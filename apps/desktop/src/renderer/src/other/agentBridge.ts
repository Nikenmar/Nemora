import { listen } from '@tauri-apps/api/event';
import { ipc } from '@platform/ipc';

import { player } from '../app/bootstrap';
import { store } from '../store';

/**
 * PLAN/22: what an AI agent asks of the view (through nemora-mcp, the app's pipe and
 * `nemora://agent-request`): playback, the queue, pages, a notice. The app has checked the access
 * level before the request gets here; the view only does it, says what it did, and answers
 * through `agent_reply`. Every change shows a notice naming the agent, so the user sees it.
 */
export type AgentBridge = {
  playSong: (songId: string, isStartPlay?: boolean) => void;
  createQueue: (queue: string[], queueType: QueueTypes, isShuffleQueue?: boolean, queueId?: string, startPlaying?: boolean) => void;
  togglePlay: (isPlay?: boolean) => void;
  next: () => void;
  previous: () => void;
  seek: (seconds: number) => void;
  setVolume: (percent: number) => void;
  setMuted: (muted: boolean) => void;
  setRepeat: (mode: RepeatTypes) => void;
  setShuffle: (on: boolean) => void;
  setSmartShuffle: (on: boolean) => void;
  updateQueue: (currentSongIndex: number | null | undefined, queue: string[]) => void;
  playAt: (index: number) => void;
  open: (page: PageTitles, data?: PageData) => void;
  notify: (text: string, icon?: string) => void;
};

let bridge: AgentBridge | null = null;

export const registerAgentBridge = (functions: AgentBridge) => {
  bridge = functions;
  return () => {
    if (bridge === functions) bridge = null;
  };
};

type Params = Record<string, unknown>;

const strings = (value: unknown, name: string): string[] => {
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) throw new Error(`${name} is a list of song ids`);
  return value as string[];
};
const number = (value: unknown, name: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${name} is a number`);
  return value;
};

const nowPlaying = () => {
  const song = store.state.currentSongData;
  const { player: state, localStorage } = store.state;
  const queue = localStorage.queue;
  return {
    songId: song?.songId ? song.songId.split(':')[0] : null,
    viewId: song?.songId ?? null,
    title: song?.title ?? null,
    artists: song?.artists?.map((a) => a.name) ?? [],
    album: song?.album?.name ?? null,
    positionSeconds: Math.round((player.currentTime || 0) * 10) / 10,
    durationSeconds: Math.round((player.duration || song?.duration || 0) * 10) / 10,
    playing: !player.paused,
    volumePercent: state.volume.value,
    muted: state.volume.isMuted,
    repeat: state.isRepeating === 'repeat-1' ? 'one' : state.isRepeating === 'repeat' ? 'all' : 'off',
    shuffle: state.isTierShuffling ? 'smart' : state.isShuffling ? 'shuffle' : 'off',
    queueLength: queue.queue.length,
    queueIndex: queue.currentSongIndex ?? null
  };
};

const PAGES: Record<string, (id?: string) => [PageTitles, PageData?]> = {
  home: () => ['Home'],
  songs: () => ['Songs'],
  albums: () => ['Albums'],
  artists: () => ['Artists'],
  playlists: () => ['Playlists'],
  genres: () => ['Genres'],
  queue: () => ['CurrentQueue'],
  lyrics: () => ['Lyrics'],
  stats: () => ['Stats'],
  taste_map: () => ['TasteMap'],
  tierlists: () => ['Tierlists'],
  settings: () => ['Settings'],
  song: (id) => ['SongInfo', { songId: id }],
  album: (id) => ['AlbumInfo', { albumId: id }],
  artist: (id) => ['ArtistInfo', { artistName: id, artistId: id }],
  genre: (id) => ['GenreInfo', { genreId: id }],
  playlist: (id) => ['PlaylistInfo', { playlistId: id }]
};

const waitForChange = (from: string | null, seconds: number) =>
  new Promise<ReturnType<typeof nowPlaying> & { changed: boolean }>((resolve) => {
    const done = (changed: boolean) => {
      unsubscribe();
      clearTimeout(timer);
      resolve({ ...nowPlaying(), changed });
    };
    const unsubscribe = store.subscribe(() => {
      const id = store.state.currentSongData?.songId ?? null;
      if (id !== from) done(true);
    });
    const timer = setTimeout(() => done(false), seconds * 1000);
  });

/** What the agent is told after an action: once the view has caught up with it (React state and
 * the player land a moment after the call), or after 1.5 s at most. */
const settled = async (done: () => boolean) => {
  for (let i = 0; i < 30 && !done(); i += 1) await new Promise((r) => setTimeout(r, 50));
  await new Promise((r) => setTimeout(r, 50));
  return nowPlaying();
};

/** Runs one request; the answer goes back to the agent, a notice to the user. */
export const runAgentRequest = async (method: string, params: Params, agent: string): Promise<unknown> => {
  for (let i = 0; i < 50 && !bridge; i += 1) await new Promise((r) => setTimeout(r, 100));
  const b = bridge;
  if (!b) throw new Error('Nemora is still starting; try again in a moment.');
  const tell = (what: string, icon = 'smart_toy') => b.notify(`${agent}: ${what}`, icon);
  const queue = () => store.state.localStorage.queue;
  switch (method) {
    case 'now':
      return nowPlaying();
    case 'queue': {
      const q = queue();
      return { songIds: q.queue.map((id) => id.split(':')[0]), currentIndex: q.currentSongIndex ?? null };
    }
    case 'wait_change': {
      const from = typeof params.fromSongId === 'string' ? params.fromSongId : (store.state.currentSongData?.songId ?? null);
      return waitForChange(from, Math.min(Math.max(Number(params.timeoutSeconds) || 120, 1), 600));
    }
    case 'play': {
      const ids = strings(params.songIds, 'songIds');
      if (ids.length === 0) throw new Error('songIds is empty');
      const start = typeof params.startIndex === 'number' ? Math.min(Math.max(params.startIndex, 0), ids.length - 1) : 0;
      b.createQueue(ids, 'songs', params.shuffle === true, undefined, start === 0);
      if (start > 0) b.playAt(start);
      tell(ids.length === 1 ? 'playing a song' : `playing ${ids.length} songs`, 'play_arrow');
      const wanted = params.shuffle === true ? null : ids[start].split(':')[0];
      return settled(() => {
        const playing = store.state.currentSongData?.songId?.split(':')[0];
        return wanted ? playing === wanted && !player.paused : !player.paused;
      });
    }
    case 'pause':
      b.togglePlay(false);
      tell('paused', 'pause');
      return settled(() => player.paused);
    case 'resume':
      b.togglePlay(true);
      tell('playing', 'play_arrow');
      return settled(() => !player.paused);
    case 'next':
    case 'previous': {
      const from = store.state.currentSongData?.songId;
      const at = player.currentTime;
      if (method === 'next') b.next();
      else b.previous();
      return settled(() => store.state.currentSongData?.songId !== from || player.currentTime < at - 1);
    }
    case 'seek': {
      const seconds = number(params.seconds, 'seconds');
      b.seek(seconds);
      return settled(() => Math.abs(player.currentTime - seconds) < 2);
    }
    case 'volume': {
      const percent = Math.round(Math.min(Math.max(number(params.percent, 'percent'), 0), 100));
      b.setVolume(percent);
      tell(`volume ${percent}%`, 'volume_up');
      return settled(() => store.state.player.volume.value === percent);
    }
    case 'mute': {
      const muted = params.muted !== false;
      b.setMuted(muted);
      return settled(() => store.state.player.volume.isMuted === muted);
    }
    case 'repeat': {
      const mode = params.mode === 'one' ? 'repeat-1' : params.mode === 'all' ? 'repeat' : 'false';
      b.setRepeat(mode);
      return settled(() => store.state.player.isRepeating === mode);
    }
    case 'shuffle': {
      const mode = params.mode;
      if (mode !== 'off' && mode !== 'shuffle' && mode !== 'smart') throw new Error('mode is off, shuffle or smart');
      if (mode === 'smart') b.setSmartShuffle(true);
      else {
        b.setSmartShuffle(false);
        b.setShuffle(mode === 'shuffle');
      }
      tell(`shuffle ${mode}`, 'shuffle');
      return settled(() => nowPlaying().shuffle === mode);
    }
    case 'queue_add': {
      const ids = strings(params.songIds, 'songIds');
      const q = queue();
      const list = [...q.queue];
      if (params.next === true) list.splice((q.currentSongIndex ?? -1) + 1, 0, ...ids);
      else list.push(...ids);
      b.updateQueue(undefined, list);
      tell(params.next === true ? `${ids.length} next in the queue` : `${ids.length} added to the queue`, 'queue');
      return { queueLength: list.length };
    }
    case 'queue_remove': {
      const positions = new Set((Array.isArray(params.positions) ? params.positions : []).map(Number));
      const q = queue();
      const current = q.currentSongIndex ?? 0;
      if (positions.has(current)) throw new Error('the song playing cannot be removed; skip it first');
      const list = q.queue.filter((_, i) => !positions.has(i));
      const before = [...positions].filter((p) => p < current).length;
      b.updateQueue(current - before, list);
      tell(`${q.queue.length - list.length} removed from the queue`, 'remove');
      return { queueLength: list.length };
    }
    case 'queue_move': {
      const from = number(params.from, 'from');
      const to = number(params.to, 'to');
      const q = queue();
      if (from < 0 || from >= q.queue.length || to < 0 || to >= q.queue.length) throw new Error('positions are out of the queue');
      const list = [...q.queue];
      const [moved] = list.splice(from, 1);
      list.splice(to, 0, moved);
      const playing = q.queue[q.currentSongIndex ?? 0];
      b.updateQueue(list.indexOf(playing), list);
      return { queueLength: list.length };
    }
    case 'queue_clear': {
      const q = queue();
      const playing = q.queue[q.currentSongIndex ?? 0];
      b.updateQueue(playing ? 0 : null, playing ? [playing] : []);
      tell('cleared the queue', 'clear_all');
      return { queueLength: playing ? 1 : 0 };
    }
    case 'open': {
      const make = PAGES[String(params.page)];
      if (!make) throw new Error(`page is one of ${Object.keys(PAGES).join(', ')}`);
      const id = typeof params.id === 'string' ? params.id : undefined;
      const [page, data] = make(id);
      if (data && !id) throw new Error(`page ${String(params.page)} needs an id`);
      b.open(page, data);
      return { opened: page };
    }
    case 'notify': {
      const text = String(params.text ?? '').slice(0, 200);
      if (!text) throw new Error('text is empty');
      tell(text, 'chat');
      return { shown: true };
    }
    default:
      throw new Error(`the view knows no ${method}`);
  }
};

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

if (isTauri) {
  void listen<{ requestId: number; method: string; params: Params | null; agent: string }>(
    'nemora://agent-request',
    ({ payload }) => {
      runAgentRequest(payload.method, payload.params ?? {}, payload.agent)
        .then((result) => ipc('agent_reply', { requestId: payload.requestId, result: (result ?? null) as never, error: null }))
        .catch((error: unknown) =>
          ipc('agent_reply', { requestId: payload.requestId, result: null, error: error instanceof Error ? error.message : String(error) })
        )
        .catch((error: unknown) => console.warn('[agent] the answer did not reach the app', error));
    }
  );
}

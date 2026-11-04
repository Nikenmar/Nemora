import { Store } from '@tanstack/react-store';
import { ipc } from '@platform/ipc';
import { registerFlush } from '@platform/runtime/flush';
import { store } from '../store';
import { setPlayingVersion, versionStore } from './soundEffects';
import { soundTag } from './soundTag';

/**
 * Switch version: the song itself takes a version's sound, with no second row. Kept per song (its
 * id, not a row), so lists, sorts and "newest" do not change; "Back to original" removes it. While
 * the song plays, its sound is applied like a version's, and the panel edits it.
 *
 * Kept in the library and in Nemora's own field of the song's files (`nemora_core::song_sound`:
 * `TXXX:NEMORA_SOUND`, `NEMORA_SOUND=`, `----:com.cmrdevs.nemora:sound`), so it travels with the
 * file; the user's notes and other tags are never touched. The setting `isSoundInFileDisabled`
 * keeps it in the library only. The file of the song that is playing, or opened ahead as the next,
 * is written when the engine has let it go (or as the app quits): a tag that grows would move the
 * audio the engine is reading.
 * localStorage is this device's quick copy for the first render; the library is the source.
 */
export type SongSound = { name: string; semitones: number; keepPitch: boolean; reverb: number; size: Size };
type Size = 'room' | 'hall' | 'vast';

const KEY = 'nemora.songSounds';
/** The id the panel's "playing version" carries for a switched song (versions have positive ids). */
export const OWN_SOUND_ID = -1;

const load = (): Record<string, SongSound> => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, SongSound>;
  } catch {
    return {};
  }
};

export const songSoundStore = new Store<Record<string, SongSound>>(load());

/** The song's own id from a row's view id (`<song>`, `<song>:<variant>` or `<song>:v<version>`). */
export const songOf = (viewId: string) => viewId.split(':')[0];

const save = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify(songSoundStore.state));
  } catch {
    /* not remembered */
  }
};

/** The pseudo-version the panel and the engine use for a switched song. */
export const ownVersionOf = (viewId: string): SongVersion | null => {
  const own = songSoundStore.state[songOf(viewId)];
  return own ? { id: OWN_SOUND_ID, songId: songOf(viewId), ...own } : null;
};

const reapplyIfPlaying = (viewId: string) => {
  const current = store.state.currentSongData;
  if (!current.songId || current.version || songOf(current.songId) !== songOf(viewId)) return;
  setPlayingVersion(ownVersionOf(viewId));
};

/** Gives the song this sound (named by its tag), or takes it away with `null`. */
export const switchSongSound = (viewId: string, sound: Omit<SongSound, 'name'> | null) => {
  const id = songOf(viewId);
  songSoundStore.setState((all) => {
    const next = { ...all };
    if (sound) next[id] = { ...sound, name: soundTag(sound) ?? 'Original' };
    else delete next[id];
    return next;
  });
  save();
  reapplyIfPlaying(viewId);
  keep(id, sound);
};

/** Keeps the panel's change to a switched song's sound (its "Save to version"). */
export const saveOwnSound = () => {
  const playing = versionStore.state;
  const current = store.state.currentSongData;
  if (!playing || playing.id !== OWN_SOUND_ID || !current.songId) return;
  const { semitones, keepPitch, reverb, size } = playing.sound;
  switchSongSound(current.songId, { semitones, keepPitch, reverb, size });
};

// ----- the library and the file ---------------------------------------------------------------

type CoreSound = { semitones: number; keepPitch: boolean; reverb: number; size: string };
const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
const toCore = (sound: Omit<SongSound, 'name'>): CoreSound => ({
  semitones: sound.semitones,
  keepPitch: sound.keepPitch,
  reverb: sound.reverb,
  size: sound.size
});
const fromCore = (sound: CoreSound): SongSound => {
  const size = (['room', 'hall', 'vast'].includes(sound.size) ? sound.size : 'hall') as Size;
  const own = { semitones: sound.semitones, keepPitch: sound.keepPitch, reverb: sound.reverb, size };
  return { ...own, name: soundTag(own) ?? 'Original' };
};

/** Songs whose file waits until the song stops playing: song id -> the sound (`null`: removed). */
const pendingFiles = new Map<string, CoreSound | null>();
const writesFiles = () => !store.state.localStorage.preferences?.isSoundInFileDisabled;
const playingSong = () => {
  const id = store.state.currentSongData?.songId;
  return id ? songOf(id) : null;
};
/** The songs whose files the engine has open: the one playing and the next, opened ahead for a gapless change. */
const openSongs = () => {
  const { queue, currentSongIndex } = store.state.localStorage.queue ?? {};
  const next = typeof currentSongIndex === 'number' ? queue?.[currentSongIndex + 1] : undefined;
  return new Set([playingSong(), next ? songOf(next) : null]);
};

const writeFile = (id: string, sound: CoreSound | null) =>
  ipc('song_sound_set', { songId: id, sound, writeFile: true })
    .then((saved) => {
      if (saved.failed.length > 0) console.warn(`[song sound] ${id}: ${saved.failed.join('; ')}`);
    })
    .catch((error: unknown) => console.warn('[song sound] the file was not written', error));

/** The files of songs that are no longer playing (all of them as the app quits). */
const flushFiles = (all = false): Promise<void> => {
  const open = all ? new Set<string | null>() : openSongs();
  const writes: Promise<void>[] = [];
  for (const [id, sound] of [...pendingFiles]) {
    if (open.has(id)) continue;
    pendingFiles.delete(id);
    writes.push(writeFile(id, sound));
  }
  return Promise.all(writes).then(() => undefined);
};

/** The library at once; the file now, or when the song stops playing. */
function keep(id: string, sound: Omit<SongSound, 'name'> | null) {
  if (!isTauri) return;
  const core = sound ? toCore(sound) : null;
  ipc('song_sound_set', { songId: id, sound: core, writeFile: false }).catch((error: unknown) =>
    console.warn('[song sound] not kept in the library', error)
  );
  if (!writesFiles()) return;
  if (openSongs().has(id)) pendingFiles.set(id, core);
  else {
    pendingFiles.delete(id);
    void writeFile(id, core);
  }
}

/**
 * At a start: the library's sounds become the songs' (a file brought one from another PC); a sound
 * only this device's copy has (made before the library kept them) goes to the library and the file.
 */
const syncWithCore = async () => {
  let core: Record<string, CoreSound>;
  try {
    core = await ipc('song_sounds');
  } catch (error) {
    console.warn('[song sound] the library did not answer', error);
    return;
  }
  const local = songSoundStore.state;
  for (const [id, sound] of Object.entries(local)) if (!(id in core)) keep(id, sound);
  songSoundStore.setState(() => ({
    ...local,
    ...Object.fromEntries(Object.entries(core).map(([id, sound]) => [id, fromCore(sound)]))
  }));
  save();
};

if (isTauri) {
  void syncWithCore();
  // A song that stops being the playing one gets its file written.
  let last = playingSong();
  store.subscribe(() => {
    const now = playingSong();
    if (now !== last) {
      last = now;
      if (pendingFiles.size > 0) void flushFiles();
    }
  });
  registerFlush(() =>
    Promise.race([flushFiles(true), new Promise<void>((resolve) => setTimeout(resolve, 2000))])
  );
}

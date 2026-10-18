/*
 * Oracle: 1.1.9 Smart Shuffle weights, Rediscover and the weighted queue order on generated
 * libraries. Regenerate with `tools/oracle/run.ps1 -Name shuffle`.
 */
import getMegaShuffleWeights from '@old/platform/core/shuffle/megaShuffle';
import refreshRediscoverPlaylist from '@old/platform/core/rediscover/rediscover';
import megaShuffleQueue from '@old/renderer/src/other/megaShuffleQueue';

const makePrng = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const prng = makePrng(1018);
const pick = <T>(list: T[]) => list[Math.floor(prng() * list.length)];
const DAY = 86_400_000;
const NOW = Date.now();
const logger = { debug: () => undefined, error: () => undefined, info: () => undefined };

const cases = [];
for (let n = 0; n < 80; n += 1) {
  const count = 3 + Math.floor(prng() * 60);
  const artists = Array.from({ length: 1 + Math.floor(prng() * 12) }, (_, i) => `artist ${n}.${i}`);
  const songs = Array.from({ length: count }, (_, i) => ({
    songId: `song${n}x${i}`,
    artists: Array.from({ length: Math.floor(prng() * 3) }, () => pick(artists))
  }));
  const ids = songs.map((s) => s.songId);
  const tierlists = Array.from({ length: Math.floor(prng() * 3) }, (_, t) => ({
    tierlistId: `t${t}`,
    influencesShuffle: prng() < 0.7,
    tiers: Array.from({ length: 1 + Math.floor(prng() * 7) }, (_, k) => ({ tierId: `k${k}`, name: `T${k}`, items: ids.filter(() => prng() < 0.15) }))
  }));
  const threshold = pick([7, 30, 90]);
  const listening = ids
    .filter(() => prng() < 0.7)
    .map((songId) => {
      // Days ago, never within two days of the threshold: the boundary is a clock question.
      let ago = Math.floor(prng() * 200);
      if (Math.abs(ago - threshold) <= 2) ago += 5;
      return { songId, fullListens: Math.floor(prng() * 20), lastAt: prng() < 0.9 ? NOW - ago * DAY : 0 };
    });
  const history = Array.from({ length: Math.floor(prng() * 50) }, () => pick(ids));
  const totalDuels = pick([0, 5, 9, 10, 40]);
  const ratings: Record<string, { rating: number; games: number; wins: number; losses: number }> = {};
  for (const id of ids)
    if (prng() < 0.4)
      ratings[id] = { rating: Math.round((1000 + prng() * 450) * 10) / 10, games: Math.floor(prng() * 9), wins: 0, losses: 0 };
  const blacklisted = ids.filter(() => prng() < 0.05);
  const intensity = pick([0, 0.3, 0.6, 1]);
  const targets = prng() < 0.3 ? [] : ids.filter(() => prng() < 0.6);

  let rediscover: string[] = [];
  const repo = {
    getSongsData: () => songs.map((s) => ({ songId: s.songId, path: s.songId, artists: s.artists.map((name) => ({ name, artistId: name })) })),
    getTierlistData: () => tierlists,
    getListeningData: () =>
      listening.map((l) => ({ songId: l.songId, fullListens: l.fullListens, listens: [{ year: 2026, listens: l.lastAt ? [[l.lastAt, 1]] : [] }] })),
    getPlaylistData: (only?: string[]) =>
      only?.includes('History') ? [{ playlistId: 'History', songs: history }] : [{ playlistId: 'Rediscover', songs: [] }],
    setPlaylistData: (playlists: { playlistId: string; songs: string[] }[]) => {
      rediscover = playlists.find((p) => p.playlistId === 'Rediscover')!.songs;
    },
    getCmrStatsData: () => ({ elo: { ratings, history: [], totalDuels } }),
    rediscoverPlaylistTemplate: { playlistId: 'Rediscover', name: 'Rediscover', songs: [] },
    emitDataUpdate: () => undefined,
    isSongBlacklisted: (songId: string) => blacklisted.includes(songId),
    logger
  };
  const weights = getMegaShuffleWeights(repo as never, targets, intensity);
  refreshRediscoverPlaylist(repo as never, threshold);

  const queue = ids.filter(() => prng() < 0.8);
  const pairFeedback = Array.from({ length: Math.floor(prng() * 6) }, () => ({ songAId: pick(ids), songBId: pick(ids), reason: 'tooDifferent' }));
  const currentSongIndex = queue.length > 0 && prng() < 0.7 ? Math.floor(prng() * queue.length) : undefined;
  const draws = Array.from({ length: queue.length + 2 }, () => prng());
  let used = 0;
  const { shuffledQueue } = megaShuffleQueue(queue, { weights, pairFeedback } as never, currentSongIndex, () => draws[used++]);

  cases.push({
    songs, tierlists, listening, history, totalDuels, ratings, blacklisted, intensity, targets, threshold,
    cutoff: NOW - threshold * DAY, weights, rediscover, queue, pairFeedback, currentSongIndex: currentSongIndex ?? null, draws, shuffledQueue
  });
}

process.stdout.write(JSON.stringify({ generatedFrom: '1.1.9 (326f15b)', cases }));

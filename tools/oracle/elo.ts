/*
 * Oracle: runs 1.1.9's duel matchmaker and rating math on generated scenarios and prints the
 * inputs with the answers. Randomness is a recorded list of numbers, so the Rust port can replay
 * the very same draws (tests/elo_oracle.rs). Regenerate with `tools/oracle/run.ps1 -Name elo`.
 */
import {
  calculateEloDeltas,
  getEffectiveEloRating,
  getNormalizedEloScore,
  getPositiveEloScore,
  orderDuelSongIds,
  selectAdaptiveOpponent,
  selectDuelAnchor
} from '@old/platform/core/stats/duelMatchmaker';

// mulberry32: only generates the inputs and the recorded draws; the port never reimplements it.
const makePrng = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const DAY = 86_400_000;
const NOW = 1_790_000_000_000;
const prng = makePrng(20261018);
const pick = <T>(list: T[]) => list[Math.floor(prng() * list.length)];
const some = <T>(list: T[], p: number) => list.filter(() => prng() < p);

const GENRES = ['phonk', 'rock', 'lofi', 'trance', 'jazz'];
const ARTISTS = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'];
const ALBUMS = ['al1', 'al2', 'al3'];
const PLAYLISTS = ['p1', 'p2'];
const TIERLISTS = ['t1'];
const REASONS = ['tooClose', 'tooDifferent', 'cantDecide'] as const;

const scenarios = [];
for (let n = 0; n < 300; n += 1) {
  const count = 2 + Math.floor(prng() * 30);
  const ids = Array.from({ length: count }, (_, i) => `s${n}-${i}`);
  const songs = ids.map((songId) => ({
    songId,
    artistIds: some(ARTISTS, 0.25),
    genreIds: some(GENRES, 0.3),
    albumId: prng() < 0.5 ? pick(ALBUMS) : undefined,
    playlistIds: some(PLAYLISTS, 0.3),
    tierlistIds: some(TIERLISTS, 0.3)
  }));
  const ratings: Record<string, { rating: number; games: number; wins: number; losses: number; draws: number; lastDuelAt?: number }> = {};
  for (const id of ids) {
    if (prng() < 0.3) continue;
    const games = Math.floor(prng() * 12);
    ratings[id] = {
      rating: Math.round((1000 + prng() * 450) * 10) / 10,
      games,
      wins: Math.floor(games / 2),
      losses: games - Math.floor(games / 2),
      draws: 0,
      ...(prng() < 0.8 ? { lastDuelAt: NOW - Math.floor(prng() * 60 * DAY) } : {})
    };
  }
  const history = Array.from({ length: Math.floor(prng() * 60) }, (_, i) => {
    const a = pick(ids);
    let b = pick(ids);
    if (b === a) b = ids[(ids.indexOf(a) + 1) % ids.length];
    return { at: NOW - i * 3_600_000, songAId: a, songBId: b, winner: pick(['A', 'B', 'draw'] as const), deltaA: 0, deltaB: 0 };
  });
  const skippedPairs = Array.from({ length: Math.floor(prng() * 6) }, () => {
    const a = pick(ids);
    let b = pick(ids);
    if (b === a) b = ids[(ids.indexOf(a) + 1) % ids.length];
    return { at: NOW - Math.floor(prng() * 200 * DAY), songAId: a, songBId: b, reason: pick([...REASONS]) };
  });
  const candidates = Array.from({ length: Math.floor(prng() * 12) }, () => ({
    songId: prng() < 0.9 ? pick(ids) : 'unknown',
    listenedAt: NOW - Math.floor(prng() * 10 * DAY)
  }));
  const eligible = some(ids, 0.85);
  const excluded = some(ids, 0.1);

  const draws = Array.from({ length: 400 }, () => prng());
  let used = 0;
  const random = () => draws[used++];
  const elo = { ratings, history, totalDuels: history.length };

  const anchor = selectDuelAnchor(candidates, new Set(eligible), new Set(excluded), elo as never, NOW, random) ?? null;
  const anchorForOpponent = anchor ?? ids[0];
  const opponent = selectAdaptiveOpponent(anchorForOpponent, songs, elo as never, skippedPairs as never, NOW, random) ?? null;
  const order = opponent ? orderDuelSongIds(anchorForOpponent, opponent, random) : null;

  scenarios.push({
    songs, ratings, history, skippedPairs, candidates, eligible, excluded, draws: draws.slice(0, used + 5),
    anchor, anchorForOpponent, opponent, order, used
  });
}

const deltas = Array.from({ length: 200 }, () => {
  const a = Math.round((900 + prng() * 700) * 10) / 10;
  const b = Math.round((900 + prng() * 700) * 10) / 10;
  const score = pick([0, 0.5, 1] as const);
  return { a, b, score, result: calculateEloDeltas(a, b, score) };
});

const scores = Array.from({ length: 200 }, () => {
  const rating = { rating: Math.round((900 + prng() * 700) * 10) / 10, games: Math.floor(prng() * 9), wins: 0, losses: 0 };
  return {
    rating,
    effective: getEffectiveEloRating(rating as never),
    normalized: getNormalizedEloScore(rating as never),
    positive: getPositiveEloScore(rating as never)
  };
});

process.stdout.write(JSON.stringify({ generatedFrom: '1.1.9 (326f15b)', now: NOW, scenarios, deltas, scores }));

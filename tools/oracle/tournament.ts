/*
 * Oracle: 1.1.9 tournaments on generated brackets. Each case creates a bracket, then plays it
 * through with tracks dropping out of the library along the way, recording every state.
 * Regenerate with `tools/oracle/run.ps1 -Name tournament`.
 */
import {
  createTournament,
  getCurrentTournamentMatch,
  reconcileTournament,
  recordTournamentWinner
} from '@old/platform/core/stats/tournaments';

const makePrng = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const prng = makePrng(7);
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';
const id = () => Array.from({ length: 26 }, () => ALPHABET[Math.floor(prng() * 32)]).join('');

const cases = [];
for (let n = 0; n < 24; n += 1) {
  const size = ([8, 16, 32] as const)[n % 3];
  const songIds = Array.from({ length: size + Math.floor(prng() * 20) }, id);
  const ratings: Record<string, { rating: number; games: number; wins: number; losses: number }> = {};
  for (const songId of songIds) {
    if (prng() < 0.4) continue;
    ratings[songId] = { rating: Math.round((1050 + prng() * 300) * 10) / 10, games: Math.floor(prng() * 8), wins: 0, losses: 0 };
  }
  const elo = { ratings, history: [], totalDuels: 0 };
  const createdAt = 1_790_000_000_000 + Math.floor(prng() * 1e9);
  let state = createTournament(songIds, elo as never, size, createdAt);
  const created = state;
  const available = new Set(songIds);
  const steps = [];
  for (let guard = 0; guard < 100; guard += 1) {
    if (prng() < 0.15) {
      const gone = songIds[Math.floor(prng() * songIds.length)];
      available.delete(gone);
      state = reconcileTournament(state, available);
      steps.push({ remove: gone, state });
      continue;
    }
    const current = getCurrentTournamentMatch(state);
    if (!current) break;
    const winner = prng() < 0.5 ? current.songAId! : current.songBId!;
    state = recordTournamentWinner(state, current.id, winner, available);
    steps.push({ play: current.id, winner, state });
  }
  cases.push({ songIds, ratings, size, createdAt, created, steps });
}

process.stdout.write(JSON.stringify({ generatedFrom: '1.1.9 (326f15b)', cases }));

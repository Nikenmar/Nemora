import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import megaShuffleQueue from '@renderer/other/megaShuffleQueue';

/**
 * PLAN/21 P21.6: the equivalence suite of Smart Shuffle's order. The view's `megaShuffleQueue` is
 * the oracle; its Rust port (`nemora-core/src/mega_order.rs`) runs the same cases in
 * `crates/nemora-core/tests/mega_order.rs` and must give the same order for every one.
 *
 * The cases are generated here from a fixed seed and written with the oracle's answer to
 * `crates/nemora-core/tests/data/mega-order-cases.json`; this test fails when the file is not what
 * the oracle says now. Regenerate: `NEMORA_WRITE_MEGA_CASES=1 npm test -- megaOrderCases`.
 */
const FILE = resolve(__dirname, '../../../../../crates/nemora-core/tests/data/mega-order-cases.json');
const CASES = 400;

const seeded = (seed: number) => {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 0x100000000;
  };
};

type Case = {
  songIds: string[];
  data: MegaShuffleData;
  currentIndex: number | null;
  draws: number[];
  expected: { shuffledQueue: string[]; positions: number[] };
};

/** A case from a seed: sizes, versions, held songs, artists, energy, neighbours, pairs and indexes vary. */
const makeCase = (seed: number): Case => {
  const r = seeded(seed * 7919 + 13);
  const pick = <T>(items: T[]) => items[Math.floor(r() * items.length)];
  const n = pick([0, 1, 2, 3, 5, 10, 30, 60, 120, 400]);
  const songs = Array.from({ length: n }, (_, i) => `s${i}`);
  // Some rows are a song's versions (`song:variant`), some songs come twice.
  const songIds = songs.map((id) => (r() < 0.1 ? `${pick(songs)}:${1 + Math.floor(r() * 3)}` : r() < 0.03 ? pick(songs) : id));
  // Weights in steps of 1/64 (exact in binary): some missing (the default), some tiny, some large.
  const weights: Record<string, number> = {};
  for (const id of songs) if (r() < 0.9) weights[id] = pick([1 / 64, 0.25, 0.5, 0.75, 1, 1.5, 3]) * (1 + Math.floor(r() * 4) / 4);
  // Records from before reasoned feedback have no reason.
  const pairFeedback = Array.from({ length: Math.floor(r() * Math.min(n, 20)) }, () => {
    const reason = pick(['tooDifferent', 'tooDifferent', 'tooClose', undefined]);
    return {
      ...(reason ? { reason } : {}),
      songAId: pick(songIds.length ? songIds : ['none']),
      songBId: pick(songIds.length ? songIds : ['none'])
    };
  });
  const data = { weights, pairFeedback } as unknown as MegaShuffleData & Record<string, unknown>;
  if (r() < 0.4) data.held = songs.filter(() => r() < 0.1);
  if (r() < 0.6) data.artists = Object.fromEntries(songs.filter(() => r() < 0.9).map((id) => [id, r() < 0.05 ? [] : [Math.floor(r() * 6), ...(r() < 0.2 ? [Math.floor(r() * 6)] : [])]]));
  if (r() < 0.5) data.energy = Object.fromEntries(songs.filter(() => r() < 0.8).map((id) => [id, Math.floor(r() * 16) / 16]));
  if (r() < 0.4) data.neighbours = Object.fromEntries(songs.filter(() => r() < 0.3).map((id) => [id, r() < 0.1 ? [] : songs.filter(() => r() < 0.05)]));
  const currentIndex = n === 0 ? pick([null, 0]) : pick([null, null, 0, Math.floor(r() * n), n - 1, n, -1]);
  // The draws the oracle takes, recorded: multiples of 2^-32, exact in JSON.
  const draws: number[] = [];
  const random = seeded(seed + 1);
  const recording = () => {
    const value = random();
    draws.push(value);
    return value;
  };
  const expected = megaShuffleQueue(songIds, data, currentIndex ?? undefined, recording);
  return { songIds, data, currentIndex, draws, expected };
};

describe('mega order cases', () => {
  it('the equivalence cases are what the oracle says now', () => {
    const cases = Array.from({ length: CASES }, (_, i) => makeCase(i + 1));
    const text = `${JSON.stringify(cases)}\n`;
    if (process.env.NEMORA_WRITE_MEGA_CASES) writeFileSync(FILE, text);
    let committed = '';
    try {
      committed = readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n');
    } catch {
      /* missing: fails below */
    }
    expect(committed === text, 'regenerate: NEMORA_WRITE_MEGA_CASES=1 npm test -- megaOrderCases').toBe(true);
  });
});

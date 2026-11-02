import { describe, expect, it } from 'vitest';
import megaShuffleQueue from '@renderer/other/megaShuffleQueue';

/**
 * PLAN/21 P21.0: Smart Shuffle's ordering, frozen as it is. Every case runs with a seeded random
 * source, and its order is the snapshot taken from today's code; a change in any rule (weights,
 * too-different pairs, artist spacing, held songs, energy flow, following the map, one turn per
 * song) shows as a snapshot difference.
 */
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

const ids = (n: number) => Array.from({ length: n }, (_, i) => `s${String(i).padStart(3, '0')}`);

const base = (songs: string[]): MegaShuffleData =>
  ({
    weights: Object.fromEntries(songs.map((id, i) => [id, 0.1 + ((i * 37) % 10) / 10])),
    pairFeedback: []
  }) as unknown as MegaShuffleData;

describe('megaShuffleQueue', () => {
  const songs = ids(40);

  it('orders by weight with a seeded random source', () => {
    expect(megaShuffleQueue(songs, base(songs), undefined, seeded(1)).shuffledQueue).toMatchSnapshot();
    expect(megaShuffleQueue(songs, base(songs), undefined, seeded(2)).shuffledQueue).toMatchSnapshot();
  });

  it('keeps the current song first and reports where it went', () => {
    expect(megaShuffleQueue(songs, base(songs), 7, seeded(3))).toMatchSnapshot();
  });

  it('keeps too-different pairs apart', () => {
    const data = base(songs);
    (data as unknown as { pairFeedback: unknown[] }).pairFeedback = [
      { reason: 'tooDifferent', songAId: 's001', songBId: 's002' },
      { reason: 'tooDifferent', songAId: 's003', songBId: 's004' },
      { reason: 'tooClose', songAId: 's005', songBId: 's006' }
    ];
    expect(megaShuffleQueue(songs, data, undefined, seeded(4)).shuffledQueue).toMatchSnapshot();
  });

  it('spaces artists, holds songs back, follows energy and the map', () => {
    const data = {
      ...base(songs),
      artists: Object.fromEntries(songs.map((id, i) => [id, [i % 5]])),
      held: ['s010', 's011', 's012'],
      energy: Object.fromEntries(songs.map((id, i) => [id, (i * 7) % 10 / 10])),
      neighbours: { s000: ['s020', 's021', 's022'] }
    } as unknown as MegaShuffleData;
    expect(megaShuffleQueue(songs, data, 0, seeded(5))).toMatchSnapshot();
  });

  it('gives a song and its versions one turn', () => {
    const withVersions = [...songs.slice(0, 12), 's000:v1', 's000:v2', 's003:v5'];
    expect(megaShuffleQueue(withVersions, base(songs), undefined, seeded(6)).shuffledQueue).toMatchSnapshot();
  });

  it('is the same for the same random source', () => {
    const a = megaShuffleQueue(songs, base(songs), undefined, seeded(9)).shuffledQueue;
    const b = megaShuffleQueue(songs, base(songs), undefined, seeded(9)).shuffledQueue;
    expect(a).toEqual(b);
    expect([...a].sort()).toEqual([...songs].sort());
  });
});

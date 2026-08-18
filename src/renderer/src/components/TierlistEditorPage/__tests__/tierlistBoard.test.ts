import { describe, expect, test } from '@jest/globals';

import { incrementalBoard, seedBoard } from '../tierlistBoard';

/**
 * The rule under test cost a real tierlist twice, and both times it looked like
 * the reattachment after a library rebuild had failed - the ranking was simply
 * gone. It had not failed. The editor drew only songs the current SOURCE offers,
 * dropped the rest from the board, and then saved the board.
 *
 * So: a placement survives while its song still exists. Being outside the source
 * decides what is offered in the pool and nothing else.
 */
const song = (songId: string): SongData => ({ songId, title: songId }) as unknown as SongData;

const tierlist = (items: string[]): SavableTierlist =>
  ({
    tierlistId: 't',
    name: 'ranking',
    tiers: [{ tierId: 'S', name: 'S', items }]
  }) as unknown as SavableTierlist;

const placedIds = (board: { tiers: Record<string, { id: string }[]> }, tierId = 'S') =>
  (board.tiers[tierId] ?? []).map((item) => item.id);

describe('the tierlist board', () => {
  test('keeps a ranked song whose source no longer offers it', () => {
    const tl = tierlist(['ranked']);
    const songMap = { ranked: song('ranked'), fromSource: song('fromSource') };
    const seeded = seedBoard(tl, ['fromSource'], songMap);

    // The user switched the source to a playlist that does not contain the
    // ranked track. Its card stays where they put it.
    expect(placedIds(seeded)).toEqual(['ranked']);
    // ...and the pool still only offers what the source has.
    expect(seeded.pool.map((item) => item.id)).toEqual(['fromSource']);

    const next = incrementalBoard(seeded, tl, ['fromSource'], songMap);
    expect(placedIds(next)).toEqual(['ranked']);
  });

  test('drops a ranked song that has left the library', () => {
    const tl = tierlist(['gone', 'kept']);
    const before = seedBoard(tl, [], { gone: song('gone'), kept: song('kept') });
    expect(placedIds(before)).toEqual(['gone', 'kept']);

    // `songMap` is what the editor can draw at all; a song missing from it is a
    // song the library no longer has, and the catalog keeps it as an orphan.
    const after = incrementalBoard(before, tl, [], { kept: song('kept') });
    expect(placedIds(after)).toEqual(['kept']);
  });

  test('an empty source does not empty the ranking', () => {
    const tl = tierlist(['a', 'b']);
    const songMap = { a: song('a'), b: song('b') };

    const seeded = seedBoard(tl, [], songMap);
    expect(placedIds(seeded)).toEqual(['a', 'b']);
    expect(seeded.pool).toEqual([]);

    expect(placedIds(incrementalBoard(seeded, tl, [], songMap))).toEqual(['a', 'b']);
  });

  test('a song added to the source appears in the pool without disturbing placements', () => {
    const tl = tierlist(['ranked']);
    const songMap = { ranked: song('ranked'), fresh: song('fresh') };
    const seeded = seedBoard(tl, [], { ranked: song('ranked') });

    const next = incrementalBoard(seeded, tl, ['fresh'], songMap);

    expect(placedIds(next)).toEqual(['ranked']);
    expect(next.pool.map((item) => item.id)).toEqual(['fresh']);
  });

  test('a rebuilt library keeps the placement on its new id', () => {
    const tl = tierlist(['old-id']);
    const seeded = seedBoard(tl, [], { 'old-id': song('old-id') });

    // What a folder removed and added back looks like from here: the same track
    // under a new id, with the dedup remap pointing the old one at it.
    const next = incrementalBoard(seeded, tl, ['new-id'], { 'new-id': song('new-id') }, {
      'old-id': 'new-id'
    });

    expect(placedIds(next)).toEqual(['new-id']);
    expect(next.pool).toEqual([]);
  });
});

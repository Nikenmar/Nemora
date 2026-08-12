import { dedupeListeningRows, hasDuplicateListeningRows } from '../mergeListeningData';

const row = (songId: string, listens: number) => ({
  songId,
  listens: [{ year: 2026, listens: [[1_780_000_000_000, listens]] as [number, number][] }],
  skips: listens
});

describe('listening data deduplication', () => {
  test('keeps the LAST row per song, matching Electron getListeningData', () => {
    // Each pre-3.3.0 duplicate was a snapshot of the whole row taken after an
    // update, so the final one already holds the accumulated history. Summing
    // them is what inflated a real profile from 4,502 listens to 32,452.
    const rows = [row('a', 1), row('b', 5), row('a', 9)];
    const result = dedupeListeningRows(rows);

    expect(result).toHaveLength(2);
    expect(result.find((r) => r.songId === 'a')?.skips).toBe(9);
  });

  test('leaves an already-unique list untouched, identities included', () => {
    const rows = [row('a', 1), row('b', 2)];
    const result = dedupeListeningRows(rows);

    expect(result).toHaveLength(2);
    expect(result[0]).toBe(rows[0]);
    expect(result[1]).toBe(rows[1]);
  });

  test('an empty profile stays empty', () => {
    expect(dedupeListeningRows([])).toEqual([]);
  });

  test('detects duplicates without modifying anything', () => {
    expect(hasDuplicateListeningRows([row('a', 1), row('a', 2)])).toBe(true);
    expect(hasDuplicateListeningRows([row('a', 1), row('b', 2)])).toBe(false);
  });

  test('totals collapse to the last snapshot rather than their sum', () => {
    const rows = [row('a', 3), row('a', 7), row('a', 11)];
    const total = dedupeListeningRows(rows).reduce(
      (sum, r) => sum + r.listens[0].listens[0][1],
      0
    );

    expect(total).toBe(11);
  });
});

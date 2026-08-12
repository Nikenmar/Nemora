/**
 * Collapses duplicate listening rows on READ, exactly as Electron does.
 *
 * Builds before 3.3.0 updated the first matching row and then pushed the same
 * snapshot again, so `listening_data.json` grew a new row per listen. The write
 * bug was fixed on 2026-07-19 (commit 4505f6f2), but every profile that ran an
 * older build still carries the rows: one real library holds 4,932 rows for
 * 1,039 songs.
 *
 * Electron never showed that damage, because `getListeningData`
 * (src/main/filesystem.ts:516) rebuilt the list through a Map keyed by songId,
 * which keeps the LAST row for each song. The port read every row and summed
 * them, reporting 32,452 listens where Electron reported 4,502 - a 7.2x
 * inflation that turned the statistics page into nonsense on the first day
 * someone looked at it.
 *
 * Last-row-wins is not an arbitrary tie-break: each duplicate was a snapshot of
 * the whole row taken after an update, so the final one already contains the
 * accumulated history. Merging by timestamp instead would produce numbers that
 * disagree with what the Electron build has shown this user for months, and
 * parity with the existing build is the point.
 */

export interface ListeningRowLike {
  songId: string;
}

/**
 * One row per songId, keeping the last occurrence. Rows that are already unique
 * come back in their original order and identity, so a healthy profile pays
 * nothing beyond the scan.
 */
export function dedupeListeningRows<T extends ListeningRowLike>(rows: readonly T[]): T[] {
  return [...new Map(rows.map((row) => [row.songId, row] as const)).values()];
}

/** True when any songId appears more than once. */
export function hasDuplicateListeningRows(rows: readonly ListeningRowLike[]): boolean {
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.songId)) return true;
    seen.add(row.songId);
  }
  return false;
}

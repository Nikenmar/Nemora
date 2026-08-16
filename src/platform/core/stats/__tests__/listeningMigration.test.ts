import { describe, expect, test } from '@jest/globals';

import { countersFromLegacyRows, deriveListeningRows, mergeCounterFiles } from '../listeningEvents';

const fingerprint = (
  songId: string,
  title: string,
  fileName: string,
  duration: number,
  artists: string[]
): SongFingerprint => ({ songId, title, fileName, duration, artists });

const songFrom = (identity: SongFingerprint, songId = identity.songId): SavableSongData => ({
  songId,
  title: identity.title,
  artists: identity.artists.map((name, index) => ({ artistId: `artist-${index}`, name })),
  duration: identity.duration,
  isAFavorite: false,
  isArtworkAvailable: false,
  path: `D:\\Music\\${identity.fileName}`,
  addedDate: 1
});

const totalListens = (rows: readonly SongListeningData[]): number =>
  rows.reduce(
    (total, row) =>
      total +
      row.listens.reduce(
        (rowTotal, year) =>
          rowTotal + year.listens.reduce((yearTotal, [, count]) => yearTotal + count, 0),
        0
      ),
    0
  );

const totalOf = (rows: readonly SongListeningData[], field: 'fullListens' | 'skips'): number =>
  rows.reduce((total, row) => total + (row[field] ?? 0), 0);

const firstIdentity = fingerprint(
  'legacy-midnight-id',
  'Midnight Drive',
  '01 Midnight Drive.flac',
  181.87,
  ['The Driver']
);
const secondIdentity = fingerprint('legacy-waves-id', 'Slow Waves', '02 Slow Waves.flac', 244.2, [
  'Guest Singer',
  'Sea Glass'
]);

const realisticLegacyRows = (): SongListeningData[] => [
  {
    songId: firstIdentity.songId,
    listens: [
      {
        year: 2025,
        listens: [
          [new Date(2025, 11, 30).getTime(), 3],
          [new Date(2025, 11, 31).getTime(), 2]
        ]
      }
    ],
    fullListens: 4,
    skips: 1,
    inNoOfPlaylists: 2,
    seeks: [
      { position: 18, seeks: 2 },
      { position: 95, seeks: 1 }
    ],
    fingerprint: firstIdentity
  },
  {
    songId: secondIdentity.songId,
    listens: [
      { year: 2025, listens: [[new Date(2025, 11, 31).getTime(), 7]] },
      { year: 2026, listens: [[new Date(2026, 0, 1).getTime(), 1]] }
    ],
    fullListens: 5,
    skips: 2,
    inNoOfPlaylists: 4,
    seeks: [{ position: 42, seeks: 3 }],
    fingerprint: secondIdentity
  }
];

describe('listening counter migration', () => {
  test('preserves listen, full-listen, and skip totals when legacy rows are derived again', () => {
    const legacyRows = realisticLegacyRows();
    const migrated = countersFromLegacyRows(legacyRows, 'migration-source', 'install-a');
    const derived = deriveListeningRows(
      migrated.file,
      [songFrom(firstIdentity), songFrom(secondIdentity)],
      legacyRows
    );

    expect(migrated).toMatchObject({ migrated: 2, skipped: 0 });
    expect(totalListens(derived)).toBe(totalListens(legacyRows));
    expect(totalOf(derived, 'fullListens')).toBe(totalOf(legacyRows, 'fullListens'));
    expect(totalOf(derived, 'skips')).toBe(totalOf(legacyRows, 'skips'));
  });

  test('is idempotent when the same legacy data is migrated twice', () => {
    const legacyRows = realisticLegacyRows();
    const before = structuredClone(legacyRows);
    const first = countersFromLegacyRows(legacyRows, 'migration-source', 'install-a');
    const second = countersFromLegacyRows(legacyRows, 'migration-source', 'install-a');

    expect(second).toEqual(first);
    expect(mergeCounterFiles(first.file, second.file)).toEqual(first.file);
    expect(legacyRows).toEqual(before);
  });

  test('reports a row without a fingerprint as skipped without dropping or guessing it', () => {
    const orphan: SongListeningData = {
      songId: 'legacy-without-identity',
      listens: [{ year: 2026, listens: [[new Date(2026, 3, 8).getTime(), 9]] }],
      fullListens: 6,
      skips: 3,
      inNoOfPlaylists: 1,
      seeks: [{ position: 30, seeks: 2 }]
    };
    const legacyRows = [orphan];
    const before = structuredClone(legacyRows);

    const migrated = countersFromLegacyRows(legacyRows, 'migration-source', 'install-a');

    expect(migrated.migrated).toBe(0);
    expect(migrated.skipped).toBe(1);
    expect(migrated.file.tracks).toEqual({});
    expect(migrated.file.counters).toEqual({});
    expect(legacyRows).toEqual(before);
    expect(legacyRows[0]).toBe(orphan);
  });

  test('preserves seeks and playlist membership verbatim in derived rows', () => {
    const legacyRows = realisticLegacyRows();
    const migrated = countersFromLegacyRows(legacyRows, 'migration-source', 'install-a');
    const derived = deriveListeningRows(
      migrated.file,
      [songFrom(firstIdentity), songFrom(secondIdentity)],
      legacyRows
    );

    for (const legacyRow of legacyRows) {
      const derivedRow = derived.find((row) => row.songId === legacyRow.songId);
      expect(derivedRow).toBeDefined();
      expect(derivedRow?.seeks).toEqual(legacyRow.seeks);
      expect(derivedRow?.inNoOfPlaylists).toBe(legacyRow.inNoOfPlaylists);
    }
  });
});

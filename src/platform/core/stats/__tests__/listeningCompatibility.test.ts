import { describe, expect, test } from '@jest/globals';

import {
  createCounterFile,
  deriveListeningRows,
  mergeCounterFiles,
  recordListening,
  trackKeyOf,
  type ListeningCounterFile,
  type ListeningKind
} from '../listeningEvents';

const fingerprint = (
  songId: string,
  overrides: Partial<SongFingerprint> = {}
): SongFingerprint => ({
  songId,
  title: 'Midnight Drive',
  artists: ['The Driver'],
  duration: 181.87,
  fileName: '01 Midnight Drive.flac',
  ...overrides
});

const songFrom = (identity: SongFingerprint, songId = identity.songId): SavableSongData => ({
  songId,
  title: identity.title,
  artists: identity.artists.map((name, index) => ({ artistId: `artist-${index}`, name })),
  duration: identity.duration,
  isAFavorite: false,
  isArtworkAvailable: false,
  path: `D:\\Rebuilt Library\\${identity.fileName}`,
  addedDate: 1
});

const recordMany = (
  file: ListeningCounterFile,
  identity: SongFingerprint,
  kind: ListeningKind,
  count: number,
  atMs: number,
  sourceId: string
): ListeningCounterFile => {
  let result = file;
  for (let index = 0; index < count; index += 1)
    result = recordListening(result, identity, kind, atMs, sourceId);
  return result;
};

const listensIn = (row: SongListeningData | undefined): number =>
  row?.listens.reduce(
    (total, year) => total + year.listens.reduce((yearTotal, [, count]) => yearTotal + count, 0),
    0
  ) ?? 0;

describe('listening counter compatibility', () => {
  test('adds counters from another install once and makes re-merging a no-op', () => {
    const localIdentity = fingerprint('local-song-id');
    const foreignIdentity = fingerprint('foreign-song-id');
    const atMs = new Date(2026, 4, 12, 12).getTime();

    let local = createCounterFile('install-a');
    local = recordMany(local, localIdentity, 'listen', 2, atMs, 'install-a');
    let foreign = createCounterFile('install-b');
    foreign = recordMany(foreign, foreignIdentity, 'listen', 3, atMs, 'install-b');

    const mergedOnce = mergeCounterFiles(local, foreign);
    const mergedTwice = mergeCounterFiles(mergedOnce, foreign);
    const currentSong = songFrom(localIdentity);

    expect(mergedOnce.installId).toBe('install-a');
    expect(listensIn(deriveListeningRows(mergedOnce, [currentSong], [])[0])).toBe(5);
    expect(mergedTwice).toEqual(mergedOnce);
    expect(listensIn(deriveListeningRows(mergedTwice, [currentSong], [])[0])).toBe(5);
  });

  test('keeps counts when a rebuilt library gives the same track a new songId', () => {
    const oldIdentity = fingerprint('old-random-id');
    const rebuiltIdentity = fingerprint('new-random-id');
    const rebuiltSong = songFrom(rebuiltIdentity);
    const atMs = new Date(2026, 5, 20, 14).getTime();

    let file = createCounterFile('install-a');
    file = recordMany(file, oldIdentity, 'listen', 7, atMs, 'install-a');
    file = recordMany(file, oldIdentity, 'fullListen', 5, atMs, 'install-a');
    file = recordMany(file, oldIdentity, 'skip', 2, atMs, 'install-a');

    const derived = deriveListeningRows(file, [rebuiltSong], []);

    expect(trackKeyOf(oldIdentity)).toBe(trackKeyOf(rebuiltIdentity));
    expect(derived).toHaveLength(1);
    expect(derived[0]).toMatchObject({
      songId: 'new-random-id',
      fullListens: 5,
      skips: 2
    });
    expect(listensIn(derived[0])).toBe(7);
    expect(derived[0].fingerprint).toBeDefined();
  });

  test('buckets plays by local day across both ends of midnight', () => {
    const identity = fingerprint('local-song-id');
    const firstDayStart = new Date(2026, 4, 12).getTime();
    const nextDayStart = new Date(2026, 4, 13).getTime();
    const early = new Date(2026, 4, 12, 0, 30).getTime();
    const late = new Date(2026, 4, 12, 23, 30).getTime();
    const nextDay = new Date(2026, 4, 13, 0, 30).getTime();

    let file = createCounterFile('install-a');
    file = recordListening(file, identity, 'listen', early, 'install-a');
    file = recordListening(file, identity, 'listen', late, 'install-a');
    file = recordListening(file, identity, 'listen', nextDay, 'install-a');

    const key = trackKeyOf(identity);
    expect(file.counters[key]['install-a']).toEqual({
      '2026-05-12': { l: 2, h: { '0': 1, '23': 1 } },
      '2026-05-13': { l: 1, h: { '0': 1 } }
    });

    const derived = deriveListeningRows(file, [songFrom(identity)], []);
    const buckets = derived[0].listens.flatMap((year) => year.listens);
    expect(new Map(buckets)).toEqual(
      new Map([
        [firstDayStart, 2],
        [nextDayStart, 1]
      ])
    );
  });
});

import { describe, expect, test } from '@jest/globals';

import {
  countersFromLegacyRows,
  createCounterFile,
  deriveListeningRows,
  mergeCounterFiles,
  recordListening,
  trackKeyOf
} from '../listeningEvents';

const identity = (songId = 'song-a'): SongFingerprint => ({
  songId,
  title: '  A Track ',
  artists: ['Second Artist', ' First Artist '],
  duration: 161.87,
  fileName: ' TRACK.FLAC '
});

const song = (songId = 'song-a'): SavableSongData => ({
  songId,
  title: 'A Track',
  artists: [
    { artistId: 'first', name: 'First Artist' },
    { artistId: 'second', name: 'Second Artist' }
  ],
  duration: 161.9,
  path: 'E:\\Music\\track.flac',
  isAFavorite: false,
  isArtworkAvailable: false,
  addedDate: 1
});

describe('listening event counters', () => {
  test('content keys ignore songId, case, surrounding whitespace, artist order, and parser decimals', () => {
    expect(trackKeyOf(identity('old-id'))).toBe(
      trackKeyOf({
        ...identity('new-id'),
        title: 'a track',
        artists: ['first artist', 'SECOND ARTIST'],
        duration: 161.9,
        fileName: 'track.flac'
      })
    );
  });

  test('recording is pure and increments only the selected source/day metric', () => {
    const empty = createCounterFile('install-a');
    const atMs = new Date(2026, 7, 16, 23, 30).getTime();
    const once = recordListening(empty, identity(), 'listen', atMs, 'source-a');
    const twice = recordListening(once, identity(), 'listen', atMs, 'source-a');

    expect(empty).toEqual(createCounterFile('install-a'));
    expect(twice.counters[trackKeyOf(identity())]).toEqual({
      'source-a': { '2026-08-16': { l: 2, h: { '23': 2 } } }
    });
  });

  test('records hours for listens only and merges every hour by maximum', () => {
    const noon = new Date(2026, 7, 16, 12).getTime();
    const evening = new Date(2026, 7, 16, 18).getTime();
    let base = recordListening(createCounterFile('base'), identity(), 'listen', noon, 'shared');
    base = recordListening(base, identity(), 'listen', noon, 'shared');
    let incoming = recordListening(
      createCounterFile('incoming'),
      identity('other'),
      'listen',
      noon,
      'shared'
    );
    incoming = recordListening(incoming, identity('other'), 'listen', evening, 'shared');
    incoming = recordListening(incoming, identity('other'), 'fullListen', evening, 'shared');
    incoming = recordListening(incoming, identity('other'), 'skip', evening, 'shared');

    const counts = mergeCounterFiles(base, incoming).counters[trackKeyOf(identity())].shared[
      '2026-08-16'
    ];

    expect(counts).toEqual({ l: 2, f: 1, s: 1, h: { '12': 2, '18': 1 } });
  });

  test('merge takes a value-wise maximum without mutating either input', () => {
    const atMs = new Date(2026, 7, 16, 12).getTime();
    let base = recordListening(createCounterFile('base'), identity(), 'listen', atMs, 'shared');
    base = recordListening(base, identity(), 'listen', atMs, 'shared');
    const incoming = recordListening(
      recordListening(createCounterFile('incoming'), identity('other'), 'skip', atMs, 'shared'),
      identity('other'),
      'listen',
      atMs,
      'shared'
    );
    const baseBefore = structuredClone(base);
    const incomingBefore = structuredClone(incoming);

    const merged = mergeCounterFiles(base, incoming);

    expect(merged.installId).toBe('base');
    expect(merged.counters[trackKeyOf(identity())].shared['2026-08-16']).toEqual({
      l: 2,
      s: 1,
      h: { '12': 2 }
    });
    expect(base).toEqual(baseBefore);
    expect(incoming).toEqual(incomingBefore);
    expect(mergeCounterFiles(merged, incoming)).toEqual(merged);
  });

  test('merge is structurally idempotent even when a stored metric is explicitly zero', () => {
    const file = createCounterFile('install-a');
    const key = trackKeyOf(identity());
    file.tracks[key] = identity();
    file.counters[key] = { 'install-a': { '2026-08-16': { l: 0 } } };

    expect(mergeCounterFiles(file, file)).toEqual(file);
  });

  test('undated legacy scalars use the sentinel day and still derive with empty listens', () => {
    const legacy: SongListeningData = {
      songId: 'song-a',
      listens: [],
      fullListens: 4,
      skips: 2,
      fingerprint: identity()
    };
    const migrated = countersFromLegacyRows([legacy], 'source-a', 'install-a');
    const key = trackKeyOf(identity());

    expect(migrated.file.counters[key]['source-a']['1970-01-01']).toEqual({ f: 4, s: 2 });
    expect(migrated.file.counters[key]['source-a']['1970-01-01'].h).toBeUndefined();
    expect(deriveListeningRows(migrated.file, [song()], [legacy])[0]).toMatchObject({
      songId: 'song-a',
      listens: [],
      fullListens: 4,
      skips: 2
    });
  });

  test('legacy scalars use the latest local listen day when one exists', () => {
    const earlier = new Date(2026, 0, 2, 23, 30).getTime();
    const latest = new Date(2026, 0, 4, 0, 30).getTime();
    const migrated = countersFromLegacyRows(
      [
        {
          songId: 'song-a',
          listens: [
            {
              year: 2026,
              listens: [
                [latest, 1],
                [earlier, 2]
              ]
            }
          ],
          fullListens: 2,
          skips: 1,
          fingerprint: identity()
        }
      ],
      'source-a',
      'install-a'
    );
    const days = migrated.file.counters[trackKeyOf(identity())]['source-a'];

    expect(days['2026-01-02']).toEqual({ l: 2 });
    expect(days['2026-01-04']).toEqual({ l: 1, f: 2, s: 1 });
    expect(Object.values(days).every((counts) => counts.h === undefined)).toBe(true);
  });

  test('passes through legacy-only rows verbatim', () => {
    const legacyOnly: SongListeningData = {
      songId: 'unidentified',
      listens: [{ year: 2026, listens: [[1, 9]] }],
      seeks: [{ position: 12, seeks: 3 }]
    };

    const result = deriveListeningRows(createCounterFile('install-a'), [song()], [legacyOnly]);

    expect(result).toEqual([legacyOnly]);
    expect(result[0]).toBe(legacyOnly);
  });
});

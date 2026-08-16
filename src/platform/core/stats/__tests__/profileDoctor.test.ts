import { createCounterFile, recordListening, trackKeyOf } from '../listeningEvents';
import { inspectProfile } from '../profileDoctor';
import { fingerprintOfSong } from '../songFingerprint';

const song = (songId: string, overrides: Partial<SavableSongData> = {}): SavableSongData => ({
  songId,
  title: `Title ${songId}`,
  artists: [{ artistId: 'artist', name: 'Artist' }],
  duration: 180,
  isAFavorite: false,
  isArtworkAvailable: false,
  path: `D:\\Music\\${songId}.flac`,
  addedDate: 1,
  ...overrides
});

describe('inspectProfile', () => {
  test('reports every identity and file-integrity problem without changing the profile', () => {
    const first = song('song-1', {
      title: 'Collision',
      path: 'D:\\Music\\A\\same.flac'
    });
    const second = song('song-2', {
      title: 'Collision',
      path: 'D:\\Music\\B\\same.flac'
    });
    const missing = song('song-3');
    const detachedSong = song('old-song', { path: 'D:\\Music\\detached.flac' });
    const listeningData: SongListeningData[] = [
      { songId: 'song-1', listens: [] },
      { songId: 'song-1', listens: [] },
      { songId: 'old-song', listens: [], fingerprint: fingerprintOfSong(detachedSong) },
      { songId: 'unknown-song', listens: [] }
    ];
    const foreignSong = song('foreign', { path: 'E:\\Elsewhere\\foreign.flac' });
    const listeningCounters = recordListening(
      createCounterFile('install'),
      fingerprintOfSong(foreignSong),
      'listen',
      new Date(2026, 7, 16, 12).getTime(),
      'source-b'
    );
    listeningCounters.counters[trackKeyOf(fingerprintOfSong(foreignSong))]['source-a'] = {};
    const exists = jest.fn((path: string) => path !== missing.path);
    const snapshot = JSON.stringify({ listeningData, listeningCounters });

    const report = inspectProfile({
      songs: [first, second, missing],
      listeningData,
      listeningCounters,
      exists
    });

    expect(report.recoverableOrphanedListeningRows).toEqual([{ rowIndex: 2, songId: 'old-song' }]);
    expect(report.unidentifiableOrphanedListeningRows).toEqual([
      { rowIndex: 3, songId: 'unknown-song' }
    ]);
    expect(report.duplicateListeningRows).toEqual([{ songId: 'song-1', rowIndexes: [0, 1] }]);
    expect(report.trackKeyCollisions).toEqual([
      {
        trackKey: trackKeyOf(fingerprintOfSong(first)),
        songIds: ['song-1', 'song-2']
      }
    ]);
    expect(report.missingLibraryFiles).toEqual([{ songId: 'song-3', path: missing.path }]);
    expect(report.unmatchedCounterTracks).toEqual([
      {
        trackKey: trackKeyOf(fingerprintOfSong(foreignSong)),
        sourceIds: ['source-a', 'source-b'],
        fingerprint: fingerprintOfSong(foreignSong)
      }
    ]);
    expect(exists).toHaveBeenCalledTimes(3);
    expect(JSON.stringify({ listeningData, listeningCounters })).toBe(snapshot);
  });

  test('returns an empty report for a healthy profile', () => {
    const liveSong = song('live');
    const listeningCounters = recordListening(
      createCounterFile('install'),
      fingerprintOfSong(liveSong),
      'listen',
      new Date(2026, 7, 16, 12).getTime(),
      'install'
    );

    expect(
      inspectProfile({
        songs: [liveSong],
        listeningData: [{ songId: 'live', listens: [] }],
        listeningCounters,
        exists: () => true
      })
    ).toEqual({
      recoverableOrphanedListeningRows: [],
      unidentifiableOrphanedListeningRows: [],
      duplicateListeningRows: [],
      trackKeyCollisions: [],
      missingLibraryFiles: [],
      unmatchedCounterTracks: []
    });
  });
});

import { fingerprintOfSong, relinkOrphanedListeningRows } from '../songFingerprint';

/**
 * The regression this guards is not a crash, it is a year of listening history
 * quietly detaching from the music it belongs to.
 *
 * Real shape of the failure, taken from a profile that hit it: a library
 * rebuilt on one day, 1260 of 1280 listening rows left pointing at ids that no
 * longer existed, and nothing on disk to reattach them by. Rows that carry a
 * fingerprint come back; rows that do not, cannot, and must not be guessed at.
 */

const song = (songId: string, overrides: Partial<SavableSongData> = {}): SavableSongData => ({
  songId,
  title: `Title ${songId}`,
  artists: [{ artistId: `artist-${songId}`, name: `Artist ${songId}` }],
  duration: 200,
  isAFavorite: false,
  isArtworkAvailable: false,
  path: `D:\\Music\\${songId}.flac`,
  addedDate: 1,
  ...overrides
});

const row = (
  songId: string,
  listens: number,
  fingerprint?: SongFingerprint
): SongListeningData => ({
  songId,
  listens: [{ year: 2026, listens: [[1_770_000_000_000, listens]] }],
  fullListens: listens,
  ...(fingerprint ? { fingerprint } : {})
});

describe('relinkOrphanedListeningRows', () => {
  test('reattaches history when the same files come back under new ids', () => {
    // The library as it was: the row recorded who it belonged to.
    const before = song('old-1', { title: 'Midnight Drive', path: 'D:\\Music\\midnight.flac' });
    const history = row('old-1', 40, fingerprintOfSong(before));

    // The library as it is after a rebuild: same file, brand new id.
    const after = song('new-1', { title: 'Midnight Drive', path: 'D:\\Music\\midnight.flac' });

    const { rows, relinked } = relinkOrphanedListeningRows([history], [after]);

    expect(relinked).toBe(1);
    expect(rows[0].songId).toBe('new-1');
    expect(rows[0].fullListens).toBe(40);
    // The fingerprint is refreshed from the song it now names.
    expect(rows[0].fingerprint?.songId).toBe('new-1');
  });

  test('leaves rows written before fingerprints existed alone', () => {
    const orphan = row('old-1', 40);
    const after = song('new-1', { title: 'Midnight Drive', path: 'D:\\Music\\midnight.flac' });

    const { rows, relinked } = relinkOrphanedListeningRows([orphan], [after]);

    expect(relinked).toBe(0);
    expect(rows[0].songId).toBe('old-1');
  });

  test('refuses to guess when two tracks fit the fingerprint', () => {
    const before = song('old-1', { title: 'Intro', path: 'D:\\Music\\intro.flac' });
    const history = row('old-1', 12, fingerprintOfSong(before));
    // Two copies of the same file name and duration in different folders: the
    // history could belong to either, so it belongs to neither.
    const first = song('new-1', { title: 'Intro', path: 'D:\\Music\\A\\intro.flac' });
    const second = song('new-2', { title: 'Intro', path: 'D:\\Music\\B\\intro.flac' });

    const { rows, relinked } = relinkOrphanedListeningRows([history], [first, second]);

    expect(relinked).toBe(0);
    expect(rows[0].songId).toBe('old-1');
  });

  test('never overwrites history the new id has already accumulated', () => {
    const before = song('old-1', { title: 'Midnight Drive', path: 'D:\\Music\\midnight.flac' });
    const detached = row('old-1', 40, fingerprintOfSong(before));
    const after = song('new-1', { title: 'Midnight Drive', path: 'D:\\Music\\midnight.flac' });
    // Played a few times after the rebuild, before the old history was noticed.
    const fresh = row('new-1', 3, fingerprintOfSong(after));

    const { rows, relinked } = relinkOrphanedListeningRows([detached, fresh], [after]);

    expect(relinked).toBe(0);
    expect(rows.filter((entry) => entry.songId === 'new-1')).toHaveLength(1);
    expect(rows.find((entry) => entry.songId === 'new-1')?.fullListens).toBe(3);
    // The detached row survives untouched rather than being merged or dropped.
    expect(rows.find((entry) => entry.songId === 'old-1')?.fullListens).toBe(40);
  });

  test('matches by title and artists when the file was renamed', () => {
    const before = song('old-1', {
      title: 'Slow Waves',
      artists: [{ artistId: 'a1', name: 'Artist Two' }],
      duration: 184.5,
      path: 'D:\\Music\\01 slow waves.flac'
    });
    const history = row('old-1', 22, fingerprintOfSong(before));
    const after = song('new-1', {
      title: 'Slow Waves',
      artists: [{ artistId: 'a9', name: 'Artist Two' }],
      duration: 185,
      path: 'D:\\Music\\Renamed\\slow-waves.flac'
    });

    const { rows, relinked } = relinkOrphanedListeningRows([history], [after]);

    expect(relinked).toBe(1);
    expect(rows[0].songId).toBe('new-1');
  });

  test('is a no-op when nothing is detached', () => {
    const live = song('new-1');
    const rows = [row('new-1', 5, fingerprintOfSong(live))];

    expect(relinkOrphanedListeningRows(rows, [live])).toEqual({ rows, relinked: 0 });
  });
});

import {
  fingerprintOfSong,
  relinkOrphanedListeningRows,
  relinkOrphanedRatings,
  relinkOrphanedTierlistItems
} from '../songFingerprint';

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

describe('relinkOrphanedRatings', () => {
  test('reattaches the rating, history, and skip feedback without mutating the input', () => {
    const before = song('old-1', { title: 'Slow Waves', path: 'D:\\Music\\slow.flac' });
    const after = song('new-1', { title: 'Slow Waves', path: 'D:\\Music\\slow.flac' });
    const cmrStats: CmrStatsData = {
      elo: {
        ratings: {
          'old-1': {
            rating: 1312,
            games: 4,
            wins: 3,
            losses: 1,
            fingerprint: fingerprintOfSong(before)
          } as EloSongRating & { fingerprint: SongFingerprint }
        },
        history: [
          {
            at: 1,
            songAId: 'old-1',
            songBId: 'other',
            winner: 'A',
            deltaA: 12,
            deltaB: -12
          }
        ],
        totalDuels: 1
      },
      importedStatsExportIds: [],
      duelMatchmaking: {
        skippedPairs: [{ at: 2, songAId: 'other', songBId: 'old-1', reason: 'cantDecide' }]
      }
    };

    const result = relinkOrphanedRatings(cmrStats, [after]);
    const rating = result.cmrStats.elo.ratings['new-1'] as EloSongRating & {
      fingerprint?: SongFingerprint;
    };

    expect(result.relinked).toBe(1);
    expect(result.cmrStats.elo.ratings).not.toHaveProperty('old-1');
    expect(rating).toMatchObject({ rating: 1312, fingerprint: { songId: 'new-1' } });
    expect(result.cmrStats.elo.history[0]).toMatchObject({
      songAId: 'new-1',
      songBId: 'other'
    });
    expect(result.cmrStats.duelMatchmaking?.skippedPairs[0]).toMatchObject({
      songAId: 'other',
      songBId: 'new-1'
    });
    expect(cmrStats.elo.ratings).toHaveProperty('old-1');
    expect(cmrStats.elo.history[0].songAId).toBe('old-1');
  });

  test('does not overwrite a rating already accumulated under the new id', () => {
    const before = song('old-1', { path: 'D:\\Music\\same.flac' });
    const after = song('new-1', { path: 'D:\\Music\\same.flac' });
    const cmrStats: CmrStatsData = {
      elo: {
        ratings: {
          'old-1': {
            rating: 1400,
            games: 8,
            wins: 6,
            losses: 2,
            fingerprint: fingerprintOfSong(before)
          } as EloSongRating & { fingerprint: SongFingerprint },
          'new-1': { rating: 1210, games: 1, wins: 1, losses: 0 }
        },
        history: [],
        totalDuels: 0
      },
      importedStatsExportIds: []
    };

    const result = relinkOrphanedRatings(cmrStats, [after]);

    expect(result.relinked).toBe(0);
    expect(result.cmrStats.elo.ratings['new-1'].rating).toBe(1210);
    expect(result.cmrStats.elo.ratings).toHaveProperty('old-1');
  });
});

describe('relinkOrphanedTierlistItems', () => {
  test('restores a card to its stored tier and position', () => {
    const before = song('old-1', { title: 'Slow Waves', path: 'D:\\Music\\slow.flac' });
    const after = song('new-1', { title: 'Slow Waves', path: 'D:\\Music\\slow.flac' });
    const tierlists: SavableTierlist[] = [
      {
        tierlistId: 'tierlist',
        name: 'Ranking',
        createdDate: new Date(0),
        sourcePlaylistIds: [],
        tiers: [
          {
            tierId: 's',
            name: 'S',
            items: ['keep'],
            orphanedItems: [{ songId: 'old-1', index: 0, fingerprint: fingerprintOfSong(before) }]
          } as TierRow & {
            orphanedItems: Array<{
              songId: string;
              index: number;
              fingerprint: SongFingerprint;
            }>;
          }
        ],
        labelMode: 'track'
      }
    ];

    const result = relinkOrphanedTierlistItems(tierlists, [after]);
    const tier = result.tierlists[0].tiers[0] as TierRow & { orphanedItems?: unknown[] };

    expect(result.relinked).toBe(1);
    expect(tier.items).toEqual(['new-1', 'keep']);
    expect(tier.orphanedItems).toBeUndefined();
    expect(tierlists[0].tiers[0].items).toEqual(['keep']);
  });

  test('keeps the detached placement when the fingerprint is ambiguous', () => {
    const before = song('old-1', { title: 'Intro', path: 'D:\\Music\\intro.flac' });
    const tier = {
      tierId: 's',
      name: 'S',
      items: [],
      orphanedItems: [{ songId: 'old-1', index: 0, fingerprint: fingerprintOfSong(before) }]
    } as TierRow & {
      orphanedItems: Array<{ songId: string; index: number; fingerprint: SongFingerprint }>;
    };
    const tierlist: SavableTierlist = {
      tierlistId: 'tierlist',
      name: 'Ranking',
      createdDate: new Date(0),
      sourcePlaylistIds: [],
      tiers: [tier],
      labelMode: 'track'
    };
    const first = song('new-1', { title: 'Intro', path: 'D:\\Music\\A\\intro.flac' });
    const second = song('new-2', { title: 'Intro', path: 'D:\\Music\\B\\intro.flac' });

    const result = relinkOrphanedTierlistItems([tierlist], [first, second]);

    expect(result.relinked).toBe(0);
    expect((result.tierlists[0].tiers[0] as typeof tier).orphanedItems[0].songId).toBe('old-1');
  });
});

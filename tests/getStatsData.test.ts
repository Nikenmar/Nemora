import getStatsData from '../src/platform/core/stats/getStatsData';
import type { StatsDataRepo } from '../src/platform/core/stats/getStatsData';

const DAY_MS = 24 * 60 * 60 * 1000;

const song = (songId: string, title = songId): SavableSongData => ({
  songId,
  title,
  duration: 200,
  isAFavorite: false,
  isArtworkAvailable: true,
  path: `C:\\music\\${songId}.mp3`,
  addedDate: 1
});

const listening = (
  songId: string,
  datesMs: number[],
  fullListens = 0,
  skips = 0
): SongListeningData => ({
  songId,
  fullListens,
  skips,
  listens: [{ year: 2026, listens: datesMs.map((dateMs) => [dateMs, 1] as [number, number]) }]
});

const emptyCmrStats = (): CmrStatsData => ({
  elo: { ratings: {}, history: [], totalDuels: 0 },
  importedStatsExportIds: []
});

const createRepo = (overrides: Partial<StatsDataRepo> = {}): StatsDataRepo => ({
  getSongsData: () => [],
  getListeningData: () => [],
  getPlaylistData: () => [],
  getGenresData: () => [],
  getCmrStatsData: () => emptyCmrStats(),
  getSongArtworkPath: (id) => ({
    isDefaultArtwork: false,
    artworkPath: `nemora://art/${id}.webp`,
    optimizedArtworkPath: `nemora://art/${id}-optimized.webp`
  }),
  isSongBlacklisted: () => false,
  logger: { debug: jest.fn() },
  ...overrides
});

describe('ported getStatsData', () => {
  test('totals: range-filtered listens, all-time full listens and skips, favorites count', () => {
    const now = Date.now();
    const repo = createRepo({
      getSongsData: () => [song('a'), song('b'), song('c')],
      getListeningData: () => [
        listening('a', [now - 5 * DAY_MS], 2, 3),
        listening('b', [now - 400 * DAY_MS], 1, 0),
        listening('c', [now - 2 * DAY_MS], 0, 1)
      ],
      getPlaylistData: (ids?: string[]) =>
        ids?.length
          ? [{ playlistId: 'Favorites', name: 'Favorites', createdDate: new Date(), songs: ['a', 'b'], isArtworkAvailable: true }]
          : []
    });

    const allTime = getStatsData(repo, 'allTime');
    expect(allTime.totals.totalListens).toBe(3);
    expect(allTime.totals.fullListens).toBe(3);
    expect(allTime.totals.skips).toBe(4);
    expect(allTime.totals.favorites).toBe(2);
    expect(allTime.totals.distinctSongsPlayed).toBe(3);
    expect(allTime.totals.approxListeningTimeSec).toBe(600);

    const last30 = getStatsData(repo, 'last30Days');
    expect(last30.totals.totalListens).toBe(2); // b's listen is outside the window
    expect(last30.totals.fullListens).toBe(3); // all-time scalar, range-independent
  });

  test('top songs sort by listens desc with title tiebreak and exclude blacklisted', () => {
    const now = Date.now();
    const repo = createRepo({
      getSongsData: () => [song('a', 'A Song'), song('b', 'B Song'), song('hidden', 'Hidden')],
      getListeningData: () => [
        listening('a', [now - DAY_MS], 0, 0),
        listening('b', [now - 2 * DAY_MS], 0, 0),
        listening('hidden', [now - 3 * DAY_MS], 0, 0)
      ],
      isSongBlacklisted: (songId) => songId === 'hidden'
    });

    const { topSongs } = getStatsData(repo, 'allTime');
    expect(topSongs.map((s) => s.songId)).toEqual(['a', 'b']);
    expect(topSongs[0]).toMatchObject({
      title: 'A Song',
      artists: [],
      artworkPath: 'nemora://art/a.webp',
      listensInRange: 1
    });
  });

  test('activity: last30Days produces 30 daily buckets ending today', () => {
    const now = Date.now();
    const threeDaysAgo = now - 3 * DAY_MS;
    const repo = createRepo({
      getListeningData: () => [listening('a', [threeDaysAgo])]
    });

    const { activity } = getStatsData(repo, 'last30Days');
    expect(activity).toHaveLength(30);
    expect(activity[26].listens).toBe(1); // three days ago
    expect(activity[27].listens).toBe(0);
    expect(activity[29].listens).toBe(0); // today's bucket stays empty
  });

  test('activity: 12 monthly buckets ending at the current month', () => {
    const now = Date.now();
    const repo = createRepo({
      getListeningData: () => [listening('a', [now - 2 * 30 * DAY_MS])]
    });

    const { activity } = getStatsData(repo, 'last12Months');
    expect(activity).toHaveLength(12);
    expect(activity.reduce((sum, bucket) => sum + bucket.listens, 0)).toBe(1);
    expect(activity[11].label).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('calendar: current streak survives a silent today, longest streak and most active day', () => {
    const now = Date.now();
    const yesterday = now - 1 * DAY_MS;
    const twoDaysAgo = now - 2 * DAY_MS;
    const repo = createRepo({
      getListeningData: () => [listening('a', [yesterday, twoDaysAgo])]
    });

    const { calendar } = getStatsData(repo, 'allTime');
    expect(calendar.days).toHaveLength(371);
    expect(calendar.currentStreak).toBe(2);
    expect(calendar.longestStreak).toBe(2);
    expect(calendar.mostActiveDay?.listens).toBe(1);
  });

  test('most skipped ranks by the all-time skips scalar', () => {
    const now = Date.now();
    const repo = createRepo({
      getSongsData: () => [song('a'), song('b')],
      getListeningData: () => [
        listening('a', [now - DAY_MS], 0, 7),
        listening('b', [now - DAY_MS], 0, 3)
      ]
    });

    const { mostSkipped } = getStatsData(repo, 'allTime');
    expect(mostSkipped.map((s) => s.songId)).toEqual(['a', 'b']);
    expect(mostSkipped[0].skips).toBe(7);
  });

  test('genre fallback aggregates the genre store when songs carry no genre refs', () => {
    const now = Date.now();
    const repo = createRepo({
      getSongsData: () => [song('a'), song('b')],
      getListeningData: () => [
        listening('a', [now - DAY_MS]),
        listening('b', [now - 2 * DAY_MS])
      ],
      getGenresData: () => [
        {
          genreId: 'g1',
          name: 'Rock',
          songs: [
            { title: 'A', songId: 'a' },
            { title: 'B', songId: 'b' }
          ]
        }
      ]
    });

    const { topGenres } = getStatsData(repo, 'allTime');
    expect(topGenres).toEqual([{ name: 'Rock', listens: 2 }]);
  });

  test('ELO section surfaces top-rated songs by effective rating and recent duels', () => {
    const now = Date.now();
    const repo = createRepo({
      getSongsData: () => [song('rated'), song('plain')],
      getCmrStatsData: () => ({
        ...emptyCmrStats(),
        elo: {
          ratings: {
            rated: { rating: 1400, games: 5, wins: 4, losses: 1, draws: 0 }
          },
          history: [
            {
              at: now,
              songAId: 'rated',
              songBId: 'plain',
              winner: 'A',
              deltaA: 16,
              deltaB: -16
            }
          ],
          totalDuels: 1
        }
      })
    });

    const { elo } = getStatsData(repo, 'allTime');
    expect(elo.totalDuels).toBe(1);
    expect(elo.topRated).toHaveLength(1);
    expect(elo.topRated[0]).toMatchObject({
      songId: 'rated',
      rating: 1400,
      effectiveRating: 1400,
      isProvisional: false,
      games: 5,
      wins: 4,
      losses: 1,
      draws: 0
    });
    expect(elo.recentDuels[0]).toMatchObject({
      titleA: 'rated',
      titleB: 'plain',
      winner: 'A',
      deltaA: 16,
      deltaB: -16
    });
  });
});

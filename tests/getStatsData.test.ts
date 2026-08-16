import { getStatsData, type StatsDataRepo } from '../src/platform/core/stats/getStatsData';
import { createCounterFile, recordListening } from '../src/platform/core/stats/listeningEvents';
import { fingerprintOfSong } from '../src/platform/core/stats/songFingerprint';

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
  getListeningCounters: () => createCounterFile('test-install'),
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
          ? [
              {
                playlistId: 'Favorites',
                name: 'Favorites',
                createdDate: new Date(),
                songs: ['a', 'b'],
                isArtworkAvailable: true
              }
            ]
          : []
    });

    const allTime = getStatsData(repo, 'allTime');
    expect(allTime.totals.totalListens).toBe(3);
    expect(allTime.totals.fullListens).toBe(3);
    expect(allTime.totals.skips).toBe(4);
    expect(allTime.totals.favorites).toBe(2);
    expect(allTime.totals.distinctSongsPlayed).toBe(3);
    expect(allTime.totals.approxListeningTimeSec).toBe(600);
    expect(allTime.scopes).toEqual({
      totalListens: 'range',
      fullListens: 'allTime',
      skips: 'allTime',
      distinctSongsPlayed: 'range',
      approxListeningTimeSec: 'range',
      favorites: 'range',
      activity: 'range',
      calendar: 'allTime',
      topSongs: 'range',
      topArtists: 'range',
      topAlbums: 'range',
      topGenres: 'range',
      mostSkipped: 'allTime',
      elo: 'allTime'
    });

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
      getSongsData: () => [song('a')],
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
      getSongsData: () => [song('a')],
      getListeningData: () => [listening('a', [now - 2 * 30 * DAY_MS])]
    });

    const { activity } = getStatsData(repo, 'last12Months');
    expect(activity).toHaveLength(12);
    expect(activity.reduce((sum, bucket) => sum + bucket.listens, 0)).toBe(1);
    expect(activity[11].label).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('year ranges filter every dated figure and show January through December', () => {
    const january2025 = new Date(2025, 0, 4, 12).getTime();
    const december2025 = new Date(2025, 11, 20, 12).getTime();
    const june2026 = new Date(2026, 5, 2, 12).getTime();
    const repo = createRepo({
      getSongsData: () => [song('a'), song('b')],
      getListeningData: () => [
        listening('a', [january2025, december2025, june2026], 7, 3),
        listening('b', [june2026], 2, 1)
      ]
    });

    const stats = getStatsData(repo, 'year:2025');

    expect(stats.availableYears).toEqual([2026, 2025]);
    expect(stats.totals).toMatchObject({
      totalListens: 2,
      distinctSongsPlayed: 1,
      approxListeningTimeSec: 400,
      fullListens: 9,
      skips: 4
    });
    expect(stats.topSongs.map((entry) => entry.songId)).toEqual(['a']);
    expect(stats.activity).toHaveLength(12);
    expect(stats.activity[0]).toEqual({ label: '2025-01-01', listens: 1 });
    expect(stats.activity[11]).toEqual({ label: '2025-12-01', listens: 1 });
    expect(stats.activity.reduce((total, month) => total + month.listens, 0)).toBe(2);

    const emptyYear = getStatsData(repo, 'year:2030');
    expect(emptyYear.availableYears).toEqual([2026, 2025]);
    expect(emptyYear.totals).toMatchObject({
      totalListens: 0,
      distinctSongsPlayed: 0,
      approxListeningTimeSec: 0,
      fullListens: 9,
      skips: 4
    });
    expect(emptyYear.activity).toHaveLength(12);
    expect(emptyYear.activity.every((month) => month.listens === 0)).toBe(true);
    expect(emptyYear.weekdayHistogram).toEqual(new Array<number>(7).fill(0));
  });

  test('hour data starts when counters first record it while weekdays cover legacy rows', () => {
    const trackedSong = song('a');
    const sundayBefore = new Date(2023, 11, 31, 23, 30).getTime();
    const monday = new Date(2024, 0, 1, 5, 30).getTime();
    const tuesday = new Date(2024, 0, 2, 6, 30).getTime();
    const sunday = new Date(2024, 0, 7, 7, 30).getTime();
    let counters = createCounterFile('install-a');
    counters = recordListening(
      counters,
      fingerprintOfSong(trackedSong),
      'listen',
      sundayBefore,
      'install-a'
    );
    counters = recordListening(
      counters,
      fingerprintOfSong(trackedSong),
      'listen',
      monday,
      'install-a'
    );
    counters = recordListening(
      counters,
      fingerprintOfSong(trackedSong),
      'listen',
      monday,
      'install-a'
    );
    const repo = createRepo({
      getSongsData: () => [trackedSong],
      getListeningData: () => [listening('a', [monday, tuesday, sunday])],
      getListeningCounters: () => counters
    });

    const stats = getStatsData(repo, 'year:2024');

    expect(stats.weekdayHistogram).toEqual([1, 1, 0, 0, 0, 0, 1]);
    expect(stats.hourHistogram).toHaveLength(24);
    expect(stats.hourHistogram.reduce((total, count) => total + count, 0)).toBe(2);
    expect(stats.hourHistogram[5]).toBe(2);
    expect(stats.hourHistogram[23]).toBe(0);
    expect(stats.hourDataSince).toBe(new Date(2023, 11, 31).getTime());
  });

  test('legacy-only day buckets expose no invented hour data', () => {
    const atMs = new Date(2024, 0, 1, 12).getTime();
    const stats = getStatsData(
      createRepo({
        getSongsData: () => [song('a')],
        getListeningData: () => [listening('a', [atMs])]
      }),
      'year:2024'
    );

    expect(stats.hourHistogram).toEqual(new Array<number>(24).fill(0));
    expect(stats.hourDataSince).toBeNull();
  });

  test('calendar: current streak survives a silent today, longest streak and most active day', () => {
    const now = Date.now();
    const yesterday = now - 1 * DAY_MS;
    const twoDaysAgo = now - 2 * DAY_MS;
    const repo = createRepo({
      getSongsData: () => [song('a')],
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
      getListeningData: () => [listening('a', [now - DAY_MS]), listening('b', [now - 2 * DAY_MS])],
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

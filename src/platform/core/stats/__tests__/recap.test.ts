import { buildRecap, type RecapInput, type RecapSlide } from '../recap';

const at = (year: number, month: number, day: number) =>
  new Date(year, month - 1, day, 12).getTime();

const song = (songId: string, title: string, artist: string, duration = 180): SavableSongData => ({
  songId,
  title,
  artists: [{ artistId: artist.toLowerCase(), name: artist }],
  duration,
  isAFavorite: false,
  isArtworkAvailable: false,
  path: `D:\\Music\\${songId}.flac`,
  addedDate: 1
});

const row = (songId: string, listens: [number, number][]): SongListeningData => ({
  songId,
  listens: [{ year: 2025, listens }]
});

const find = <Kind extends RecapSlide['kind']>(slides: RecapSlide[], kind: Kind) =>
  slides.find((slide): slide is Extract<RecapSlide, { kind: Kind }> => slide.kind === kind);

describe('buildRecap', () => {
  const songs = [
    song('a', 'Aurora', 'Mira', 120),
    song('b', 'Bloom', 'Mira', 240),
    song('c', 'Comet', 'Nova', 180)
  ];
  const listeningData = [
    row('a', [
      [at(2024, 12, 31), 1],
      [at(2025, 1, 2), 2],
      [at(2025, 1, 3), 3],
      [at(2025, 2, 1), 1]
    ]),
    row('b', [
      [at(2025, 1, 2), 4],
      [at(2025, 1, 4), 1]
    ]),
    row('c', [[at(2025, 2, 5), 10]])
  ];

  test('builds month slides from local calendar boundaries and reports the share of the year', () => {
    const slides = buildRecap({ songs, listeningData }, { kind: 'month', year: 2025, month: 1 });

    expect(find(slides, 'listening')).toEqual({
      kind: 'listening',
      totalListens: 10,
      approxListeningTimeSec: 1800,
      year: 2025,
      yearTotalListens: 21,
      yearShare: 10 / 21
    });
    expect(find(slides, 'topSongs')?.songs.map(({ title, listens }) => [title, listens])).toEqual([
      ['Aurora', 5],
      ['Bloom', 5]
    ]);
    expect(find(slides, 'topArtist')).toMatchObject({
      artist: 'Mira',
      listens: 10,
      peakMonth: 1,
      peakMonthListens: 10
    });
    expect(find(slides, 'mostActiveDay')).toMatchObject({
      date: '2025-01-02',
      listens: 6,
      topSong: { title: 'Bloom', listens: 4 }
    });
    expect(find(slides, 'longestStreak')).toEqual({
      kind: 'longestStreak',
      days: 3,
      startDate: '2025-01-02',
      endDate: '2025-01-04'
    });
  });

  test('includes only a discovery whose first listen is inside the period and it repeats', () => {
    const slides = buildRecap({ songs, listeningData }, { kind: 'year', year: 2025 });

    expect(find(slides, 'discovery')).toMatchObject({
      song: { songId: 'c', title: 'Comet', listens: 10 },
      firstListenDate: '2025-02-05'
    });
    expect(find(slides, 'topSongs')?.songs[0]).toMatchObject({ songId: 'c', listens: 10 });
    expect(find(slides, 'listening')?.yearShare).toBe(1);
  });

  test('uses the highest current tier placement among songs heard in the period', () => {
    const tierlists: SavableTierlist[] = [
      {
        tierlistId: 'tiers',
        name: 'Forever favorites',
        createdDate: new Date(0),
        sourcePlaylistIds: [],
        labelMode: 'track',
        tiers: [
          { tierId: 's', name: 'S', items: ['b'] },
          { tierId: 'a', name: 'A', items: ['a'] }
        ]
      }
    ];

    expect(
      find(
        buildRecap({ songs, listeningData, tierlists }, { kind: 'month', year: 2025, month: 1 }),
        'tierlist'
      )
    ).toMatchObject({
      song: { songId: 'b' },
      tierlistName: 'Forever favorites',
      tierName: 'S'
    });
  });

  test('sums duel deltas in the period and omits a zero or unavailable climber', () => {
    const cmrStats = {
      importedStatsExportIds: [],
      elo: {
        ratings: {},
        totalDuels: 3,
        history: [
          { at: at(2025, 1, 5), songAId: 'a', songBId: 'b', winner: 'A', deltaA: 16, deltaB: -16 },
          { at: at(2025, 1, 6), songAId: 'a', songBId: 'c', winner: 'A', deltaA: 8, deltaB: -8 },
          { at: at(2025, 2, 6), songAId: 'b', songBId: 'c', winner: 'B', deltaA: -10, deltaB: 10 }
        ]
      }
    } satisfies CmrStatsData;

    const january = buildRecap(
      { songs, listeningData, cmrStats },
      { kind: 'month', year: 2025, month: 1 }
    );
    expect(find(january, 'eloClimber')).toMatchObject({
      song: { songId: 'a' },
      ratingGain: 24,
      duels: 2
    });

    const withoutDuels = buildRecap(
      { songs, listeningData },
      { kind: 'month', year: 2025, month: 1 }
    );
    expect(find(withoutDuels, 'eloClimber')).toBeUndefined();
  });

  test('degrades to one honest listening slide when the period has no data', () => {
    const input: RecapInput = { songs, listeningData, tierlists: [] };

    expect(buildRecap(input, { kind: 'month', year: 2023, month: 7 })).toEqual([
      {
        kind: 'listening',
        totalListens: 0,
        approxListeningTimeSec: 0,
        year: 2023,
        yearTotalListens: 0,
        yearShare: 0
      }
    ]);
  });

  test('rejects invalid calendar periods', () => {
    expect(() =>
      buildRecap({ songs, listeningData }, { kind: 'month', year: 2025, month: 0 })
    ).toThrow(RangeError);
  });
});

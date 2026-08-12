import getMegaShuffleWeights, { getMegaShuffleData, tierValue } from '../src/platform/core/shuffle/megaShuffle';
import type { MegaShuffleRepo } from '../src/platform/core/shuffle/megaShuffle';

const song = (
  songId: string,
  artists: { artistId: string; name: string }[] = []
): SavableSongData => ({
  songId,
  title: songId,
  duration: 200,
  isAFavorite: false,
  isArtworkAvailable: true,
  path: `C:\\music\\${songId}.mp3`,
  addedDate: 1,
  artists
});

const emptyCmrStats = (): CmrStatsData => ({
  elo: { ratings: {}, history: [], totalDuels: 0 },
  importedStatsExportIds: [],
  duelMatchmaking: { skippedPairs: [] }
});

const noopLogger = {
  debug: jest.fn(),
  error: jest.fn()
};

const createRepo = (overrides: Partial<MegaShuffleRepo> = {}): MegaShuffleRepo => ({
  getSongsData: () => [],
  getTierlistData: () => [],
  getListeningData: () => [],
  getPlaylistData: () => [],
  getCmrStatsData: () => emptyCmrStats(),
  logger: noopLogger,
  ...overrides
});

describe('tierValue', () => {
  test('gives S a full 1.0 and the last tier ~1/total with a mild curve', () => {
    expect(tierValue(0, 7)).toBe(1);
    expect(tierValue(6, 7)).toBeCloseTo((1 / 7) ** 1.4, 5);
    expect(tierValue(0, 0)).toBe(0);
  });
});

describe('ported Mega Smart Shuffle weights', () => {
  test('unranked song with no signals gets the default-intensity floor of 0.4', () => {
    const repo = createRepo({ getSongsData: () => [song('a')] });
    expect(getMegaShuffleWeights(repo, ['a'])).toEqual({ a: 0.4 });
  });

  test('intensity 0 yields pure random (weight 1) regardless of tier score', () => {
    const tierlist: SavableTierlist = {
      tierlistId: 'tl',
      name: 'Influencing',
      createdDate: new Date(),
      sourcePlaylistIds: [],
      influencesShuffle: true,
      labelMode: 'track',
      tiers: [{ tierId: 't0', name: 'S', items: ['a'] }]
    };
    const repo = createRepo({ getSongsData: () => [song('a')], getTierlistData: () => [tierlist] });
    expect(getMegaShuffleWeights(repo, ['a'], 0).a).toBe(1);
  });

  test('intensity is clamped to [0, 1]', () => {
    const repo = createRepo({ getSongsData: () => [song('a')] });
    expect(getMegaShuffleWeights(repo, ['a'], 2).a).toBe(0.001);
    expect(getMegaShuffleWeights(repo, ['a'], -1).a).toBe(1);
  });

  test('S-tier song at full intensity scores 0.5 via the legacy formula', () => {
    const tierlist: SavableTierlist = {
      tierlistId: 'tl',
      name: 'Influencing',
      createdDate: new Date(),
      sourcePlaylistIds: [],
      influencesShuffle: true,
      labelMode: 'track',
      tiers: [{ tierId: 't0', name: 'S', items: ['a'] }]
    };
    const repo = createRepo({ getSongsData: () => [song('a')], getTierlistData: () => [tierlist] });
    expect(getMegaShuffleWeights(repo, ['a'], 1).a).toBeCloseTo(0.5, 5);
  });

  test('only tierlists flagged influencesShuffle participate', () => {
    const plain: SavableTierlist = {
      tierlistId: 'tl',
      name: 'Not influencing',
      createdDate: new Date(),
      sourcePlaylistIds: [],
      labelMode: 'track',
      tiers: [{ tierId: 't0', name: 'S', items: ['a'] }]
    };
    const repo = createRepo({ getSongsData: () => [song('a')], getTierlistData: () => [plain] });
    expect(getMegaShuffleWeights(repo, ['a'], 1).a).toBeCloseTo(0.001, 5);
  });

  test('freshness pushes the most recent History entry back (weight x0.4) and leaves the oldest almost untouched', () => {
    const repo = createRepo({
      getSongsData: () => [song('recent'), song('older')],
      getPlaylistData: (ids?: string[]) =>
        ids?.length ? [{ playlistId: 'History', name: 'History', createdDate: new Date(), songs: ['recent', 'older'], isArtworkAvailable: true }] : []
    });
    const weights = getMegaShuffleWeights(repo, ['recent', 'older']);
    expect(weights.recent).toBeCloseTo(0.4 * 0.4, 5); // base 0.4 * factor 0.4
    expect(weights.older).toBeCloseTo(0.4 * 0.7, 5); // base 0.4 * factor 0.7
  });

  test('an unranked track by a top-ranked artist is lifted by artist affinity', () => {
    const tierlist: SavableTierlist = {
      tierlistId: 'tl',
      name: 'Influencing',
      createdDate: new Date(),
      sourcePlaylistIds: [],
      influencesShuffle: true,
      labelMode: 'track',
      tiers: [{ tierId: 't0', name: 'S', items: ['ranked'] }]
    };
    const repo = createRepo({
      getSongsData: () => [
        song('ranked', [{ artistId: 'x', name: 'X' }]),
        song('unranked', [{ artistId: 'x', name: 'X' }])
      ],
      getTierlistData: () => [tierlist]
    });
    // affinity = 0.75*1 + 0.25*0 = 0.75; unranked: score = 0.4*0.75 = 0.3
    expect(getMegaShuffleWeights(repo, ['unranked'], 1).unranked).toBeCloseTo(0.3, 5);
  });

  test('ELO signal becomes active only after 10 duels and unrated stays neutral', () => {
    const cmrStats: CmrStatsData = {
      ...emptyCmrStats(),
      elo: {
        ratings: { rated: { rating: 1400, games: 5, wins: 5, losses: 0 } },
        history: [],
        totalDuels: 10
      }
    };
    const repo = createRepo({
      getSongsData: () => [song('rated'), song('unrated')],
      getCmrStatsData: () => cmrStats
    });
    const weights = getMegaShuffleWeights(repo, ['rated', 'unrated'], 1);
    // rated: normalized ELO = 0.5 + (1400-1200)/400 = 1 => score = 0.1*1
    expect(weights.rated).toBeCloseTo(0.1, 5);
    // unrated: neutral eloScore 0.5 => score = 0.1*0.5 = 0.05
    expect(weights.unrated).toBeCloseTo(0.05, 5);
  });

  test('below 10 duels the legacy formula stays bit-exact (no ELO term)', () => {
    const cmrStats: CmrStatsData = {
      ...emptyCmrStats(),
      elo: {
        ratings: { rated: { rating: 1400, games: 5, wins: 5, losses: 0 } },
        history: [],
        totalDuels: 9
      }
    };
    const repo = createRepo({
      getSongsData: () => [song('rated')],
      getCmrStatsData: () => cmrStats
    });
    expect(getMegaShuffleWeights(repo, ['rated'], 1).rated).toBeCloseTo(0.001, 5);
  });

  test('empty songIds computes weights for the whole library', () => {
    const repo = createRepo({ getSongsData: () => [song('a'), song('b')] });
    expect(Object.keys(getMegaShuffleWeights(repo))).toEqual(['a', 'b']);
  });

  test('listening nudge scales by the library maximum full-listens', () => {
    const repo = createRepo({
      getSongsData: () => [song('heavy'), song('light')],
      getListeningData: () => [
        { songId: 'heavy', fullListens: 10, listens: [] },
        { songId: 'light', fullListens: 5, listens: [] }
      ]
    });
    const weights = getMegaShuffleWeights(repo, ['heavy', 'light'], 1);
    // heavy: lScore = 1 => score 0.1 ; light: lScore = 0.5 => score 0.05
    expect(weights.heavy).toBeCloseTo(0.1, 5);
    expect(weights.light).toBeCloseTo(0.05, 5);
  });
});

describe('ported getMegaShuffleData pair feedback', () => {
  const NOW = Date.now();

  test('keeps only Too different pairs inside the 180-day window, capped at 100', () => {
    const skippedPairs: DuelSkipRecord[] = [
      { at: NOW, songAId: 'a', songBId: 'b', reason: 'tooDifferent' },
      { at: NOW, songAId: 'c', songBId: 'd', reason: 'cantDecide' },
      { at: NOW - 181 * 24 * 60 * 60 * 1000, songAId: 'e', songBId: 'f', reason: 'tooDifferent' }
    ];
    const repo = createRepo({
      getSongsData: () => [song('a')],
      getCmrStatsData: () => ({
        ...emptyCmrStats(),
        duelMatchmaking: { skippedPairs }
      })
    });
    expect(getMegaShuffleData(repo).pairFeedback).toEqual([skippedPairs[0]]);
  });

  test('caps pair feedback at 100 entries', () => {
    const skippedPairs: DuelSkipRecord[] = Array.from({ length: 150 }, (_, i) => ({
      at: NOW,
      songAId: `a${i}`,
      songBId: `b${i}`,
      reason: 'tooDifferent'
    }));
    const repo = createRepo({
      getSongsData: () => [song('a')],
      getCmrStatsData: () => ({
        ...emptyCmrStats(),
        duelMatchmaking: { skippedPairs }
      })
    });
    expect(getMegaShuffleData(repo).pairFeedback).toHaveLength(100);
  });
});

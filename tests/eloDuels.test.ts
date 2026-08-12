import {
  getDuelPair,
  getDuelPairByIds,
  recordDuelSkip,
  selectDuelAnchorFromCandidates,
  submitDuelResult
} from '../src/platform/core/stats/eloDuels';
import type { EloDuelsRepo } from '../src/platform/core/stats/eloDuels';

const song = (songId: string, isAFavorite = false): SavableSongData => ({
  songId,
  title: songId,
  duration: 200,
  isAFavorite,
  isArtworkAvailable: true,
  path: `C:\\music\\${songId}.mp3`,
  addedDate: 1,
  artists: [{ artistId: songId, name: songId }]
});

const emptyCmrStats = (): CmrStatsData => ({
  elo: { ratings: {}, history: [], totalDuels: 0 },
  importedStatsExportIds: [],
  duelMatchmaking: { skippedPairs: [] }
});

const duelRecord = (i: number): DuelRecord => ({
  at: i,
  songAId: 'a',
  songBId: 'b',
  winner: 'A',
  deltaA: 16,
  deltaB: -16
});

const createRepo = (overrides: Partial<EloDuelsRepo> = {}) => {
  const written: CmrStatsData[] = [];
  const events: [DataUpdateEventTypes, string[]?][] = [];
  const repo: EloDuelsRepo = {
    getSongsData: () => [],
    getListeningData: () => [],
    getPlaylistData: () => [],
    getTierlistData: () => [],
    getCmrStatsData: () => emptyCmrStats(),
    setCmrStatsData: (data) => written.push(data),
    emitDataUpdate: (type, data) => events.push([type, data]),
    getSongArtworkPath: (id) => ({
      isDefaultArtwork: false,
      artworkPath: `nemora://art/${id}.webp`,
      optimizedArtworkPath: `nemora://art/${id}-optimized.webp`
    }),
    resolveSongFilePath: (songPath) => `nemora://music/${songPath}`,
    isSongBlacklisted: () => false,
    logger: { debug: jest.fn() },
    ...overrides
  };
  return { repo, written, events };
};

describe('ported submitDuelResult', () => {
  test('applies symmetric ELO deltas, persists newest-first history and emits eloDuels', () => {
    const { repo, written, events } = createRepo();
    const result = submitDuelResult(repo, 'a', 'b', 'a');

    expect(result).toEqual({ deltaA: 16, deltaB: -16, ratingA: 1216, ratingB: 1184 });
    expect(written).toHaveLength(1);
    expect(written[0].elo.totalDuels).toBe(1);
    expect(written[0].elo.history).toHaveLength(1);
    expect(written[0].elo.history[0]).toMatchObject({
      songAId: 'a',
      songBId: 'b',
      winner: 'A',
      deltaA: 16,
      deltaB: -16
    });
    expect(written[0].elo.ratings.a).toMatchObject({
      rating: 1216,
      games: 1,
      wins: 1,
      losses: 0,
      draws: 0
    });
    expect(events).toEqual([['eloDuels', undefined]]);
  });

  test('rejects invalid winners and same-song duels', () => {
    const { repo } = createRepo();
    expect(() => submitDuelResult(repo, 'a', 'b', 'c')).toThrow('Invalid ELO duel result.');
    expect(() => submitDuelResult(repo, 'a', 'a', 'a')).toThrow('Invalid ELO duel result.');
  });

  test('caps ELO history at 1000 entries', () => {
    const stats = emptyCmrStats();
    stats.elo.history = Array.from({ length: 1000 }, (_, i) => duelRecord(i));
    const { repo, written } = createRepo({ getCmrStatsData: () => stats });
    submitDuelResult(repo, 'a', 'b', 'b');
    expect(written[0].elo.history).toHaveLength(1000);
  });
});

describe('ported recordDuelSkip', () => {
  test('Too close records a draw outcome plus the skip, newest first', () => {
    const { repo, written, events } = createRepo();
    recordDuelSkip(repo, 'a', 'b', 'tooClose');

    expect(written).toHaveLength(1);
    expect(written[0].elo.totalDuels).toBe(1);
    expect(written[0].elo.history[0].winner).toBe('draw');
    expect(written[0].elo.ratings.a.draws).toBe(1);
    expect(written[0].duelMatchmaking?.skippedPairs[0]).toMatchObject({
      songAId: 'a',
      songBId: 'b',
      reason: 'tooClose'
    });
    expect(events).toEqual([['eloDuels', undefined]]);
  });

  test('falls back to cantDecide for unknown reasons and ignores invalid ids', () => {
    const { repo, written } = createRepo();
    // @ts-expect-error deliberately passing an invalid reason at runtime
    recordDuelSkip(repo, 'a', 'b', 'nonsense');
    expect(written[0].duelMatchmaking?.skippedPairs[0].reason).toBe('cantDecide');
    recordDuelSkip(repo, 'a', 'a');
    expect(written).toHaveLength(1);
  });

  test('caps skip history at 250 entries', () => {
    const stats = emptyCmrStats();
    stats.duelMatchmaking = {
      skippedPairs: Array.from({ length: 250 }, (_, i) => ({
        at: i,
        songAId: 'a',
        songBId: 'b',
        reason: 'cantDecide' as const
      }))
    };
    const { repo, written } = createRepo({ getCmrStatsData: () => stats });
    recordDuelSkip(repo, 'a', 'b');
    expect(written[0].duelMatchmaking?.skippedPairs).toHaveLength(250);
  });
});

describe('ported selectDuelAnchorFromCandidates', () => {
  test('returns null when no candidate is eligible', () => {
    const { repo } = createRepo({ getSongsData: () => [song('a')] });
    expect(selectDuelAnchorFromCandidates(repo, [{ songId: 'x', listenedAt: 1 }])).toBeNull();
  });

  test('picks the under-calibrated eligible candidate', () => {
    const stats = emptyCmrStats();
    stats.elo.ratings.b = { rating: 1210, games: 5, wins: 3, losses: 2 };
    const { repo } = createRepo({
      getSongsData: () => [song('a'), song('b')],
      getPlaylistData: () => [
        { playlistId: 'P', name: 'P', createdDate: new Date(), songs: ['a', 'b'], isArtworkAvailable: true }
      ],
      getCmrStatsData: () => stats
    });
    const now = Date.now();
    expect(
      selectDuelAnchorFromCandidates(repo, [
        { songId: 'a', listenedAt: now },
        { songId: 'b', listenedAt: now }
      ])
    ).toBe('a');
  });
});

describe('ported getDuelPair', () => {
  test('returns null with fewer than two eligible songs', () => {
    const { repo } = createRepo({ getSongsData: () => [song('a')] });
    expect(getDuelPair(repo)).toBeNull();
  });

  test('returns null when the pinned anchor is no longer eligible', () => {
    const { repo } = createRepo({
      getSongsData: () => [song('a'), song('b')],
      getPlaylistData: () => [
        { playlistId: 'P', name: 'P', createdDate: new Date(), songs: ['a', 'b'], isArtworkAvailable: true }
      ]
    });
    expect(getDuelPair(repo, 'missing')).toBeNull();
  });

  test('builds a pair for a pinned anchor with resolved paths and ticket marker', () => {
    const { repo } = createRepo({
      getSongsData: () => [song('a'), song('b')],
      getPlaylistData: () => [
        { playlistId: 'P', name: 'P', createdDate: new Date(), songs: ['a', 'b'], isArtworkAvailable: true }
      ]
    });
    const pair = getDuelPair(repo, 'a');
    expect(pair).not.toBeNull();
    expect(pair?.ticketAnchorSongId).toBe('a');
    const ids = [pair?.songA.songId, pair?.songB.songId].sort();
    expect(ids).toEqual(['a', 'b']);
    expect(pair?.songA.path).toContain('nemora://music/');
    expect(pair?.songA.artworkPaths.artworkPath).toContain('nemora://art/');
  });
});

describe('ported getDuelPairByIds', () => {
  test('returns null for missing or blacklisted songs', () => {
    const { repo } = createRepo({ getSongsData: () => [song('a')] });
    expect(getDuelPairByIds(repo, 'a', 'missing')).toBeNull();
    const blacklistRepo = createRepo({
      getSongsData: () => [song('a'), song('b')],
      isSongBlacklisted: (songId) => songId === 'a'
    });
    expect(getDuelPairByIds(blacklistRepo.repo, 'a', 'b')).toBeNull();
  });

  test('builds the pair for two present, unblacklisted songs', () => {
    const { repo } = createRepo({ getSongsData: () => [song('a'), song('b')] });
    const pair = getDuelPairByIds(repo, 'a', 'b');
    expect(pair?.songA.songId).toBe('a');
    expect(pair?.songB.songId).toBe('b');
    expect(pair?.ticketAnchorSongId).toBeUndefined();
  });
});

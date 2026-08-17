import {
  createTournament,
  getTournamentOverview,
  getCurrentTournamentMatch,
  prepareTournament,
  recordTournamentWinner,
  resumeTournament,
  startTournament,
  submitTournamentDuel,
  type TournamentRepo,
  type TournamentState
} from '../tournaments';

const rating = (value: number, games = 5): EloSongRating => ({
  rating: value,
  games,
  wins: games,
  losses: 0
});

const eloFor = (values: number[]): EloData => ({
  ratings: Object.fromEntries(values.map((value, index) => [`song-${index + 1}`, rating(value)])),
  history: [],
  totalDuels: 0
});

const available = (state: TournamentState) =>
  new Set(state.participants.map(({ songId }) => songId));

describe('duel tournaments', () => {
  it('seeds a conventional bracket by effective ELO, not raw provisional rating', () => {
    const elo = eloFor([1300, 1290, 1280, 1270, 1260, 1250, 1240, 1230]);
    elo.ratings['song-8'] = rating(1600, 0);
    const state = createTournament(Object.keys(elo.ratings), elo, 8, 1234);

    expect(state.participants.map(({ songId }) => songId)).toEqual([
      'song-1',
      'song-2',
      'song-3',
      'song-4',
      'song-5',
      'song-6',
      'song-7',
      'song-8'
    ]);
    expect(state.matches.slice(0, 4).map(({ songAId, songBId }) => [songAId, songBId])).toEqual([
      ['song-1', 'song-8'],
      ['song-4', 'song-5'],
      ['song-2', 'song-7'],
      ['song-3', 'song-6']
    ]);
  });

  it('refuses unsupported sizes and libraries too small for the bracket', () => {
    expect(() => createTournament([], eloFor([]), 8, 1)).toThrow('needs at least 8 tracks');
    expect(() => createTournament([], eloFor([]), 4 as 8, 1)).toThrow(
      'Unsupported tournament size'
    );
  });

  it.each([8, 16, 32] as const)('builds a complete %i-track bracket', (size) => {
    const songIds = Array.from({ length: size }, (_, index) => `song-${index + 1}`);
    const state = createTournament(
      songIds,
      eloFor(songIds.map((_, index) => 1400 - index)),
      size,
      1
    );

    expect(state.matches).toHaveLength(size - 1);
    expect(state.matches.at(-1)).toMatchObject({
      round: Math.log2(size) - 1,
      position: 0
    });
  });

  it('advances one match at a time and preserves who beat whom', () => {
    let state = createTournament(
      Array.from({ length: 8 }, (_, index) => `song-${index + 1}`),
      eloFor([1300, 1290, 1280, 1270, 1260, 1250, 1240, 1230]),
      8,
      1
    );
    const ids = available(state);

    while (state.status === 'active') {
      const match = getCurrentTournamentMatch(state);
      expect(match).toBeDefined();
      state = recordTournamentWinner(state, match!.id, match!.songAId!, ids);
    }

    expect(state.championSongId).toBe('song-1');
    expect(state.matches).toHaveLength(7);
    expect(state.matches.every(({ resolution }) => resolution === 'played')).toBe(true);
    expect(state.matches.at(-1)).toMatchObject({
      id: 'r3m1',
      songAId: 'song-1',
      songBId: 'song-2',
      winnerSongId: 'song-1'
    });
  });

  it('turns a missing participant into a forfeit after a restart', () => {
    const original = createTournament(
      Array.from({ length: 8 }, (_, index) => `song-${index + 1}`),
      eloFor([1300, 1290, 1280, 1270, 1260, 1250, 1240, 1230]),
      8,
      1
    );
    const restarted = JSON.parse(JSON.stringify(original)) as TournamentState;
    const ids = available(restarted);
    ids.delete('song-8');

    const prepared = prepareTournament(restarted, ids);

    expect(prepared.state.matches[0]).toMatchObject({
      songAId: 'song-1',
      songBId: 'song-8',
      winnerSongId: 'song-1',
      resolution: 'forfeit'
    });
    expect(prepared.currentMatch?.id).toBe('r1m2');
    expect(prepareTournament(prepared.state, ids).state).toBe(prepared.state);
  });

  it('propagates vacant matches and byes without blocking the bracket', () => {
    const state = createTournament(
      Array.from({ length: 8 }, (_, index) => `song-${index + 1}`),
      eloFor([1300, 1290, 1280, 1270, 1260, 1250, 1240, 1230]),
      8,
      1
    );

    const prepared = prepareTournament(state, new Set(['song-2']));

    expect(prepared.state.status).toBe('completed');
    expect(prepared.state.championSongId).toBe('song-2');
    expect(prepared.state.matches.some(({ resolution }) => resolution === 'vacant')).toBe(true);
    expect(prepared.state.matches.some(({ resolution }) => resolution === 'bye')).toBe(true);
  });

  it('persists beside CMR stats and submits tournament votes through normal ELO', () => {
    let cmrStats = {
      elo: eloFor([1300, 1290, 1280, 1270, 1260, 1250, 1240, 1230]),
      importedStatsExportIds: []
    } as CmrStatsData & { tournament?: TournamentState };
    const songs = Array.from({ length: 8 }, (_, index) => ({
      songId: `song-${index + 1}`
    })) as SavableSongData[];
    const emitDataUpdate = jest.fn();
    const repo = {
      getSongsData: () => songs,
      getListeningData: () => [],
      getPlaylistData: () => [],
      getTierlistData: () => [],
      getCmrStatsData: () => cmrStats,
      setCmrStatsData: (data: CmrStatsData) => {
        cmrStats = data;
      },
      emitDataUpdate,
      getSongArtworkPath: () => ({ artworkPath: '', optimizedArtworkPath: '' }),
      resolveSongFilePath: (path: string) => path,
      isSongBlacklisted: () => false,
      logger: { debug: jest.fn() }
    } as unknown as TournamentRepo;

    const started = startTournament(repo, 8, 100);
    expect(cmrStats.tournament).toEqual(started);
    const current = resumeTournament(repo)?.currentMatch;
    const submitted = submitTournamentDuel(repo, current!.id, current!.songAId!);

    expect(submitted.tournament.matches[0].resolution).toBe('played');
    expect(cmrStats.elo.totalDuels).toBe(1);
    expect(cmrStats.elo.history[0]).toMatchObject({
      songAId: current!.songAId,
      songBId: current!.songBId,
      winner: 'A'
    });
    expect(emitDataUpdate).toHaveBeenCalledWith('eloDuels');
  });

  it('reports the seedable library, not the running bracket, so the size buttons can be gated', () => {
    let cmrStats = {
      elo: eloFor(Array.from({ length: 12 }, (_, index) => 1300 - index * 10)),
      importedStatsExportIds: []
    } as CmrStatsData & { tournament?: TournamentState };
    const songs = Array.from({ length: 12 }, (_, index) => ({
      songId: `song-${index + 1}`,
      title: `Song ${index + 1}`,
      artists: [{ name: 'Someone' }],
      duration: 180,
      path: `E:\Music\song-${index + 1}.flac`
    })) as unknown as SavableSongData[];
    const repo = {
      getSongsData: () => songs,
      getListeningData: () => [],
      getPlaylistData: () => [],
      getTierlistData: () => [],
      getCmrStatsData: () => cmrStats,
      setCmrStatsData: (data: CmrStatsData) => {
        cmrStats = data;
      },
      emitDataUpdate: jest.fn(),
      getSongArtworkPath: () => ({ artworkPath: '', optimizedArtworkPath: '' }),
      resolveSongFilePath: (path: string) => path,
      isSongBlacklisted: (songId: string) => songId === 'song-12',
      logger: { debug: jest.fn() }
    } as unknown as TournamentRepo;

    const idle = getTournamentOverview(repo);
    expect(idle.eligibleTrackCount).toBe(11);
    expect(idle.state).toBeUndefined();
    expect(idle.songs).toEqual([]);

    startTournament(repo, 8, 100);
    const running = getTournamentOverview(repo);

    expect(running.eligibleTrackCount).toBe(11);
    expect(running.state?.size).toBe(8);
    expect(running.currentMatch).toBeDefined();
    expect(running.songs).toHaveLength(8);
    expect(
      running.songs.map(({ title }) => title).every((title) => title.startsWith('Song '))
    ).toBe(true);
  });

  it('lets tracks nobody has duelled into the bracket, and varies between tournaments', () => {
    const songIds = Array.from({ length: 300 }, (_, index) => `song-${index + 1}`);
    const elo: EloData = {
      ratings: Object.fromEntries(
        Array.from({ length: 40 }, (_, index) => [
          `song-${index + 1}`,
          rating(1400 - index * 7, 12)
        ])
      ),
      history: [],
      totalDuels: 100
    };
    const idsOf = (state: TournamentState) => state.participants.map(({ songId }) => songId);

    const first = createTournament(songIds, elo, 8, 1);
    const second = createTournament(songIds, elo, 8, 2);

    // A tournament exists to put ratings on tracks that have none.
    expect(idsOf(first).every((songId) => !elo.ratings[songId])).toBe(true);
    expect(idsOf(first)).not.toEqual(idsOf(second));
    // Same creation time rebuilds the same bracket, so reconciliation stays deterministic.
    expect(idsOf(createTournament(songIds, elo, 8, 1))).toEqual(idsOf(first));
    expect(first.participants.map(({ seed }) => seed)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

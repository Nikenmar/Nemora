import refreshRediscoverPlaylist, { REDISCOVER_PLAYLIST_ID } from '../src/platform/core/rediscover/rediscover';
import type { RediscoverRepo } from '../src/platform/core/rediscover/rediscover';

const DAY_MS = 24 * 60 * 60 * 1000;

const song = (songId: string): SavableSongData => ({
  songId,
  title: songId,
  duration: 200,
  isAFavorite: false,
  isArtworkAvailable: true,
  path: `C:\\music\\${songId}.mp3`,
  addedDate: 1
});

const REDISCOVER_TEMPLATE: SavablePlaylist = {
  playlistId: 'Rediscover',
  name: 'Rediscover',
  createdDate: new Date(2026, 0, 1),
  songs: [],
  isArtworkAvailable: true
};

const listening = (songId: string, lastHeardMs: number, fullListens = 0): SongListeningData => ({
  songId,
  fullListens,
  listens: lastHeardMs > 0 ? [{ year: 2026, listens: [[lastHeardMs, 1]] }] : []
});

const emptyCmrStats = (): CmrStatsData => ({
  elo: { ratings: {}, history: [], totalDuels: 0 },
  importedStatsExportIds: []
});

const createRepo = (overrides: Partial<RediscoverRepo> = {}) => {
  let playlists: SavablePlaylist[] = [];
  const events: DataUpdateEventTypes[] = [];
  const repo: RediscoverRepo = {
    getSongsData: () => [],
    getTierlistData: () => [],
    getCmrStatsData: () => emptyCmrStats(),
    getListeningData: () => [],
    getPlaylistData: () => playlists,
    setPlaylistData: (data) => {
      playlists = data;
    },
    rediscoverPlaylistTemplate: REDISCOVER_TEMPLATE,
    emitDataUpdate: (type) => events.push(type),
    isSongBlacklisted: () => false,
    logger: { info: jest.fn(), error: jest.fn() },
    ...overrides
  };
  return { repo, events, playlists: () => playlists };
};

describe('ported Rediscover refresh', () => {
  test('returns count 0 and writes nothing for an empty library', () => {
    const { repo, playlists } = createRepo();
    expect(refreshRediscoverPlaylist(repo)).toEqual({ count: 0 });
    expect(playlists()).toEqual([]);
  });

  test('picks loved and forgotten songs, skipping fresh, unranked and blacklisted ones', () => {
    const now = Date.now();
    const lovedOld: SavableTierlist = {
      tierlistId: 'tl',
      name: 'Loved',
      createdDate: new Date(2026, 0, 1),
      sourcePlaylistIds: [],
      labelMode: 'track',
      tiers: [{ tierId: 't0', name: 'S', items: ['lovedOld', 'lovedRecent'] }]
    };
    const { repo, events, playlists } = createRepo({
      getSongsData: () => [
        song('lovedOld'),
        song('lovedRecent'),
        song('unranked'),
        song('blacklisted')
      ],
      getTierlistData: () => [lovedOld],
      getListeningData: () => [
        listening('lovedOld', now - 40 * DAY_MS, 5),
        listening('lovedRecent', now - 5 * DAY_MS, 5),
        listening('unranked', 0, 0),
        listening('blacklisted', 0, 0)
      ],
      isSongBlacklisted: (songId) => songId === 'blacklisted'
    });

    const result = refreshRediscoverPlaylist(repo);
    expect(result).toEqual({ count: 1 });
    const rediscover = playlists().find((p) => p.playlistId === REDISCOVER_PLAYLIST_ID);
    expect(rediscover?.songs).toEqual(['lovedOld']);
    expect(events).toEqual(['playlists/rediscover']);
  });

  test('caps the playlist at 50 tracks', () => {
    const now = Date.now();
    const songs = Array.from({ length: 60 }, (_, i) => song(`song-${i}`));
    const { repo, playlists } = createRepo({
      getSongsData: () => songs,
      getListeningData: () =>
        songs.map((s) => listening(s.songId, now - 100 * DAY_MS, 1)),
      getTierlistData: () => [
        {
          tierlistId: 'tl',
          name: 'Loved',
          createdDate: new Date(2026, 0, 1),
          sourcePlaylistIds: [],
          labelMode: 'track',
          tiers: [{ tierId: 't0', name: 'S', items: songs.map((s) => s.songId) }]
        }
      ]
    });

    refreshRediscoverPlaylist(repo);
    const rediscover = playlists().find((p) => p.playlistId === REDISCOVER_PLAYLIST_ID);
    expect(rediscover?.songs).toHaveLength(50);
  });

  test('updates the existing Rediscover playlist instead of duplicating it', () => {
    const now = Date.now();
    const { repo, playlists } = createRepo({
      getSongsData: () => [song('loved')],
      getTierlistData: () => [
        {
          tierlistId: 'tl',
          name: 'Loved',
          createdDate: new Date(2026, 0, 1),
          sourcePlaylistIds: [],
          labelMode: 'track',
          tiers: [{ tierId: 't0', name: 'S', items: ['loved'] }]
        }
      ],
      getListeningData: () => [listening('loved', now - 100 * DAY_MS, 1)]
    });
    // Seed an existing Rediscover playlist with a stale song list.
    repo.setPlaylistData([{ ...REDISCOVER_TEMPLATE, songs: ['stale'] }]);

    expect(refreshRediscoverPlaylist(repo).count).toBe(1);
    const rediscover = playlists().filter((p) => p.playlistId === REDISCOVER_PLAYLIST_ID);
    expect(rediscover).toHaveLength(1);
    expect(rediscover[0].songs).toEqual(['loved']);
  });

  test('treats invalid thresholds as the 30-day default', () => {
    const now = Date.now();
    const { repo, playlists } = createRepo({
      getSongsData: () => [song('a')],
      getTierlistData: () => [
        {
          tierlistId: 'tl',
          name: 'Loved',
          createdDate: new Date(2026, 0, 1),
          sourcePlaylistIds: [],
          labelMode: 'track',
          tiers: [{ tierId: 't0', name: 'S', items: ['a'] }]
        }
      ],
      getListeningData: () => [listening('a', now - 40 * DAY_MS, 1)]
    });

    // 40 days old: inside the default 30-day cutoff, outside a 60-day one.
    expect(refreshRediscoverPlaylist(repo, NaN).count).toBe(1);
    expect(refreshRediscoverPlaylist(repo, -5).count).toBe(1);
    expect(
      playlists().find((p) => p.playlistId === REDISCOVER_PLAYLIST_ID)?.songs
    ).toEqual(['a']);
    // A 60-day threshold excludes the 40-day-old track; the derived playlist
    // is regenerated completely, so it is rewritten empty.
    expect(refreshRediscoverPlaylist(repo, 60).count).toBe(0);
    expect(
      playlists().find((p) => p.playlistId === REDISCOVER_PLAYLIST_ID)?.songs
    ).toEqual([]);
  });

  test('ELO only contributes once 10 duels exist, and only above neutral', () => {
    const now = Date.now();
    const base = {
      getSongsData: () => [song('dueled')],
      getTierlistData: () => [],
      getListeningData: () => [listening('dueled', 0, 0)]
    };
    const stats = emptyCmrStats();
    stats.elo.ratings.dueled = { rating: 1400, games: 5, wins: 4, losses: 1 };
    stats.elo.totalDuels = 10;

    const { repo, playlists } = createRepo({
      ...base,
      getCmrStatsData: () => stats
    });
    expect(refreshRediscoverPlaylist(repo).count).toBe(1);
    expect(playlists().find((p) => p.playlistId === REDISCOVER_PLAYLIST_ID)?.songs).toEqual([
      'dueled'
    ]);

    const below10 = emptyCmrStats();
    below10.elo.ratings.dueled = { rating: 1400, games: 5, wins: 4, losses: 1 };
    below10.elo.totalDuels = 9;
    const quiet = createRepo({
      ...base,
      getCmrStatsData: () => below10
    });
    expect(refreshRediscoverPlaylist(quiet.repo).count).toBe(0);
  });
});

import { jest } from '@jest/globals';

import importStatsData from '../importStats';
import { configureLogger } from '../../playlists/logger';
import { md5Hex } from '../md5';
import { joinPath } from '../joinPath';
import { PROFILE_ROOT, createMockTransferRepo, createSong } from './testUtils';

jest.mock('@tauri-apps/plugin-dialog', () => ({
  open: jest.fn(),
  save: jest.fn()
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pluginDialog = jest.requireMock('@tauri-apps/plugin-dialog') as {
  open: jest.Mock<() => Promise<string | null>>;
};

/**
 * Two-install fixture: FOREIGN devices have songIds f1..f4 and live under
 * `E:\Other Device\...`; the LOCAL library has songIds l1..l3 under
 * `D:\Local Library\...`. The metadata matches — ids and paths do not.
 */
const FOREIGN_SONGS: SongFingerprint[] = [
  {
    songId: 'f1',
    title: 'Midnight Drive',
    artists: ['Artist One'],
    duration: 210,
    fileName: 'midnight_drive.mp3'
  },
  {
    songId: 'f2',
    title: 'Slow Waves',
    artists: ['Artist Two'],
    duration: 184.5,
    fileName: 'slow_waves.flac'
  },
  {
    songId: 'f3',
    title: 'Echoes',
    artists: ['Artist Three', 'Artist One'], // artist order differs from local
    duration: 241,
    fileName: 'echoes.mp3'
  },
  {
    songId: 'f4',
    title: 'Never Heard Of',
    artists: ['Someone Else'],
    duration: 130,
    fileName: 'never_heard.mp3'
  }
];

const LOCAL_SONGS: SavableSongData[] = [
  createSong('l1', {
    title: 'Midnight Drive',
    artists: [{ artistId: 'a1', name: 'Artist One' }],
    duration: 210,
    path: 'D:\\Local Library\\Albums\\midnight_drive.mp3'
  }),
  createSong('l2', {
    title: 'Slow Waves',
    artists: [{ artistId: 'a2', name: 'Artist Two' }],
    duration: 185,
    path: 'D:\\Local Library\\Albums\\slow_waves.flac'
  }),
  createSong('l3', {
    title: 'Echoes',
    artists: [
      { artistId: 'a1', name: 'Artist One' },
      { artistId: 'a3', name: 'Artist Three' }
    ],
    duration: 240,
    path: 'D:\\Local Library\\echoes.mp3'
  })
];

const exportFile = (overrides: Partial<StatsExportFile> = {}): StatsExportFile => ({
  format: 'nora-cmr-stats-export',
  formatVersion: 1,
  exportId: 'fixture-export-1',
  exportedAt: '2025-06-01T00:00:00.000Z',
  appVersion: '3.4.5-CMR-Fork',
  songs: FOREIGN_SONGS,
  listeningData: [
    {
      songId: 'f1',
      fullListens: 5,
      skips: 2,
      listens: [{ year: 2025, listens: [[1735689600000, 3]] }]
    },
    { songId: 'f2', fullListens: 1, listens: [] },
    { songId: 'f3', skips: 1, listens: [] },
    { songId: 'f4', fullListens: 9, listens: [] }
  ],
  ...overrides
});

const repoWithLocalLibrary = (overrides = {}) =>
  createMockTransferRepo(
    overrides,
    { songs: LOCAL_SONGS },
    { 'E:\\Exports\\export.json': JSON.stringify(exportFile()) }
  );

describe('importStatsData — fingerprint remap between two installs', () => {
  const logged: { message: string; data?: Record<string, unknown> }[] = [];

  beforeEach(() => {
    jest.clearAllMocks();
    logged.length = 0;
    configureLogger({
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: (message, data) => logged.push({ message, data })
    });
  });

  afterEach(() => {
    configureLogger(undefined);
  });

  test('matches foreign songs to local ids by file name, title+artists and title', async () => {
    const repo = repoWithLocalLibrary();
    pluginDialog.open.mockResolvedValue('E:\\Exports\\export.json');

    const report = await importStatsData(repo, 'separateDevices', 'file');

    expect(report.success).toBe(true);
    // Listening entries: f1 (file name + duration), f2 (file name within ±2s)
    // and f3 (title + sorted artists + duration) match; f4 has no local
    // counterpart. The counts cover listening entries, like the Electron build.
    expect(report.matchedSongs).toBe(3);
    expect(report.unmatchedSongs).toBe(1);
    expect(report.mergedListens).toBe(3);

    // The foreign listening entries were remapped onto the LOCAL songIds.
    // Listens are bucketed by local calendar day on the way in.
    const dayStart = new Date(
      new Date(1735689600000).getFullYear(),
      new Date(1735689600000).getMonth(),
      new Date(1735689600000).getDate()
    ).getTime();
    const merged = repo.state.listeningData.find((entry) => entry.songId === 'l1');
    expect(merged?.fullListens).toBe(5);
    expect(merged?.listens).toEqual([{ year: 2025, listens: [[dayStart, 3]] }]);
    expect(repo.state.listeningData.find((entry) => entry.songId === 'l2')?.fullListens).toBe(1);
    expect(repo.state.listeningData.find((entry) => entry.songId === 'l3')?.skips).toBe(1);
  });

  test('skips ambiguous matches instead of guessing', async () => {
    const repo = createMockTransferRepo(
      {},
      {
        songs: [
          createSong('l1', { title: 'Track A', duration: 200, path: 'D:\\Lib\\same.mp3' }),
          createSong('l2', { title: 'Track B', duration: 200, path: 'D:\\Lib\\same.mp3' })
        ]
      },
      {
        'E:\\Exports\\export.json': JSON.stringify(
          exportFile({
            songs: [
              {
                songId: 'f1',
                title: 'Track A',
                artists: [],
                duration: 200,
                fileName: 'same.mp3'
              }
            ],
            listeningData: [{ songId: 'f1', listens: [] }]
          })
        )
      }
    );
    pluginDialog.open.mockResolvedValue('E:\\Exports\\export.json');

    const report = await importStatsData(repo, 'separateDevices', 'file');

    // Two local songs share the file name + duration, so the foreign song is
    // skipped at every stage instead of being silently assigned to one of them.
    expect(report.matchedSongs).toBe(0);
    expect(report.unmatchedSongs).toBe(1);
    expect(repo.state.listeningData).toHaveLength(0);
  });

  test('separateDevices sums and sameOrigin takes the max', async () => {
    // Listens are bucketed by LOCAL calendar day before merging, so the
    // merged day key is the local midnight of the raw timestamp.
    const dayStart = new Date(
      new Date(1735689600000).getFullYear(),
      new Date(1735689600000).getMonth(),
      new Date(1735689600000).getDate()
    ).getTime();

    const foreign = exportFile({
      listeningData: [
        {
          songId: 'f1',
          fullListens: 5,
          listens: [{ year: 2025, listens: [[1735689600000, 3]] }]
        }
      ]
    });

    const runImport = async (mergeMode: StatsMergeMode) => {
      const repo = createMockTransferRepo(
        {},
        {
          songs: LOCAL_SONGS,
          listeningData: [
            {
              songId: 'l1',
              fullListens: 2,
              listens: [{ year: 2025, listens: [[1735689600000, 1]] }]
            }
          ]
        },
        { 'E:\\Exports\\export.json': JSON.stringify(foreign) }
      );
      pluginDialog.open.mockResolvedValue('E:\\Exports\\export.json');
      await importStatsData(repo, mergeMode, 'file');
      return repo.state.listeningData.find((entry) => entry.songId === 'l1');
    };

    const summed = await runImport('separateDevices');
    expect(summed?.fullListens).toBe(7); // 2 + 5
    expect(summed?.listens[0]?.listens).toEqual([[dayStart, 4]]); // 1 + 3

    const maxed = await runImport('sameOrigin');
    expect(maxed?.fullListens).toBe(5); // max(2, 5)
    expect(maxed?.listens[0]?.listens).toEqual([[dayStart, 3]]); // max(1, 3)
  });

  test('never merges into the Rediscover/History/Favorites system playlists', async () => {
    const repo = createMockTransferRepo(
      {},
      { songs: LOCAL_SONGS },
      {
        'E:\\Exports\\export.json': JSON.stringify(
          exportFile({
            playlists: [
              {
                playlistId: 'xp1',
                name: 'Rediscover',
                songs: ['f1'],
                createdDate: '2025-01-01' as unknown as Date
              },
              {
                playlistId: 'xp2',
                name: 'history',
                songs: ['f2'],
                createdDate: '2025-01-01' as unknown as Date
              },
              {
                playlistId: 'xp3',
                name: 'Favorites',
                songs: ['f3'],
                createdDate: '2025-01-01' as unknown as Date
              },
              {
                playlistId: 'xp4',
                name: 'Road Trip',
                songs: ['f1', 'f4'],
                createdDate: '2025-01-01' as unknown as Date
              }
            ]
          })
        )
      }
    );
    pluginDialog.open.mockResolvedValue('E:\\Exports\\export.json');

    const report = await importStatsData(repo, 'separateDevices', 'file');

    expect(report.playlistsImported).toBe(1); // only 'Road Trip'
    expect(report.notes).toEqual(
      expect.arrayContaining([
        "Playlist 'Rediscover' is app-managed here - skipped.",
        "Playlist 'history' is app-managed here - skipped.",
        "Playlist 'Favorites' is app-managed here - skipped."
      ])
    );
    const playlists = repo.state.playlists;
    expect(
      playlists.filter(
        (p) => p.name === 'Rediscover' || p.name === 'history' || p.name === 'Favorites'
      )
    ).toHaveLength(0);
    expect(playlists.find((p) => p.name === 'Road Trip')?.songs).toEqual(['l1']);
  });

  test('backs up the current stats BEFORE any write', async () => {
    const repo = repoWithLocalLibrary();
    pluginDialog.open.mockResolvedValue('E:\\Exports\\export.json');

    await importStatsData(repo, 'separateDevices', 'file');

    const backupEvents = repo.events.filter((event) => event.startsWith('copyFileAtomic:'));
    const saveIndex = repo.events.indexOf('saveListeningData');

    // Four profile files were copied into the backups folder first.
    expect(backupEvents).toHaveLength(4);
    for (const event of backupEvents) {
      expect(event).toContain(joinPath(PROFILE_ROOT, 'backups'));
      expect(event).toMatch(/\.backup\.\d+\.json$/);
    }
    // Every backup copy happened strictly before the first store write.
    expect(saveIndex).toBe(backupEvents.length);
    // The import id is recorded so the same export cannot be summed twice.
    expect(repo.state.cmrStats.importedStatsExportIds).toEqual(['fixture-export-1']);
  });

  test('tolerates a missing cmr_stats.json during backup (fresh install)', async () => {
    const repo = repoWithLocalLibrary();
    // A profile that has never run a duel has no cmr_stats.json. Nothing to back
    // up is not a failure, and the other three files are still copied.
    repo.files.delete(joinPath(PROFILE_ROOT, 'cmr_stats.json'));
    pluginDialog.open.mockResolvedValue('E:\\Exports\\export.json');

    const report = await importStatsData(repo, 'separateDevices', 'file');

    expect(report.success).toBe(true);
    expect(repo.events.filter((event) => event.startsWith('copyFileAtomic:'))).toHaveLength(3);
    expect(repo.state.cmrStats.importedStatsExportIds).toEqual(['fixture-export-1']);
  });

  test('a copy that genuinely fails aborts the import before any write', async () => {
    const repo = repoWithLocalLibrary();
    // The shape a real rejection has: the Rust command and plugin-fs both reject
    // with a bare string, never a Node-style error carrying `code`.
    repo.copyFileAtomic = jest.fn(async (_source: string, _destination: string) => {
      throw new Error('failed to copy file from path: C:\\..., to path: C:\\...');
    });
    pluginDialog.open.mockResolvedValue('E:\\Exports\\export.json');

    const report = await importStatsData(repo, 'separateDevices', 'file');

    expect(report).toMatchObject({
      success: false,
      message: 'Failed to create a backup before importing. Nothing was changed.'
    });
    // "Nothing was changed" has to be true: no store write may have happened.
    expect(repo.saveListeningDataMock).not.toHaveBeenCalled();
    expect(repo.setCmrStatsDataMock).not.toHaveBeenCalled();
    expect(repo.state.listeningData).toHaveLength(0);
    // The reason must reach the core logger: this failure used to be discarded
    // there, which is why a real one could not be diagnosed from the app at all.
    expect(logged.map((entry) => entry.message)).toContain(
      'Stats import aborted: failed to create a backup.'
    );
    expect(String(logged[0]?.data?.error)).toContain('failed to copy file');
  });

  test('refuses a second separateDevices import of the same export id', async () => {
    const repo = createMockTransferRepo(
      {},
      {
        songs: LOCAL_SONGS,
        cmrStats: {
          elo: { ratings: {}, history: [], totalDuels: 0 },
          importedStatsExportIds: ['fixture-export-1']
        }
      },
      { 'E:\\Exports\\export.json': JSON.stringify(exportFile()) }
    );
    pluginDialog.open.mockResolvedValue('E:\\Exports\\export.json');

    const report = await importStatsData(repo, 'separateDevices', 'file');

    expect(report).toMatchObject({
      success: false,
      message: 'This export was already imported.',
      alreadyImported: true
    });
    expect(repo.state.listeningData).toHaveLength(0);
    expect(repo.events.filter((event) => event.startsWith('copyFileAtomic:'))).toHaveLength(0);
  });

  test('validates fully before writing anything — malformed listening data aborts', async () => {
    const bad = exportFile({
      listeningData: [
        { songId: 'f1', listens: [{ year: 'twenty' as unknown as number, listens: [] }] }
      ]
    });
    const repo = createMockTransferRepo(
      {},
      { songs: LOCAL_SONGS },
      { 'E:\\Exports\\export.json': JSON.stringify(bad) }
    );
    pluginDialog.open.mockResolvedValue('E:\\Exports\\export.json');

    const report = await importStatsData(repo, 'separateDevices', 'file');

    expect(report).toMatchObject({
      success: false,
      message: 'The import file contains malformed listening data.'
    });
    expect(repo.state.listeningData).toHaveLength(0);
    expect(repo.events.filter((event) => event.startsWith('copyFileAtomic:'))).toHaveLength(0);
    expect(repo.state.cmrStats.importedStatsExportIds).toEqual([]);
  });

  test('skips a malformed optional block with a note instead of aborting', async () => {
    const repo = createMockTransferRepo(
      {},
      { songs: LOCAL_SONGS },
      {
        'E:\\Exports\\export.json': JSON.stringify(
          exportFile({
            playlists: [
              {
                playlistId: 'x',
                name: 'broken',
                songs: 'not-an-array' as unknown as string[],
                createdDate: '2025-01-01' as unknown as Date
              }
            ]
          })
        )
      }
    );
    pluginDialog.open.mockResolvedValue('E:\\Exports\\export.json');

    const report = await importStatsData(repo, 'separateDevices', 'file');

    expect(report.success).toBe(true);
    expect(report.notes).toContain('Skipped a malformed playlists block.');
    expect(repo.state.playlists).toHaveLength(0);
  });

  test('merges elo with a games-weighted rating mean and remapped history', async () => {
    const repo = createMockTransferRepo(
      {},
      {
        songs: LOCAL_SONGS,
        cmrStats: {
          elo: {
            ratings: { l1: { rating: 1200, games: 10, wins: 5, losses: 5 } },
            history: [],
            totalDuels: 10
          },
          importedStatsExportIds: []
        }
      },
      {
        'E:\\Exports\\export.json': JSON.stringify(
          exportFile({
            elo: {
              ratings: { f1: { rating: 1300, games: 10, wins: 8, losses: 2 } },
              history: [
                { at: 99, songAId: 'f1', songBId: 'f2', winner: 'A', deltaA: 10, deltaB: -10 }
              ],
              totalDuels: 10
            }
          })
        )
      }
    );
    pluginDialog.open.mockResolvedValue('E:\\Exports\\export.json');

    const report = await importStatsData(repo, 'separateDevices', 'file');

    expect(report.eloMerged).toBe(true);
    const rating = repo.state.cmrStats.elo.ratings['l1'];
    expect(rating?.rating).toBe(1250); // (1200*10 + 1300*10) / 20
    expect(rating?.games).toBe(20); // summed for separateDevices
    expect(rating?.wins).toBe(13);
    expect(repo.state.cmrStats.elo.totalDuels).toBe(20);
    expect(repo.state.cmrStats.elo.history[0]).toMatchObject({
      songAId: 'l1',
      songBId: 'l2',
      winner: 'A'
    });
  });

  test('returns preferences and keeps formatVersion-1 exports importable', async () => {
    const repo = createMockTransferRepo(
      {},
      { songs: LOCAL_SONGS },
      {
        'E:\\Exports\\export.json': JSON.stringify(
          exportFile({ preferences: { tierShuffleIntensity: 0.4 } })
        )
      }
    );
    pluginDialog.open.mockResolvedValue('E:\\Exports\\export.json');

    const report = await importStatsData(repo, 'sameOrigin', 'file');

    expect(report.success).toBe(true);
    expect(report.importedPreferences).toEqual({ tierShuffleIntensity: 0.4 });
  });

  test('rejects an unsupported format version', async () => {
    const repo = createMockTransferRepo(
      {},
      { songs: LOCAL_SONGS },
      {
        'E:\\Exports\\export.json': JSON.stringify({
          ...exportFile(),
          formatVersion: 2
        })
      }
    );
    pluginDialog.open.mockResolvedValue('E:\\Exports\\export.json');

    const report = await importStatsData(repo, 'separateDevices', 'file');

    expect(report).toMatchObject({
      success: false,
      message: 'Unsupported stats export file version.'
    });
    expect(repo.events.filter((event) => event.startsWith('copyFileAtomic:'))).toHaveLength(0);
  });

  test('imports a legacy "Nora exports" folder, resolving the nested layout', async () => {
    const listeningRaw = JSON.stringify({
      listeningData: [{ songId: 'f1', fullListens: 1, listens: [] }]
    });
    const repo = createMockTransferRepo(
      {},
      { songs: LOCAL_SONGS },
      {
        [joinPath('E:\\Backups', 'Nora exports', 'listening_data.json')]: listeningRaw,
        [joinPath('E:\\Backups', 'Nora exports', 'songs.json')]: JSON.stringify({
          songs: [
            createSong('f1', {
              title: 'Midnight Drive',
              artists: [{ artistId: 'a1', name: 'Artist One' }],
              duration: 210,
              path: 'E:\\Other Device\\midnight_drive.mp3'
            })
          ]
        }),
        [joinPath('E:\\Backups', 'Nora exports', 'cmr_stats.json')]: JSON.stringify({
          cmrStats: {
            elo: { ratings: {}, history: [], totalDuels: 3 },
            importedStatsExportIds: []
          }
        })
      }
    );
    pluginDialog.open.mockResolvedValue('E:\\Backups');

    const report = await importStatsData(repo, 'separateDevices', 'folder');

    expect(report.success).toBe(true);
    // The foreign folder entry was remapped onto the local songId l1.
    expect(report.matchedSongs).toBe(1);
    expect(repo.state.listeningData.find((entry) => entry.songId === 'l1')?.fullListens).toBe(1);
    // The legacy folder export is attributed to a stable md5 export id.
    expect(repo.state.cmrStats.importedStatsExportIds).toEqual([`legacy-${md5Hex(listeningRaw)}`]);
    expect(repo.state.cmrStats.elo.totalDuels).toBe(3);
  });

  test('returns a silent failure when the import dialog is cancelled', async () => {
    const repo = repoWithLocalLibrary();
    pluginDialog.open.mockResolvedValue(null);

    const report = await importStatsData(repo, 'separateDevices', 'file');

    expect(report).toEqual({
      success: false,
      matchedSongs: 0,
      unmatchedSongs: 0,
      mergedListens: 0,
      eloMerged: false
    });
    expect(repo.state.cmrStats.importedStatsExportIds).toEqual([]);
  });

  test('rejects unknown merge modes and sources before touching anything', async () => {
    const repo = repoWithLocalLibrary();

    const badMode = await importStatsData(repo, 'average' as StatsMergeMode, 'file');
    expect(badMode).toMatchObject({ success: false, message: 'Unknown stats merge mode.' });

    const badSource = await importStatsData(repo, 'separateDevices', 'url' as StatsImportSource);
    expect(badSource).toMatchObject({ success: false, message: 'Unknown stats import source.' });

    expect(repo.events).toHaveLength(0);
  });
});

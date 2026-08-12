import { jest } from '@jest/globals';

import importAppData from '../importAppData';
import { createMockAppDataRepo, PROFILE_ROOT, type MockAppDataRepo } from './testUtils';
import { joinPath } from '../../transfer/joinPath';

jest.mock('@tauri-apps/plugin-dialog', () => ({
  open: jest.fn(),
  save: jest.fn()
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pluginDialog = jest.requireMock('@tauri-apps/plugin-dialog') as {
  open: jest.Mock<() => Promise<string | null>>;
};

const IMPORT_DIR = 'E:\\Imports';

const fullExportFolder = (): Record<string, string> => {
  const file = (name: string, contents: string) => [joinPath(IMPORT_DIR, name), contents] as const;
  return Object.fromEntries([
    file('songs.json', JSON.stringify({ songs: [{ songId: 's1' }] })),
    file('palettes.json', JSON.stringify({ palettes: [{ paletteId: 'p1' }] })),
    file(
      'artists.json',
      JSON.stringify({ artists: [{ artistId: 'a1', songs: [], name: 'A', isAFavorite: false }] })
    ),
    file(
      'playlists.json',
      JSON.stringify({
        playlists: [
          {
            playlistId: 'pl1',
            name: 'Mix',
            createdDate: '2024-01-01',
            songs: [],
            isArtworkAvailable: false
          }
        ]
      })
    ),
    file(
      'albums.json',
      JSON.stringify({ albums: [{ albumId: 'al1', title: 'Al', artists: [], songs: [] }] })
    ),
    file(
      'genres.json',
      JSON.stringify({ genres: [{ genreId: 'g1', name: 'G', artists: [], songs: [] }] })
    ),
    file('userData.json', JSON.stringify({ userData: { language: 'ru' } })),
    file('listening_data.json', JSON.stringify({ listeningData: [{ songId: 's1', listens: [] }] })),
    file(
      'blacklist.json',
      JSON.stringify({ blacklists: { songBlacklist: ['s1'], folderBlacklist: [] } })
    ),
    file(
      'cmr_stats.json',
      JSON.stringify({
        cmrStats: { elo: { ratings: {}, history: [], totalDuels: 2 }, importedStatsExportIds: [] }
      })
    ),
    file('localStorageData.json', JSON.stringify({ preferences: { isReducedMotion: true } })),
    file(joinPath('song_covers', 'cover.webp'), 'cover-bytes')
  ]);
};

describe('importAppData', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const repoFor = (files: Record<string, string>): MockAppDataRepo => {
    const repo = createMockAppDataRepo({}, {}, files);
    repo.dirs.add(IMPORT_DIR);
    repo.dirs.add(joinPath(IMPORT_DIR, 'song_covers'));
    return repo;
  };

  test('imports required and optional data, returns localStorage and schedules a restart', async () => {
    const repo = repoFor(fullExportFolder());
    pluginDialog.open.mockResolvedValue(IMPORT_DIR);

    const result = await importAppData(repo);

    expect(result).toEqual({ preferences: { isReducedMotion: true } });
    expect(repo.state.songs).toEqual([{ songId: 's1' }]);
    expect(repo.state.palettes).toEqual([{ paletteId: 'p1' }]);
    expect(repo.state.artists).toEqual([
      { artistId: 'a1', songs: [], name: 'A', isAFavorite: false }
    ]);
    expect(repo.state.playlists).toEqual([
      {
        playlistId: 'pl1',
        name: 'Mix',
        createdDate: '2024-01-01',
        songs: [],
        isArtworkAvailable: false
      }
    ]);
    expect(repo.state.userData).toEqual({ language: 'ru' });
    expect(repo.state.listeningData).toEqual([{ songId: 's1', listens: [] }]);
    expect(repo.state.blacklist).toEqual({ songBlacklist: ['s1'], folderBlacklist: [] });
    expect(repo.state.cmrStats).toEqual({
      elo: { ratings: {}, history: [], totalDuels: 2 },
      importedStatsExportIds: []
    });

    expect(repo.sendMessageMock).toHaveBeenCalledWith('APPDATA_IMPORT_STARTED');
    expect(repo.sendMessageMock).toHaveBeenCalledWith('APPDATA_IMPORT_SUCCESS');
    expect(repo.sendMessageMock).toHaveBeenCalledWith(
      'APPDATA_IMPORT_SUCCESS_WITH_PENDING_RESTART'
    );
    // The restart is delayed by five seconds when localStorage must be consumed first.
    expect(repo.restartAppMock).not.toHaveBeenCalled();
  });

  test('restarts immediately when there is no localStorage data', async () => {
    const files = fullExportFolder();
    delete files[joinPath(IMPORT_DIR, 'localStorageData.json')];
    const repo = repoFor(files);
    pluginDialog.open.mockResolvedValue(IMPORT_DIR);

    await importAppData(repo);

    expect(repo.restartAppMock).toHaveBeenCalledWith('Applying imported app data', true);
    expect(repo.sendMessageMock).not.toHaveBeenCalledWith(
      'APPDATA_IMPORT_SUCCESS_WITH_PENDING_RESTART'
    );
  });

  test('copies the song_covers folder into the profile', async () => {
    const repo = repoFor(fullExportFolder());
    pluginDialog.open.mockResolvedValue(IMPORT_DIR);

    await importAppData(repo);

    expect(repo.copies).toEqual([
      {
        source: joinPath(IMPORT_DIR, 'song_covers', 'cover.webp'),
        destination: joinPath(PROFILE_ROOT, 'song_covers', 'cover.webp')
      }
    ]);
  });

  test('fails with a missing-files message and touches nothing when required items are absent', async () => {
    const repo = repoFor({ [joinPath(IMPORT_DIR, 'songs.json')]: '{}' });
    pluginDialog.open.mockResolvedValue(IMPORT_DIR);

    await importAppData(repo);

    expect(repo.sendMessageMock).toHaveBeenCalledWith('APPDATA_IMPORT_FAILED_DUE_TO_MISSING_FILES');
    expect(repo.state.songs).toEqual([]);
    expect(repo.state.playlists).toEqual([]);
    expect(repo.restartAppMock).not.toHaveBeenCalled();
  });

  test('skips optional data when the folder predates those files', async () => {
    const files = fullExportFolder();
    for (const name of [
      'blacklist.json',
      'listening_data.json',
      'cmr_stats.json',
      'localStorageData.json'
    ]) {
      delete files[joinPath(IMPORT_DIR, name)];
    }
    const repo = repoFor(files);
    pluginDialog.open.mockResolvedValue(IMPORT_DIR);

    await importAppData(repo);

    expect(repo.state.listeningData).toEqual([]);
    expect(repo.state.blacklist).toEqual({ songBlacklist: [], folderBlacklist: [] });
    expect(repo.state.cmrStats.elo.totalDuels).toBe(0);
    expect(repo.restartAppMock).toHaveBeenCalled();
  });

  test('reports a failure when the folder picker is cancelled', async () => {
    const repo = repoFor(fullExportFolder());
    pluginDialog.open.mockResolvedValue(null);

    await importAppData(repo);

    expect(repo.sendMessageMock).toHaveBeenCalledWith('APPDATA_IMPORT_FAILED');
    expect(repo.state.songs).toEqual([]);
  });

  test('continues after an unreadable required file, like the Electron build', async () => {
    const repo = repoFor(fullExportFolder());
    pluginDialog.open.mockResolvedValue(IMPORT_DIR);
    repo.readTextFile = jest.fn(async () => {
      throw new Error('permission denied');
    });

    await importAppData(repo);

    // The Electron build logs the read failure inside importRequiredData and
    // still reports success before restarting — the port keeps that behavior.
    expect(repo.sendMessageMock).toHaveBeenCalledWith('APPDATA_IMPORT_SUCCESS');
    expect(repo.restartAppMock).toHaveBeenCalledWith('Applying imported app data', true);
    expect(repo.state.songs).toEqual([]);
  });
});

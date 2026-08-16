import { jest } from '@jest/globals';

import exportAppData from '../exportAppData';
import { createMockAppDataRepo, PROFILE_ROOT } from './testUtils';
import { joinPath } from '../../transfer/joinPath';

jest.mock('@tauri-apps/plugin-dialog', () => ({
  open: jest.fn(),
  save: jest.fn()
}));

const pluginDialog = jest.requireMock('@tauri-apps/plugin-dialog') as {
  open: jest.Mock<() => Promise<string | null>>;
};

const EXPORT_FILES = [
  'songs.json',
  'palettes.json',
  'blacklist.json',
  'artists.json',
  'playlists.json',
  'albums.json',
  'genres.json',
  'userData.json',
  'listening_data.json',
  'listening_events.json',
  'cmr_stats.json',
  'localStorageData.json',
  'IMPORTANT - DO NOT EDIT CONTENTS IN THIS DIRECTORY.txt'
];

describe('exportAppData', () => {
  const repoWithData = () => {
    const repo = createMockAppDataRepo(
      {},
      {
        songs: [{ songId: 's1' } as SavableSongData],
        listeningCounters: {
          version: 1,
          installId: 'source-install',
          tracks: {},
          counters: {
            track: { 'source-install': { '2026-08-16': { l: 3 } } }
          }
        }
      },
      { [joinPath(PROFILE_ROOT, 'song_covers', 'a.webp')]: 'cover-bytes' }
    );
    repo.dirs.add(joinPath(PROFILE_ROOT, 'song_covers'));
    return repo;
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('writes every export file atomically plus a recursive song_covers copy', async () => {
    const repo = repoWithData();
    pluginDialog.open.mockResolvedValue('E:\\Destinations');

    await exportAppData(repo, '{"preferences":{}}');

    expect(pluginDialog.open).toHaveBeenCalledWith({
      title: 'Select a Destination to Export App Data',
      directory: true,
      multiple: false
    });

    const exportDir = joinPath('E:\\Destinations', 'Nora exports');
    expect(repo.dirs.has(exportDir)).toBe(true);
    expect(repo.writes).toHaveLength(EXPORT_FILES.length);
    for (const filename of EXPORT_FILES) {
      expect(repo.writes.some((write) => write.path === joinPath(exportDir, filename))).toBe(true);
    }

    const songs = repo.writes.find((write) => write.path.endsWith('songs.json'));
    expect(JSON.parse(songs!.contents)).toEqual({ songs: [{ songId: 's1' }] });
    const localStorageWrite = repo.writes.find((write) =>
      write.path.endsWith('localStorageData.json')
    );
    expect(localStorageWrite?.contents).toBe('{"preferences":{}}');
    const listeningEvents = repo.writes.find((write) =>
      write.path.endsWith('listening_events.json')
    );
    expect(JSON.parse(listeningEvents!.contents)).toEqual({
      listeningEvents: repo.state.listeningCounters
    });

    // Song covers were copied recursively through the file seam.
    expect(repo.copies).toEqual([
      {
        source: joinPath(PROFILE_ROOT, 'song_covers', 'a.webp'),
        destination: joinPath(exportDir, 'song_covers', 'a.webp')
      }
    ]);

    // One progress message per operation (14 = 13 files + song_covers), then the success message.
    expect(repo.sendMessageMock).toHaveBeenCalledTimes(EXPORT_FILES.length + 2);
    expect(repo.sendMessageMock).toHaveBeenCalledWith('APPDATA_EXPORT_STARTED', {
      total: 14,
      value: 14
    });
    expect(repo.sendMessageMock).toHaveBeenLastCalledWith('APPDATA_EXPORT_SUCCESS');
  });

  test('uses the selected folder directly when it is already named "Nora exports"', async () => {
    const repo = repoWithData();
    pluginDialog.open.mockResolvedValue('E:\\Destinations\\Nora exports');

    await exportAppData(repo, '{}');

    const exportDir = joinPath('E:\\Destinations\\Nora exports');
    expect(repo.writes.some((write) => write.path.startsWith(`${exportDir}\\`))).toBe(true);
    expect(
      repo.writes.some((write) =>
        write.path.startsWith('E:\\Destinations\\Nora exports\\Nora exports')
      )
    ).toBe(false);
  });

  test('rejects when the folder picker is cancelled, like the Electron build', async () => {
    const repo = repoWithData();
    pluginDialog.open.mockResolvedValue(null);

    await expect(exportAppData(repo, '{}')).rejects.toThrow('PROMPT_CLOSED_BEFORE_INPUT');
    expect(repo.writes).toHaveLength(0);
  });

  test('reports export failure when a write fails mid-run', async () => {
    const repo = repoWithData();
    pluginDialog.open.mockResolvedValue('E:\\Destinations');
    repo.writeTextFileAtomic = jest.fn(async () => {
      throw new Error('disk full');
    });

    await exportAppData(repo, '{}');

    expect(repo.sendMessageMock).toHaveBeenCalledWith('APPDATA_EXPORT_FAILED');
  });
});

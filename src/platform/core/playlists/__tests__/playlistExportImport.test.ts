import { jest } from '@jest/globals';

import exportPlaylist from '../exportPlaylist';
import importPlaylist from '../importPlaylist';
import { createMockPlaylistsRepo, createPlaylist, createSong } from './testUtils';

jest.mock('@tauri-apps/plugin-fs', () => ({
  readTextFile: jest.fn(),
  writeTextFile: jest.fn()
}));

jest.mock('@tauri-apps/plugin-dialog', () => ({
  open: jest.fn(),
  save: jest.fn()
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pluginFs = jest.requireMock('@tauri-apps/plugin-fs') as {
  readTextFile: jest.Mock<(path: string) => Promise<string>>;
  writeTextFile: jest.Mock<(path: string, data: string) => Promise<void>>;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pluginDialog = jest.requireMock('@tauri-apps/plugin-dialog') as {
  open: jest.Mock<() => Promise<string | null>>;
  save: jest.Mock<() => Promise<string | null>>;
};

const SUPPORTED_MUSIC_EXTENSIONS = ['mp3', 'wav', 'ogg', 'aac', 'm4r', 'm4a', 'opus', 'flac'];

const m3u8Content = (lines: string[]): string => ['#EXTM3U', ...lines].join('\n');

describe('exportPlaylist', () => {
  const repoWithSongs = () => {
    const repo = createMockPlaylistsRepo(undefined, {
      playlists: [
        createPlaylist('p1', { name: 'Road Trip', songs: ['s1', 's2'] }),
        createPlaylist('p2', { name: 'Empty', songs: [] })
      ],
      songs: [
        createSong('s1', { path: 'E:\\Music\\a.mp3' }),
        createSong('s2', { path: 'E:\\Music\\b.flac' }),
        createSong('s3', { path: 'E:\\Music\\c.mp3' })
      ]
    });
    return repo;
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('writes an M3U8 file with the songs of the playlist', async () => {
    const repo = repoWithSongs();
    pluginDialog.save.mockResolvedValue('E:\\Exports\\Road Trip.m3u8');

    await exportPlaylist(repo, 'p1');

    expect(pluginDialog.save).toHaveBeenCalledWith(
      expect.objectContaining({
        title: `Select the destination to save 'Road Trip' playlist`,
        defaultPath: 'Road Trip',
        filters: [{ extensions: ['m3u8'], name: 'M3U8 Files' }],
        canCreateDirectories: true
      })
    );
    expect(pluginFs.writeTextFile).toHaveBeenCalledWith(
      'E:\\Exports\\Road Trip.m3u8',
      ['#EXTM3U', '#Road Trip.m3u8', '', 'E:\\Music\\a.mp3', 'E:\\Music\\b.flac'].join('\n')
    );
    expect(repo.sendMessageMock).toHaveBeenCalledWith('PLAYLIST_EXPORT_SUCCESS', {
      name: 'Road Trip'
    });
  });

  test('reports export failure when the save dialog is cancelled', async () => {
    const repo = repoWithSongs();
    pluginDialog.save.mockResolvedValue(null);

    await exportPlaylist(repo, 'p1');

    expect(pluginFs.writeTextFile).not.toHaveBeenCalled();
    expect(repo.sendMessageMock).toHaveBeenCalledWith('PLAYLIST_EXPORT_FAILED', {
      name: 'Road Trip'
    });
  });

  test('reports export failure when the write fails', async () => {
    const repo = repoWithSongs();
    pluginDialog.save.mockResolvedValue('E:\\Exports\\Road Trip.m3u8');
    pluginFs.writeTextFile.mockRejectedValue(new Error('disk error'));

    await exportPlaylist(repo, 'p1');

    expect(repo.sendMessageMock).toHaveBeenCalledWith('PLAYLIST_EXPORT_FAILED', {
      name: 'Road Trip'
    });
  });

  test('does nothing for an unknown playlist id', async () => {
    const repo = repoWithSongs();

    await exportPlaylist(repo, 'missing');

    expect(pluginDialog.save).not.toHaveBeenCalled();
    expect(pluginFs.writeTextFile).not.toHaveBeenCalled();
  });
});

describe('importPlaylist', () => {
  const repoWithLibrary = () => {
    const repo = createMockPlaylistsRepo(undefined, {
      songs: [
        createSong('s1', { path: 'E:\\Music\\a.mp3' }),
        createSong('s2', { path: 'E:\\Music\\b.flac' })
      ]
    });
    return repo;
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('creates a new playlist from an M3U8 with absolute library paths', async () => {
    const repo = repoWithLibrary();
    pluginDialog.open.mockResolvedValue('E:\\Exports\\Hits.m3u8');
    pluginFs.readTextFile.mockResolvedValue(
      m3u8Content(['E:\\Music\\a.mp3', '#EXTINF:180,Song b', 'E:\\Music\\b.flac'])
    );

    await importPlaylist(repo, SUPPORTED_MUSIC_EXTENSIONS);

    const created = repo.state.playlists.find((p) => p.name === 'Hits');
    expect(created).toBeDefined();
    expect(created?.songs).toEqual(['s1', 's2']);
    expect(repo.sendMessageMock).toHaveBeenCalledWith('PLAYLIST_IMPORT_SUCCESS', {
      name: 'Hits'
    });
  });

  test('ignores relative entries, comments and unsupported extensions', async () => {
    const repo = repoWithLibrary();
    pluginDialog.open.mockResolvedValue('E:\\Exports\\Hits.m3u8');
    pluginFs.readTextFile.mockResolvedValue(
      m3u8Content([
        'E:\\Music\\a.mp3',
        './relative.mp3',
        'E:\\Music\\notes.txt',
        '#EXTINF:10,Skip me'
      ])
    );

    await importPlaylist(repo, SUPPORTED_MUSIC_EXTENSIONS);

    const created = repo.state.playlists.find((p) => p.name === 'Hits');
    expect(created?.songs).toEqual(['s1']);
  });

  test('adds to an existing playlist instead of duplicating it', async () => {
    const repo = createMockPlaylistsRepo(undefined, {
      songs: [
        createSong('s1', { path: 'E:\\Music\\a.mp3' }),
        createSong('s2', { path: 'E:\\Music\\b.flac' })
      ],
      playlists: [createPlaylist('p1', { name: 'Hits', songs: ['s1'] })]
    });
    pluginDialog.open.mockResolvedValue('E:\\Exports\\Hits.m3u8');
    pluginFs.readTextFile.mockResolvedValue(m3u8Content(['E:\\Music\\a.mp3', 'E:\\Music\\b.flac']));

    await importPlaylist(repo, SUPPORTED_MUSIC_EXTENSIONS);

    expect(repo.state.playlists).toHaveLength(1);
    expect(repo.state.playlists[0]?.songs).toEqual(['s1', 's2']);
    expect(repo.sendMessageMock).toHaveBeenCalledWith('PLAYLIST_IMPORT_TO_EXISTING_PLAYLIST', {
      count: 2,
      name: 'Hits'
    });
  });

  test('merges into Favorites through the like-toggle without duplicates', async () => {
    const repo = createMockPlaylistsRepo(undefined, {
      songs: [
        createSong('s1', { path: 'E:\\Music\\a.mp3' }),
        createSong('s2', { path: 'E:\\Music\\b.flac' })
      ],
      playlists: [createPlaylist('Favorites', { songs: ['s1'] })]
    });
    pluginDialog.open.mockResolvedValue('E:\\Exports\\Favorites.m3u8');
    pluginFs.readTextFile.mockResolvedValue(m3u8Content(['E:\\Music\\a.mp3', 'E:\\Music\\b.flac']));

    await importPlaylist(repo, SUPPORTED_MUSIC_EXTENSIONS);

    const favorites = repo.state.playlists.find((p) => p.playlistId === 'Favorites');
    expect(favorites?.songs).toEqual(['s1', 's2']);
    expect(repo.state.songs.find((s) => s.songId === 's2')?.isAFavorite).toBe(true);
    expect(repo.state.songs.find((s) => s.songId === 's1')?.isAFavorite).toBe(false);
    expect(repo.sendMessageMock).toHaveBeenCalledWith('PLAYLIST_IMPORT_TO_EXISTING_PLAYLIST', {
      count: 2,
      name: 'Favorites'
    });
  });

  test('reports a failed import when the chosen file is not an M3U8', async () => {
    const repo = repoWithLibrary();
    pluginDialog.open.mockResolvedValue('E:\\Exports\\Hits.txt');

    await importPlaylist(repo, SUPPORTED_MUSIC_EXTENSIONS);

    expect(repo.sendMessageMock).toHaveBeenCalledWith(
      'PLAYLIST_IMPORT_FAILED_DUE_TO_INVALID_FILE_EXTENSION'
    );
  });

  test('reports invalid file data when the header is missing', async () => {
    const repo = repoWithLibrary();
    pluginDialog.open.mockResolvedValue('E:\\Exports\\Hits.m3u8');
    pluginFs.readTextFile.mockResolvedValue('E:\\Music\\a.mp3');

    await importPlaylist(repo, SUPPORTED_MUSIC_EXTENSIONS);

    expect(repo.sendMessageMock).toHaveBeenCalledWith(
      'PLAYLIST_IMPORT_FAILED_DUE_TO_INVALID_FILE_DATA'
    );
  });

  test('reports a general failure when the dialog is cancelled', async () => {
    const repo = repoWithLibrary();
    pluginDialog.open.mockResolvedValue(null);

    await importPlaylist(repo, SUPPORTED_MUSIC_EXTENSIONS);

    expect(repo.sendMessageMock).toHaveBeenCalledWith('PLAYLIST_IMPORT_FAILED');
  });

  test('reports a general failure when reading the file throws', async () => {
    const repo = repoWithLibrary();
    pluginDialog.open.mockResolvedValue('E:\\Exports\\Hits.m3u8');
    pluginFs.readTextFile.mockRejectedValue(new Error('unreadable'));

    await importPlaylist(repo, SUPPORTED_MUSIC_EXTENSIONS);

    expect(repo.sendMessageMock).toHaveBeenCalledWith('PLAYLIST_IMPORT_FAILED');
  });

  test('handles CRLF line endings and reports songs outside the library', async () => {
    const repo = repoWithLibrary();
    pluginDialog.open.mockResolvedValue('E:\\Exports\\Hits.m3u8');
    pluginFs.readTextFile.mockResolvedValue(
      m3u8Content(['E:\\Music\\a.mp3', 'D:\\NotInLibrary.mp3']).replaceAll('\n', '\r\n')
    );

    await importPlaylist(repo, SUPPORTED_MUSIC_EXTENSIONS);

    const created = repo.state.playlists.find((p) => p.name === 'Hits');
    expect(created?.songs).toEqual(['s1']);
    expect(repo.sendMessageMock).toHaveBeenCalledWith('PLAYLIST_IMPORT_SUCCESS', {
      count: 1
    });
    expect(repo.sendMessageMock).toHaveBeenLastCalledWith('PLAYLIST_IMPORT_SUCCESS', {
      name: 'Hits'
    });
  });
});

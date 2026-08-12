import { describe, expect, jest, test } from '@jest/globals';

import addArtworkToAPlaylist from '../addArtworkToAPlaylist';
import addNewPlaylist from '../addNewPlaylist';
import addSongsToPlaylist from '../addSongsToPlaylist';
import clearSongHistory from '../clearSongHistory';
import removePlaylists from '../removePlaylists';
import removeSongFromPlaylist from '../removeSongFromPlaylist';
import renameAPlaylist from '../renameAPlaylist';
import { createMockPlaylistsRepo, createPlaylist, type MockPlaylistsRepo } from './testUtils';

describe('addNewPlaylist', () => {
  test('creates a playlist with song ids and artwork', async () => {
    const repo = createMockPlaylistsRepo();
    repo.storePlaylistArtwork = jest.fn(async (playlistId: string) => ({
      isDefaultArtwork: false,
      artworkPath: `nemora://localfiles/song_covers/${playlistId}.webp`,
      optimizedArtworkPath: `nemora://localfiles/song_covers/${playlistId}-optimized.webp`
    }));

    const result = await addNewPlaylist(repo, 'My Mix', ['s1', 's2'], 'E:\\art.jpg');

    expect(result.success).toBe(true);
    expect(result.playlist).toBeDefined();
    expect(result.playlist?.name).toBe('My Mix');
    expect(result.playlist?.songs).toEqual(['s1', 's2']);
    expect(result.playlist?.isArtworkAvailable).toBe(true);
    expect(result.playlist?.artworkPaths).toEqual({
      isDefaultArtwork: false,
      artworkPath: `nemora://localfiles/song_covers/${result.playlist?.playlistId}.webp`,
      optimizedArtworkPath: `nemora://localfiles/song_covers/${result.playlist?.playlistId}-optimized.webp`
    });
    expect(repo.state.playlists.some((p) => p.name === 'My Mix')).toBe(true);
    expect(repo.emitDataUpdateMock).toHaveBeenCalledWith('playlists/newPlaylist');
  });

  test('rejects a duplicate name', async () => {
    const repo = createMockPlaylistsRepo(undefined, {
      playlists: [createPlaylist('p1', { name: 'My Mix' })]
    });

    const result = await addNewPlaylist(repo, 'My Mix');

    expect(result).toEqual({
      success: false,
      message: `Playlist with name 'My Mix' already exists.`
    });
    expect(repo.state.playlists).toHaveLength(1);
  });

  test('defaults to an empty song list and reports artwork availability', async () => {
    const repo = createMockPlaylistsRepo();

    const result = await addNewPlaylist(repo, 'Empty');

    expect(result.success).toBe(true);
    expect(result.playlist?.songs).toEqual([]);
    expect(result.playlist?.isArtworkAvailable).toBe(false);
    expect(repo.storePlaylistArtwork).toHaveBeenCalledWith(result.playlist?.playlistId, undefined);
  });

  test('returns a failure result when artwork storage throws', async () => {
    const repo = createMockPlaylistsRepo({
      storePlaylistArtwork: jest.fn(async () => {
        throw new Error('disk full');
      })
    });

    const result = await addNewPlaylist(repo, 'Broken');

    expect(result).toEqual({ success: false });
    expect(repo.state.playlists).toHaveLength(3);
  });
});

describe('renameAPlaylist', () => {
  test('renames a user playlist', () => {
    const repo = createMockPlaylistsRepo(undefined, {
      playlists: [createPlaylist('p1', { name: 'Old' })]
    });

    renameAPlaylist(repo, 'p1', 'New');

    expect(repo.state.playlists[0]?.name).toBe('New');
    expect(repo.sendMessageMock).toHaveBeenCalledWith('PLAYLIST_RENAME_SUCCESS');
  });

  test('reports a missing playlist', () => {
    const repo = createMockPlaylistsRepo();

    renameAPlaylist(repo, 'missing', 'New');

    expect(repo.sendMessageMock).toHaveBeenCalledWith('PLAYLIST_NOT_FOUND');
  });

  test('refuses to rename the system playlists', () => {
    for (const playlistId of ['History', 'Favorites', 'Rediscover']) {
      const repo = createMockPlaylistsRepo();
      renameAPlaylist(repo, playlistId, 'Hacked');

      expect(repo.sendMessageMock).toHaveBeenCalledWith('PLAYLIST_NOT_FOUND');
      const stored = repo.state.playlists.find((p) => p.playlistId === playlistId);
      expect(stored?.name).toBe(playlistId);
    }
  });
});

describe('removePlaylists', () => {
  test('deletes user playlists and reports the deleted ids', () => {
    const repo = createMockPlaylistsRepo(undefined, {
      playlists: [createPlaylist('p1'), createPlaylist('p2')]
    });

    const result = removePlaylists(repo, ['p1', 'p2']);

    expect(result).toBe(true);
    expect(repo.state.playlists).toHaveLength(0);
    expect(repo.emitDataUpdateMock).toHaveBeenCalledWith('playlists/deletedPlaylist');
  });

  test('never deletes the system playlists', () => {
    const repo = createMockPlaylistsRepo();

    removePlaylists(repo, ['History', 'Favorites', 'Rediscover', 'p1']);

    const ids = repo.state.playlists.map((p) => p.playlistId);
    expect(ids).toEqual(['History', 'Favorites', 'Rediscover']);
  });

  test('throws when no playlist matches', () => {
    const repo = createMockPlaylistsRepo();

    expect(() => removePlaylists(repo, ['missing'])).toThrow(
      'Failed to remove playlists because playlists cannot be located.'
    );
  });
});

describe('addSongsToPlaylist', () => {
  test('adds new songs and skips existing ones', () => {
    const repo = createMockPlaylistsRepo(undefined, {
      playlists: [createPlaylist('p1', { songs: ['s1'] })]
    });

    addSongsToPlaylist(repo, 'p1', ['s1', 's2', 's3']);

    expect(repo.state.playlists[0]?.songs).toEqual(['s1', 's2', 's3']);
    expect(repo.sendMessageMock).toHaveBeenCalledWith('ADDED_SONGS_TO_PLAYLIST', {
      count: 2,
      name: 'p1'
    });
  });

  test('throws for an unknown playlist', () => {
    const repo = createMockPlaylistsRepo();

    expect(() => addSongsToPlaylist(repo, 'missing', ['s1'])).toThrow(
      'Request failed because a playlist cannot be found.'
    );
  });

  test('throws for an empty playlists array', () => {
    const repo = createMockPlaylistsRepo(undefined, { playlists: [] });

    expect(() => addSongsToPlaylist(repo, 'p1', ['s1'])).toThrow(
      'Request failed because the playlists array is empty.'
    );
  });

  test('rejects manual modification of the Rediscover system playlist', () => {
    const repo = createMockPlaylistsRepo();

    expect(() => addSongsToPlaylist(repo, 'Rediscover', ['s1'])).toThrow(
      'cannot be manually modified'
    );
    const rediscover = repo.state.playlists.find((p) => p.playlistId === 'Rediscover');
    expect(rediscover?.songs).toEqual([]);
  });
});

describe('removeSongFromPlaylist', () => {
  test('removes a song and emits the deleted-song event', async () => {
    const repo = createMockPlaylistsRepo(undefined, {
      playlists: [createPlaylist('p1', { songs: ['s1', 's2'] })]
    });

    await removeSongFromPlaylist(repo, 'p1', 's1');

    expect(repo.state.playlists[0]?.songs).toEqual(['s2']);
    expect(repo.emitDataUpdateMock).toHaveBeenCalledWith('playlists/deletedSong');
  });

  test('throws when the song is not in the playlist', async () => {
    const repo = createMockPlaylistsRepo(undefined, {
      playlists: [createPlaylist('p1', { songs: ['s2'] })]
    });

    await expect(removeSongFromPlaylist(repo, 'p1', 's1')).rejects.toThrow(
      `'s1' cannot be found in the playlist of id p1.`
    );
  });

  test('throws when the playlists data is empty', async () => {
    const repo = createMockPlaylistsRepo(undefined, { playlists: [] });

    await expect(removeSongFromPlaylist(repo, 'p1', 's1')).rejects.toThrow(
      'Request failed because playlist data is undefined.'
    );
  });
});

describe('addArtworkToAPlaylist', () => {
  const artworkPaths: ArtworkPaths = {
    isDefaultArtwork: false,
    artworkPath: 'nemora://localfiles/song_covers/play.webp',
    optimizedArtworkPath: 'nemora://localfiles/song_covers/play-optimized.webp'
  };

  const repoWithPlaylist = (overrides: Partial<MockPlaylistsRepo> = {}): MockPlaylistsRepo => {
    const repo = createMockPlaylistsRepo(overrides, {
      playlists: [createPlaylist('p1', { isArtworkAvailable: false })]
    });
    repo.storePlaylistArtwork = jest.fn(async () => artworkPaths);
    return repo;
  };

  test('stores the artwork and updates availability', async () => {
    const repo = repoWithPlaylist();

    const result = await addArtworkToAPlaylist(repo, 'p1', 'E:\\new-art.jpg');

    expect(result).toEqual(artworkPaths);
    expect(repo.state.playlists[0]?.isArtworkAvailable).toBe(true);
    expect(repo.storePlaylistArtwork).toHaveBeenCalledWith('p1', 'E:\\new-art.jpg');
    expect(repo.resetArtworkCache).toHaveBeenCalledWith('playlistArtworks');
    expect(repo.emitDataUpdateMock).toHaveBeenCalledWith('playlists');
  });

  test('removes the previous artwork before storing a new one', async () => {
    const repo = repoWithPlaylist({
      getPlaylistArtworkPath: jest.fn(() => artworkPaths)
    });
    repo.state.playlists[0]!.isArtworkAvailable = true;

    await addArtworkToAPlaylist(repo, 'p1', 'E:\\new-art.jpg');

    expect(repo.removePlaylistArtwork).toHaveBeenCalledWith(artworkPaths);
  });

  test('returns undefined for an unknown playlist id', async () => {
    const repo = repoWithPlaylist();

    const result = await addArtworkToAPlaylist(repo, 'missing', 'E:\\new-art.jpg');

    expect(result).toBeUndefined();
  });

  test('refuses to re-cover the system playlists', async () => {
    for (const playlistId of ['History', 'Favorites', 'Rediscover']) {
      const repo = repoWithPlaylist();

      const result = await addArtworkToAPlaylist(repo, playlistId, 'E:\\new-art.jpg');

      expect(result).toBeUndefined();
      expect(repo.storePlaylistArtwork).not.toHaveBeenCalled();
    }
  });
});

describe('clearSongHistory', () => {
  test('empties only the History playlist and returns true', () => {
    const repo = createMockPlaylistsRepo(undefined, {
      playlists: [
        createPlaylist('History', { songs: ['s1', 's2'] }),
        createPlaylist('p1', { songs: ['s3'] })
      ]
    });

    const result = clearSongHistory(repo);

    expect(result).toBe(true);
    expect(repo.state.playlists.find((p) => p.playlistId === 'History')?.songs).toEqual([]);
    expect(repo.state.playlists.find((p) => p.playlistId === 'p1')?.songs).toEqual(['s3']);
    expect(repo.emitDataUpdateMock).toHaveBeenCalledWith('playlists/history');
  });

  test('returns undefined when the store is empty', () => {
    const repo = createMockPlaylistsRepo(undefined, { playlists: [] });

    expect(clearSongHistory(repo)).toBeUndefined();
  });
});

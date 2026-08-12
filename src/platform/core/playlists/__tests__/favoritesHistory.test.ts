import { describe, expect, test } from '@jest/globals';

import addToFavorites from '../addToFavorites';
import { addToSongsHistory } from '../addToSongsHistory';
import removeFromFavorites from '../removeFromFavorites';
import sendPlaylistData from '../sendPlaylistData';
import { createMockPlaylistsRepo, createPlaylist } from './testUtils';

describe('addToFavorites', () => {
  test('adds a song to the existing Favorites playlist', () => {
    const repo = createMockPlaylistsRepo();

    const result = addToFavorites(repo, 's1');

    expect(result).toEqual({ success: true });
    const favorites = repo.state.playlists.find((p) => p.playlistId === 'Favorites');
    expect(favorites?.songs).toEqual(['s1']);
  });

  test('rejects a song that is already in Favorites', () => {
    const repo = createMockPlaylistsRepo(undefined, {
      playlists: [createPlaylist('Favorites', { songs: ['s1'] })]
    });

    const result = addToFavorites(repo, 's1');

    expect(result).toEqual({ success: false, message: 'Song with id s1 is already in Favorites.' });
  });

  test('creates the Favorites playlist when the store has no playlists', () => {
    const repo = createMockPlaylistsRepo(undefined, { playlists: [] });

    const result = addToFavorites(repo, 's1');

    expect(result).toEqual({ success: true });
    expect(repo.state.playlists).toHaveLength(1);
    expect(repo.state.playlists[0]?.playlistId).toBe('Favorites');
    expect(repo.emitDataUpdateMock).toHaveBeenCalledWith('playlists/favorites');
  });

  test('throws when the playlists data is not an array', () => {
    const repo = createMockPlaylistsRepo({
      getPlaylists: () => undefined as unknown as SavablePlaylist[]
    });

    expect(() => addToFavorites(repo, 's1')).toThrow(
      'Failed to add to favorites because the playlist data is not an array.'
    );
  });
});

describe('removeFromFavorites', () => {
  test('removes a song from Favorites', () => {
    const repo = createMockPlaylistsRepo(undefined, {
      playlists: [createPlaylist('Favorites', { songs: ['s1', 's2'] })]
    });

    const result = removeFromFavorites(repo, 's1');

    expect(result).toEqual({ success: true });
    expect(repo.state.playlists.find((p) => p.playlistId === 'Favorites')?.songs).toEqual(['s2']);
    expect(repo.emitDataUpdateMock).toHaveBeenCalledWith('playlists/favorites');
  });

  test('reports failure when the Favorites playlist is unavailable', () => {
    const repo = createMockPlaylistsRepo(undefined, {
      playlists: [createPlaylist('p1', { songs: ['s1'] })]
    });

    const result = removeFromFavorites(repo, 's1');

    expect(result).toEqual({ success: false });
  });

  test('throws when the playlists data is not an array', () => {
    const repo = createMockPlaylistsRepo({
      getPlaylists: () => undefined as unknown as SavablePlaylist[]
    });

    expect(() => removeFromFavorites(repo, 's1')).toThrow('Playlists is not an array.');
  });
});

describe('addToSongsHistory', () => {
  test('unshifts a new song to History and drops duplicates', () => {
    const repo = createMockPlaylistsRepo(undefined, {
      playlists: [createPlaylist('History', { songs: ['s1', 's2'] })]
    });

    const result = addToSongsHistory(repo, 's2');

    expect(result).toBe(true);
    expect(repo.state.playlists.find((p) => p.playlistId === 'History')?.songs).toEqual([
      's2',
      's1'
    ]);
    expect(repo.emitDataUpdateMock).toHaveBeenCalledWith('playlists/history');
    expect(repo.emitDataUpdateMock).toHaveBeenCalledWith('userData/recentlyPlayedSongs');
  });

  test('caps History at 50 songs by dropping the oldest entry', () => {
    const songs = Array.from({ length: 50 }, (_, i) => `s${i}`);
    const repo = createMockPlaylistsRepo(undefined, {
      playlists: [createPlaylist('History', { songs })]
    });

    addToSongsHistory(repo, 'new');

    const history = repo.state.playlists.find((p) => p.playlistId === 'History')?.songs;
    expect(history).toHaveLength(50);
    expect(history?.[0]).toBe('new');
    expect(history?.includes('s49')).toBe(false);
  });

  test('creates the History playlist when missing, keeping the template state like the Electron build', () => {
    const repo = createMockPlaylistsRepo(undefined, { playlists: [] });

    addToSongsHistory(repo, 's1');

    expect(repo.state.playlists[0]?.playlistId).toBe('History');
    expect(repo.state.playlists[0]?.songs).toEqual([]);
  });

  test('throws when the playlists data is not an array', () => {
    const repo = createMockPlaylistsRepo({
      getPlaylists: () => undefined as unknown as SavablePlaylist[]
    });

    expect(() => addToSongsHistory(repo, 's1')).toThrow(
      'Failed to add song to the history playlist because the playlist data is not an array.'
    );
  });
});

describe('sendPlaylistData', () => {
  test('returns every playlist decorated with artwork paths', () => {
    const repo = createMockPlaylistsRepo();

    const result = sendPlaylistData(repo);

    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({
      playlistId: 'History',
      artworkPaths: expect.objectContaining({ artworkPath: expect.any(String) })
    });
  });

  test('filters by requested ids, keeping the store order like the Electron build', () => {
    const repo = createMockPlaylistsRepo(undefined, {
      playlists: [
        createPlaylist('p1'),
        createPlaylist('p2'),
        createPlaylist('p3'),
        createPlaylist('p4')
      ]
    });

    const result = sendPlaylistData(repo, ['p3', 'p1']);

    expect(result.map((p) => p.playlistId)).toEqual(['p1', 'p3']);
  });

  test('sorts alphabetically aToZ', () => {
    const repo = createMockPlaylistsRepo(undefined, {
      playlists: [createPlaylist('p2', { name: 'Zebra' }), createPlaylist('p1', { name: 'Alpha' })]
    });

    const result = sendPlaylistData(repo, [], 'aToZ');

    expect(result.map((p) => p.name)).toEqual(['Alpha', 'Zebra']);
  });

  test('hides History with onlyMutablePlaylists but keeps the rest', () => {
    const repo = createMockPlaylistsRepo();

    const result = sendPlaylistData(repo, [], undefined, true);

    const ids = result.map((p) => p.playlistId);
    expect(ids).toEqual(['Favorites', 'Rediscover']);
  });
});

import { describe, expect, test } from '@jest/globals';

import toggleLikeArtists from '../toggleLikeArtists';
import toggleLikeSongs from '../toggleLikeSongs';
import { createArtist, createMockPlaylistsRepo, createPlaylist, createSong } from './testUtils';

describe('toggleLikeSongs', () => {
  test('likes songs, mirrors them into Favorites and reports the ids', async () => {
    const repo = createMockPlaylistsRepo(undefined, {
      songs: [createSong('s1'), createSong('s2')]
    });

    const result = await toggleLikeSongs(repo, ['s1', 's2'], true);

    expect(result).toEqual({ likes: ['s1', 's2'], dislikes: [] });
    expect(repo.state.songs.filter((s) => s.isAFavorite).map((s) => s.songId)).toEqual([
      's1',
      's2'
    ]);
    expect(repo.state.playlists.find((p) => p.playlistId === 'Favorites')?.songs).toEqual([
      's1',
      's2'
    ]);
    expect(repo.addAFavoriteToLastFM).toHaveBeenCalledTimes(2);
    expect(repo.emitDataUpdateMock).toHaveBeenCalledWith('songs/likes', ['s1', 's2']);
  });

  test('dislikes songs and removes them from Favorites', async () => {
    const repo = createMockPlaylistsRepo(undefined, {
      songs: [createSong('s1', { isAFavorite: true }), createSong('s2', { isAFavorite: true })],
      playlists: [createPlaylist('Favorites', { songs: ['s1', 's2'] })]
    });

    const result = await toggleLikeSongs(repo, ['s1', 's2'], false);

    expect(result).toEqual({ likes: [], dislikes: ['s1', 's2'] });
    expect(repo.state.songs.every((s) => !s.isAFavorite)).toBe(true);
    expect(repo.state.playlists.find((p) => p.playlistId === 'Favorites')?.songs).toEqual([]);
    expect(repo.removeAFavoriteFromLastFM).toHaveBeenCalledTimes(2);
  });

  test('toggles the state when no flag is given', async () => {
    const repo = createMockPlaylistsRepo(undefined, {
      songs: [createSong('s1', { isAFavorite: true }), createSong('s2')]
    });

    const result = await toggleLikeSongs(repo, ['s1', 's2']);

    expect(result).toEqual({ likes: ['s2'], dislikes: ['s1'] });
  });

  test('skips songs that already match the requested state', async () => {
    const repo = createMockPlaylistsRepo(undefined, {
      songs: [createSong('s1', { isAFavorite: true })]
    });

    const result = await toggleLikeSongs(repo, ['s1'], true);

    expect(result).toEqual({ likes: [], dislikes: [] });
    expect(repo.addAFavoriteToLastFM).not.toHaveBeenCalled();
  });

  test('does not spam like notifications for more than 5 songs', async () => {
    const songs = Array.from({ length: 6 }, (_, i) => createSong(`s${i}`));
    const repo = createMockPlaylistsRepo(undefined, { songs });

    await toggleLikeSongs(
      repo,
      songs.map((s) => s.songId),
      true
    );

    expect(repo.sendMessageMock).not.toHaveBeenCalledWith(
      'SONG_LIKE',
      expect.objectContaining({ name: expect.any(String) })
    );
  });

  test('returns an empty result when there are no songs', async () => {
    const repo = createMockPlaylistsRepo();

    const result = await toggleLikeSongs(repo, ['s1'], true);

    expect(result).toEqual({ likes: [], dislikes: [] });
  });
});

describe('toggleLikeArtists', () => {
  test('likes and dislikes artists and reports the ids', async () => {
    const repo = createMockPlaylistsRepo(undefined, {
      artists: [createArtist('a1'), createArtist('a2', { isAFavorite: true })]
    });

    const result = await toggleLikeArtists(repo, ['a1', 'a2'], true);

    expect(result).toEqual({ likes: ['a1'], dislikes: [] });
    expect(repo.state.artists.find((a) => a.artistId === 'a1')?.isAFavorite).toBe(true);
    expect(repo.sendMessageMock).toHaveBeenCalledWith(
      'ARTIST_LIKE',
      expect.objectContaining({ name: 'Artist a1' })
    );
    expect(repo.emitDataUpdateMock).toHaveBeenCalledWith('artists/likes', ['a1']);
  });

  test('toggles when no flag is given', async () => {
    const repo = createMockPlaylistsRepo(undefined, {
      artists: [createArtist('a1', { isAFavorite: true }), createArtist('a2')]
    });

    const result = await toggleLikeArtists(repo, ['a1', 'a2']);

    expect(result).toEqual({ likes: ['a2'], dislikes: ['a1'] });
  });

  test('keeps an already-liked artist liked when asked to like again', async () => {
    const repo = createMockPlaylistsRepo(undefined, {
      artists: [createArtist('a1', { isAFavorite: true })]
    });

    const result = await toggleLikeArtists(repo, ['a1'], true);

    expect(result).toEqual({ likes: [], dislikes: [] });
    expect(repo.state.artists[0]?.isAFavorite).toBe(true);
  });

  test('shortens long names with an ellipsis in notifications', async () => {
    const longName = 'An Incredibly Long Artist Name That Exceeds Twenty Characters';
    const repo = createMockPlaylistsRepo(undefined, {
      artists: [createArtist('a1', { name: longName })]
    });

    await toggleLikeArtists(repo, ['a1'], true);

    expect(repo.sendMessageMock).toHaveBeenCalledWith(
      'ARTIST_LIKE',
      expect.objectContaining({ name: 'An Incredibly Long A...' })
    );
  });
});

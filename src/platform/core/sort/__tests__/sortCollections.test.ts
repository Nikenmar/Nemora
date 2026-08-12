import { describe, expect, test } from '@jest/globals';

import sortAlbums from '../sortAlbums';
import sortArtists from '../sortArtists';
import sortGenres from '../sortGenres';
// The live sorter lives with the playlists, not here: `core/sort/sortPlaylists.ts`
// was a second copy that `sendPlaylistData` never used, and this suite was the
// only thing keeping it alive.
import sortPlaylists from '../../playlists/sortPlaylists';

describe('sortAlbums', () => {
  const album = (albumId: string, title: string, songs: { title: string; songId: string }[] = []): SavableAlbum => ({
    albumId,
    title,
    songs
  });

  test('aToZ and zToA ignore case and non-word characters', () => {
    const data = [album('al-2', 'zeta!'), album('al-1', 'Alpha')];
    expect(sortAlbums(data, 'aToZ').map(({ albumId }) => albumId)).toEqual(['al-1', 'al-2']);
    expect(sortAlbums(data, 'zToA').map(({ albumId }) => albumId)).toEqual(['al-2', 'al-1']);
  });

  test('noOfSongs sorts break ties alphabetically', () => {
    const data = [
      album('al-1', 'one', [{ title: 'x', songId: 's1' }]),
      album('al-3', 'three', [{ title: 'x', songId: 's1' }, { title: 'y', songId: 's2' }, { title: 'z', songId: 's3' }]),
      album('al-2', 'two', [{ title: 'x', songId: 's1' }, { title: 'y', songId: 's2' }])
    ];
    expect(sortAlbums(data, 'noOfSongsAscending').map(({ albumId }) => albumId)).toEqual([
      'al-1',
      'al-2',
      'al-3'
    ]);
    expect(sortAlbums(data, 'noOfSongsDescending').map(({ albumId }) => albumId)).toEqual([
      'al-3',
      'al-2',
      'al-1'
    ]);
  });
});

describe('sortArtists', () => {
  const artist = (artistId: string, name: string, extras: Partial<SavableArtist> = {}): SavableArtist => ({
    artistId,
    songs: [],
    name,
    isAFavorite: false,
    ...extras
  });

  test('aToZ and zToA', () => {
    const data = [artist('ar-2', 'Zed'), artist('ar-1', 'anna')];
    expect(sortArtists(data, 'aToZ')!.map(({ artistId }) => artistId)).toEqual(['ar-1', 'ar-2']);
    expect(sortArtists(data, 'zToA')!.map(({ artistId }) => artistId)).toEqual(['ar-2', 'ar-1']);
  });

  test('noOfSongs sorts break ties alphabetically', () => {
    const data = [
      artist('ar-1', 'one', { songs: [{ title: 'x', songId: 's1' }] }),
      artist('ar-2', 'two', { songs: [{ title: 'x', songId: 's1' }, { title: 'y', songId: 's2' }] })
    ];
    expect(sortArtists(data, 'noOfSongsAscending')!.map(({ artistId }) => artistId)).toEqual([
      'ar-1',
      'ar-2'
    ]);
    expect(sortArtists(data, 'noOfSongsDescending')!.map(({ artistId }) => artistId)).toEqual([
      'ar-2',
      'ar-1'
    ]);
  });

  test('mostLoved sorts break ties alphabetically', () => {
    const data = [
      artist('ar-fav', 'bravo', { isAFavorite: true }),
      artist('ar-plain', 'alpha')
    ];
    expect(sortArtists(data, 'mostLovedAscending')!.map(({ artistId }) => artistId)).toEqual([
      'ar-plain',
      'ar-fav'
    ]);
    expect(sortArtists(data, 'mostLovedDescending')!.map(({ artistId }) => artistId)).toEqual([
      'ar-fav',
      'ar-plain'
    ]);
  });

  test('returns the data untouched without a sort type', () => {
    const data = [artist('ar-1', 'zed')];
    expect(sortArtists(data)).toBe(data);
  });
});

describe('sortGenres', () => {
  const genre = (genreId: string, name: string, songs: { title: string; songId: string }[] = []): SavableGenre => ({
    genreId,
    name,
    songs
  });

  test('aToZ and zToA', () => {
    const data = [genre('g-2', 'rock!'), genre('g-1', 'ambient')];
    expect(sortGenres(data, 'aToZ').map(({ genreId }) => genreId)).toEqual(['g-1', 'g-2']);
    expect(sortGenres(data, 'zToA').map(({ genreId }) => genreId)).toEqual(['g-2', 'g-1']);
  });

  test('noOfSongs sorts break ties alphabetically', () => {
    const data = [
      genre('g-2', 'two', [{ title: 'x', songId: 's1' }, { title: 'y', songId: 's2' }]),
      genre('g-1', 'one', [{ title: 'x', songId: 's1' }])
    ];
    expect(sortGenres(data, 'noOfSongsAscending').map(({ genreId }) => genreId)).toEqual(['g-1', 'g-2']);
    expect(sortGenres(data, 'noOfSongsDescending').map(({ genreId }) => genreId)).toEqual(['g-2', 'g-1']);
  });
});

describe('sortPlaylists', () => {
  const playlist = (playlistId: string, name: string, songs: string[] = []): SavablePlaylist => ({
    playlistId,
    name,
    songs,
    createdDate: new Date(),
    isArtworkAvailable: false
  });

  test('aToZ and zToA', () => {
    const data = [playlist('pl-2', 'zeta!'), playlist('pl-1', 'Alpha')];
    expect(sortPlaylists(data, 'aToZ').map(({ playlistId }) => playlistId)).toEqual(['pl-1', 'pl-2']);
    expect(sortPlaylists(data, 'zToA').map(({ playlistId }) => playlistId)).toEqual(['pl-2', 'pl-1']);
  });

  test('noOfSongs sorts break ties alphabetically', () => {
    const data = [
      playlist('pl-1', 'one', ['s1']),
      playlist('pl-2', 'two', ['s1', 's2']),
      playlist('pl-3', 'three', ['s1', 's2', 's3'])
    ];
    expect(sortPlaylists(data, 'noOfSongsAscending').map(({ playlistId }) => playlistId)).toEqual([
      'pl-1',
      'pl-2',
      'pl-3'
    ]);
    expect(sortPlaylists(data, 'noOfSongsDescending').map(({ playlistId }) => playlistId)).toEqual([
      'pl-3',
      'pl-2',
      'pl-1'
    ]);
  });
});

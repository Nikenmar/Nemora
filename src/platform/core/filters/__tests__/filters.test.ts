import { describe, expect, test } from '@jest/globals';

import type { BlacklistRepository } from '../repository';
import filterArtists from '../filterArtists';
import filterSongs from '../filterSongs';
import filterUniqueObjects from '../filterUniqueObjects';
import paginateData from '../paginateData';

const song = (
  partial: Partial<SavableSongData> & Pick<SavableSongData, 'songId' | 'title'>
): SavableSongData => ({
  duration: 200,
  isAFavorite: false,
  isArtworkAvailable: false,
  path: `C:/music/${partial.songId}.mp3`,
  addedDate: 0,
  ...partial
});

const blacklistRepository: BlacklistRepository = {
  isSongBlacklisted: (songId) => songId === 's-black',
  getFolderBlacklist: () => []
};

describe('filterSongs', () => {
  const data = [
    song({ songId: 's-black', title: 'zeta' }),
    song({ songId: 's-white', title: 'alpha' })
  ];

  test('blacklistedSongs and whitelistedSongs split on the repository predicate', () => {
    expect(filterSongs(blacklistRepository, data, 'blacklistedSongs').map(({ songId }) => songId)).toEqual([
      's-black'
    ]);
    expect(filterSongs(blacklistRepository, data, 'whitelistedSongs').map(({ songId }) => songId)).toEqual([
      's-white'
    ]);
  });

  test('notSelected and a missing filter type return the data untouched', () => {
    expect(filterSongs(blacklistRepository, data, 'notSelected')).toBe(data);
    expect(filterSongs(blacklistRepository, data)).toBe(data);
  });
});

describe('filterArtists', () => {
  const artist = (artistId: string, isAFavorite: boolean): SavableArtist => ({
    artistId,
    songs: [],
    name: artistId,
    isAFavorite
  });

  test('favorites keeps only favorite artists', () => {
    const data = [artist('ar-fav', true), artist('ar-plain', false)];
    expect(filterArtists(data, 'favorites').map(({ artistId }) => artistId)).toEqual(['ar-fav']);
  });

  test('notSelected returns the data untouched', () => {
    const data = [artist('ar-1', false)];
    expect(filterArtists(data, 'notSelected')).toBe(data);
  });
});

describe('filterUniqueObjects', () => {
  test('keeps the first occurrence of each unique field value', () => {
    const data = [
      { id: 'a', value: 1 },
      { id: 'b', value: 2 },
      { id: 'a', value: 3 }
    ];
    expect(filterUniqueObjects(data, 'id')).toEqual([
      { id: 'a', value: 1 },
      { id: 'b', value: 2 }
    ]);
  });

  test('drops entries that lack the unique field', () => {
    const data = [{ other: 1 }, { id: 'a' }, { other: 2 }];
    expect(filterUniqueObjects(data, 'id')).toEqual([{ id: 'a' }]);
  });
});

describe('paginateData', () => {
  const data = [{ v: 1 }, { v: 2 }, { v: 3 }, { v: 4 }, { v: 5 }];

  test('returns the full slice when no pagination is given', () => {
    const result = paginateData(data, 'aToZ');
    expect(result.data).toEqual([{ v: 1 }, { v: 2 }, { v: 3 }, { v: 4 }, { v: 5 }]);
    expect(result.total).toBe(5);
    expect(result.start).toBe(0);
    expect(result.end).toBe(5);
    expect(result.sortType).toBe('aToZ');
  });

  test('slices the data when pagination is given', () => {
    const result = paginateData(data, 'zToA', { start: 1, end: 3 });
    expect(result.data).toEqual([{ v: 2 }, { v: 3 }]);
    expect(result.total).toBe(5);
    expect(result.start).toBe(1);
    expect(result.end).toBe(3);
    expect(result.sortType).toBe('zToA');
  });
});

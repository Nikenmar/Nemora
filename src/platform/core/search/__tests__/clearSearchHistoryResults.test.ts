import { describe, expect, jest, test } from '@jest/globals';

// clearSearchHistoryResults imports the SearchRepository type only, but the
// suite guards against the ESM-only any-ascii package being pulled in through
// a transitive chain; see search.test.ts for the same stub.
jest.mock('any-ascii', () => ({ __esModule: true, default: (value: string) => value }));

import clearSearchHistoryResults from '../clearSearchHistoryResults';
import type { SearchRepository } from '../repository';

interface FakeState {
  recentSearches?: string[];
  setCalls: number;
  setValues: (string[] | undefined)[];
  notifiedChannels: string[];
}

const makeRepository = (state: FakeState): SearchRepository => ({
  getSongs: () => [],
  getArtists: () => [],
  getAlbums: () => [],
  getGenres: () => [],
  getPlaylists: () => [],
  getListeningData: () => [],
  getSongBlacklist: () => [],
  getRecentSearches: () => state.recentSearches,
  setRecentSearches: (recentSearches) => {
    state.recentSearches = recentSearches;
    state.setCalls += 1;
    state.setValues.push(recentSearches);
  },
  getSongArtworkPaths: () => ({ isDefaultArtwork: true, artworkPath: '', optimizedArtworkPath: '' }),
  getArtistArtworkPaths: () => ({ isDefaultArtwork: true, artworkPath: '', optimizedArtworkPath: '' }),
  getAlbumArtworkPaths: () => ({ isDefaultArtwork: true, artworkPath: '', optimizedArtworkPath: '' }),
  getPlaylistArtworkPaths: () => ({ isDefaultArtwork: true, artworkPath: '', optimizedArtworkPath: '' }),
  notifyDataUpdated: (channel) => {
    state.notifiedChannels.push(channel);
  }
});

const makeState = (recentSearches?: string[]): FakeState => ({
  recentSearches,
  setCalls: 0,
  setValues: [],
  notifiedChannels: []
});

describe('clearSearchHistoryResults', () => {
  test('clears the whole history when no specific results are given', () => {
    const state = makeState(['a', 'b', 'c']);
    const repository = makeRepository(state);

    expect(clearSearchHistoryResults(repository)).toBe(true);
    expect(state.setCalls).toBe(1);
    expect(state.setValues[0]).toEqual([]);
    expect(state.notifiedChannels).toEqual(['userData/recentSearches']);
  });

  test('removes only the requested entries', () => {
    const state = makeState(['a', 'b', 'c']);
    const repository = makeRepository(state);

    expect(clearSearchHistoryResults(repository, ['a', 'c'])).toBe(true);
    expect(state.setValues[0]).toEqual(['b']);
    expect(state.notifiedChannels).toEqual(['userData/recentSearches']);
  });

  test('returns early without writing when the history is already empty', () => {
    const state = makeState([]);
    const repository = makeRepository(state);

    expect(clearSearchHistoryResults(repository, ['a'])).toBe(true);
    expect(state.setCalls).toBe(0);
    expect(state.notifiedChannels).toEqual([]);
  });

  test('still notifies when recent searches were never initialized', () => {
    const state = makeState(undefined);
    const repository = makeRepository(state);

    expect(clearSearchHistoryResults(repository)).toBe(true);
    expect(state.setCalls).toBe(0);
    expect(state.notifiedChannels).toEqual(['userData/recentSearches']);
  });
});

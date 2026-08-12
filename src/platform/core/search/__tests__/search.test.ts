import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

// search.ts pulls in romanizeForSearch, which imports the ESM-only package
// any-ascii; jest's CJS runtime cannot load it, so it is stubbed here. The
// transliteration tables themselves are exercised in romanizeForSearch.test.ts.
jest.mock('any-ascii', () => ({ __esModule: true, default: (value: string) => value }));

import search from '../search';
import type { SearchRepository } from '../repository';

const makeArtworkPaths = (): ArtworkPaths => ({
  isDefaultArtwork: true,
  artworkPath: 'nemora://artwork/default.webp',
  optimizedArtworkPath: 'nemora://artwork/default-optimized.webp'
});

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

const listening = (
  songId: string,
  days: [number, number][],
  fullListens = 0
): SongListeningData => ({
  songId,
  listens: [{ year: new Date().getFullYear(), listens: days }],
  fullListens
});

interface FakeRepositoryState {
  songs: SavableSongData[];
  artists: SavableArtist[];
  albums: SavableAlbum[];
  genres: SavableGenre[];
  playlists: SavablePlaylist[];
  listeningData: SongListeningData[];
  songBlacklist: string[];
  recentSearches?: string[];
  setRecentSearchesCalls: number;
}

const makeRepository = (state: FakeRepositoryState): SearchRepository => ({
  getSongs: () => state.songs,
  getArtists: () => state.artists,
  getAlbums: () => state.albums,
  getGenres: () => state.genres,
  getPlaylists: () => state.playlists,
  getListeningData: () => state.listeningData,
  getSongBlacklist: () => state.songBlacklist,
  getRecentSearches: () => state.recentSearches,
  setRecentSearches: (recentSearches) => {
    state.recentSearches = recentSearches;
    state.setRecentSearchesCalls += 1;
  },
  getSongArtworkPaths: () => makeArtworkPaths(),
  getArtistArtworkPaths: () => makeArtworkPaths(),
  getAlbumArtworkPaths: () => makeArtworkPaths(),
  getPlaylistArtworkPaths: () => makeArtworkPaths(),
  notifyDataUpdated: () => undefined
});

const makeState = (overrides: Partial<FakeRepositoryState> = {}): FakeRepositoryState => ({
  songs: [],
  artists: [],
  albums: [],
  genres: [],
  playlists: [],
  listeningData: [],
  songBlacklist: [],
  recentSearches: [],
  setRecentSearchesCalls: 0,
  ...overrides
});

const titlesOf = (songs: SongData[]) => songs.map(({ title }) => title);

describe('search ranking', () => {
  test('orders the kinds of match, best kind first: exact > prefix > word-prefix > substring', () => {
    const repository = makeRepository(
      makeState({
        songs: [
          song({ songId: 's-typo', title: 'halp' }),
          song({ songId: 's-exact', title: 'halo' }),
          song({ songId: 's-prefix', title: 'halo effect' }),
          song({ songId: 's-word', title: 'the halo effect' }),
          song({ songId: 's-substring', title: 'shalom' })
        ]
      })
    );

    expect(titlesOf(search(repository, 'All', 'halo', false).songs)).toEqual([
      'halo',
      'halo effect',
      'the halo effect',
      'shalom'
    ]);
  });

  test('drops typo matches entirely when a clean match exists', () => {
    const repository = makeRepository(
      makeState({
        songs: [
          song({ songId: 's-typo', title: 'halp' }),
          song({ songId: 's-clean', title: 'halo effect' })
        ]
      })
    );

    expect(titlesOf(search(repository, 'All', 'halo', false).songs)).toEqual(['halo effect']);
  });

  test('lets typo matches through only when nothing matched cleanly', () => {
    const repository = makeRepository(
      makeState({
        songs: [
          song({ songId: 's-typo-1', title: 'hale' }),
          song({ songId: 's-typo-2', title: 'halp' })
        ]
      })
    );

    const results = search(repository, 'All', 'halo', false).songs;
    expect(results.map(({ songId }) => songId).sort()).toEqual(['s-typo-1', 's-typo-2']);
  });

  test('ranks a title match above an artist match above an album match', () => {
    const repository = makeRepository(
      makeState({
        songs: [
          song({ songId: 's-album', title: 'something else', album: { albumId: 'al1', name: 'halo' } }),
          song({ songId: 's-title', title: 'halo' }),
          song({
            songId: 's-artist',
            title: 'something else',
            artists: [{ artistId: 'ar1', name: 'Halo' }]
          })
        ]
      })
    );

    expect(titlesOf(search(repository, 'All', 'halo', false).songs)).toEqual([
      'halo',
      'something else',
      'something else'
    ]);
  });

  test('matches a phrase that spans title and artists (combined field)', () => {
    const repository = makeRepository(
      makeState({
        songs: [
          song({ songId: 's-combined', title: 'freddie', artists: [{ artistId: 'ar1', name: 'Mercury' }] }),
          song({ songId: 's-title', title: 'freddie mercury' }),
          // A title that covers only half the phrase is no match at all.
          song({ songId: 's-half', title: 'freddie' })
        ]
      })
    );

    expect(titlesOf(search(repository, 'All', 'freddie mercury', false).songs)).toEqual([
      'freddie mercury',
      'freddie'
    ]);
  });

  test('breaks equal matches by listens: the played track comes first', () => {
    const repository = makeRepository(
      makeState({
        songs: [
          song({ songId: 's-silent', title: 'halo' }),
          song({ songId: 's-played', title: 'halo' })
        ],
        listeningData: [listening('s-played', [[Date.now(), 1], [Date.now() - 86_400_000, 2]], 3)]
      })
    );

    expect(titlesOf(search(repository, 'All', 'halo', false).songs)).toEqual(['halo', 'halo']);
    expect(search(repository, 'All', 'halo', false).songs[0].songId).toBe('s-played');
  });

  test('caps the popularity bonus so a hit cannot cross a scoring band', () => {
    const repository = makeRepository(
      makeState({
        songs: [
          song({ songId: 's-barely-played', title: 'halo' }),
          song({ songId: 's-obsessively-played', title: 'halo' }),
          song({ songId: 's-prefix', title: 'halo effect' })
        ],
        listeningData: [
          listening('s-obsessively-played', [], 1_000_000),
          listening('s-barely-played', [[Date.now(), 1]], 1)
        ]
      })
    );

    const results = search(repository, 'All', 'halo', false).songs;
    expect(results.map(({ songId }) => songId)).toEqual(['s-obsessively-played', 's-barely-played', 's-prefix']);
  });

  test('searches each semicolon-separated keyword and deduplicates', () => {
    const repository = makeRepository(
      makeState({
        songs: [
          song({ songId: 's-halo', title: 'halo' }),
          song({ songId: 's-nirvana', title: 'nirvana' })
        ]
      })
    );

    const results = search(repository, 'All', 'halo;nirvana', false);
    expect(results.songs.map(({ songId }) => songId).sort()).toEqual(['s-halo', 's-nirvana']);
    expect(results.songs).toHaveLength(2);
  });

  test('filters by kind: Songs returns only songs, All returns every kind', () => {
    const artist: SavableArtist = {
      artistId: 'ar1',
      songs: [],
      name: 'halo',
      isAFavorite: false
    };
    const album: SavableAlbum = { albumId: 'al1', title: 'halo', songs: [] };
    const genre: SavableGenre = { genreId: 'g1', name: 'halo', songs: [] };
    const playlist: SavablePlaylist = {
      playlistId: 'pl1',
      name: 'halo',
      songs: [],
      createdDate: new Date(),
      isArtworkAvailable: false
    };
    const repository = makeRepository(
      makeState({
        songs: [song({ songId: 's1', title: 'halo' })],
        artists: [artist],
        albums: [album],
        genres: [genre],
        playlists: [playlist]
      })
    );

    const songsOnly = search(repository, 'Songs', 'halo', false);
    expect(songsOnly.songs).toHaveLength(1);
    expect(songsOnly.artists).toHaveLength(0);
    expect(songsOnly.albums).toHaveLength(0);
    expect(songsOnly.playlists).toHaveLength(0);
    expect(songsOnly.genres).toHaveLength(0);

    const everything = search(repository, 'All', 'halo', false);
    expect(everything.songs).toHaveLength(1);
    expect(everything.artists).toHaveLength(1);
    expect(everything.albums).toHaveLength(1);
    expect(everything.playlists).toHaveLength(1);
    expect(everything.genres).toHaveLength(1);
  });

  test('flags blacklisted songs on the results', () => {
    const repository = makeRepository(
      makeState({
        songs: [song({ songId: 's1', title: 'halo' }), song({ songId: 's2', title: 'nirvana' })],
        songBlacklist: ['s2']
      })
    );

    const results = search(repository, 'All', 'a', false);
    expect(results.songs.map(({ songId }) => songId).sort()).toEqual(['s1', 's2']);
    expect(results.songs.find(({ songId }) => songId === 's2')?.isBlacklisted).toBe(true);
    expect(results.songs.find(({ songId }) => songId === 's1')?.isBlacklisted).toBe(false);
  });

  test('suggests partial titles via availableResults when nothing matched', () => {
    const repository = makeRepository(
      makeState({
        songs: [song({ songId: 's1', title: 'halo beware the shadow' })]
      })
    );

    // 'halozzz' is beyond the typo budget, so nothing matches; the fallback
    // trims down to 'haloz', which typo-matches, and suggests the title.
    const result = search(repository, 'All', 'halozzz', false);
    expect(result.songs).toHaveLength(0);
    expect(result.availableResults).toEqual(['halo beware the']);
  });

  test('returns empty results for an empty query', () => {
    const repository = makeRepository(
      makeState({
        songs: [song({ songId: 's1', title: 'halo' })]
      })
    );

    const result = search(repository, 'All', '', false);
    expect(result.songs).toHaveLength(0);
    expect(result.artists).toHaveLength(0);
    expect(result.availableResults).toEqual([]);
  });
});

describe('search history', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('appends the query to recent searches after the debounce', () => {
    const state = makeState();
    const repository = makeRepository(state);

    search(repository, 'All', 'queen');
    expect(state.setRecentSearchesCalls).toBe(0);

    jest.advanceTimersByTime(2000);
    expect(state.recentSearches).toEqual(['queen']);
    expect(state.setRecentSearchesCalls).toBe(1);
  });

  test('caps recent searches: ten existing entries grow to eleven, repeats move to the front', () => {
    const state = makeState({
      recentSearches: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']
    });
    const repository = makeRepository(state);

    // The pop only fires when the list is already LONGER than ten, so adding
    // the eleventh entry grows the list — a quirk of the original, preserved.
    search(repository, 'All', 'k');
    jest.advanceTimersByTime(2000);
    expect(state.recentSearches).toEqual(['k', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']);

    // Now at eleven: the repeat trims once (popping 'j'), deduplicates and reorders.
    search(repository, 'All', 'b');
    jest.advanceTimersByTime(2000);
    expect(state.recentSearches).toEqual(['b', 'k', 'a', 'c', 'd', 'e', 'f', 'g', 'h', 'i']);
  });

  test('trims once when the history was already over ten', () => {
    const state = makeState({
      recentSearches: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l']
    });
    const repository = makeRepository(state);

    search(repository, 'All', 'm');
    jest.advanceTimersByTime(2000);
    expect(state.recentSearches).toEqual(['m', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k']);
  });

  test('debounces rapid searches so only the last query is recorded', () => {
    const state = makeState();
    const repository = makeRepository(state);

    search(repository, 'All', 'first');
    search(repository, 'All', 'second');
    jest.advanceTimersByTime(2000);
    expect(state.recentSearches).toEqual(['second']);
  });

  test('skips history entirely when updateSearchHistory is false', () => {
    const state = makeState();
    const repository = makeRepository(state);

    search(repository, 'All', 'queen', false);
    expect(jest.getTimerCount()).toBe(0);
    expect(state.setRecentSearchesCalls).toBe(0);
  });

  test('does not write when recent searches were never initialized', () => {
    const state = makeState({ recentSearches: undefined });
    const repository = makeRepository(state);

    search(repository, 'All', 'queen');
    jest.advanceTimersByTime(2000);
    expect(state.setRecentSearchesCalls).toBe(0);
  });
});

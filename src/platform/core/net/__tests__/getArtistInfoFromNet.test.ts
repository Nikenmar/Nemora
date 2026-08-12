import { beforeEach, describe, expect, jest, test } from '@jest/globals';

jest.mock('../buildEnv', () => ({
  getBuildEnvVariable: (name: string) => (name === 'MAIN_VITE_LAST_FM_API_KEY' ? 'testApiKey' : undefined)
}));
// jest's node environment stubs navigator.onLine to undefined; assume online
// and let the mocked fetch decide the request outcomes.
jest.mock('../isOnline', () => ({ isConnectedToInternet: () => true }));

import getArtistInfoFromNet from '../getArtistInfoFromNet';
import type { NetworkRepository } from '../repository';

const mockFetch = jest.fn<typeof fetch>();

const artist = (artistId: string, name: string, extras: Partial<SavableArtist> = {}): SavableArtist => ({
  artistId,
  songs: [],
  name,
  isAFavorite: false,
  ...extras
});

interface FakeState {
  artists: SavableArtist[];
  setArtistsCalls: number;
  emittedDataUpdates: string[];
  generatedPalettes: string[];
}

const makeState = (overrides: Partial<FakeState> = {}): FakeState => ({
  artists: [],
  setArtistsCalls: 0,
  emittedDataUpdates: [],
  generatedPalettes: [],
  ...overrides
});

const makeRepository = (state: FakeState): NetworkRepository => ({
  getSongs: () => [],
  getAlbums: () => [],
  getArtists: () => state.artists,
  setArtists: (artists) => {
    state.artists = artists;
    state.setArtistsCalls += 1;
  },
  getUserData: () => ({
    language: 'en',
    theme: { isDarkMode: true, useSystemTheme: false },
    musicFolders: [],
    preferences: {
      autoLaunchApp: false,
      openWindowMaximizedOnStart: false,
      openWindowAsHiddenOnSystemStart: false,
      isMiniPlayerAlwaysOnTop: false,
      isMusixmatchLyricsEnabled: false,
      hideWindowOnClose: false,
      sendSongScrobblingDataToLastFM: false,
      sendSongFavoritesDataToLastFM: false,
      sendNowPlayingSongDataToLastFM: false,
      saveLyricsInLrcFilesForSupportedSongs: false,
      enableDiscordRPC: false,
      saveVerboseLogs: false
    },
    windowPositions: {},
    windowDiamensions: {},
    windowState: 'normal',
    recentSearches: []
  }),
  getSongsOutsideLibrary: () => [],
  getBlacklist: () => ({ songBlacklist: [], folderBlacklist: [] }),
  getSongArtworkPath: () => ({ isDefaultArtwork: true, artworkPath: '', optimizedArtworkPath: '' }),
  getArtistArtworkPath: () => ({ isDefaultArtwork: true, artworkPath: '', optimizedArtworkPath: '' }),
  getAlbumArtworkPath: () => ({ isDefaultArtwork: true, artworkPath: '', optimizedArtworkPath: '' }),
  getSelectedPaletteData: () => undefined,
  generatePalette: (imageUrl) => {
    state.generatedPalettes.push(imageUrl);
    return Promise.resolve({ paletteId: 'pal-1' } as PaletteData);
  },
  decrypt: (encrypted) => Promise.resolve(encrypted),
  emitDataUpdate: (dataType) => {
    state.emittedDataUpdates.push(dataType);
  }
});

const DEEZER_HIT = {
  id: 123,
  name: 'Halo Band',
  picture_xl: 'https://e-cdns-images.dzcdn.net/images/artist/7bb8b74c/500x500-000000-80-0-0.jpg',
  picture_medium: 'https://e-cdns-images.dzcdn.net/images/artist/7bb8b74c/250x250-000000-80-0-0.jpg',
  picture_small: 'https://e-cdns-images.dzcdn.net/images/artist/7bb8b74c/50x50-000000-80-0-0.jpg'
};

const LAST_FM_RESPONSE = {
  artist: {
    name: 'Halo Band',
    bio: { summary: 'A band from nowhere.' },
    tags: { tag: [{ name: 'electronic', url: 'https://last.fm/tag/electronic' }] },
    similar: {
      artist: [
        { name: 'Local Twin', url: 'https://last.fm/music/Local+Twin' },
        { name: 'No One You Know', url: 'https://last.fm/music/No+One+You+Know' }
      ]
    }
  }
};

const mockJsonResponse = (body: unknown): Response =>
  ({ ok: true, status: 200, json: () => Promise.resolve(body) }) as Response;

describe('getArtistInfoFromNet', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockImplementation((input) => {
      const url = String(input);
      if (url.startsWith('https://api.deezer.com/search/artist'))
        return Promise.resolve(mockJsonResponse({ total: 1, data: [DEEZER_HIT] }));
      if (url.startsWith('http://ws.audioscrobbler.com/2.0/'))
        return Promise.resolve(mockJsonResponse(LAST_FM_RESPONSE));
      return Promise.reject(new Error(`unexpected url ${url}`));
    });
    globalThis.fetch = mockFetch as unknown as typeof fetch;
  });

  test('assembles artwork, bio, palette, similar artists and tags', async () => {
    const state = makeState({
      artists: [
        artist('ar-1', 'Halo Band'),
        artist('ar-2', 'Local Twin')
      ]
    });
    const repository = makeRepository(state);

    const result = await getArtistInfoFromNet(repository, 'ar-1');

    expect(result.artistArtworks).toEqual({
      picture_small: DEEZER_HIT.picture_small,
      picture_medium: DEEZER_HIT.picture_medium,
      picture_xl: DEEZER_HIT.picture_xl
    });
    expect(result.artistBio).toBe('A band from nowhere.');
    expect(result.artistPalette).toEqual({ paletteId: 'pal-1' });
    expect(result.tags).toEqual([{ name: 'electronic', url: 'https://last.fm/tag/electronic' }]);

    // 'Local Twin' exists in the library, so it is linked; the other is not.
    expect(result.similarArtists.availableArtists.map(({ name }) => name)).toEqual(['Local Twin']);
    expect(result.similarArtists.availableArtists[0]?.artistData?.artistId).toBe('ar-2');
    expect(result.similarArtists.unAvailableArtists.map(({ name }) => name)).toEqual([
      'No One You Know'
    ]);
  });

  test('persists the fetched artworks on the artist and emits the update', async () => {
    const state = makeState({ artists: [artist('ar-1', 'Halo Band')] });
    const repository = makeRepository(state);

    await getArtistInfoFromNet(repository, 'ar-1');

    expect(state.artists[0].onlineArtworkPaths?.picture_medium).toBe(DEEZER_HIT.picture_medium);
    expect(state.setArtistsCalls).toBe(1);
    expect(state.emittedDataUpdates).toEqual(['artists/artworks']);
    expect(state.generatedPalettes).toEqual([DEEZER_HIT.picture_medium]);
  });

  test('does not refetch or persist when artworks already exist', async () => {
    const state = makeState({
      artists: [
        artist('ar-1', 'Halo Band', {
          onlineArtworkPaths: {
            picture_small: DEEZER_HIT.picture_small,
            picture_medium: DEEZER_HIT.picture_medium
          }
        })
      ]
    });
    const repository = makeRepository(state);

    const result = await getArtistInfoFromNet(repository, 'ar-1');

    expect(result.artistArtworks?.picture_medium).toBe(DEEZER_HIT.picture_medium);
    expect(state.setArtistsCalls).toBe(0);
    expect(state.emittedDataUpdates).toEqual([]);
  });

  test('throws when the artist is not in the library', async () => {
    const state = makeState({ artists: [artist('ar-1', 'Halo Band')] });
    const repository = makeRepository(state);

    await expect(getArtistInfoFromNet(repository, 'ar-99')).rejects.toThrow(
      'no artists found with the given name ar-99'
    );
  });

  test('throws NO_ARTISTS_FOUND for an empty library', async () => {
    const state = makeState({ artists: [] });
    const repository = makeRepository(state);

    await expect(getArtistInfoFromNet(repository, 'ar-1')).rejects.toThrow('NO_ARTISTS_FOUND');
  });

  test('fails loudly when artwork or info could not be fetched', async () => {
    mockFetch.mockImplementation((input) => {
      const url = String(input);
      if (url.startsWith('https://api.deezer.com/search/artist'))
        return Promise.resolve(mockJsonResponse({ total: 0, data: [] }));
      return Promise.resolve(mockJsonResponse(LAST_FM_RESPONSE));
    });

    const state = makeState({ artists: [artist('ar-1', 'Halo Band')] });
    const repository = makeRepository(state);

    await expect(getArtistInfoFromNet(repository, 'ar-1')).rejects.toThrow(
      'Failed to fetch artist info or artworks'
    );
  });
});

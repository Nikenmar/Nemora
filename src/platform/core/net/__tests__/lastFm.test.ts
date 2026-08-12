import { createHash } from 'node:crypto';
import { describe, expect, jest, test } from '@jest/globals';

// getLastFMAuthData reads build-time env through import.meta.env, which the
// jest CJS transform cannot load; the mocked module feeds the tests instead.
jest.mock('../buildEnv', () => ({
  getBuildEnvVariable: (name: string) => {
    if (name === 'MAIN_VITE_LAST_FM_API_KEY') return 'testApiKey';
    if (name === 'MAIN_VITE_LAST_FM_SHARED_SECRET') return 'testSharedSecret';
    return undefined;
  }
}));

import generateApiRequestBodyForLastFMPostRequests from '../lastFm/generateApiRequestBodyForLastFMPostRequests';
import getLastFmAuthData from '../lastFm/getLastFMAuthData';
import type { NetworkRepository } from '../repository';

const authData = {
  LAST_FM_API_KEY: 'testApiKey',
  LAST_FM_SHARED_SECRET: 'testSharedSecret',
  SESSION_KEY: 'session123'
};

const nodeHash = (content: string) => createHash('md5').update(content).digest('hex');

const extractSigFromBody = (body: string) => {
  const match = body.match(/(?:^|&)api_sig=([a-f0-9]{32})(?:&|$)/);
  if (!match) throw new Error(`api_sig missing in body: ${body}`);
  return match[1];
};

const makeUserData = (): UserData => ({
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
    sendSongScrobblingDataToLastFM: true,
    sendSongFavoritesDataToLastFM: true,
    sendNowPlayingSongDataToLastFM: true,
    saveLyricsInLrcFilesForSupportedSongs: false,
    enableDiscordRPC: false,
    saveVerboseLogs: false
  },
  windowPositions: {},
  windowDiamensions: {},
  windowState: 'normal',
  recentSearches: [],
  lastFmSessionData: { name: 'testUser', key: 'encryptedKey' }
});

const makeRepository = (): NetworkRepository => ({
  getSongs: () => [],
  getAlbums: () => [],
  getArtists: () => [],
  setArtists: () => undefined,
  getUserData: () => makeUserData(),
  getSongsOutsideLibrary: () => [],
  getBlacklist: () => ({ songBlacklist: [], folderBlacklist: [] }),
  getSongArtworkPath: () => ({ isDefaultArtwork: true, artworkPath: '', optimizedArtworkPath: '' }),
  getArtistArtworkPath: () => ({ isDefaultArtwork: true, artworkPath: '', optimizedArtworkPath: '' }),
  getAlbumArtworkPath: () => ({ isDefaultArtwork: true, artworkPath: '', optimizedArtworkPath: '' }),
  getSelectedPaletteData: () => undefined,
  generatePalette: () => Promise.resolve({ paletteId: '' }),
  decrypt: (encrypted) => Promise.resolve(`decrypted:${encrypted}`),
  emitDataUpdate: () => undefined
});

describe('Last.fm request signing', () => {
  test('api_sig equals the MD5 of the sorted, secret-suffixed signature string', () => {
    const body = generateApiRequestBodyForLastFMPostRequests({
      method: 'track.scrobble',
      authData,
      params: {
        track: 'Halo',
        artist: 'Beyoncé',
        timestamp: 1700000000,
        album: 'I Am... Sasha Fierce',
        albumArtist: 'Beyoncé',
        trackNumber: 3,
        duration: 273
      }
    });

    // Signature string: params sorted alphabetically, joined name+value, then
    // the shared secret appended, exactly like the Electron build.
    const signatureString =
      'albumI Am... Sasha Fierce' +
      'albumArtistBeyoncé' +
      'api_keytestApiKey' +
      'artistBeyoncé' +
      'duration273' +
      'methodtrack.scrobble' +
      'sksession123' +
      'timestamp1700000000' +
      'trackHalo' +
      'trackNumber3' +
      'testSharedSecret';

    expect(extractSigFromBody(body)).toBe(nodeHash(signatureString));
  });

  test('love/unlove signing matches the Electron build exactly', () => {
    // The love path builds its signature string by hand (api_key, artist,
    // method, sk, track) — pin that order, then the MD5 of the string.
    const signatureString =
      'api_keytestApiKeyartistAdelemethodtrack.lovesksession123trackHello' + 'testSharedSecret';

    const body = generateApiRequestBodyForLastFMPostRequests({
      method: 'track.love',
      authData,
      params: { artist: 'Adele', track: 'Hello' }
    });

    expect(extractSigFromBody(body)).toBe(nodeHash(signatureString));
    expect(body).toBe(
      `method=track.love&api_key=testApiKey&sk=session123&api_sig=${nodeHash(signatureString)}&artist=Adele&track=Hello`
    );
  });

  test('encodes parameter values with encodeURIComponent in the body', () => {
    const body = generateApiRequestBodyForLastFMPostRequests({
      method: 'track.scrobble',
      authData,
      params: { track: 'Café & Øneheart', artist: 'A', timestamp: 1 }
    });

    expect(body).toContain('track=Caf%C3%A9%20%26%20%C3%98neheart');
  });

  test('getLastFmAuthData reads the env keys and decrypts the session key', async () => {
    const auth = await getLastFmAuthData(makeRepository());
    expect(auth).toEqual({
      LAST_FM_API_KEY: 'testApiKey',
      LAST_FM_SHARED_SECRET: 'testSharedSecret',
      SESSION_KEY: 'decrypted:encryptedKey'
    });
  });

  test('getLastFmAuthData throws when the session key is missing', async () => {
    const repository = makeRepository();
    repository.getUserData = () => ({ ...makeUserData(), lastFmSessionData: undefined });
    await expect(getLastFmAuthData(repository)).rejects.toThrow('Encrypted LastFM Session Key not found');
  });
});

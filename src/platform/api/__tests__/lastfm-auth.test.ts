import { beforeEach, describe, expect, jest, test } from '@jest/globals';

const saveUserDataMock = jest.fn<(...args: unknown[]) => void>();
const encryptMock = jest.fn<(...args: unknown[]) => Promise<string>>();
const hashTextMock = jest.fn<(...args: unknown[]) => string>();

jest.mock('../../runtime', () => ({
  getRuntime: () => ({ saveUserData: saveUserDataMock })
}));
jest.mock('../../core/secrets/safeStorage', () => ({
  encrypt: encryptMock
}));
jest.mock('../../core/net/hashText', () => ({ __esModule: true, default: hashTextMock }));
jest.mock('../../core/net/buildEnv', () => ({
  getBuildEnvVariable: jest.fn((name: string) => {
    if (name === 'MAIN_VITE_LAST_FM_API_KEY') return 'testApiKey';
    if (name === 'MAIN_VITE_LAST_FM_SHARED_SECRET') return 'testSharedSecret';
    return undefined;
  })
}));
jest.mock('@tauri-apps/api/core', () => ({
  invoke: jest.fn(() => Promise.resolve([]))
}));
const shellOpenMock = jest.fn<(...args: unknown[]) => Promise<unknown>>();
jest.mock('@tauri-apps/plugin-shell', () => ({ open: shellOpenMock }));
jest.mock('@tauri-apps/plugin-dialog', () => ({ open: jest.fn() }));

import {
  handleLastFmAuthUri,
  ensureLastFmAuthCallbackInstalled,
  resetLastFmAuthCallbackInstallationForTests
} from '../lastfm-auth';
import { settingsHelpers } from '../settings-helpers';
import { userData } from '../user-data';

const mockFetch = jest.fn<typeof fetch>();

const sessionResponse = {
  session: { name: 'testUser', key: 'plain-session-key' }
};

beforeEach(() => {
  jest.clearAllMocks();
  mockFetch.mockReset();
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(sessionResponse)
  } as Response);
  globalThis.fetch = mockFetch as unknown as typeof fetch;
  encryptMock.mockImplementation(async (data) => `encrypted:${String(data)}`);
  hashTextMock.mockReturnValue('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5');
});

describe('handleLastFmAuthUri', () => {
  test('redeems the token, encrypts the session key and persists it', async () => {
    await handleLastFmAuthUri('nemora://auth?service=lastfm&token=TOKEN123');

    // The signature input matches the Electron build:
    //   api_key<key>methodauth.getSessiontoken<token><sharedSecret>, URI-encoded
    expect(hashTextMock).toHaveBeenCalledWith(
      encodeURIComponent('api_keytestApiKeymethodauth.getSessiontokenTOKEN123testSharedSecret')
    );

    const url = new URL(mockFetch.mock.calls[0]?.[0] as string);
    expect(url.searchParams.get('method')).toBe('auth.getSession');
    expect(url.searchParams.get('token')).toBe('TOKEN123');
    expect(url.searchParams.get('api_sig')).toBe('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5');

    expect(encryptMock).toHaveBeenCalledWith('plain-session-key');
    expect(saveUserDataMock).toHaveBeenCalledWith('lastFmSessionData', {
      name: 'testUser',
      key: 'encrypted:plain-session-key'
    });
  });

  test('ignores URIs that are not auth callbacks', async () => {
    await handleLastFmAuthUri('C:/music/song.mp3');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('ignores auth callbacks for other services', async () => {
    await handleLastFmAuthUri('nemora://auth?service=spotify&token=X');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('never processes the same URI twice (single-use token)', async () => {
    const uri = 'nemora://auth?service=lastfm&token=DEDUPE-TOKEN';
    await handleLastFmAuthUri(uri);
    await handleLastFmAuthUri(uri);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test('does not persist anything when the session fetch fails', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ error: 4, message: 'invalid token' })
    } as Response);

    await handleLastFmAuthUri('nemora://auth?service=lastfm&token=BAD');
    expect(saveUserDataMock).not.toHaveBeenCalled();
    expect(encryptMock).not.toHaveBeenCalled();
  });

  test('does not persist anything when encryption fails', async () => {
    encryptMock.mockRejectedValue(new Error('no secret'));
    await handleLastFmAuthUri('nemora://auth?service=lastfm&token=TOKEN123');
    expect(saveUserDataMock).not.toHaveBeenCalled();
  });

  test('logs instead of throwing when the callback has no token', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await handleLastFmAuthUri('nemora://auth?service=lastfm');
    expect(mockFetch).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  test('decodes a URI-encoded token', async () => {
    await handleLastFmAuthUri('nemora://auth?service=lastfm&token=TOKEN%20WITH%20SPACES');
    const url = new URL(mockFetch.mock.calls[0]?.[0] as string);
    expect(url.searchParams.get('token')).toBe('TOKEN WITH SPACES');
  });
});

describe('ensureLastFmAuthCallbackInstalled', () => {
  test('is idempotent', () => {
    resetLastFmAuthCallbackInstallationForTests();
    ensureLastFmAuthCallbackInstalled();
    ensureLastFmAuthCallbackInstalled();
    // Installs one event subscription; the drain invoke is fired once.
    const { invoke } = jest.requireMock('@tauri-apps/api/core') as {
      invoke: jest.Mock;
    };
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('drain_pending_second_instance_args');
  });
});

describe('settingsHelpers channels', () => {
  test('compareEncryptedData keeps the preload zero-argument shape and returns false', async () => {
    // The preload declares compareEncryptedData() with no arguments while the
    // legacy handler wanted (data, encryptedData); with no inputs there is
    // nothing to compare, so the result is false — as in the Electron build.
    expect(await settingsHelpers.compareEncryptedData()).toBe(false);
  });

  test('loginToLastFmInBrowser opens the auth page and installs the callback', () => {
    resetLastFmAuthCallbackInstallationForTests();
    shellOpenMock.mockResolvedValue(undefined);
    const { invoke } = jest.requireMock('@tauri-apps/api/core') as {
      invoke: jest.Mock;
    };
    invoke.mockClear();

    settingsHelpers.loginToLastFmInBrowser();

    expect(shellOpenMock).toHaveBeenCalledWith(
      'http://www.last.fm/api/auth/?api_key=testApiKey&cb=nemora://auth?service=lastfm'
    );
    expect(invoke).toHaveBeenCalledWith('drain_pending_second_instance_args');
  });

  test('loginToLastFmInBrowser refuses to open without an API key', () => {
    const { getBuildEnvVariable } = jest.requireMock('../../core/net/buildEnv') as {
      getBuildEnvVariable: jest.Mock;
    };
    getBuildEnvVariable.mockReturnValue(undefined);

    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    settingsHelpers.loginToLastFmInBrowser();
    expect(shellOpenMock).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
    getBuildEnvVariable.mockReturnValue('testApiKey');
  });

  test('saveUserData encrypts the plaintext Musixmatch token before storing', async () => {
    encryptMock.mockImplementation(async (data) => `encrypted:${String(data)}`);

    await userData.saveUserData('customMusixmatchUserToken', 'plain-token');

    expect(encryptMock).toHaveBeenCalledWith('plain-token');
    expect(saveUserDataMock).toHaveBeenCalledWith('customMusixmatchUserToken', 'encrypted:plain-token');
  });

  test('saveUserData passes non-token values through unchanged', async () => {
    await userData.saveUserData('language', 'en');
    expect(encryptMock).not.toHaveBeenCalled();
    expect(saveUserDataMock).toHaveBeenCalledWith('language', 'en');
  });
});

import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

import {
  MetadataProvidersUnavailableError,
  searchSongMetadataResultsInInternet
} from '../fetchSongMetadataFromInternet';

const originalFetch = globalThis.fetch;
const envKeys = [
  'MAIN_VITE_MUSIXMATCH_DEFAULT_USER_TOKEN',
  'MAIN_VITE_LAST_FM_API_KEY',
  'MAIN_VITE_GENIUS_API_KEY'
] as const;

describe('searchSongMetadataResultsInInternet', () => {
  beforeEach(() => {
    envKeys.forEach((key) => {
      process.env[key] = 'test-key';
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    envKeys.forEach((key) => {
      delete process.env[key];
    });
  });

  test('rejects when every metadata provider is unavailable', async () => {
    const fetchMock = jest.fn<() => Promise<Response>>().mockRejectedValue(new Error('offline'));
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(searchSongMetadataResultsInInternet('Halo', ['Beyonce'])).rejects.toBeInstanceOf(
      MetadataProvidersUnavailableError
    );
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  test('returns an empty result when one provider responds with no matches', async () => {
    const fetchMock = jest.fn<(input: RequestInfo | URL) => Promise<Response>>((input) => {
      if (new URL(input.toString()).hostname === 'itunes.apple.com') {
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: () => Promise.resolve({ resultCount: 0, results: [] })
        } as Response);
      }
      return Promise.reject(new Error('provider unavailable'));
    });
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(searchSongMetadataResultsInInternet('Missing song')).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
});

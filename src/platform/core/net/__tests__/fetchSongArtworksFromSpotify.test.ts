import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import fetchSongArtworksFromSpotify from '../fetchSongArtworksFromSpotify';

const mockFetch = jest.fn<typeof fetch>();
global.fetch = mockFetch as unknown as typeof fetch;

const respondWith = (body: unknown, ok = true, status = 200) =>
  mockFetch.mockResolvedValueOnce({
    ok,
    status,
    json: async () => body
  } as unknown as Response);

/** The shape the art-getter proxy passes through from Spotify, trimmed. */
const trackWithImages = {
  album: {
    images: [
      { url: 'https://i.scdn.co/image/big', width: 640, height: 640 },
      { url: 'https://i.scdn.co/image/mid', width: 300, height: 300 },
      { url: 'https://i.scdn.co/image/tiny', width: 64, height: 64 }
    ]
  }
};

describe('fetching cover art through the art-getter service', () => {
  beforeEach(() => mockFetch.mockReset());

  test('asks CMR’s service for the track and skips the 64px list thumbnail', async () => {
    respondWith(trackWithImages);

    const artworks = await fetchSongArtworksFromSpotify('4cOdK2wGLETKBW3PvgPWqT');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://art-getter-reborncmr.vercel.app/api/apee?inputType=tracks&id=4cOdK2wGLETKBW3PvgPWqT'
    );
    // Both of these become pickable album art in the tag editor, so the small
    // one is the smallest cover still worth embedding, not the smallest on offer.
    expect(artworks).toEqual({
      highResArtworkUrl: 'https://i.scdn.co/image/big',
      lowResArtworkUrl: 'https://i.scdn.co/image/mid'
    });
  });

  test('picks by declared width rather than trusting the order', async () => {
    respondWith({
      album: {
        images: [
          { url: 'https://i.scdn.co/image/mid', width: 300 },
          { url: 'https://i.scdn.co/image/big', width: 640 }
        ]
      }
    });

    // One bad assumption here writes a thumbnail into somebody's file tags.
    await expect(fetchSongArtworksFromSpotify('id')).resolves.toEqual({
      highResArtworkUrl: 'https://i.scdn.co/image/big',
      lowResArtworkUrl: 'https://i.scdn.co/image/mid'
    });
  });

  test('gives up quietly when the service is unavailable', async () => {
    respondWith({}, false, 502);

    // The caller treats undefined as "no Spotify covers offered" and keeps the
    // ones Musixmatch supplied, so a failure here must not surface as an error.
    await expect(fetchSongArtworksFromSpotify('id')).resolves.toBeUndefined();
  });

  test('gives up quietly when the track carries no cover art', async () => {
    respondWith({ album: { images: [] } });

    await expect(fetchSongArtworksFromSpotify('id')).resolves.toBeUndefined();
  });

  test('the service host is granted in the Tauri HTTP scope', () => {
    // The predecessor of this module failed for exactly this reason and looked
    // like an empty result: every remote request goes through tauri-plugin-http,
    // a host missing from the scope is rejected by the ACL, and the catch above
    // turns that into "no covers offered" without a word to anyone.
    const capability = readFileSync(
      join(__dirname, '..', '..', '..', '..', '..', 'src-tauri', 'capabilities', 'default.json'),
      'utf8'
    );
    const scope = (JSON.parse(capability) as { permissions: unknown[] }).permissions.find(
      (permission): permission is { identifier: string; allow: { url: string }[] } =>
        typeof permission === 'object' &&
        permission !== null &&
        (permission as { identifier?: string }).identifier === 'http:default'
    );

    expect(scope?.allow.map((entry) => entry.url)).toContain(
      'https://art-getter-reborncmr.vercel.app/*'
    );
  });
});

import { describe, expect, jest, test } from '@jest/globals';

import fetchLyricsFromLrclib from '../fetchLyricsFromLrclib';

const mockFetch = jest.fn<typeof fetch>();

const syncedResponse = {
  id: 1,
  trackName: 'Halo',
  artistName: 'Beyoncé',
  albumName: 'I Am... Sasha Fierce',
  duration: 273,
  instrumental: false,
  plainLyrics: 'plain line',
  syncedLyrics: '[00:12.34] synced line'
};

const unsyncedResponse = {
  id: 2,
  trackName: 'Halo',
  artistName: 'Beyoncé',
  albumName: 'I Am... Sasha Fierce',
  duration: 273,
  instrumental: false,
  plainLyrics: 'plain line'
};

const errorResponse = { statusCode: 404, name: 'NotFound', message: 'not found' };

describe('fetchLyricsFromLrclib', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    globalThis.fetch = mockFetch as unknown as typeof fetch;
  });

  test('returns synced lyrics wrapped in the LRC header block', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(syncedResponse)
    } as Response);

    const result = await fetchLyricsFromLrclib(
      { track_name: 'Halo', artist_name: 'Beyoncé', duration: '273' },
      'ANY'
    );

    expect(result?.lyricsType).toBe('SYNCED');
    expect(result?.lyrics).toContain('[ti:Halo]');
    expect(result?.lyrics).toContain('[ar:Beyoncé]');
    expect(result?.lyrics).toContain('[length:4:33]');
    expect(result?.lyrics).toContain('[00:12.34] synced line');
  });

  test('marks a response without synced lyrics as UN_SYNCED', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(unsyncedResponse)
    } as Response);

    const result = await fetchLyricsFromLrclib(
      { track_name: 'Halo', artist_name: 'Beyoncé', duration: '273' },
      'ANY'
    );

    expect(result?.lyricsType).toBe('UN_SYNCED');
    expect(result?.lyrics).toContain('plain line');
  });

  test('returns undefined when the API reports an error object', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(errorResponse)
    } as Response);

    const result = await fetchLyricsFromLrclib(
      { track_name: 'Halo', artist_name: 'Beyoncé', duration: '273' },
      'ANY'
    );

    expect(result).toBeUndefined();
  });

  test('forwards the abort signal to fetch', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(unsyncedResponse)
    } as Response);

    const controller = new AbortController();
    await fetchLyricsFromLrclib(
      { track_name: 'Halo', artist_name: 'Beyoncé', duration: '273' },
      'ANY',
      controller.signal
    );

    expect(mockFetch.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
  });

  test('returns undefined when the request fails', async () => {
    mockFetch.mockRejectedValue(new Error('network down'));

    const result = await fetchLyricsFromLrclib(
      { track_name: 'Halo', artist_name: 'Beyoncé', duration: '273' },
      'ANY'
    );

    expect(result).toBeUndefined();
  });

  test('returns undefined for a non-ok response', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 } as Response);

    const result = await fetchLyricsFromLrclib(
      { track_name: 'Halo', artist_name: 'Beyoncé', duration: '273' },
      'ANY'
    );

    expect(result).toBeUndefined();
  });
});

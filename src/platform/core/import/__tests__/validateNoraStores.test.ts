import { describe, expect, test } from '@jest/globals';

import type { StoreName } from '../../../contracts/store';
import { validateNoraStorePayload } from '../validateNoraStores';
import {
  FORK_ARTISTS,
  FORK_BLACKLIST,
  FORK_CMR_STATS,
  FORK_LISTENING,
  FORK_PALETTES,
  FORK_PLAYLISTS,
  FORK_SONGS,
  FORK_TIERLISTS,
  FORK_USER_DATA
} from './testUtils';

const valid = (store: StoreName, payload: unknown): void => {
  expect(validateNoraStorePayload(store, payload)).toBeUndefined();
};

const invalid = (store: StoreName, payload: unknown, reason: RegExp): void => {
  const result = validateNoraStorePayload(store, payload);
  expect(result).toBeDefined();
  expect(result).toMatch(reason);
};

describe('validateNoraStorePayload — tolerant, boot-safe shape checks', () => {
  test('accepts the fork fixture payloads', () => {
    valid('songs', FORK_SONGS);
    valid('artists', FORK_ARTISTS);
    valid('playlists', FORK_PLAYLISTS);
    valid('listeningData', FORK_LISTENING);
    valid('tierlists', FORK_TIERLISTS);
    valid('cmrStats', FORK_CMR_STATS);
    valid('palettes', FORK_PALETTES);
    valid('blacklist', FORK_BLACKLIST);
    valid('userData', FORK_USER_DATA);
  });

  test('songs: rejects missing ids, titles, durations or paths', () => {
    invalid('songs', [{ title: 'no id', duration: 10, path: 'a.mp3' }], /malformed/);
    invalid('songs', [{ songId: 's', duration: 10, path: 'a.mp3' }], /malformed/);
    invalid('songs', [{ songId: 's', title: 't', path: 'a.mp3' }], /malformed/);
    invalid('songs', [{ songId: 's', title: 't', duration: 10 }], /malformed/);
    invalid('songs', 'not-an-array', /array/);
  });

  test('listeningData: rejects malformed yearly records or counters', () => {
    invalid('listeningData', [{ songId: 's' }], /malformed/);
    invalid('listeningData', [{ songId: 's', listens: [{ year: 2025 }] }], /malformed/);
    invalid(
      'listeningData',
      [{ songId: 's', listens: [{ year: 2025, listens: [['x', 1]] }] }],
      /malformed/
    );
    invalid('listeningData', [{ songId: 's', listens: [], fullListens: -1 }], /malformed/);
  });

  test('playlists: rejects playlists without song arrays', () => {
    invalid('playlists', [{ playlistId: 'p', name: 'P' }], /malformed/);
    invalid('playlists', [{ playlistId: 'p', name: 'P', songs: [1] }], /malformed/);
  });

  test('tierlists: requires the pool sources and tier rows', () => {
    invalid('tierlists', [{ tierlistId: 't', name: 'T', tiers: [] }], /malformed/);
    invalid(
      'tierlists',
      [{ tierlistId: 't', name: 'T', sourcePlaylistIds: [], tiers: [{ items: 'x' }] }],
      /malformed/
    );
  });

  test('cmrStats: requires elo ratings/history and the import-id list', () => {
    invalid('cmrStats', { elo: { ratings: {} }, importedStatsExportIds: [] }, /malformed/);
    invalid(
      'cmrStats',
      { elo: { ratings: {}, history: [] }, importedStatsExportIds: 'x' },
      /malformed/
    );
    invalid('cmrStats', { importedStatsExportIds: [] }, /malformed/);
  });

  test('blacklist: requires both string arrays', () => {
    invalid('blacklist', { songBlacklist: [] }, /malformed/);
    invalid('blacklist', { songBlacklist: [1], folderBlacklist: [] }, /malformed/);
  });

  test('palettes: requires palette ids', () => {
    invalid('palettes', [{ Vibrant: {} }], /malformed/);
  });

  test('older upstream shapes pass (missing optional fields are tolerated)', () => {
    valid('songs', [
      {
        songId: 'u1',
        title: 'First Light',
        duration: 200,
        isAFavorite: false,
        isArtworkAvailable: true,
        path: 'D:\\Music\\first_light.mp3'
      }
    ]);
    valid('playlists', [
      {
        playlistId: 'Favorites',
        name: 'Favorites',
        songs: ['u1'],
        createdDate: '2023-01-01T00:00:00.000Z'
      }
    ]);
    valid('listeningData', [
      { songId: 'u1', fullListens: 12, listens: [{ year: 2024, listens: [[1, 2]] }] }
    ]);
    valid('userData', { language: 'en' });
  });
});

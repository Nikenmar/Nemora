/**
 * Templates and constants for Nora's three system playlists.
 *
 * These mirror the Electron definitions in `src/main/filesystem.ts`. The three
 * system playlists are managed by the app: they cannot be deleted, renamed or
 * re-covered, and Rediscover is additionally hidden from manual song adds.
 */

export const HISTORY_PLAYLIST_TEMPLATE: SavablePlaylist = {
  name: 'History',
  playlistId: 'History',
  createdDate: new Date(),
  songs: [],
  isArtworkAvailable: true
};

export const FAVORITES_PLAYLIST_TEMPLATE: SavablePlaylist = {
  name: 'Favorites',
  playlistId: 'Favorites',
  createdDate: new Date(),
  songs: [],
  isArtworkAvailable: true
};

export const REDISCOVER_PLAYLIST_TEMPLATE: SavablePlaylist = {
  name: 'Rediscover',
  playlistId: 'Rediscover',
  createdDate: new Date(),
  songs: [],
  isArtworkAvailable: true
};

export const PLAYLIST_DATA_TEMPLATE: SavablePlaylist[] = [
  HISTORY_PLAYLIST_TEMPLATE,
  FAVORITES_PLAYLIST_TEMPLATE,
  REDISCOVER_PLAYLIST_TEMPLATE
];

/** Ids of the app-managed playlists that users must never destroy. */
export const SYSTEM_PLAYLIST_IDS: readonly string[] = ['History', 'Favorites', 'Rediscover'];

export const isSystemPlaylist = (playlistId: string): boolean =>
  SYSTEM_PLAYLIST_IDS.includes(playlistId);

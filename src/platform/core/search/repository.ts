/**
 * Data access contract for the ported search and search-history logic.
 *
 * The ported search code is pure: it never reads a store directly. Callers
 * (the api-bridge layer) implement this interface over the store layer, which
 * is being built in parallel. Arrays returned by the getters are treated as
 * immutable snapshots — the in-memory song index caches by array identity, so
 * a repository must hand out a fresh array whenever the library changes.
 */

export interface SearchLogger {
  debug(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
}

export interface SearchRepository {
  getSongs(): SavableSongData[];
  getArtists(): SavableArtist[];
  getAlbums(): SavableAlbum[];
  getGenres(): SavableGenre[];
  getPlaylists(): SavablePlaylist[];

  /** Raw listening records, keyed by songId. */
  getListeningData(): SongListeningData[];

  /** songIds of blacklisted songs (used to flag song results). */
  getSongBlacklist(): string[];

  /** The persisted recent-search list, or undefined when never initialized. */
  getRecentSearches(): string[] | undefined;
  setRecentSearches(recentSearches: string[]): void;

  /** Artwork path resolution for result payloads (paths/URLs, never bytes). */
  getSongArtworkPaths(songId: string, isArtworkAvailable: boolean): ArtworkPaths;
  getArtistArtworkPaths(artworkName?: string): ArtworkPaths;
  getAlbumArtworkPaths(artworkName?: string): ArtworkPaths;
  getPlaylistArtworkPaths(playlistId: string, isArtworkAvailable: boolean): ArtworkPaths;

  /** Fires a data-updated event to the UI (e.g. `userData/recentSearches`). */
  notifyDataUpdated(channel: string): void;

  /** Optional logging facade; a no-op is used when absent. */
  log?: SearchLogger;
}

/** A logger that swallows everything, used when the repository omits one. */
export const noOpLogger: SearchLogger = {
  debug: () => undefined,
  warn: () => undefined,
  error: () => undefined
};

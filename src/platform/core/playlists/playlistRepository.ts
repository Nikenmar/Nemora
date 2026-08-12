/**
 * Data and side-effect seam for the playlists, favorites and history subsystem.
 *
 * The ported functions never import a store or the Electron main process; the
 * api-bridge constructs a concrete implementation from `CachedStores` (the
 * synchronous `get`/`set` cache over `StorePort`) plus the artwork and Last.fm
 * adapters. Every method here mirrors one call the Electron code made against
 * `filesystem.ts`, `main.ts`, `other/artworks.ts` or `fs/resolveFilePaths.ts`.
 */

export interface PlaylistsRepository {
  /** All playlists, or only the ones whose ids are given. */
  getPlaylists(playlistIds?: string[]): SavablePlaylist[];
  setPlaylists(playlists: SavablePlaylist[]): void;

  getSongs(): SavableSongData[];
  setSongs(songs: SavableSongData[]): void;

  getArtists(): SavableArtist[];
  setArtists(artists: SavableArtist[]): void;

  getBlacklist(): Blacklist;
  setBlacklist(blacklist: Blacklist): void;

  /** Persists the artwork for a playlist; mirrors `storeArtworks`. */
  storePlaylistArtwork(playlistId: string, artworkPath?: string): Promise<ArtworkPaths>;
  /** Deletes the stored artwork of a playlist; mirrors `removeArtwork`. */
  removePlaylistArtwork(artworkPaths: ArtworkPaths): Promise<void>;

  /** URL of a playlist cover; mirrors `getPlaylistArtworkPath`. */
  getPlaylistArtworkPath(
    playlistId: string,
    isArtworkAvailable: boolean,
    resetCache?: boolean
  ): ArtworkPaths;
  /** URL of a song cover; mirrors `getSongArtworkPath`. */
  getSongArtworkPath(songId: string, isArtworkAvailable?: boolean): ArtworkPaths;
  /** URL of an artist cover; mirrors `getArtistArtworkPath`. */
  getArtistArtworkPath(artworkName?: string): ArtworkPaths;
  /** Bumps the artwork URL cache timestamp; mirrors `resetArtworkCache`. */
  resetArtworkCache(
    type:
      | 'songs'
      | 'songArtworks'
      | 'artistArtworks'
      | 'albumArtworks'
      | 'playlistArtworks'
      | 'genreArtworks'
      | 'all'
  ): void;

  /** Mirrors `addAFavoriteToLastFM` from `sendFavoritesDataToLastFM.ts`. */
  addAFavoriteToLastFM(title: string, artists?: string[]): void;
  /** Mirrors `removeAFavoriteFromLastFM` from `sendFavoritesDataToLastFM.ts`. */
  removeAFavoriteFromLastFM(title: string, artists?: string[]): void;

  /** Mirrors `dataUpdateEvent`; debouncing stays in the adapter. */
  emitDataUpdate(dataType: DataUpdateEventTypes, data?: string[], message?: string): void;
  /** Mirrors `sendMessageToRenderer`; the adapter routes to the renderer. */
  sendMessage(messageCode: MessageCodes, data?: MessageToRendererData): void;
}

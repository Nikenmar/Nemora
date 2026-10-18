/**
 * Data and side-effect seam for the network subsystem.
 *
 * The ported functions never import a store or the Electron main process; the
 * api-bridge constructs a concrete implementation from the store layer, the
 * artwork/palette subsystem and safeStorage. Every method mirrors one call the
 * Electron code made against `filesystem.ts`, `main.ts`,
 * `fs/resolveFilePaths.ts`, `other/generatePalette.ts` or `utils/safeStorage.ts`.
 */

export interface NetworkRepository {
  getSongs(): SavableSongData[];
  getAlbums(): SavableAlbum[];
  getArtists(): SavableArtist[];
  setArtists(artists: SavableArtist[]): void;

  /**
   * Mirrors `getUserData`; used for Last.fm session data and preferences. The
   * store always returns the full UserData shape.
   */
  getUserData(): UserData;

  /** Mirrors `getSongsOutsideLibraryData` from `main.ts`. */
  getSongsOutsideLibrary(): AudioPlayerData[];

  /** Mirrors `getBlacklistData`; feeds the ported blacklist queries. */
  getBlacklist(): Blacklist;

  /** Mirrors `getSongArtworkPath` / `getArtistArtworkPath`. */
  getSongArtworkPath(songId: string, isArtworkAvailable: boolean): ArtworkPaths;
  getArtistArtworkPath(artworkName?: string): ArtworkPaths;
  getAlbumArtworkPath(artworkName?: string): ArtworkPaths;

  /** Mirrors `getSelectedPaletteData` from `generatePalette.ts`. */
  getSelectedPaletteData(paletteId?: string): PaletteData | undefined;
  /** Mirrors `generatePalette` from `generatePalette.ts` (image URL in, palette out). */
  generatePalette(imageUrl: string): Promise<PaletteData>;

  /** Mirrors `decrypt` from `safeStorage.ts` (scoped to token values). */
  decrypt(encrypted: string): Promise<string>;

  /** Mirrors `dataUpdateEvent`; debouncing stays in the adapter. */
  emitDataUpdate(dataType: DataUpdateEventTypes, data?: string[]): void;
}

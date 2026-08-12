/**
 * Data and side-effect seam for SongGuessr.
 *
 * Availability is deliberately synchronous. The Tauri runtime supplies the
 * watcher-reconciled library catalog, where removal events evict missing files;
 * autocomplete must never issue one plugin-fs `exists` call per candidate.
 */
export interface SongGuessrRepository {
  getSongs(): SavableSongData[];
  getBlacklist(): Blacklist;
  getPlaylists(): SavablePlaylist[];
  getGenres(): SavableGenre[];
  isSongAvailable(songId: string, path: string): boolean;
  resolveSongFilePath(songPath: string): string;
  getSongArtworkPath(songId: string, isArtworkAvailable: boolean): ArtworkPaths;
  romanizeForSearch(value: string): string | undefined;
  random(): number;
}

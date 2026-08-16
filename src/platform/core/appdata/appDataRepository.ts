import type { CoreLogger } from '../playlists/logger';
import type { ListeningCounterFile } from '../stats/listeningEvents';

/**
 * Data and side-effect seam for the app-data import/export subsystem.
 *
 * Port of `src/main/core/exportAppData.ts`, `src/main/core/importAppData.ts`
 * and `src/main/resetAppData.ts`. Every store payload and file operation
 * arrives through this injected repository — no store and no Electron
 * main-process import lives here.
 * Signature: `exportAppData(repo, localStorageData)`, `importAppData(repo)`,
 * `resetAppData(repo)`.
 *
 * Write policy (see docs/tauri-port/03-main-logic-port.md):
 *   * store payloads go through the setters (api-bridge backs them with
 *     `CachedStores`, every store write lands in the Rust
 *     `write_text_file_atomic` command);
 *   * standalone files in the export folder go through
 *     {@link writeTextFileAtomic} — never a plain plugin-fs write.
 */

export interface AppDataRepository {
  // --- stores (reads for export, full replaces for import) ---
  getSongsData(): SavableSongData[];
  setSongsData(songs: SavableSongData[]): void;
  getPaletteData(): PaletteData[];
  setPaletteData(palettes: PaletteData[]): void;
  getArtistsData(): SavableArtist[];
  setArtistsData(artists: SavableArtist[]): void;
  getAlbumsData(): SavableAlbum[];
  setAlbumsData(albums: SavableAlbum[]): void;
  getGenresData(): SavableGenre[];
  setGenresData(genres: SavableGenre[]): void;
  getPlaylistData(playlistIds?: string[]): SavablePlaylist[];
  setPlaylistData(playlists: SavablePlaylist[]): void;
  getUserData(): UserData;
  saveUserData(userData: UserData): void;
  getBlacklistData(): Blacklist;
  setBlacklist(blacklist: Blacklist): void;
  getListeningData(): SongListeningData[];
  saveListeningData(data: SongListeningData[]): void;
  getListeningCounters(): ListeningCounterFile;
  saveListeningCounters(data: ListeningCounterFile): void;
  getCmrStatsData(): CmrStatsData;
  setCmrStatsData(data: CmrStatsData): void;

  // --- files ---
  /** Absolute path of a file/dir inside the Nora profile (`%APPDATA%\Nora`). */
  profilePath(...segments: string[]): Promise<string>;
  /** UTF-8 text read of an absolute path (plugin-fs `readTextFile`). */
  readTextFile(path: string): Promise<string>;
  /** Entry names and directory flags of a folder (plugin-fs `readDir`). */
  readDir(path: string): Promise<{ name: string; isDirectory: boolean }[]>;
  /**
   * Crash-safe standalone write via the Rust `write_text_file_atomic` command.
   * Never a plain plugin-fs `writeFile` — user data must not be clobbered by a
   * torn write.
   */
  writeTextFileAtomic(path: string, contents: string): Promise<void>;
  /** Creates the directory; resolves `{ exist: true }` when it already exists. */
  makeDir(path: string, options?: { recursive?: boolean }): Promise<{ exist: boolean }>;
  /** Copies one file (plugin-fs `copyFile`). */
  copyFile(source: string, destination: string): Promise<void>;
  /**
   * Removes a file or directory. A missing path must resolve (missing-file
   * errors are tolerated like the Electron ENOENT handling).
   */
  remove(path: string, options?: { recursive?: boolean }): Promise<void>;

  // --- app ---
  /** Mirrors `sendMessageToRenderer`; the adapter routes to the renderer. */
  sendMessage(messageCode: MessageCodes, data?: MessageToRendererData): void;
  /** Mirrors the Electron `restartApp(reason, force)`. */
  restartApp(reason: string, force?: boolean): void;
  logger: CoreLogger;
}

import type { CoreLogger } from '../playlists/logger';
import type { ListeningCounterFile } from '../stats/listeningEvents';

/**
 * Data and side-effect seam for the portable stats transfer subsystem.
 *
 * Port of `src/main/core/statsTransfer/*`. Library/stats data, profile paths,
 * standalone-file I/O and the data-update bus arrive through this injected
 * repository — no store and no Electron main-process import lives here.
 * Signature: `exportStatsData(repo, options?)`, `importStatsData(repo, mode, source)`.
 *
 * Write policy (see docs/tauri-port/03-main-logic-port.md):
 *   * store payloads (listening data, cmr stats, playlists, tierlists) go
 *     through the setters, which the api-bridge backs with `CachedStores`
 *     (every store write lands in the Rust `write_text_file_atomic` command);
 *   * standalone files (the export JSON, backup copies) go through
 *     {@link writeTextFileAtomic} — never a plain plugin-fs write.
 */

export interface StatsTransferRepository {
  // --- stores (synchronous cache over the store layer) ---
  getSongsData(): SavableSongData[];
  getListeningData(): SongListeningData[];
  saveListeningData(data: SongListeningData[]): void;
  getListeningCounters(): ListeningCounterFile;
  saveListeningCounters(data: ListeningCounterFile): void;
  getPlaylistData(playlistIds?: string[]): SavablePlaylist[];
  setPlaylistData(playlists: SavablePlaylist[]): void;
  getTierlistData(): SavableTierlist[];
  setTierlistData(tierlists: SavableTierlist[]): void;
  getCmrStatsData(): CmrStatsData;
  setCmrStatsData(data: CmrStatsData): void;

  // --- files ---
  /** Absolute path of a file/dir inside the Nora profile (`%APPDATA%\Nora`). */
  profilePath(...segments: string[]): Promise<string>;
  /** UTF-8 text read of an absolute path (plugin-fs `readTextFile`). */
  readTextFile(path: string): Promise<string>;
  /**
   * Crash-safe standalone write via the Rust `write_text_file_atomic` command.
   * Never a plain plugin-fs `writeFile` — user data must not be clobbered by a
   * torn write.
   */
  writeTextFileAtomic(path: string, contents: string): Promise<void>;
  /** True when the path exists (replaces `fs.access`). */
  exists(path: string): Promise<boolean>;
  /** Creates the directory; resolves `{ exist: true }` when it already exists. */
  makeDir(path: string, options?: { recursive?: boolean }): Promise<{ exist: boolean }>;
  /**
   * Crash-safe path-to-path copy (the Rust `copy_file_atomic` command), used for
   * the pre-import backup.
   *
   * A rejection is a real failure and aborts the import before any write. Callers
   * must not treat "the source does not exist" as one of those: ask {@link exists}
   * first. Nothing in this app rejects with a Node-style `error.code`, so a
   * missing file cannot be recognised after the fact.
   */
  copyFileAtomic(source: string, destination: string): Promise<void>;

  // --- app ---
  /** Local data-update bus; expected to keep the one-second coalescing behavior. */
  emitDataUpdate(dataType: DataUpdateEventTypes, data?: string[], message?: string): void;
  /** The exporting build's version string (`package.json` `version`). */
  appVersion: string;
  logger: CoreLogger;
}

/**
 * The persistence contract for Nemora's JSON stores.
 *
 * Shape rules taken from the real profile (docs/tauri-port/01-appdata-compat.md):
 *   * every file is a JSON OBJECT, never a bare array;
 *   * the payload sits under a named key (`songs`, `userData`, `cmrStats`, ...);
 *   * eight files carry a sibling `__internal__.migrations.version` written by
 *     `conf`. It is metadata, not an envelope, and it MUST survive round-trips.
 *
 * Two behaviours are non-negotiable, because losing user data fails goal #1:
 *   1. Unknown keys - at the root and nested - are preserved verbatim. A future
 *      or unrecognised field must never be dropped by re-serialisation.
 *   2. A file that exists but cannot be parsed is an ERROR, never an empty
 *      default. Electron's `clearInvalidConfig: true` overwrote such files; the
 *      Tauri build fails closed and surfaces recovery instead.
 */

/** Envelope written by `conf`/electron-store alongside the payload. */
export interface StoreInternalMetadata {
  migrations?: { version?: string };
  [unknown: string]: unknown;
}

export interface StoreFile<T> {
  /** The named payload, e.g. `songs` for songs.json. */
  payload: T;
  /**
   * The store's own root `version` key. Verified present in all eleven live
   * files and DISTINCT from `__internal__.migrations.version`. Both must
   * survive a round-trip; conflating them corrupts migration state.
   */
  version?: unknown;
  /**
   * `__internal__` if the file had one. Verified present in eight files;
   * tierlists.json, cmr_stats.json and palettes.json have none, because the
   * fork created them without migrations. Absence must stay absence - adding
   * the key would make old builds believe a migration ran.
   */
  internal?: StoreInternalMetadata;
  /** Every other root key found in the file, preserved verbatim. */
  unknownRootKeys: Record<string, unknown>;
}

export type StoreName =
  | 'songs'
  | 'artists'
  | 'albums'
  | 'genres'
  | 'playlists'
  | 'userData'
  | 'listeningData'
  | 'listeningEvents'
  | 'blacklist'
  | 'tierlists'
  | 'cmrStats'
  | 'palettes';

export class StoreReadError extends Error {
  // Plain fields, not constructor parameter properties: the repo compiles with
  // `erasableSyntaxOnly`, which forbids the shorthand.
  readonly store: StoreName;
  readonly path: string;
  override readonly cause: unknown;

  constructor(store: StoreName, path: string, cause: unknown) {
    super(`store "${store}" at ${path} could not be read; refusing to substitute defaults`);
    this.name = 'StoreReadError';
    this.store = store;
    this.path = path;
    this.cause = cause;
  }
}

/**
 * Reads and writes one store.
 *
 * Callers keep the synchronous get/set ergonomics the Electron code relies on
 * by talking to an in-memory cache; this port is what that cache hydrates from
 * and flushes to. Hydration MUST complete before the renderer reads anything.
 */
export interface StorePort {
  /** Loads a store. Throws `StoreReadError` on a corrupt or unreadable file. */
  read<T>(store: StoreName): Promise<StoreFile<T>>;

  /**
   * Replaces a store on disk.
   *
   * Crash-safety is delegated to Rust: JSON stores go through
   * `write_text_file_atomic`, binary payloads through `write_file_atomic`. A crash
   * must leave either the complete previous file or the complete new one.
   */
  write<T>(store: StoreName, file: StoreFile<T>): Promise<void>;

  /** True when the file exists. A missing file is a legitimate new install. */
  exists(store: StoreName): Promise<boolean>;
}

/** Maps a store to its on-disk filename and its payload key. */
export const STORE_LAYOUT: Record<StoreName, { file: string; payloadKey: string }> = {
  songs: { file: 'songs.json', payloadKey: 'songs' },
  artists: { file: 'artists.json', payloadKey: 'artists' },
  albums: { file: 'albums.json', payloadKey: 'albums' },
  genres: { file: 'genres.json', payloadKey: 'genres' },
  playlists: { file: 'playlists.json', payloadKey: 'playlists' },
  userData: { file: 'userData.json', payloadKey: 'userData' },
  listeningData: { file: 'listening_data.json', payloadKey: 'listeningData' },
  listeningEvents: { file: 'listening_events.json', payloadKey: 'listeningEvents' },
  blacklist: { file: 'blacklist.json', payloadKey: 'blacklist' },
  tierlists: { file: 'tierlists.json', payloadKey: 'tierlists' },
  cmrStats: { file: 'cmr_stats.json', payloadKey: 'cmrStats' },
  palettes: { file: 'palettes.json', payloadKey: 'palettes' }
};

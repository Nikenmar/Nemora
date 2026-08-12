/**
 * Where Nemora keeps its data, and where it looks for Nora's.
 *
 * Nemora owns `%APPDATA%\Nemora` and never writes anywhere else. Nora's profile
 * is a READ-ONLY source for the "import from Nora" action in settings: nothing
 * in this application may modify it, because the user is expected to keep both
 * players installed and a one-way import must never damage the one they came
 * from.
 *
 * Tauri derives its own app directories from the bundle identifier, which would
 * give `%APPDATA%\com.cmrdevs.nemora`. That is not where the data lives, so
 * `BaseDirectory.AppData` is banned for user data and every path is built from
 * `dataDir()` explicitly.
 */

import { dataDir, join } from '@tauri-apps/api/path';

/** Nemora's own profile directory name. */
export const PROFILE_DIR_NAME = 'Nemora';

/**
 * Nora's profile directory name. Both the CMR fork and upstream Nora 3.1.0 use
 * it, because both ship with productName "Nora" - which is exactly why the
 * importer has to inspect the contents to tell them apart rather than trusting
 * the folder.
 */
export const NORA_PROFILE_DIR_NAME = 'Nora';

/**
 * The identifier-derived directory Tauri would have used. Nothing may ever be
 * written here; the acceptance tests assert its absence.
 */
export const FORBIDDEN_PROFILE_DIR_NAME = 'com.cmrdevs.nemora';

let cachedRoot: string | undefined;

/**
 * Absolute path of `%APPDATA%\Nemora`.
 *
 * `NEMORA_PROFILE_DIR` overrides it, which exists because Tauri resolves
 * `dataDir()` through the Windows known-folder API and ignores the `APPDATA`
 * environment variable: a test run that believed it was sandboxed by setting
 * APPDATA once read and wrote a real profile instead. Never set it in a shipped
 * build.
 */
export async function profileRoot(): Promise<string> {
  if (cachedRoot) return cachedRoot;

  const { invoke } = await import('@tauri-apps/api/core');
  const override = await invoke<string | null>('profile_dir_override').catch(() => null);
  if (override) {
    cachedRoot = override;
    return cachedRoot;
  }

  cachedRoot = await join(await dataDir(), PROFILE_DIR_NAME);
  return cachedRoot;
}

/** Absolute path of a file directly inside Nemora's profile. */
export async function profilePath(...segments: string[]): Promise<string> {
  return join(await profileRoot(), ...segments);
}

/** Artwork directory. Hundreds of MB in a real profile, and NOT a cache. */
export async function songCoversDir(): Promise<string> {
  return profilePath('song_covers');
}

/** Idempotent marker for the legacy localStorage import. */
export async function migrationMarkerPath(): Promise<string> {
  return profilePath('nemora-migration-v1.json');
}

/**
 * Absolute path of `%APPDATA%\Nora`, the import source. Read-only by policy.
 */
export async function noraProfileRoot(): Promise<string> {
  return join(await dataDir(), NORA_PROFILE_DIR_NAME);
}

/** A file inside Nora's profile. Read-only by policy. */
export async function noraProfilePath(...segments: string[]): Promise<string> {
  return join(await noraProfileRoot(), ...segments);
}

/** Nora's Chromium LevelDB, the source of its renderer-side state. */
export async function noraLocalStorageDir(): Promise<string> {
  return noraProfilePath('Local Storage', 'leveldb');
}

/** Test seam: forget the cached root. Production code never needs this. */
export function __resetProfileRootCache(): void {
  cachedRoot = undefined;
}

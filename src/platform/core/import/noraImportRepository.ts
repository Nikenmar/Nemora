import { invoke } from '@tauri-apps/api/core';
import { join, tempDir } from '@tauri-apps/api/path';
import {
  copyFile,
  exists,
  mkdir,
  readDir,
  readFile,
  readTextFile,
  remove,
  stat
} from '@tauri-apps/plugin-fs';

import type { CoreLogger } from '../playlists/logger';
import { logger } from '../playlists/logger';
import { noraProfilePath, profilePath } from '../../contracts/paths';
import type { MigrationFileSystem, MigrationStorage } from '../../migration/types';

/**
 * Side-effect seam for the "import from Nora" feature.
 *
 * The feature replaces Nemora's profile wholesale with `%APPDATA%\Nora`'s:
 * the eleven JSON stores are copied byte-for-byte (a verified copy, not a
 * transformation), the three Chromium localStorage keys are recovered from
 * Nora's LevelDB through the shared migration decoder, and `song_covers`
 * (hundreds of MB of authoritative artwork) is copied per file. Nothing in
 * this subsystem ever writes into the Nora profile — it is read-only by
 * policy (docs/tauri-port/01-appdata-compat.md).
 *
 * All destination writes go through the Rust atomic commands
 * (`write_text_file_atomic`, `write_file_atomic`, `copy_file_atomic`); there
 * is no plain plugin-fs write in this subsystem.
 * Signature: `importNoraProfile(port)`.
 */

/** A failed, unsupported or unreadable source profile. */
export class NoraImportError extends Error {
  // Plain fields, not constructor parameter properties: the repo compiles with
  // `erasableSyntaxOnly`, which forbids the shorthand.
  readonly cause: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'NoraImportError';
    this.cause = cause;
  }
}

export interface NoraImportPort {
  /**
   * Read-only source I/O plus the snapshot plumbing shared with the migration
   * subsystem. The importer never writes through this facade.
   */
  fileSystem: MigrationFileSystem;

  /** Absolute path of a file/dir inside `%APPDATA%\Nora` (read-only source). */
  noraProfilePath(...segments: string[]): Promise<string>;

  /** Absolute path of a file/dir inside `%APPDATA%\Nemora` (the destination). */
  nemoraProfilePath(...segments: string[]): Promise<string>;

  /**
   * A fresh scratch directory for the crash-consistent LevelDB copy
   * (`createStableLevelDbSnapshot`). The importer deletes it after recovery.
   */
  createSnapshotDirectory(): Promise<string>;

  /** Crash-safe standalone write via the Rust `write_text_file_atomic` command. */
  writeTextFileAtomic(path: string, contents: string): Promise<void>;

  /** Crash-safe binary write via the Rust `write_file_atomic` command. */
  writeFileAtomic(path: string, contents: Uint8Array): Promise<void>;

  /**
   * Crash-safe copy via the Rust `copy_file_atomic` command — artwork and
   * backup copies, never a plain plugin-fs write.
   */
  copyFileAtomic(source: string, destination: string): Promise<void>;

  /** Deletes one file (destination side only — never a Nora profile path). */
  removeFile(path: string): Promise<void>;

  /** WebView localStorage; receives the three recovered renderer-state keys. */
  storage: MigrationStorage;

  /** Hex SHA-256, used by the LevelDB snapshot consistency check. */
  sha256(contents: Uint8Array): Promise<string>;

  now(): Date;

  logger: CoreLogger;
}

const sha256 = async (contents: Uint8Array): Promise<string> => {
  if (!globalThis.crypto?.subtle) throw new NoraImportError('Web Crypto SHA-256 is unavailable');
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    contents as Uint8Array<ArrayBuffer>
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

/**
 * Production Tauri port. Paths resolve through `%APPDATA%\Nemora` /
 * `%APPDATA%\Nora` explicitly (contracts/paths), reads use plugin-fs and every
 * write is delegated to the Rust crash-safe commands. Mirrors the
 * `createDefaultDependencies` wiring of src/platform/migration/migration.ts.
 */
export function createDefaultNoraImportPort(): NoraImportPort {
  return {
    fileSystem: {
      exists,
      readText: (path) => readTextFile(path),
      readBinary: (path) => readFile(path),
      readDirectory: (path) => readDir(path),
      metadata: async (path) => {
        const info = await stat(path);
        return { size: info.size, mtimeMs: info.mtime?.getTime() ?? null };
      },
      copyFile,
      createDirectory: (path) => mkdir(path, { recursive: true }),
      removeDirectory: (path) => remove(path, { recursive: true }),
      join
    },
    noraProfilePath: (...segments) => noraProfilePath(...segments),
    nemoraProfilePath: (...segments) => profilePath(...segments),
    createSnapshotDirectory: async () => {
      if (!globalThis.crypto?.randomUUID)
        throw new NoraImportError('crypto.randomUUID is unavailable');
      return join(await tempDir(), 'nora-import-leveldb', globalThis.crypto.randomUUID());
    },
    writeTextFileAtomic: async (path, contents) => {
      await invoke<void>('write_text_file_atomic', { path, contents });
    },
    writeFileAtomic: async (path, contents) => {
      await invoke<void>('write_file_atomic', { path, contents: Array.from(contents) });
    },
    copyFileAtomic: async (source, destination) => {
      await invoke<void>('copy_file_atomic', { source, destination });
    },
    removeFile: (path) => remove(path),
    storage: globalThis.localStorage,
    sha256,
    now: () => new Date(),
    logger
  };
}

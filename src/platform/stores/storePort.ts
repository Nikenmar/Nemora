import { invoke } from '@tauri-apps/api/core';
import { exists as fsExists, readTextFile } from '@tauri-apps/plugin-fs';

import {
  FORBIDDEN_PROFILE_DIR_NAME,
  PROFILE_DIR_NAME,
  profilePath
} from '../contracts/paths';
import {
  STORE_LAYOUT,
  StoreReadError,
  type StoreFile,
  type StoreName,
  type StorePort
} from '../contracts/store';

const ARRAY_PAYLOAD_STORES = new Set<StoreName>([
  'songs',
  'artists',
  'albums',
  'genres',
  'playlists',
  'listeningData',
  'tierlists',
  'palettes'
]);

export interface StoreIo {
  exists(path: string): Promise<boolean>;
  readTextFile(path: string): Promise<string>;
  invoke<T>(command: string, args: Record<string, unknown>): Promise<T>;
  resolvePath(fileName: string): Promise<string>;
}

const productionIo: StoreIo = {
  exists: (path) => fsExists(path),
  readTextFile: (path) => readTextFile(path),
  invoke: (command, args) => invoke(command, args),
  resolvePath: (fileName) => profilePath(fileName)
};

const hasOwn = (value: object, key: PropertyKey): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

const isJsonObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Rejects identifier-derived paths even if an incorrect resolver is injected. */
export function assertCompatibleStorePath(store: StoreName, path: string): void {
  const parts = path.split(/[\\/]+/u).filter(Boolean);
  const forbidden = FORBIDDEN_PROFILE_DIR_NAME.toLocaleLowerCase('en-US');

  if (parts.some((part) => part.toLocaleLowerCase('en-US') === forbidden)) {
    throw new Error(`refusing to access the identifier-derived profile path: ${path}`);
  }

  const expectedFile = STORE_LAYOUT[store].file.toLocaleLowerCase('en-US');
  const actualFile = parts.at(-1)?.toLocaleLowerCase('en-US');
  const profileDirectory = parts.at(-2)?.toLocaleLowerCase('en-US');
  if (
    actualFile !== expectedFile ||
    profileDirectory !== PROFILE_DIR_NAME.toLocaleLowerCase('en-US')
  ) {
    throw new Error(`store path escaped the canonical Nemora profile: ${path}`);
  }
}

export function parseStoreText<T>(store: StoreName, path: string, text: string): StoreFile<T> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (cause) {
    throw new StoreReadError(store, path, cause);
  }

  if (!isJsonObject(parsed)) {
    throw new StoreReadError(store, path, new TypeError('store root must be a JSON object'));
  }

  const payloadKey = STORE_LAYOUT[store].payloadKey;
  if (!hasOwn(parsed, payloadKey)) {
    throw new StoreReadError(
      store,
      path,
      new TypeError(`store root is missing payload key "${payloadKey}"`)
    );
  }

  const payload = parsed[payloadKey];
  const payloadShapeIsValid = ARRAY_PAYLOAD_STORES.has(store)
    ? Array.isArray(payload)
    : isJsonObject(payload);
  if (!payloadShapeIsValid) {
    throw new StoreReadError(
      store,
      path,
      new TypeError(`store payload "${payloadKey}" has the wrong JSON shape`)
    );
  }

  if (hasOwn(parsed, '__internal__') && !isJsonObject(parsed.__internal__)) {
    throw new StoreReadError(
      store,
      path,
      new TypeError('store __internal__ metadata must be a JSON object when present')
    );
  }

  const unknownRootKeys = Object.fromEntries(
    Object.entries(parsed).filter(
      ([key]) => key !== payloadKey && key !== 'version' && key !== '__internal__'
    )
  );
  const file: StoreFile<T> = {
    payload: payload as T,
    unknownRootKeys
  };

  if (hasOwn(parsed, 'version')) file.version = parsed.version;
  if (hasOwn(parsed, '__internal__')) {
    file.internal = parsed.__internal__ as NonNullable<StoreFile<T>['internal']>;
  }
  return file;
}

export function serializeStoreFile<T>(store: StoreName, file: StoreFile<T>): string {
  const payloadKey = STORE_LAYOUT[store].payloadKey;
  const root: Record<string, unknown> = { ...file.unknownRootKeys };

  if (hasOwn(file, 'version')) root.version = file.version;
  root[payloadKey] = file.payload;
  if (hasOwn(file, 'internal')) root.__internal__ = file.internal;

  return `${JSON.stringify(root, null, 2)}\n`;
}

/**
 * Tauri-backed StorePort. Reads use plugin-fs and every write is delegated to
 * the Rust crash-safe replacement command; this class has no plain write API.
 */
export class TauriStorePort implements StorePort {
  private readonly io: StoreIo;

  constructor(io: StoreIo = productionIo) {
    this.io = io;
  }

  private async pathFor(store: StoreName): Promise<string> {
    const path = await this.io.resolvePath(STORE_LAYOUT[store].file);
    assertCompatibleStorePath(store, path);
    return path;
  }

  async exists(store: StoreName): Promise<boolean> {
    let path = STORE_LAYOUT[store].file;
    try {
      path = await this.pathFor(store);
      return await this.io.exists(path);
    } catch (cause) {
      throw new StoreReadError(store, path, cause);
    }
  }

  async read<T>(store: StoreName): Promise<StoreFile<T>> {
    let path = STORE_LAYOUT[store].file;
    try {
      path = await this.pathFor(store);
      const text = await this.io.readTextFile(path);
      return parseStoreText<T>(store, path, text);
    } catch (cause) {
      if (cause instanceof StoreReadError) throw cause;
      throw new StoreReadError(store, path, cause);
    }
  }

  async write<T>(store: StoreName, file: StoreFile<T>): Promise<void> {
    const path = await this.pathFor(store);
    // Text, not bytes, on purpose. `invoke` serialises a Vec<u8> argument as a
    // JSON array of numbers, so shipping songs.json (1.4 MB) as bytes would
    // cross IPC as ~1.4 million numbers. A string crosses as one string.
    // See rule 2 in docs/tauri-port/00-PLAN.md.
    const contents = serializeStoreFile(store, file);
    await this.io.invoke<void>('write_text_file_atomic', { path, contents });
  }
}

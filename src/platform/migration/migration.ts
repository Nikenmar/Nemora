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
import { migrationMarkerPath, noraLocalStorageDir, noraProfilePath } from '../contracts/paths';
import { encodeUtf8 } from './bytes';
import { recoverLocalStorageFromLevelDb } from './leveldb';
import { createStableLevelDbSnapshot } from './snapshot';
import {
  LOCAL_STORAGE_KEYS,
  LocalStorageMigrationError,
  LocalStorageRecoveryError,
  type LocalStorageKey,
  type LocalStorageValues,
  type MigrationDependencies,
  type MigrationMarker,
  type MigrationResult
} from './types';
import {
  canonicalValuesBytes,
  parseBridgeExport,
  parseMarker,
  validateLocalStorageValues
} from './validation';

const checksumValue = (
  dependencies: MigrationDependencies,
  key: LocalStorageKey,
  value: string | null
): Promise<string> => dependencies.sha256(encodeUtf8(JSON.stringify({ key, value })));

const destinationChecksums = async (
  dependencies: MigrationDependencies,
  values: LocalStorageValues
): Promise<Record<LocalStorageKey, string>> => {
  const result = {} as Record<LocalStorageKey, string>;
  for (const key of LOCAL_STORAGE_KEYS)
    result[key] = await checksumValue(dependencies, key, values[key]);
  return result;
};

const currentStorageValues = (dependencies: MigrationDependencies): LocalStorageValues => ({
  version: dependencies.storage.getItem('version'),
  localStorage: dependencies.storage.getItem('localStorage'),
  nora_song_guessr: dependencies.storage.getItem('nora_song_guessr')
});

const importAndReadBack = (
  dependencies: MigrationDependencies,
  values: LocalStorageValues
): LocalStorageValues => {
  for (const key of LOCAL_STORAGE_KEYS) {
    const value = values[key];
    if (value === null) dependencies.storage.removeItem(key);
    else dependencies.storage.setItem(key, value);
  }
  const readBack = currentStorageValues(dependencies);
  for (const key of LOCAL_STORAGE_KEYS) {
    if (readBack[key] !== values[key])
      throw new LocalStorageRecoveryError(`WebView localStorage read-back failed for ${key}`);
  }
  return readBack;
};

interface SelectedSource {
  kind: 'bridge' | 'leveldb';
  values: LocalStorageValues;
  sourceHashes: Record<string, string>;
}

const selectSource = async (
  dependencies: MigrationDependencies
): Promise<SelectedSource | undefined> => {
  const { fileSystem, paths, sha256 } = dependencies;
  const bridgePath = await paths.bridgeExport();
  const bridgeExists = await fileSystem.exists(bridgePath);
  let bridgeFailure: unknown;

  if (bridgeExists) {
    try {
      const serialized = await fileSystem.readText(bridgePath);
      const bridge = parseBridgeExport(serialized);
      const actualChecksum = await sha256(canonicalValuesBytes(bridge.values));
      if (actualChecksum !== bridge.checksum)
        throw new LocalStorageMigrationError(
          'bridge export checksum does not match its exact values'
        );
      return {
        kind: 'bridge',
        values: bridge.values,
        sourceHashes: { bridge: await sha256(encodeUtf8(serialized)) }
      };
    } catch (error) {
      bridgeFailure = error;
    }
  }

  const legacyDirectory = await paths.legacyLevelDb();
  if (await fileSystem.exists(legacyDirectory)) {
    let snapshotDirectory: string | undefined;
    try {
      const snapshot = await createStableLevelDbSnapshot(dependencies, legacyDirectory);
      snapshotDirectory = snapshot.directory;
      const recovered = await recoverLocalStorageFromLevelDb(fileSystem, snapshot.directory);
      validateLocalStorageValues(recovered.values);
      return { kind: 'leveldb', values: recovered.values, sourceHashes: snapshot.sourceHashes };
    } catch (error) {
      throw new LocalStorageRecoveryError(
        'legacy Chromium LevelDB exists but could not be recovered; refusing to initialize defaults',
        error
      );
    } finally {
      if (snapshotDirectory)
        await fileSystem.removeDirectory(snapshotDirectory).catch(() => undefined);
    }
  }

  if (bridgeExists)
    throw new LocalStorageRecoveryError(
      'a bridge export exists but is invalid and no legacy LevelDB is available; refusing defaults',
      bridgeFailure
    );
  return undefined;
};

export async function migrateLocalStorage(
  dependencies: MigrationDependencies
): Promise<MigrationResult> {
  const { fileSystem, paths } = dependencies;
  const markerPath = await paths.marker();
  if (await fileSystem.exists(markerPath)) {
    const marker = parseMarker(await fileSystem.readText(markerPath));
    // Destination localStorage is mutable after migration (playback position,
    // preferences, SongGuessr history, and normal schema migrations all write
    // it). The marker proves the one-time read-back; comparing against its old
    // checksums on every launch would reject legitimate post-migration changes.
    return { status: 'already-migrated', marker };
  }

  const source = await selectSource(dependencies);
  if (!source) return { status: 'new-install' };

  validateLocalStorageValues(source.values);
  const readBack = importAndReadBack(dependencies, source.values);
  const marker: MigrationMarker = {
    formatVersion: 1,
    source: source.kind,
    sourceHashes: source.sourceHashes,
    destinationChecksums: await destinationChecksums(dependencies, readBack),
    completedAt: dependencies.now().toISOString()
  };
  await dependencies.atomicWrite(markerPath, encodeUtf8(JSON.stringify(marker, null, '\t')));
  return { status: 'migrated', marker };
}

const sha256 = async (contents: Uint8Array): Promise<string> => {
  if (!globalThis.crypto?.subtle)
    throw new LocalStorageMigrationError('Web Crypto SHA-256 is unavailable');
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    contents as Uint8Array<ArrayBuffer>
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

const createDefaultDependencies = (): MigrationDependencies => ({
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
  paths: {
    bridgeExport: () => noraProfilePath('nemora-import-localstorage.json'),
    marker: migrationMarkerPath,
    legacyLevelDb: noraLocalStorageDir,
    createSnapshotDirectory: async () => {
      if (!globalThis.crypto?.randomUUID)
        throw new LocalStorageMigrationError('crypto.randomUUID is unavailable');
      return join(await tempDir(), 'nora-leveldb-snapshots', globalThis.crypto.randomUUID());
    }
  },
  storage: globalThis.localStorage,
  atomicWrite: async (path, contents) => {
    await invoke<void>('write_file_atomic', { path, contents: Array.from(contents) });
  },
  sha256,
  now: () => new Date()
});

let startupGate: Promise<MigrationResult> | undefined;

/**
 * Startup barrier for the renderer. This MUST resolve before importing App or
 * any module that reaches renderer/store.ts, because store.ts immediately runs
 * checkLocalStorage(), whose recovery branch clears all three physical keys.
 */
export function runLocalStorageMigrationGate(
  dependencies?: MigrationDependencies
): Promise<MigrationResult> {
  startupGate ??= migrateLocalStorage(dependencies ?? createDefaultDependencies());
  return startupGate;
}

export function __resetLocalStorageMigrationGateForTests(): void {
  startupGate = undefined;
}

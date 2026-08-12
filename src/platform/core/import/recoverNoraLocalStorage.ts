import { createStableLevelDbSnapshot } from '../../migration/snapshot';
import { recoverLocalStorageFromLevelDb } from '../../migration/leveldb';
import {
  LOCAL_STORAGE_KEYS,
  type LocalStorageValues,
  type MigrationDependencies
} from '../../migration/types';
import type { NoraImportPort } from './noraImportRepository';
import { NoraImportError } from './noraImportRepository';

/**
 * Recovers Nora's renderer state (the three physical Chromium localStorage
 * keys) from `%APPDATA%\Nora\Local Storage\leveldb`.
 *
 * The decoder is NOT reimplemented here: the migration subsystem already
 * understands the LevelDB format, and Nora may be running while we read it, so
 * the whole directory is first copied to a crash-consistent snapshot
 * (`createStableLevelDbSnapshot`), then decoded read-only
 * (`recoverLocalStorageFromLevelDb`). The snapshot is deleted afterwards.
 *
 * Upstream Nora 3.1.0 predates the SongGuessr and duel keys; their absence in
 * the recovered values (null) is normal, and a profile without a LevelDB
 * folder at all is reported as `absent` rather than an error. A LevelDB that
 * EXISTS but cannot be decoded fails the import (fail-closed — the profile is
 * not "new", it is unreadable).
 */

export type NoraLocalStorageSource = 'leveldb' | 'absent';

export interface NoraLocalStorageRecovery {
  source: NoraLocalStorageSource;
  values: LocalStorageValues;
}

const createMigrationDependencies = (port: NoraImportPort): MigrationDependencies => ({
  fileSystem: port.fileSystem,
  // Only the LevelDB recovery path of the migration module is used; the other
  // path/marker hooks exist for the upgrade gate and are never called here.
  paths: {
    bridgeExport: () => port.noraProfilePath('nemora-import-localstorage.json'),
    marker: () => port.nemoraProfilePath('import-nora-v1.json'),
    legacyLevelDb: () => port.noraProfilePath('Local Storage', 'leveldb'),
    createSnapshotDirectory: port.createSnapshotDirectory
  },
  storage: port.storage,
  atomicWrite: (path, contents) => port.writeFileAtomic(path, contents),
  sha256: port.sha256,
  now: port.now
});

const isJsonObjectRoot = (serialized: string): boolean => {
  try {
    const parsed: unknown = JSON.parse(serialized);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
  } catch {
    return false;
  }
};

/**
 * Deliberately tolerant validation: older (upstream 3.1.0) composites lack
 * fork-era fields such as `duels` and `tierShuffleIntensity`, which is normal.
 * The renderer's own boot-time migration (`checkLocalStorage` +
 * `addMissingPropsToAnObject`) patches those. All we refuse is data that would
 * break the renderer at parse time: non-JSON or non-object roots.
 */
const validateRecoveredValues = (values: LocalStorageValues): void => {
  for (const key of LOCAL_STORAGE_KEYS) {
    const value = values[key];
    if (value !== null && typeof value !== 'string')
      throw new NoraImportError(`recovered ${key} must be a string or null`);
    if (value === null) continue;
    if (key === 'version') {
      if (value.length === 0) throw new NoraImportError('recovered version must not be empty');
      continue;
    }
    if (!isJsonObjectRoot(value))
      throw new NoraImportError(`recovered ${key} is not a JSON object`);
  }
};

export async function recoverNoraLocalStorage(
  port: NoraImportPort
): Promise<NoraLocalStorageRecovery> {
  const levelDbDirectory = await port.noraProfilePath('Local Storage', 'leveldb');
  if (!(await port.fileSystem.exists(levelDbDirectory)))
    return {
      source: 'absent',
      values: { version: null, localStorage: null, nora_song_guessr: null }
    };

  const dependencies = createMigrationDependencies(port);
  let snapshotDirectory: string | undefined;
  try {
    const snapshot = await createStableLevelDbSnapshot(dependencies, levelDbDirectory);
    snapshotDirectory = snapshot.directory;
    const recovered = await recoverLocalStorageFromLevelDb(
      dependencies.fileSystem,
      snapshot.directory
    );
    validateRecoveredValues(recovered.values);
    return { source: 'leveldb', values: recovered.values };
  } catch (error) {
    if (error instanceof NoraImportError) throw error;
    throw new NoraImportError(
      'Nora LevelDB renderer state exists but could not be recovered',
      error
    );
  } finally {
    if (snapshotDirectory)
      await port.fileSystem.removeDirectory(snapshotDirectory).catch(() => undefined);
  }
}

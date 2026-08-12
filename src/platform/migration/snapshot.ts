import { LocalStorageRecoveryError, type MigrationDependencies } from './types';

interface SnapshotFileState {
  name: string;
  size: number;
  mtimeMs: number | null;
}

export interface LevelDbSnapshot {
  directory: string;
  sourceHashes: Record<string, string>;
}

const captureState = async (
  dependencies: MigrationDependencies,
  sourceDirectory: string
): Promise<SnapshotFileState[]> => {
  const { fileSystem } = dependencies;
  const entries = await fileSystem.readDirectory(sourceDirectory);
  const states: SnapshotFileState[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.isDirectory || entry.isSymlink || !entry.isFile)
      throw new LocalStorageRecoveryError(
        `legacy LevelDB contains unsupported entry ${entry.name}`
      );
    const metadata = await fileSystem.metadata(await fileSystem.join(sourceDirectory, entry.name));
    states.push({ name: entry.name, size: metadata.size, mtimeMs: metadata.mtimeMs });
  }
  if (!states.some((state) => state.name === 'CURRENT'))
    throw new LocalStorageRecoveryError('legacy LevelDB has no CURRENT file');
  return states;
};

const statesEqual = (left: SnapshotFileState[], right: SnapshotFileState[]): boolean =>
  left.length === right.length &&
  left.every(
    (state, index) =>
      state.name === right[index].name &&
      state.size === right[index].size &&
      state.mtimeMs === right[index].mtimeMs
  );

/**
 * Copies the entire database and proves it stayed unchanged for the duration of
 * the copy. If Electron writes or compacts concurrently, the attempt is thrown
 * away and retried in a fresh directory; the source is never opened writable.
 */
export async function createStableLevelDbSnapshot(
  dependencies: MigrationDependencies,
  sourceDirectory: string,
  maxAttempts = 3
): Promise<LevelDbSnapshot> {
  const { fileSystem, paths, sha256 } = dependencies;
  let lastCause: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const snapshotDirectory = await paths.createSnapshotDirectory();
    await fileSystem.createDirectory(snapshotDirectory);
    try {
      const before = await captureState(dependencies, sourceDirectory);
      for (const state of before) {
        const source = await fileSystem.join(sourceDirectory, state.name);
        const destination = await fileSystem.join(snapshotDirectory, state.name);
        await fileSystem.copyFile(source, destination);
      }
      const after = await captureState(dependencies, sourceDirectory);
      if (!statesEqual(before, after))
        throw new LocalStorageRecoveryError(
          'legacy LevelDB changed while it was being snapshotted'
        );

      const sourceHashes: Record<string, string> = {};
      for (const state of before) {
        const snapshotPath = await fileSystem.join(snapshotDirectory, state.name);
        const metadata = await fileSystem.metadata(snapshotPath);
        if (metadata.size !== state.size)
          throw new LocalStorageRecoveryError(`${state.name} changed size during snapshot copy`);
        sourceHashes[state.name] = await sha256(await fileSystem.readBinary(snapshotPath));
      }
      return { directory: snapshotDirectory, sourceHashes };
    } catch (error) {
      lastCause = error;
      await fileSystem.removeDirectory(snapshotDirectory).catch(() => undefined);
    }
  }
  throw new LocalStorageRecoveryError(
    `could not create a stable read-only LevelDB snapshot after ${maxAttempts} attempts`,
    lastCause
  );
}

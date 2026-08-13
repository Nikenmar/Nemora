import { DEFAULT_DIRECTORY_CONCURRENCY, SUPPORTED_MUSIC_EXTENSIONS } from './constants';
import { canonicalPathKey, extensionOf, joinPath } from './path';
import type {
  LibraryFileSystemPort,
  NativeLibraryPort,
  TraversalResult,
  WalkedDirectory
} from './types';

export interface TraversalOptions {
  concurrency?: number;
  supportedExtensions?: readonly string[];
  now?: () => Date;
  /**
   * A host that can walk the tree itself. Falls back to the readDir walk below
   * when absent or when the host declines.
   */
  native?: NativeLibraryPort;
}

/**
 * Rebuilds the folder tree from a flat list of visited directories.
 *
 * The host reports WHAT it found; what a folder structure is - how song counts
 * roll up through subfolders, which directories are de-duplicated when selected
 * roots overlap - stays here, because that is application behaviour and the
 * Android port reuses it. The host walk only replaces the file-system calls.
 */
const structuresFromWalk = (
  walked: readonly WalkedDirectory[],
  roots: readonly string[],
  parsedAt: Date
): TraversalResult => {
  const byPath = new Map(walked.map((entry) => [canonicalPathKey(entry.path), entry]));
  const songPaths: string[] = [];
  const visitedDirectories: string[] = [];
  const built = new Set<string>();

  const build = (path: string): FolderStructure | undefined => {
    const key = canonicalPathKey(path);
    const entry = byPath.get(key);
    // A directory the host could not read is reported by omission; the parent
    // still exists and simply has one fewer subfolder.
    if (!entry || built.has(key)) return undefined;
    built.add(key);
    visitedDirectories.push(entry.path);
    songPaths.push(...entry.files);

    const subFolders = entry.directories
      .map((child) => build(child))
      .filter((child): child is FolderStructure => child !== undefined);
    const descendantSongs = subFolders.reduce(
      (sum, subFolder) => sum + (subFolder.noOfSongs ?? 0),
      0
    );

    const modified = entry.modified === undefined ? parsedAt : new Date(entry.modified);
    const created = entry.created === undefined ? parsedAt : new Date(entry.created);
    return {
      path: entry.path,
      stats: {
        lastModifiedDate: modified,
        lastChangedDate: modified,
        fileCreatedDate: created,
        lastParsedDate: parsedAt
      },
      subFolders,
      noOfSongs: entry.files.length + descendantSongs
    };
  };

  const structures = roots
    .map((root) => build(root))
    .filter((structure): structure is FolderStructure => structure !== undefined);
  return { structures, songPaths, visitedDirectories };
};

const folderStats = (
  stats: Awaited<ReturnType<LibraryFileSystemPort['stat']>>,
  parsedAt: Date
): MusicFolderData['stats'] => ({
  lastModifiedDate: stats.mtime ?? parsedAt,
  lastChangedDate: stats.mtime ?? parsedAt,
  fileCreatedDate: stats.birthtime ?? parsedAt,
  lastParsedDate: parsedAt
});

/**
 * Builds folder structures and candidate paths from the same readDir result.
 * A path is scheduled at most once, including when selected roots overlap.
 */
export const walkMusicTrees = async (
  fileSystem: Pick<LibraryFileSystemPort, 'readDir' | 'stat'>,
  roots: readonly string[],
  options: TraversalOptions = {}
): Promise<TraversalResult> => {
  const concurrency = options.concurrency ?? DEFAULT_DIRECTORY_CONCURRENCY;
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError('Directory concurrency must be a positive integer.');
  }

  const supportedExtensions = new Set(
    (options.supportedExtensions ?? SUPPORTED_MUSIC_EXTENSIONS).map((extension) =>
      extension.toLowerCase()
    )
  );
  const parsedAt = (options.now ?? (() => new Date()))();

  if (options.native) {
    const walked = await options.native
      .walk(roots, [...supportedExtensions])
      .catch(() => undefined);
    // An empty answer is treated as "the host declined", not as "the library is
    // empty": a scan that silently found nothing is indistinguishable from a
    // broken native route, and the readDir walk below settles which it was.
    if (walked && walked.length > 0) return structuresFromWalk(walked, roots, parsedAt);
  }

  const structures: FolderStructure[] = [];
  const songPaths: string[] = [];
  const visitedDirectories: string[] = [];
  const scheduled = new Set<string>();
  const waiters: Array<() => void> = [];
  let active = 0;

  const acquire = async (): Promise<void> => {
    if (active < concurrency) {
      active += 1;
      return;
    }
    await new Promise<void>((resolve) =>
      waiters.push(() => {
        active += 1;
        resolve();
      })
    );
  };

  const withPermit = async <Result>(operation: () => Promise<Result>): Promise<Result> => {
    await acquire();
    try {
      return await operation();
    } finally {
      active -= 1;
      waiters.shift()?.();
    }
  };

  const visit = async (path: string): Promise<FolderStructure> => {
    const [stats, entries] = await withPermit(() =>
      Promise.all([fileSystem.stat(path), fileSystem.readDir(path)])
    );
    if (!stats.isDirectory) throw new Error(`Library path is not a directory: ${path}`);
    visitedDirectories.push(path);

    const files = entries.filter(
      (entry) =>
        entry.isFile && !entry.isSymlink && supportedExtensions.has(extensionOf(entry.name))
    );
    songPaths.push(...files.map((entry) => joinPath(path, entry.name)));

    const childPromises: Array<Promise<FolderStructure>> = [];
    for (const entry of entries) {
      if (!entry.isDirectory || entry.isSymlink) continue;
      const childPath = joinPath(path, entry.name);
      const key = canonicalPathKey(childPath);
      if (scheduled.has(key)) continue;
      scheduled.add(key);
      childPromises.push(visit(childPath));
    }
    const subFolders = await Promise.all(childPromises);
    const descendantSongs = subFolders.reduce(
      (sum, subFolder) => sum + (subFolder.noOfSongs ?? 0),
      0
    );

    return {
      path,
      stats: folderStats(stats, parsedAt),
      subFolders,
      noOfSongs: files.length + descendantSongs
    };
  };

  const rootPromises: Array<Promise<FolderStructure>> = [];
  for (const root of roots) {
    const key = canonicalPathKey(root);
    if (scheduled.has(key)) continue;
    scheduled.add(key);
    rootPromises.push(visit(root));
  }
  structures.push(...(await Promise.all(rootPromises)));

  return { structures, songPaths, visitedDirectories };
};

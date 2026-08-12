import { SUPPORTED_MUSIC_EXTENSIONS } from '../library/constants';
import { canonicalPathKey, extensionOf, parentPath } from '../library/path';
import { InFlightPathGuard, retryLockedFile, type RetryOptions } from '../library/retry';
import { InternalWriteSuppression, internalWriteSuppression } from './suppression';
import type {
  LibraryWatcherRepository,
  Unwatch,
  WatchEvent,
  WatchEventKind,
  WatcherFileSystemPort
} from './types';

export const DEFAULT_WATCH_DEBOUNCE_MS = 500;

export interface LibraryWatcherStartOptions {
  /** Runs the post-install reconciliation pass over every root. Defaults to true. */
  reconcile?: boolean;
}

export interface LibraryWatcherOptions {
  debounceMs?: number;
  supportedExtensions?: readonly string[];
  retry?: RetryOptions;
}

const eventCategory = (
  kind: WatchEventKind
): 'access' | 'create' | 'modify' | 'remove' | 'other' => {
  if (typeof kind === 'object' && kind !== null) {
    if ('access' in kind) return 'access';
    if ('create' in kind) return 'create';
    if ('modify' in kind) return 'modify';
    if ('remove' in kind) return 'remove';
  }
  return 'other';
};

const uniquePaths = (paths: readonly string[]): string[] => {
  const seen = new Set<string>();
  return paths.filter((path) => {
    const key = canonicalPathKey(path);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export class LibraryWatcherManager {
  private readonly repository: LibraryWatcherRepository;
  private readonly fileSystem: WatcherFileSystemPort;
  private readonly suppression: InternalWriteSuppression;
  private readonly inFlight: InFlightPathGuard;
  private readonly supportedExtensions: Set<string>;
  private readonly debounceMs: number;
  private readonly retry: RetryOptions | undefined;
  private unwatchers: Unwatch[];

  constructor(
    repository: LibraryWatcherRepository,
    fileSystem: WatcherFileSystemPort,
    suppression: InternalWriteSuppression = internalWriteSuppression,
    options: LibraryWatcherOptions = {}
  ) {
    this.repository = repository;
    this.fileSystem = fileSystem;
    this.suppression = suppression;
    this.inFlight = new InFlightPathGuard();
    this.supportedExtensions = new Set(
      (options.supportedExtensions ?? SUPPORTED_MUSIC_EXTENSIONS).map((value) =>
        value.toLowerCase()
      )
    );
    this.debounceMs = options.debounceMs ?? DEFAULT_WATCH_DEBOUNCE_MS;
    this.retry = options.retry;
    this.unwatchers = [];
  }

  async start(
    structures: readonly FolderStructure[] = this.repository.getMusicFolders(),
    options: LibraryWatcherStartOptions = {}
  ): Promise<void> {
    this.stop();
    const roots = uniquePaths(structures.map((structure) => structure.path));
    if (roots.length === 0) return;

    const rootUnwatch = await this.fileSystem.watch(roots, (event) => this.dispatch(event), {
      recursive: true,
      delayMs: this.debounceMs
    });
    this.unwatchers.push(rootUnwatch);

    const parents = uniquePaths(roots.map(parentPath).filter(Boolean));
    if (parents.length > 0) {
      const parentUnwatch = await this.fileSystem.watch(parents, (event) => this.dispatch(event), {
        recursive: false,
        delayMs: this.debounceMs
      });
      this.unwatchers.push(parentUnwatch);
    }

    // Close the snapshot-to-watch race: changes made between traversal and
    // listener installation are discovered by this final pass.
    //
    // Skippable, because the pass is a full traversal of every root. That is
    // the right price directly after a scan, which is what this was written
    // for, and the wrong one on an ordinary launch: paying it at every startup
    // is the re-index that once turned a 2-second start into a 12-second one.
    if (options.reconcile === false) return;
    // One root at a time, deliberately. A reconciliation is a read-modify-write
    // of the whole catalog, so running the roots concurrently lets one pass
    // commit a snapshot taken before another pass added its songs - and the
    // songs that lost the race are simply gone from the library.
    for (const root of roots) {
      try {
        await this.repository.reconcileFolder(root);
      } catch (error) {
        this.repository.reportWatcherError(error, root);
      }
    }
  }

  stop(): void {
    const unwatchers = this.unwatchers;
    this.unwatchers = [];
    for (const unwatch of unwatchers) {
      try {
        unwatch();
      } catch (error) {
        this.repository.reportWatcherError(error);
      }
    }
  }

  private dispatch(event: WatchEvent): void {
    if (eventCategory(event.type) === 'access') return;
    for (const path of uniquePaths(event.paths)) {
      void this.handlePath(path, event.type).catch((error: unknown) =>
        this.repository.reportWatcherError(error, path)
      );
    }
  }

  private async handlePath(path: string, kind: WatchEventKind): Promise<void> {
    if (this.suppression.isSuppressed(path)) return;
    const category = eventCategory(kind);
    if (!this.supportedExtensions.has(extensionOf(path))) {
      if (category !== 'access') await this.repository.reconcileFolder(path);
      return;
    }

    const key = canonicalPathKey(path);
    await this.inFlight.run(key, async () => {
      const exists = category === 'remove' ? false : await this.fileSystem.exists(path);
      if (!exists) {
        const known = this.repository
          .getKnownSongPaths()
          .some((knownPath) => canonicalPathKey(knownPath) === key);
        if (known) await this.repository.removeSongs([path]);
        return;
      }
      await retryLockedFile(() => this.repository.scanSong(path), this.retry);
    });
  }
}

import { canonicalPathKey } from '../library/path';
import { scanTraversal } from '../library/scanner';
import { walkMusicTrees } from '../library/traversal';
import type {
  LibraryFileSystemPort,
  LibraryRepository,
  LibraryScanResult,
  MetadataParserPort,
  NativeLibraryPort
} from '../library/types';
import { isPathWithin } from './path';
import { removeSongsFromLibrary } from './removeSongs';
import type { CatalogRepository } from './repository';

export interface CatalogReconcileResult extends LibraryScanResult {
  removed: number;
}

export interface CatalogReconcileOptions {
  /** A host that can walk and parse natively; falls back to readDir when absent. */
  native?: NativeLibraryPort;
  /**
   * Refuses to read "the walk found nothing" as "the user emptied the folder".
   *
   * A watcher event names a directory the user just changed, so an empty answer
   * there is a real answer. A pass that runs on its own, over roots nobody
   * touched, has no such evidence: a music folder on a drive that has not
   * finished mounting, or a cloud folder that is not synced yet, also walks as
   * empty, and acting on it would delete the entire library the moment the app
   * opened. The only thing lost by declining is the pruning of a genuinely
   * emptied folder, which the explicit resync still does.
   */
  keepCatalogWhenEmpty?: boolean;
}

export const reconcileCatalog = async (
  catalog: CatalogRepository,
  library: LibraryRepository,
  fileSystem: LibraryFileSystemPort,
  parser: MetadataParserPort,
  roots: readonly string[],
  options: CatalogReconcileOptions = {}
): Promise<CatalogReconcileResult> => {
  const traversal = await walkMusicTrees(fileSystem, roots, { native: options.native });
  const diskPaths = new Set(traversal.songPaths.map(canonicalPathKey));
  const declined = options.keepCatalogWhenEmpty === true && traversal.songPaths.length === 0;
  // The known paths, not the catalog state: `getCatalogState` deep-clones every
  // store to answer, and this pass runs on a timer nobody asked for. Both lists
  // come from the same songs array, and only the paths are needed here.
  const deletedPaths = declined
    ? []
    : library
        .getKnownSongPaths()
        .filter(
          (path) =>
            roots.some((root) => isPathWithin(path, root)) &&
            !diskPaths.has(canonicalPathKey(path))
        );

  // Removal is skipped rather than called with an empty list: it clones the
  // whole catalog before it discovers there is nothing to remove.
  const removed =
    deletedPaths.length === 0
      ? 0
      : (await removeSongsFromLibrary(catalog, deletedPaths)).removedCount;

  // The folder tree is held back until the pass has something to show for
  // itself. Committing it rewrites userData and tells the interface the music
  // folders changed, and a reconciliation that found nothing new, nothing
  // missing and nothing moved has changed nothing but the parse timestamp -
  // which is not worth a store write and a refresh on every launch.
  let structures = traversal.structures;
  const scan = await scanTraversal(
    {
      ...library,
      commitFolderStructures: (committed) => {
        structures = committed;
      }
    },
    fileSystem,
    parser,
    traversal,
    { includeArtwork: true, native: options.native }
  );
  if (removed > 0 || scan.scanned > 0) await library.commitFolderStructures(structures);

  return { ...scan, removed };
};


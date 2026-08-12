import { canonicalPathKey } from '../library/path';
import { scanTraversal } from '../library/scanner';
import { walkMusicTrees } from '../library/traversal';
import type {
  LibraryFileSystemPort,
  LibraryRepository,
  LibraryScanResult,
  MetadataParserPort
} from '../library/types';
import { isPathWithin } from './path';
import { removeSongsFromLibrary } from './removeSongs';
import type { CatalogRepository } from './repository';

export interface CatalogReconcileResult extends LibraryScanResult {
  removed: number;
}

export const reconcileCatalog = async (
  catalog: CatalogRepository,
  library: LibraryRepository,
  fileSystem: LibraryFileSystemPort,
  parser: MetadataParserPort,
  roots: readonly string[]
): Promise<CatalogReconcileResult> => {
  const traversal = await walkMusicTrees(fileSystem, roots);
  const diskPaths = new Set(traversal.songPaths.map(canonicalPathKey));
  const deletedPaths = catalog
    .getCatalogState()
    .songs.filter(
      (song) =>
        roots.some((root) => isPathWithin(song.path, root)) &&
        !diskPaths.has(canonicalPathKey(song.path))
    )
    .map((song) => song.path);

  const removal = await removeSongsFromLibrary(catalog, deletedPaths);
  const scan = await scanTraversal(library, fileSystem, parser, traversal, {
    includeArtwork: true
  });
  return { ...scan, removed: removal.removedCount };
};


import { SUPPORTED_MUSIC_EXTENSIONS } from '../library/constants';
import { extensionOf } from '../library/path';
import { removeSongsFromLibrary } from './removeSongs';
import type { CatalogFileDeletionPort, CatalogRepository } from './repository';

export class InvalidCatalogDeletePathError extends Error {
  constructor(path: string) {
    super(`Refusing to delete a path that is not a supported audio file: ${path}`);
    this.name = 'InvalidCatalogDeletePathError';
  }
}

export const deleteSongsFromSystem = async (
  repository: CatalogRepository,
  files: CatalogFileDeletionPort,
  absoluteFilePaths: readonly string[],
  isPermanentDelete: boolean,
  abortSignal?: AbortSignal
): Promise<{ success: boolean; message?: string }> => {
  const supported = new Set<string>(SUPPORTED_MUSIC_EXTENSIONS);
  for (const path of absoluteFilePaths) {
    if (!supported.has(extensionOf(path))) throw new InvalidCatalogDeletePathError(path);
  }

  const deletedPaths: string[] = [];
  try {
    for (const path of absoluteFilePaths) {
      if (abortSignal?.aborted) {
        const error = new Error('Song deletion was aborted.');
        error.name = 'CatalogDeletionAbortedError';
        throw error;
      }
      if (isPermanentDelete) await files.permanentlyDelete(path);
      else await files.moveToTrash(path);
      deletedPaths.push(path);
    }
  } catch (error) {
    if (deletedPaths.length > 0) await removeSongsFromLibrary(repository, deletedPaths);
    repository.reportError(error, isPermanentDelete ? 'permanent song deletion' : 'recycle song deletion');
    return { success: false };
  }

  await removeSongsFromLibrary(repository, deletedPaths);
  return {
    success: true,
    message: isPermanentDelete
      ? `Successfully deleted ${deletedPaths.length} songs from the system.`
      : `Successfully moved ${deletedPaths.length} songs to the recycle bin.`
  };
};


import { extname } from '../playlists/pathUtils';
import { logger } from '../playlists/logger';
import type { AppDataRepository } from './appDataRepository';

/**
 * Port of `src/main/resetAppData.ts`. Deletes the user data files and the
 * song-covers folder from the Nora profile so the app can rebuild them from
 * defaults. Missing resources are tolerated; the store caches must be dropped
 * by the caller after this completes.
 * Signature: `resetAppData(repo)`.
 */

const resourcePaths = [
  'songs.json',
  'artists.json',
  'albums.json',
  'genres.json',
  'playlists.json',
  'userData.json',
  'listening_data.json',
  'blacklist.json',
  'song_covers'
];

const manageErrors = (error: unknown) => {
  if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
    return logger.error(`A recoverable error occurred when resetting an app data module.`, {
      error
    });
  }
  throw error;
};

const resetAppData = async (repo: AppDataRepository): Promise<void> => {
  try {
    for (const resourcePath of resourcePaths) {
      const isResourcePathADirectory = extname(resourcePath) === '';
      const fullPath = await repo.profilePath(resourcePath);

      await repo.remove(fullPath, { recursive: isResourcePathADirectory }).catch(manageErrors);
    }
  } catch (error) {
    logger.error(`An unrecoverable error occurred when resetting the app.`, { error });
  }
};

export default resetAppData;

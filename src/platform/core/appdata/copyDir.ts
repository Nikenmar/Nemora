import { logger } from '../playlists/logger';
import { joinPath } from '../transfer/joinPath';
import type { AppDataRepository } from './appDataRepository';

/**
 * Recursive directory copy (port of `src/main/utils/copyDir.ts`) over the
 * injected file seam: readDir + mkdir + copyFile.
 */
const copyDir = async (repo: AppDataRepository, src: string, dest: string): Promise<void> => {
  try {
    const { exist } = await repo.makeDir(dest, { recursive: true });
    if (exist) logger.info(`Directory already exists. Will re-write contents of the directory.`);

    const entries = await repo.readDir(src);

    for (const entry of entries) {
      const srcPath = joinPath(src, entry.name);
      const destPath = joinPath(dest, entry.name);

      if (entry.isDirectory) await copyDir(repo, srcPath, destPath);
      else await repo.copyFile(srcPath, destPath);
    }
  } catch (error) {
    logger.error('Failed to copy the directory', { error, src, dest });
    throw error;
  }
};

export default copyDir;

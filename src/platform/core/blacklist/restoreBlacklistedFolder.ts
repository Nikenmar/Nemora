import { logger } from '../playlists/logger';
import { basename, dirname } from '../playlists/pathUtils';
import { isParentFolderBlacklisted } from './isBlacklisted';
import type { BlacklistRepository } from './blacklistRepository';

/**
 * Removes folders from the folder blacklist. A folder whose parent stays
 * blacklisted is reported as not whitelistable instead of silently restoring it.
 */
const restoreBlacklistedFolders = async (
  repo: BlacklistRepository,
  blacklistedFolderPaths: string[]
): Promise<void> => {
  const blacklist = repo.getBlacklist();

  for (const blacklistedFolderPath of blacklistedFolderPaths) {
    const isParentBlacklisted = isParentFolderBlacklisted(repo, blacklistedFolderPath);
    const isParentNotInFolderPaths = !blacklistedFolderPaths.includes(
      dirname(blacklistedFolderPath)
    );

    if (isParentBlacklisted && isParentNotInFolderPaths)
      repo.sendMessage('WHITELISTING_FOLDER_FAILED_DUE_TO_BLACKLISTED_PARENT_FOLDER', {
        folderName: basename(blacklistedFolderPath),
        parentFolderName: dirname(blacklistedFolderPath)
      });
  }

  blacklist.folderBlacklist = blacklist.folderBlacklist.filter(
    (blacklistedFolderPath) => !blacklistedFolderPaths.includes(blacklistedFolderPath)
  );

  repo.setBlacklist(blacklist);
  repo.emitDataUpdate('blacklist/folderBlacklist');
  logger.info('Folder blacklist updated because some songs got removed from the blacklist.', {
    blacklistedFolderPaths
  });
};

export default restoreBlacklistedFolders;

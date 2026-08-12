import { logger } from '../playlists/logger';
import type { BlacklistRepository } from './blacklistRepository';

export interface ToggleBlacklistFoldersReturnValue {
  blacklists: string[];
  whitelists: string[];
}

/**
 * Toggles, blacklists or whitelists folders. With no explicit flag the state
 * toggles per folder; requests that would not change anything are rejected.
 */
const toggleBlacklistFolders = async (
  repo: BlacklistRepository,
  folderPaths: string[],
  isBlacklistFolder?: boolean
): Promise<ToggleBlacklistFoldersReturnValue> => {
  const blacklist = repo.getBlacklist();

  const result: ToggleBlacklistFoldersReturnValue = {
    blacklists: [],
    whitelists: []
  };
  logger.debug(`Requested to modify folder blacklist status`, { folderPaths, isBlacklistFolder });

  for (const folderPath of folderPaths) {
    const isFolderBlacklisted = blacklist.folderBlacklist.includes(folderPath);

    if (isBlacklistFolder === undefined) {
      if (isFolderBlacklisted) {
        blacklist.folderBlacklist = blacklist.folderBlacklist.filter(
          (blacklistedFolderPath) => blacklistedFolderPath !== folderPath
        );
        result.whitelists.push(folderPath);
      } else {
        blacklist.folderBlacklist.push(folderPath);
        result.blacklists.push(folderPath);
      }
    } else if (isBlacklistFolder) {
      if (!isFolderBlacklisted) {
        blacklist.folderBlacklist.push(folderPath);
        result.blacklists.push(folderPath);
      } else
        logger.error(`Request to blacklist a folder but it is already blacklisted.`, {
          folderPath,
          isFolderBlacklisted,
          isBlacklistFolder
        });
    } else if (isFolderBlacklisted) {
      blacklist.folderBlacklist = blacklist.folderBlacklist.filter(
        (blacklistedFolderPath) => blacklistedFolderPath !== folderPath
      );
      result.whitelists.push(folderPath);
    } else
      logger.error(`Request to whitelist a folder but it is already whitelisted.`, {
        folderPath,
        isFolderBlacklisted,
        isBlacklistFolder
      });
  }

  repo.setBlacklist(blacklist);
  repo.emitDataUpdate('blacklist/folderBlacklist', [...result.blacklists, ...result.whitelists]);
  return result;
};

export default toggleBlacklistFolders;

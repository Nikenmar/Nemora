import { logger } from '../playlists/logger';
import type { BlacklistRepository } from './blacklistRepository';

/** Adds the given folders to the folder blacklist, deduplicating by path. */
const blacklistFolders = (repo: BlacklistRepository, folderPaths: string[]): void => {
  const blacklist = repo.getBlacklist();

  blacklist.folderBlacklist = Array.from(new Set([...blacklist.folderBlacklist, ...folderPaths]));
  repo.setBlacklist(blacklist);

  repo.emitDataUpdate('blacklist/folderBlacklist');
  logger.info('Folder blacklist updated because a new songs got blacklisted.', { folderPaths });
};

export default blacklistFolders;

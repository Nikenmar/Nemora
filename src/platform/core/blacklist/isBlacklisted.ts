import { dirname, normalize } from '../playlists/pathUtils';
import type { BlacklistRepository } from './blacklistRepository';

/**
 * Blacklist queries. `folderPath` and `songPath` comparisons run through the
 * Windows-correct path adapter (backslashes, drive letters, UNC shares) with
 * the same semantics as the Electron build.
 */

export const isParentFolderBlacklisted = (
  repo: BlacklistRepository,
  folderPath: string
): boolean => {
  const { folderBlacklist } = repo.getBlacklist();

  const isParentBlacklisted = folderBlacklist.some(
    (blacklistedFolderPath) => dirname(folderPath) === blacklistedFolderPath
  );

  return isParentBlacklisted;
};

export const isFolderBlacklisted = (repo: BlacklistRepository, folderPath: string): boolean => {
  const { folderBlacklist } = repo.getBlacklist();

  const isBlacklisted = folderBlacklist.includes(normalize(folderPath));
  const isParentBlacklisted = isParentFolderBlacklisted(repo, folderPath);

  return isBlacklisted || isParentBlacklisted;
};

export const isSongBlacklisted = (
  repo: BlacklistRepository,
  songId: string,
  songPath: string
): boolean => {
  const { folderBlacklist, songBlacklist } = repo.getBlacklist();

  const isFolderInBlacklist = folderBlacklist.some((folderPath) =>
    normalize(songPath).includes(normalize(folderPath))
  );

  const isSongInBlacklist = songBlacklist.includes(songId);

  return isFolderInBlacklist || isSongInBlacklist;
};

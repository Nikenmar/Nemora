import { logger } from '../playlists/logger';
import type { BlacklistRepository } from './blacklistRepository';

/** Adds the given songs to the song blacklist, deduplicating by id. */
const blacklistSongs = (repo: BlacklistRepository, songIds: string[]): void => {
  const blacklist = repo.getBlacklist();

  blacklist.songBlacklist = Array.from(new Set([...blacklist.songBlacklist, ...songIds]));
  repo.setBlacklist(blacklist);

  repo.emitDataUpdate('blacklist/songBlacklist');
  logger.debug('Song blacklist updated because a new songs got blacklisted.', { songIds });
};

export default blacklistSongs;

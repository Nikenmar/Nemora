import { logger } from '../playlists/logger';
import { basename, dirname } from '../playlists/pathUtils';
import type { BlacklistRepository } from './blacklistRepository';

/**
 * Removes songs from the song blacklist. Songs that stay effectively
 * blacklisted through a blacklisted directory are reported as not
 * whitelistable; the rest are confirmed with a count message.
 */
const restoreBlacklistedSongs = async (
  repo: BlacklistRepository,
  blacklistedSongIds: string[]
): Promise<void> => {
  const blacklist = repo.getBlacklist();
  const filteredIds = blacklistedSongIds.filter((id) => !blacklist.songBlacklist.includes(id));
  blacklist.songBlacklist = blacklist.songBlacklist.filter(
    (blacklistedId) => !blacklistedSongIds.includes(blacklistedId)
  );

  if (filteredIds.length > 0) {
    const songsData = await repo.getSongInfo(filteredIds);
    for (const songData of songsData) {
      if (songData.isBlacklisted)
        repo.sendMessage('WHITELISTING_SONG_FAILED_DUE_TO_BLACKLISTED_DIRECTORY', {
          songName: songData.title,
          directoryName: basename(dirname(songData.path)) || songData.path
        });
    }
  }

  const restoredIds = blacklistedSongIds.filter((id) => !filteredIds.includes(id));

  if (restoredIds.length > 0) {
    repo.sendMessage('SONG_WHITELISTED', { count: restoredIds.length });
  }

  repo.setBlacklist(blacklist);
  repo.emitDataUpdate('blacklist/songBlacklist', restoredIds);
  logger.info('Song blacklist updated because some songs got removed from the blacklist.', {
    songIds: blacklistedSongIds
  });
};

export default restoreBlacklistedSongs;

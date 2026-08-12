import { logger } from './logger';
import type { PlaylistsRepository } from './playlistRepository';

/**
 * Empties the History system playlist. Returns true when history was cleared,
 * undefined when the playlists store was empty or not an array.
 */
const clearSongHistory = (repo: PlaylistsRepository): true | undefined => {
  logger.debug('Started the cleaning process of the song history.');

  const playlistData = repo.getPlaylists();

  if (Array.isArray(playlistData) && playlistData.length > 0) {
    for (let i = 0; i < playlistData.length; i += 1) {
      if (playlistData[i].playlistId === 'History') playlistData[i].songs = [];
    }

    repo.emitDataUpdate('playlists/history');
    repo.setPlaylists(playlistData);
    logger.debug('Finished the song history cleaning process successfully.');
    return true;
  }

  const errorMessage = `Failed to clear the song history because playlist data is empty or not an array`;
  logger.error(errorMessage, { playlistData });
  return undefined;
};

export default clearSongHistory;

import { logger } from './logger';
import type { PlaylistsRepository } from './playlistRepository';

/**
 * Adds songs to a playlist, skipping ids that are already present.
 *
 * The Rediscover playlist is app-managed and hidden from manual adds, exactly
 * like the renderer's add-to-playlist prompt filtered it out.
 */
const addSongsToPlaylist = (
  repo: PlaylistsRepository,
  playlistId: string,
  songIds: string[]
): void => {
  logger.debug(`Requested to add songs to a playlist.`, {
    playlistId,
    songIds
  });

  if (playlistId === 'Rediscover') {
    const errMessage =
      'Request failed because the Rediscover playlist cannot be manually modified.';
    logger.error(errMessage, { playlistId });
    throw new Error(errMessage);
  }

  const playlists = repo.getPlaylists();
  const addedIds: string[] = [];
  const existingIds: string[] = [];

  if (playlists && Array.isArray(playlists) && playlists.length > 0) {
    for (const playlist of playlists) {
      if (playlist.playlistId === playlistId) {
        for (let i = 0; i < songIds.length; i += 1) {
          const songId = songIds[i];

          if (!playlist.songs.includes(songId)) {
            playlist.songs.push(songId);
            addedIds.push(songId);
          } else existingIds.push(songId);
        }
        repo.setPlaylists(playlists);
        logger.debug(`Successfully added ${addedIds.length} songs to the playlist.`, {
          addedIds,
          existingIds,
          playlistId
        });
        return repo.sendMessage('ADDED_SONGS_TO_PLAYLIST', {
          count: addedIds.length,
          name: playlist.name
        });
      }
    }

    const errMessage = 'Request failed because a playlist cannot be found.';
    logger.error(errMessage, {
      playlistId
    });
    throw new Error(errMessage);
  }

  const errMessage = 'Request failed because the playlists array is empty.';
  logger.error(errMessage);
  throw new Error(errMessage);
};

export default addSongsToPlaylist;

import { logger } from './logger';
import toggleLikeSongs from './toggleLikeSongs';
import type { PlaylistsRepository } from './playlistRepository';

/**
 * Removes a song from a playlist. Favorites is handled through the like-toggle
 * so the songs store stays in sync. Throws when the song or the playlist data
 * cannot be found.
 */
const removeSongFromPlaylist = async (
  repo: PlaylistsRepository,
  playlistId: string,
  songId: string
) => {
  logger.debug(`Requested to remove a song from playlist.`, { playlistId, songId });

  let playlistsData = repo.getPlaylists();
  let isSongFound = false;
  if (playlistId === 'Favorites') {
    logger.debug(
      'User requested to remove a song from the Favorites playlist. Request handed over to toggleLikeSongs.'
    );
    return toggleLikeSongs(repo, [songId], false);
  }
  if (Array.isArray(playlistsData) && playlistsData.length > 0) {
    playlistsData = playlistsData.map((playlist) => {
      if (playlist.playlistId === playlistId && playlist.songs.some((id) => id === songId)) {
        isSongFound = true;
        return {
          ...playlist,
          songs: playlist.songs.filter((id) => id !== songId)
        };
      }
      return playlist;
    });

    if (isSongFound) {
      repo.emitDataUpdate('playlists/deletedSong');
      repo.setPlaylists(playlistsData);
      return logger.info(`song removed from playlist successfully.`, { playlistId, songId });
    }
    logger.error(`Selected song cannot be found in the playlist`, { playlistId, songId });
    throw new Error(`'${songId}' cannot be found in the playlist of id ${playlistId}.`);
  }
  logger.error(`Request failed because playlist data is undefined.`);
  throw new Error(`Request failed because playlist data is undefined.`);
};

export default removeSongFromPlaylist;

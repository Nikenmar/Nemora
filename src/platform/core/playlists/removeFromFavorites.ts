import { logger } from './logger';
import type { PlaylistsRepository } from './playlistRepository';

/**
 * Removes a song from the Favorites system playlist. Reports failure when the
 * Favorites playlist does not exist; throws when the playlists data is broken.
 */
const removeFromFavorites = (
  repo: PlaylistsRepository,
  songId: string
): { success: boolean; message?: string } => {
  logger.debug(`Requested to remove a song from the favorites.`, { songId });
  const playlists = repo.getPlaylists();

  if (playlists && Array.isArray(playlists)) {
    if (
      playlists.length > 0 &&
      playlists.some(
        (playlist) => playlist.name === 'Favorites' && playlist.playlistId === 'Favorites'
      )
    ) {
      const selectedPlaylist = playlists.find(
        (playlist) => playlist.name === 'Favorites' && playlist.playlistId === 'Favorites'
      );

      if (
        selectedPlaylist &&
        selectedPlaylist.songs.some((playlistSongId: string) => playlistSongId === songId)
      ) {
        const { songs } = selectedPlaylist;
        songs.splice(songs.indexOf(songId), 1);
        selectedPlaylist.songs = songs;
      }
      repo.setPlaylists(playlists);
      repo.emitDataUpdate('playlists/favorites');
      return { success: true };
    }
    logger.warn(`Failed to remove a song from Favorites because it is unavailable.`);
    return { success: false };
  }
  logger.error(`Failed to remove a song from favorites. playlist data are empty.`);
  throw new Error('Playlists is not an array.');
};

export default removeFromFavorites;

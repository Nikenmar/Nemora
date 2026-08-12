import { logger } from './logger';
import { FAVORITES_PLAYLIST_TEMPLATE } from './playlistTemplates';
import type { PlaylistsRepository } from './playlistRepository';

/**
 * Adds a song to the Favorites system playlist, creating the playlist on first
 * use. A song that is already there is rejected without changes.
 */
const addToFavorites = (
  repo: PlaylistsRepository,
  songId: string
): { success: boolean; message?: string } => {
  logger.debug(`Requested a song to be added to the favorites.`, { songId });
  const playlists = repo.getPlaylists();
  if (playlists && Array.isArray(playlists)) {
    if (playlists.length > 0) {
      const selectedPlaylist = playlists.find(
        (playlist) => playlist.name === 'Favorites' && playlist.playlistId === 'Favorites'
      );
      if (selectedPlaylist) {
        if (selectedPlaylist.songs.some((playlistSongId: string) => playlistSongId === songId)) {
          logger.debug(
            `Request failed for the song to be added to the Favorites because it was already in the Favorites.`,
            { songId }
          );
          return {
            success: false,
            message: `Song with id ${songId} is already in Favorites.`
          };
        }
        selectedPlaylist.songs.push(songId);
      }

      repo.setPlaylists(playlists);
      return { success: true };
    }
    playlists.push(FAVORITES_PLAYLIST_TEMPLATE);
    repo.setPlaylists(playlists);
    repo.emitDataUpdate('playlists/favorites');
    return { success: true };
  }

  const message = `Failed to add to favorites because the playlist data is not an array.`;
  logger.error(message, { playlists: typeof playlists, songId });
  throw new Error(message);
};

export default addToFavorites;

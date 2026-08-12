import { logger } from './logger';
import { HISTORY_PLAYLIST_TEMPLATE } from './playlistTemplates';
import type { PlaylistsRepository } from './playlistRepository';

/**
 * Adds a song to the History system playlist: capped at 50 entries, newest
 * first, no duplicates. Creates the playlist on first use.
 */
export const addToSongsHistory = (repo: PlaylistsRepository, songId: string): boolean => {
  logger.debug(`Requested a song to be added to the History playlist.`, { songId });
  const playlists = repo.getPlaylists();

  if (playlists && Array.isArray(playlists)) {
    const selectedPlaylist = playlists.find(
      (playlist) => playlist.name === 'History' && playlist.playlistId === 'History'
    );

    if (selectedPlaylist) {
      if (selectedPlaylist.songs.length + 1 > 50) selectedPlaylist.songs.pop();
      if (selectedPlaylist.songs.some((song) => song === songId))
        selectedPlaylist.songs = selectedPlaylist.songs.filter((song) => song !== songId);
      selectedPlaylist.songs.unshift(songId);

      repo.setPlaylists(playlists);
    } else {
      playlists.push(HISTORY_PLAYLIST_TEMPLATE);
      repo.setPlaylists(playlists);
    }
    repo.emitDataUpdate('playlists/history');
    repo.emitDataUpdate('userData/recentlyPlayedSongs');
    return true;
  }

  const errMessage =
    'Failed to add song to the history playlist because the playlist data is not an array.';
  logger.error(errMessage, { playlists, songId });
  throw new Error(errMessage);
};

import { logger } from './logger';
import { isSystemPlaylist } from './playlistTemplates';
import type { PlaylistsRepository } from './playlistRepository';

/**
 * Renames a playlist. System playlists (History, Favorites, Rediscover) keep
 * their canonical names and are rejected like an unknown playlist.
 */
const renameAPlaylist = (repo: PlaylistsRepository, playlistId: string, newName: string) => {
  const playlists = repo.getPlaylists();

  if (isSystemPlaylist(playlistId)) {
    logger.warn('Tried to rename a system playlist.', { playlistId, newName });
    return repo.sendMessage('PLAYLIST_NOT_FOUND');
  }

  for (let i = 0; i < playlists.length; i += 1) {
    if (playlistId === playlists[i].playlistId) {
      playlists[i].name = newName;
      repo.setPlaylists(playlists);

      logger.info('Playlist renamed successfully.', { playlistId, newName });
      return repo.sendMessage('PLAYLIST_RENAME_SUCCESS');
    }
  }
  logger.warn('Playlist not found.', { playlistId, newName });
  return repo.sendMessage('PLAYLIST_NOT_FOUND');
};

export default renameAPlaylist;

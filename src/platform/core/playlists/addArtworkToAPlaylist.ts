import { logger } from './logger';
import { isSystemPlaylist } from './playlistTemplates';
import type { PlaylistsRepository } from './playlistRepository';

const removePreviousArtwork = async (repo: PlaylistsRepository, playlistId: string) => {
  const artworkPaths = repo.getPlaylistArtworkPath(playlistId, true, true);
  await repo.removePlaylistArtwork(artworkPaths);
  return logger.debug('Successfully removed previous playlist artwork.');
};

/**
 * Sets the artwork of a playlist. System playlists (History, Favorites,
 * Rediscover) keep their dedicated icons and can never be re-covered.
 */
const addArtworkToAPlaylist = async (
  repo: PlaylistsRepository,
  playlistId: string,
  artworkPath: string
): Promise<ArtworkPaths | undefined> => {
  if (isSystemPlaylist(playlistId)) {
    logger.warn(`Requested to add an artwork to a system playlist.`, { playlistId });
    return undefined;
  }

  const playlists = repo.getPlaylists();

  for (let i = 0; i < playlists.length; i += 1) {
    if (playlists[i].playlistId === playlistId) {
      try {
        if (playlists[i].isArtworkAvailable) await removePreviousArtwork(repo, playlistId);

        const artworkPaths = await repo.storePlaylistArtwork(playlistId, artworkPath);

        playlists[i].isArtworkAvailable = !artworkPaths.isDefaultArtwork;

        repo.resetArtworkCache('playlistArtworks');
        repo.setPlaylists(playlists);
        repo.emitDataUpdate('playlists');

        return artworkPaths;
      } catch (error) {
        logger.error('Failed to add an artwork to a playlist.', { error });
      }
    }
  }
  return undefined;
};

export default addArtworkToAPlaylist;

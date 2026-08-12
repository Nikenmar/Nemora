import { logger } from './logger';
import sortPlaylists from './sortPlaylists';
import type { PlaylistsRepository } from './playlistRepository';

/**
 * Returns playlist data, optionally filtered by ids, sorted, and decorated
 * with artwork paths. With `onlyMutablePlaylists` the History system playlist
 * is hidden from callers that only manage user playlists.
 */
const sendPlaylistData = (
  repo: PlaylistsRepository,
  playlistIds: string[] = [],
  sortType?: PlaylistSortTypes,
  onlyMutablePlaylists = false
): Playlist[] => {
  const playlists = repo.getPlaylists();
  if (playlistIds && playlists && Array.isArray(playlists)) {
    let results: SavablePlaylist[] = [];
    logger.debug(`Requested playlists data`, { playlistIds });
    if (playlistIds.length === 0) results = playlists;
    else {
      for (let x = 0; x < playlists.length; x += 1) {
        for (let y = 0; y < playlistIds.length; y += 1) {
          if (playlists[x].playlistId === playlistIds[y]) results.push(playlists[x]);
        }
      }
    }
    if (sortType) results = sortPlaylists(results, sortType);
    const updatedResults: Playlist[] = results.map((x) => ({
      ...x,
      artworkPaths: repo.getPlaylistArtworkPath(x.playlistId, x.isArtworkAvailable)
    }));
    return onlyMutablePlaylists
      ? updatedResults.filter((result) => result.playlistId !== 'History')
      : updatedResults;
  }
  return [];
};

export default sendPlaylistData;

import { logger } from './logger';
import { generateRandomId } from './randomId';
import type { PlaylistsRepository } from './playlistRepository';

const createNewPlaylist = async (
  repo: PlaylistsRepository,
  name: string,
  songIds?: string[],
  artworkPath?: string
): Promise<{ newPlaylist: SavablePlaylist; newPlaylistArtworkPaths: ArtworkPaths } | undefined> => {
  try {
    const playlistId = generateRandomId();
    const artworkPaths = await repo.storePlaylistArtwork(playlistId, artworkPath);
    const newPlaylist: SavablePlaylist = {
      name,
      playlistId,
      createdDate: new Date(),
      songs: Array.isArray(songIds) ? songIds : [],
      isArtworkAvailable: !artworkPaths.isDefaultArtwork
    };

    return { newPlaylist, newPlaylistArtworkPaths: artworkPaths };
  } catch (error) {
    logger.error('Failed to create a new playlist.', { error });
    return undefined;
  }
};

/**
 * Creates a playlist unless one with the same name already exists. Returns
 * the new playlist together with its stored artwork paths on success.
 */
const addNewPlaylist = async (
  repo: PlaylistsRepository,
  name: string,
  songIds?: string[],
  artworkPath?: string
): Promise<{ success: boolean; message?: string; playlist?: Playlist }> => {
  logger.debug(`Requested a creation of new playlist with a name ${name}`);
  const playlists = repo.getPlaylists();

  if (playlists && Array.isArray(playlists)) {
    const duplicatePlaylist = playlists.find((playlist) => playlist.name === name);

    if (duplicatePlaylist) {
      logger.warn(`Request failed because there is already a playlist named '${name}'.`, {
        duplicatePlaylist
      });
      return {
        success: false,
        message: `Playlist with name '${name}' already exists.`
      };
    }

    const newPlaylistData = await createNewPlaylist(repo, name, songIds, artworkPath);
    if (!newPlaylistData) return { success: false };

    const { newPlaylist, newPlaylistArtworkPaths } = newPlaylistData;

    playlists.push(newPlaylist);
    repo.setPlaylists(playlists);
    repo.emitDataUpdate('playlists/newPlaylist');

    return {
      success: true,
      playlist: { ...newPlaylist, artworkPaths: newPlaylistArtworkPaths }
    };
  }
  logger.error(`Failed to add a song to the favorites. Playlist is not an array.`, {
    playlistsType: typeof playlists
  });
  return { success: false };
};

export default addNewPlaylist;

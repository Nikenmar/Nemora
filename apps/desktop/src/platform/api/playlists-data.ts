import { getRuntime } from '../runtime';

export const playlistsData = {
  getPlaylistData: async (
    playlistIds?: string[],
    sortType?: PlaylistSortTypes,
    onlyMutablePlaylists?: boolean
  ): Promise<Playlist[]> => getRuntime().getPlaylists(playlistIds, sortType, onlyMutablePlaylists),
  addNewPlaylist: (
    playlistName: string,
    songIds?: string[],
    artworkPath?: string
  ): Promise<{ success: boolean; message?: string; playlist?: Playlist }> =>
    getRuntime().addNewPlaylist(playlistName, songIds, artworkPath),
  addSongsToPlaylist: async (
    playlistId: string,
    songIds: string[]
  ): Promise<{ success: boolean; message?: string }> => {
    getRuntime().addSongsToPlaylist(playlistId, songIds);
    return undefined as unknown as { success: boolean; message?: string };
  },
  addArtworkToAPlaylist: (
    playlistId: string,
    artworkPath: string
  ): Promise<ArtworkPaths | undefined> => getRuntime().addPlaylistArtwork(playlistId, artworkPath),
  renameAPlaylist: async (playlistId: string, newName: string): Promise<void> =>
    getRuntime().renamePlaylist(playlistId, newName),
  removeSongFromPlaylist: async (
    playlistId: string,
    songId: string
  ): Promise<{ success: boolean; message?: string }> =>
    getRuntime().removeSongFromPlaylist(playlistId, songId) as unknown as {
      success: boolean;
      message?: string;
    },
  removePlaylists: async (playlistIds: string[]): Promise<unknown> =>
    getRuntime().removePlaylists(playlistIds),
  getArtworksForMultipleArtworksCover: async (songIds: string[]): Promise<string[]> =>
    getRuntime().getMultipleArtworkPaths(songIds),
  exportPlaylist: async (playlistId: string): Promise<void> =>
    getRuntime().exportPlaylist(playlistId),
  importPlaylist: (): Promise<void> => getRuntime().importPlaylist(),
  refreshRediscoverPlaylist: async (thresholdDays?: number): Promise<{ count: number }> =>
    getRuntime().refreshRediscover(thresholdDays)
};

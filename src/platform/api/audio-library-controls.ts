import type { SimilarTracksOutput } from '../../types/last_fm_similar_tracks_api';
import { getRuntime } from '../runtime';
import type { PathBackedAudioPlayerData } from './binary';

export const audioLibraryControls = {
  checkForStartUpSongs: (): Promise<PathBackedAudioPlayerData | undefined> =>
    getRuntime().checkForStartUpSongs(),
  addSongsFromFolderStructures: (
    structures: FolderStructure[],
    sortType?: SongSortTypes
  ): Promise<SongData[]> => getRuntime().addSongsFromFolderStructures(structures, sortType),
  getSong: async (
    songId: string,
    _updateListeningRate = true
  ): Promise<PathBackedAudioPlayerData> => getRuntime().getSong(songId),
  getAllSongs: async (
    sortType?: SongSortTypes,
    filterType?: SongFilterTypes,
    paginatingData?: PaginatingData
  ): Promise<PaginatedResult<AudioInfo, SongSortTypes>> =>
    getRuntime().getAllSongs(sortType, filterType, paginatingData),
  getSongInfo: async (
    songIds: string[],
    sortType?: SongSortTypes,
    filterType?: SongFilterTypes,
    limit?: number,
    preserveIdOrder?: boolean
  ): Promise<SongData[] | undefined> =>
    getRuntime().getSongInfo(songIds, sortType, filterType, limit, preserveIdOrder),
  getSongListeningData: async (songIds: string[]): Promise<SongListeningData[]> =>
    getRuntime().getListeningData(songIds),
  updateSongListeningData: <
    DataType extends keyof ListeningDataTypes,
    Value extends ListeningDataTypes[DataType]
  >(
    songId: string,
    dataType: DataType,
    dataUpdateType: Value
  ): Promise<void> => {
    getRuntime().updateSongListeningData(songId, dataType, dataUpdateType);
    return Promise.resolve();
  },
  resyncSongsLibrary: (): Promise<true> => getRuntime().resyncSongsLibrary(),
  getBlacklistData: async (): Promise<Blacklist> => getRuntime().getBlacklist(),
  blacklistSongs: async (songIds: string[]): Promise<void> => getRuntime().blacklistSongs(songIds),
  restoreBlacklistedSongs: async (songIds: string[]): Promise<void> =>
    getRuntime().restoreBlacklistedSongs(songIds),
  deleteSongsFromSystem: (
    absoluteFilePaths: string[],
    isPermanentDelete: boolean
  ): Promise<{ success: boolean; message?: string }> =>
    getRuntime().deleteSongsFromSystem(absoluteFilePaths, isPermanentDelete),
  generatePalettes: (): Promise<void> => getRuntime().generatePalettes(),
  clearSongHistory: async (): Promise<{ success: boolean; message?: string }> =>
    getRuntime().clearHistory() as unknown as { success: boolean; message?: string },
  scrobbleSong: (songId: string, startTimeInSecs: number): Promise<void> =>
    getRuntime().scrobbleSong(songId, startTimeInSecs),
  sendNowPlayingSongDataToLastFM: (songId: string): Promise<void> =>
    getRuntime().sendNowPlayingSong(songId),
  getSimilarTracksForASong: (songId: string): Promise<SimilarTracksOutput> =>
    getRuntime().getSimilarTracks(songId)
};

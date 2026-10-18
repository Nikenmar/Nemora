import { getRuntime } from '../runtime';

export const tierlistsData = {
  getTierlistData: async (
    tierlistIds?: string[],
    sortType?: TierlistSortTypes
  ): Promise<SavableTierlist[]> => getRuntime().getTierlists(tierlistIds, sortType),
  addTierlist: async (
    name: string,
    sourcePlaylistIds?: string[],
    labelMode?: TierlistLabelMode,
    sourceFolderPaths?: string[]
  ): Promise<{ success: boolean; message?: string; tierlist?: SavableTierlist }> =>
    getRuntime().addTierlist(name, sourcePlaylistIds, labelMode, sourceFolderPaths),
  saveTierlist: async (
    updatedTierlist: SavableTierlist
  ): Promise<{ success: boolean; message?: string }> => getRuntime().saveTierlist(updatedTierlist),
  removeTierlists: async (tierlistIds: string[]): Promise<{ success: boolean; message?: string }> =>
    getRuntime().removeTierlists(tierlistIds),
  getTierlistArtworks: (songIds: string[]): Promise<Record<string, string>> =>
    getRuntime().createTierlistArtworks(songIds),
  getMegaShuffleWeights: async (
    songIds: string[],
    intensity?: number
  ): Promise<Record<string, number>> => getRuntime().getMegaShuffleWeights(songIds, intensity),
  getMegaShuffleData: async (songIds: string[], intensity?: number): Promise<MegaShuffleData> =>
    getRuntime().getMegaShuffleData(songIds, intensity)
};

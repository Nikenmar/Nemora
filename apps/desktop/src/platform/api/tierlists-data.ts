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
  getMegaShuffleData: async (
    songIds: string[],
    intensity?: number,
    options?: { options?: ShuffleOptions; steering?: ShuffleSteering }
  ): Promise<MegaShuffleData> => getRuntime().getMegaShuffleData(songIds, intensity, options),
  getTierSuggestions: async (): Promise<TierSuggestion[]> => getRuntime().getTierSuggestions(),
  applyTierSuggestion: async (tierlistId: string, songId: string, to: number): Promise<boolean> =>
    getRuntime().applyTierSuggestion(tierlistId, songId, to),
  dismissTierSuggestion: async (tierlistId: string, songId: string, to: number): Promise<void> =>
    getRuntime().dismissTierSuggestion(tierlistId, songId, to),
  explainShuffle: async (
    songIds: string[],
    intensity?: number,
    options?: ShuffleOptions
  ): Promise<Record<string, ShuffleExplanation>> =>
    getRuntime().explainShuffle(songIds, intensity, options)
};

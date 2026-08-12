import type { PathBackedUpdateSongDataResult } from './binary';
import { getRuntime } from '../runtime';

export const suggestions = {
  getArtistDuplicates: async (artistName: string): Promise<Artist[]> =>
    getRuntime().getArtistDuplicates(artistName),
  resolveArtistDuplicates: (
    selectedArtistId: string,
    duplicateIds: string[]
  ): Promise<PathBackedUpdateSongDataResult | undefined> =>
    getRuntime().resolveArtistDuplicates(selectedArtistId, duplicateIds),
  resolveSeparateArtists: (
    separateArtistId: string,
    separateArtistNames: string[]
  ): Promise<PathBackedUpdateSongDataResult | undefined> =>
    getRuntime().resolveSeparateArtists(separateArtistId, separateArtistNames),
  resolveFeaturingArtists: (
    songId: string,
    featArtistNames: string[],
    removeFeatInfoInTitle?: boolean
  ): Promise<PathBackedUpdateSongDataResult | undefined> =>
    getRuntime().resolveFeaturingArtists(songId, featArtistNames, removeFeatInfoInTitle)
};

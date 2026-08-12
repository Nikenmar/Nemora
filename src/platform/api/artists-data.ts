import { getRuntime } from '../runtime';

export const artistsData = {
  getArtistData: async (
    artistIdsOrNames?: string[],
    sortType?: ArtistSortTypes,
    filterType?: ArtistFilterTypes,
    limit?: number
  ): Promise<Artist[]> => getRuntime().getArtists(artistIdsOrNames, sortType, filterType, limit),
  toggleLikeArtists: async (
    artistIds: string[],
    likeArtist?: boolean
  ): Promise<ToggleLikeSongReturnValue | undefined> =>
    getRuntime().toggleLikeArtists(artistIds, likeArtist),
  getArtistArtworks: (artistId: string): Promise<ArtistInfoFromNet | undefined> =>
    getRuntime().getArtistArtwork(artistId)
};

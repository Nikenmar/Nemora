import type { LastFMAlbumInfo } from '../../types/last_fm_album_info_api';
import { getRuntime } from '../runtime';

export const albumsData = {
  getAlbumData: async (albumTitlesOrIds?: string[], sortType?: AlbumSortTypes): Promise<Album[]> =>
    getRuntime().getAlbums(albumTitlesOrIds, sortType),
  getAlbumInfoFromLastFM: (albumId: string): Promise<LastFMAlbumInfo | undefined> =>
    getRuntime().getAlbumInfoFromLastFM(albumId)
};

import type { LastFMTrackInfoApi } from '../../types/last_fm_api';
import { getRuntime } from '../runtime';

export const songDataFromInternet = {
  searchSongMetadataResultsInInternet: (
    songTitle: string,
    songArtists: string[]
  ): Promise<SongMetadataResultFromInternet[]> =>
    getRuntime().searchSongMetadata(songTitle, songArtists) as unknown as Promise<
      SongMetadataResultFromInternet[]
    >,
  fetchSongMetadataFromInternet: (
    songTitle: string,
    songArtists: string[]
  ): Promise<SongMetadataResultFromInternet[]> =>
    getRuntime().fetchSongMetadata(songTitle, songArtists) as unknown as Promise<
      SongMetadataResultFromInternet[]
    >,
  fetchSongInfoFromNet: (
    songTitle: string,
    songArtists: string[]
  ): Promise<LastFMTrackInfoApi | undefined> => getRuntime().fetchSongInfo(songTitle, songArtists)
};

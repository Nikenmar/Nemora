import { getRuntime } from '../runtime';

export const lyrics = {
  getSongLyrics: (
    songInfo: LyricsRequestTrackInfo,
    lyricsType?: LyricsTypes,
    lyricsRequestType?: LyricsRequestTypes,
    saveLyricsAutomatically?: AutomaticallySaveLyricsTypes
  ): Promise<SongLyrics | undefined> =>
    getRuntime().getSongLyrics(songInfo, lyricsType, lyricsRequestType, saveLyricsAutomatically),
  getTranslatedLyrics: (languageCode: LanguageCodes): Promise<SongLyrics | undefined> =>
    getRuntime().getTranslatedLyrics(languageCode),
  romanizeLyrics: (): Promise<SongLyrics | undefined> => getRuntime().romanizeLyrics(),
  convertLyricsToPinyin: (): Promise<SongLyrics | undefined> =>
    getRuntime().convertLyricsToPinyin(),
  convertLyricsToRomaja: (): Promise<SongLyrics | undefined> =>
    getRuntime().convertLyricsToRomaja(),
  resetLyrics: (): Promise<SongLyrics> => getRuntime().resetLyrics() as Promise<SongLyrics>,
  saveLyricsToSong: (songPath: string, text: SongLyrics): Promise<unknown> =>
    getRuntime().saveLyrics(songPath, text)
};

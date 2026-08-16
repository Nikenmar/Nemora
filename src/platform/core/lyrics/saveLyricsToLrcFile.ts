import { writeTextFile } from '@tauri-apps/plugin-fs';

import { version } from '../../../../package.json';
import {
  getAlbumFromLyricsString,
  getArtistFromLyricsString,
  getCopyrightInfoFromLyricsString,
  getDurationFromLyricsString,
  getLanguageFromLyricsString,
  getOffsetFromLyricsString,
  getTitleFromLyricsString
} from '../../../common/parseLyrics';
import { dirname, extname, join, basename } from './pathUtils';
import { logger } from './logger';
import type { LyricsRepository } from './repository';

export const getLrcLyricsMetadata = (songLyrics: SongLyrics) => {
  const { unparsedLyrics } = songLyrics.lyrics;

  const title = getTitleFromLyricsString(unparsedLyrics) || songLyrics.title;
  const artist = getArtistFromLyricsString(unparsedLyrics);
  const album = getAlbumFromLyricsString(unparsedLyrics);
  const lang = getLanguageFromLyricsString(unparsedLyrics) || songLyrics.lyrics.originalLanguage;
  const length = getDurationFromLyricsString(unparsedLyrics);
  const offset = getOffsetFromLyricsString(unparsedLyrics) || songLyrics.lyrics.offset;
  const copyright = getCopyrightInfoFromLyricsString(unparsedLyrics) || songLyrics.lyrics.copyright;

  return {
    title,
    artist,
    album,
    lang,
    length,
    offset,
    copyright
  };
};

const convertSecondsToLrcTime = (seconds: number) => {
  const time = {
    minutes: Math.floor(seconds / 60),
    seconds: Math.floor(seconds % 60),
    hundredths: Math.floor((seconds % 1) * 100)
  };
  const lrcTime = `${time.minutes >= 10 ? time.minutes : `0${time.minutes}`}:${
    time.seconds.toString().length > 1 ? time.seconds : `0${time.seconds}`
  }.${time.hundredths}`;

  return { time, lrcTime };
};

const generateLrcLyricLine = (text: string | SyncedLyricsLineWord[], start = 0, lang?: string) => {
  const language = lang ? `[lang:${lang}]` : '';

  if (typeof text === 'string') {
    // lyrics is either synced or unsynced
    if (typeof start === 'number') {
      // lyrics is synced
      const { lrcTime } = convertSecondsToLrcTime(start);

      return `[${lrcTime}]${language} ${text || '♪'}`;
    }
    // lyrics is unsynced
    return language ? `${language} text` : '♪';
  }

  // lyrics is enhanced synced
  const words: string[] = [];

  const { lrcTime } = convertSecondsToLrcTime(start);
  words.push(`[${lrcTime}]${language}`);

  for (const word of text) {
    const { lrcTime } = convertSecondsToLrcTime(word.start);
    words.push(`<${lrcTime}> ${word.text}`);
  }

  return words.join(' ');
};

export const getLrcLyricLinesFromParsedLyrics = (parsedLyrics: LyricLine[]) => {
  const lines: string[] = [];

  for (const lyric of parsedLyrics) {
    const { originalText, translatedTexts, start = 0 } = lyric;

    lines.push(generateLrcLyricLine(originalText, start));
    for (const translatedText of translatedTexts) {
      lines.push(generateLrcLyricLine(translatedText.text, start, translatedText.lang));
    }
  }

  return lines;
};

const convertLyricsToLrcFormat = (songLyrics: SongLyrics) => {
  const { lyrics } = songLyrics;
  const { parsedLyrics } = lyrics;

  const lyricsArr: string[] = [];

  const { title, artist, album, length, offset, copyright } = getLrcLyricsMetadata(songLyrics);

  lyricsArr.push(`[re:Nemora (https://github.com/Nikenmar/Nemora)]`);
  lyricsArr.push(`[ve:${version}]`);
  lyricsArr.push(`[ti:${title}]`);

  if (artist) lyricsArr.push(`[ar:${artist}]`);
  if (album) lyricsArr.push(`[al:${album}]`);
  if (typeof length === 'number')
    lyricsArr.push(`[length:${Math.floor(length / 60)}:${length % 60}]`);
  if (typeof offset === 'number') lyricsArr.push(`[offset:${offset}]`);
  if (copyright) lyricsArr.push(`[copyright:${copyright}]`);

  lyricsArr.push(...getLrcLyricLinesFromParsedLyrics(parsedLyrics));

  return lyricsArr.join('\n');
};

const getLrcFileSaveDirectory = (
  repository: LyricsRepository,
  songPathWithoutProtocol: string,
  lrcFileName: string
) => {
  const userData = repository.getUserData();
  const extensionDroppedLrcFileName = lrcFileName.replaceAll(extname(lrcFileName), '');
  let saveDirectory: string;

  if (userData.customLrcFilesSaveLocation) saveDirectory = userData.customLrcFilesSaveLocation;
  else {
    const songContainingFolderPath = dirname(songPathWithoutProtocol);
    saveDirectory = songContainingFolderPath;
  }

  return join(saveDirectory, `${extensionDroppedLrcFileName}.lrc`);
};

const saveLyricsToLRCFile = async (
  repository: LyricsRepository,
  songPathWithoutProtocol: string,
  songLyrics: SongLyrics
) => {
  const songFileName = basename(songPathWithoutProtocol);
  const lrcFilePath = getLrcFileSaveDirectory(repository, songPathWithoutProtocol, songFileName);

  const lrcFormattedLyrics = convertLyricsToLrcFormat(songLyrics);

  await writeTextFile(lrcFilePath, lrcFormattedLyrics);
  logger.debug(`Lyrics saved in LRC file successfully.`, { title: songLyrics.title, lrcFilePath });
};

export default saveLyricsToLRCFile;

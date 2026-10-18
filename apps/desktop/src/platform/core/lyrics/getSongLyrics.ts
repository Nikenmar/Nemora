/**
 * The lyrics of the playing song, from the core, parsed for the view.
 *
 * The core finds and keeps the text (`nemora-core::lyrics`): what it stored before, else the
 * `.lrc` file next to the song, else the song's tags, else LRCLIB, and whatever it finds is stored
 * in the library so it syncs with everything else. This module only parses it, and caches the
 * result: translation and romanisation work on the cached copy, as in 1.1.9.
 */
import { invoke } from '@tauri-apps/api/core';

import parseLyrics from '../../../common/parseLyrics';
import { getLrcLyricLinesFromParsedLyrics, getLrcLyricsMetadata } from './saveLyricsToLrcFile';

let cachedLyrics = undefined as SongLyrics | undefined;

export const getCachedLyrics = () => cachedLyrics;

export const updateCachedLyrics = async (
  callback: (prevLyrics: typeof cachedLyrics) => SongLyrics | undefined
) => {
  const lyrics = await callback(cachedLyrics);
  if (lyrics) cachedLyrics = lyrics;
};

type StoredLyrics = { text: string; source: string; synced: boolean };

/** The core's source names as 1.x showed them. */
const SOURCE_NAMES: Record<string, LyricsSource> = {
  tags: 'IN_SONG_LYRICS',
  lrc_file: 'IN_SONG_LYRICS',
  user: 'IN_SONG_LYRICS',
  lrclib: 'LRCLIB',
  musixmatch: 'MUSIXMATCH'
};

const typeOf = (lyrics: LyricsData): LyricsTypes => {
  if (!lyrics.isSynced) return 'UN_SYNCED';
  const enhanced = lyrics.parsedLyrics.some((line) => typeof line.originalText !== 'string');
  return enhanced ? 'ENHANCED_SYNCED' : 'SYNCED';
};

const accepts = (wanted: LyricsTypes, found: LyricsTypes) =>
  wanted === 'ANY' ||
  wanted === found ||
  (wanted === 'SYNCED' && found === 'ENHANCED_SYNCED');

const getSongLyrics = async (
  trackInfo: LyricsRequestTrackInfo,
  lyricsType: LyricsTypes = 'ANY',
  lyricsRequestType: LyricsRequestTypes = 'ANY'
): Promise<SongLyrics | undefined> => {
  const stored = await invoke<StoredLyrics | null>('lyrics_get', {
    path: trackInfo.songPath,
    network: lyricsRequestType !== 'OFFLINE_ONLY' && navigator.onLine
  });
  if (!stored) {
    cachedLyrics = undefined;
    return undefined;
  }
  const lyrics = parseLyrics(stored.text);
  const found = typeOf(lyrics);
  if (!accepts(lyricsType, found)) return undefined;
  cachedLyrics = {
    title: trackInfo.songTitle,
    source: SOURCE_NAMES[stored.source] ?? stored.source,
    lyricsType: found,
    lyrics,
    // Found lyrics are stored in the library, so every text the core returns works offline.
    isOfflineLyricsAvailable: true
  };
  return cachedLyrics;
};

/** The lyrics as LRC, the form the core stores. */
export const toLrc = (songLyrics: SongLyrics): string => {
  const { title, artist, album, lang, offset, copyright } = getLrcLyricsMetadata(songLyrics);
  const head = [`[ti:${title}]`];
  if (artist) head.push(`[ar:${artist}]`);
  if (album) head.push(`[al:${album}]`);
  if (lang) head.push(`[lang:${lang}]`);
  if (offset) head.push(`[offset:${offset}]`);
  if (copyright) head.push(`[copyright:${copyright}]`);
  if (!songLyrics.lyrics.isSynced) {
    const lines = songLyrics.lyrics.parsedLyrics.map((line) =>
      typeof line.originalText === 'string'
        ? line.originalText
        : line.originalText.map((word) => word.text).join(' ')
    );
    return [...head, ...lines].join('\n');
  }
  return [...head, ...getLrcLyricLinesFromParsedLyrics(songLyrics.lyrics.parsedLyrics)].join('\n');
};

export default getSongLyrics;

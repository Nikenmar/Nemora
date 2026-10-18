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

const fold = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/**
 * Whether Musixmatch answered about the song that was asked. A token it no longer trusts gets
 * another song with placeholder words instead of an error, and that must never be kept as lyrics.
 */
const isSameTrack = (asked: LyricsRequestTrackInfo, title?: string, artist?: string) => {
  if (!title) return false;
  const [askedTitle, gotTitle] = [fold(asked.songTitle), fold(title)];
  const titleMatches = askedTitle.includes(gotTitle) || gotTitle.includes(askedTitle);
  const artists = (asked.songArtists ?? []).map(fold).filter(Boolean);
  const gotArtist = fold(artist ?? '');
  const artistMatches =
    artists.length === 0 || artists.some((a) => gotArtist.includes(a) || a.includes(gotArtist));
  return titleMatches && artistMatches && gotTitle.length > 0;
};

/**
 * Musixmatch, when the user turned it on: asked only for what the core did not find (or found
 * without the timing that was asked for). What it finds is stored like any found text.
 */
const fromMusixmatch = async (
  trackInfo: LyricsRequestTrackInfo,
  lyricsType: LyricsTypes,
  token: string
): Promise<SongLyrics | undefined> => {
  const { default: fetchLyricsFromMusixmatch } = await import('../net/fetchLyricsFromMusixmatch');
  const artists = trackInfo.songArtists ?? [];
  const found = await fetchLyricsFromMusixmatch(
    {
      q_track: trackInfo.songTitle,
      q_artist: artists[0] ?? '',
      q_artists: artists.join(' '),
      q_duration: trackInfo.duration.toString()
    },
    token,
    lyricsType
  ).catch(() => undefined);
  if (!found || !isSameTrack(trackInfo, found.metadata.title, found.metadata.artist)) return undefined;
  await invoke('lyrics_store_found', {
    path: trackInfo.songPath,
    text: found.lyrics,
    source: 'musixmatch'
  }).catch((error: unknown) => console.error('Musixmatch lyrics were not kept.', error));
  const lyrics = parseLyrics(found.lyrics);
  return {
    title: trackInfo.songTitle,
    source: 'MUSIXMATCH',
    lyricsType: typeOf(lyrics),
    link: found.metadata.link,
    lyrics,
    isOfflineLyricsAvailable: true
  };
};

const getSongLyrics = async (
  trackInfo: LyricsRequestTrackInfo,
  lyricsType: LyricsTypes = 'ANY',
  lyricsRequestType: LyricsRequestTypes = 'ANY',
  musixmatchToken?: string
): Promise<SongLyrics | undefined> => {
  const online = lyricsRequestType !== 'OFFLINE_ONLY' && navigator.onLine;
  const stored = await invoke<StoredLyrics | null>('lyrics_get', { path: trackInfo.songPath, network: online });
  const lyrics = stored ? parseLyrics(stored.text) : undefined;
  const found = lyrics ? typeOf(lyrics) : undefined;
  if (stored && lyrics && found && accepts(lyricsType, found)) {
    cachedLyrics = {
      title: trackInfo.songTitle,
      source: SOURCE_NAMES[stored.source] ?? stored.source,
      lyricsType: found,
      lyrics,
      // Found lyrics are stored in the library, so every text the core returns works offline.
      isOfflineLyricsAvailable: true
    };
    return cachedLyrics;
  }
  if (online && musixmatchToken) {
    const fromMxm = await fromMusixmatch(trackInfo, lyricsType, musixmatchToken);
    if (fromMxm && accepts(lyricsType, fromMxm.lyricsType)) {
      cachedLyrics = fromMxm;
      return cachedLyrics;
    }
  }
  if (!stored) cachedLyrics = undefined;
  return undefined;
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

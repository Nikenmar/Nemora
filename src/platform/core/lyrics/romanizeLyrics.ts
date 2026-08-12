import Kuroshiro from '@sglkc/kuroshiro';
import KuromojiAnalyzer from '@sglkc/kuroshiro-analyzer-kuromoji';
import { toRomaji } from 'wanakana';

import { version } from '../../../../package.json';
import { INSTRUMENTAL_LYRIC_IDENTIFIER } from '../../../common/parseLyrics';
import { getCachedLyrics, updateCachedLyrics } from './getSongLyrics';
import { getLrcLyricsMetadata } from './saveLyricsToLrcFile';
import { logger } from './logger';
import type { LyricsRepository } from './repository';

const kuroshiro = new Kuroshiro();
await kuroshiro.init(
  new KuromojiAnalyzer(
    // In a webview the dictionary is an HTTP asset, not a node_modules path.
    // vite.tauri.config.ts copies it to /kuromoji-dict; without this the
    // analyzer fetches index.html, fails to gunzip it, and never resolves.
    // Two spellings exist and only one works here: the kuroshiro wrapper
    // reads `dictPath`, while the kuromoji builder underneath reads `dicPath`.
    // Passing the inner spelling is silently ignored and falls back to a
    // node_modules path that does not exist in a webview. The trailing slash
    // matters too - the loader concatenates path + filename.
    '__TAURI_INTERNALS__' in globalThis ? { dictPath: '/kuromoji-dict/' } : undefined
  )
);

const hasConvertibleCharacter = (str: string) => {
  if (!str) return false;
  for (const c of str) {
    if (Kuroshiro.Util.isJapanese(c)) return true;
  }
  return false;
};

const convertText = async (str: string) => {
  const strsToReplace = ['  ', ' ,', ' .', ' ?', ' !', ' ;', ' )', '( '];
  const strsReplace = [' ', ',', '.', '?', '!', ';', ')', '('];
  const kana = await kuroshiro.convert(str, { to: 'katakana', mode: 'spaced' });
  let convertedText =
    ' ' + toRomaji(kana, { customRomajiMapping: { '「': '「', '」': '」' } }) + ' ';
  for (let j = 0; j < strsToReplace.length; j++)
    convertedText = convertedText.replaceAll(strsToReplace[j], strsReplace[j]);
  return convertedText.trim();
};

const romanizeLyrics = async (repository: LyricsRepository) => {
  const cachedLyrics = getCachedLyrics();
  try {
    if (!cachedLyrics) return undefined;
    const { parsedLyrics } = cachedLyrics.lyrics;
    const lines: (string | SyncedLyricsLineWord[])[] = parsedLyrics.map(
      (line) => line.originalText
    );

    const convertedLyrics: string[][] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (typeof line === 'string') {
        if (!hasConvertibleCharacter(line)) convertedLyrics.push([]);
        else convertedLyrics.push([await convertText(line)]);
      } else {
        const convertedSyncedWords: string[] = [];
        let convertedWordsCount = 0;
        for (let j = 0; j < line.length; j++) {
          const word = line[j];
          if (!hasConvertibleCharacter(word.text)) convertedSyncedWords.push(word.text.trim());
          else {
            convertedSyncedWords.push(await convertText(word.text));
            convertedWordsCount++;
          }
        }
        if (convertedWordsCount > 0) convertedLyrics.push(convertedSyncedWords);
        else convertedLyrics.push([]);
      }
    }

    const lyricsArr: string[] = [];
    const { title, artist, album, lang, length, offset, copyright } =
      getLrcLyricsMetadata(cachedLyrics);

    lyricsArr.push(`[re:Nora (https://github.com/Sandakan/Nora)]`);
    lyricsArr.push(`[ve:${version}]`);
    lyricsArr.push(`[ti:${title}]`);

    if (artist) lyricsArr.push(`[ar:${artist}]`);
    if (album) lyricsArr.push(`[al:${album}]`);
    if (lang) lyricsArr.push(`[lang:${lang}]`);
    if (length) lyricsArr.push(`[length:${length}]`);
    if (typeof offset === 'number') lyricsArr.push(`[offset:${offset}]`);
    if (copyright) lyricsArr.push(`[copyright:${copyright}]`);

    for (let i = 0; i < parsedLyrics.length; i++) {
      const lyric = parsedLyrics[i];
      const convertedLyric = convertedLyrics.at(i);
      if (!convertedLyric || convertedLyric.length === 0) {
        lyric.romanizedText = '';
        continue;
      }
      if (lyric.isEnhancedSynced) {
        const enhancedLyrics: SyncedLyricsLineWord[] = new Array<SyncedLyricsLineWord>(
          lyric.originalText.length
        );
        for (let j = 0; j < enhancedLyrics.length; j++) {
          const originalEnhancedLyric = lyric.originalText.at(j) as SyncedLyricsLineWord;
          const enhancedLyric = {
            text: convertedLyric[j].trim().replaceAll('\n', ''),
            start: originalEnhancedLyric.start,
            end: originalEnhancedLyric.end,
            unparsedText: originalEnhancedLyric.unparsedText
          };
          enhancedLyrics[j] = enhancedLyric;
        }
        lyric.romanizedText = enhancedLyrics;
      } else {
        const convertedText = convertedLyric[0].trim();
        if (convertedText !== INSTRUMENTAL_LYRIC_IDENTIFIER)
          lyric.romanizedText = convertedText.replaceAll('\n', '');
      }
    }
    cachedLyrics.lyrics.isRomanized = true;
    cachedLyrics.lyrics.parsedLyrics = parsedLyrics;

    await updateCachedLyrics(() => cachedLyrics);

    repository.sendMessage({
      messageCode: 'LYRICS_CONVERT_SUCCESS'
    });
    return cachedLyrics;
  } catch (error) {
    logger.error('Failed to romanize lyrics.', { error });
    repository.sendMessage({
      messageCode: 'LYRICS_CONVERT_FAILED'
    });
  }

  return undefined;
};

export default romanizeLyrics;

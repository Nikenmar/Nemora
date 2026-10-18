import {
  translateText,
  type RawTranslateResponse
} from '../net/translateText';

import { version } from '../../../../package.json';
import parseLyrics, { INSTRUMENTAL_LYRIC_IDENTIFIER } from '../../../common/parseLyrics';
import { getCachedLyrics, updateCachedLyrics } from './getSongLyrics';
import { getLrcLyricLinesFromParsedLyrics, getLrcLyricsMetadata } from './saveLyricsToLrcFile';
import { logger } from './logger';
import type { LyricsRepository } from './repository';

const GOOGLE_TRANSLATE_COPYRIGHT_STRING = ' Lyrics translated using Google Translate.';

const getTranslatedLyricLines = (repository: LyricsRepository, raw: RawTranslateResponse, translatedLang: string) => {
  if (translatedLang === raw.src) {
    // Lyrics were requested to be translated to the same source language
    repository.sendMessage({
      messageCode: 'LYRICS_TRANSLATION_TO_SAME_SOURCE_LANGUAGE',
      data: { language: translatedLang }
    });

    const first = raw.sentences.at(0);
    if (raw.sentences.length === 1 && first && 'trans' in first) {
      const translatedText = first.trans;

      return translatedText.split('\n').map((line) => ({ trans: line }));
    }
  }

  return raw.sentences;
};

const getTranslatedLyrics = async (repository: LyricsRepository, languageCode: string) => {
  const cachedLyrics = getCachedLyrics();

  try {
    if (cachedLyrics) {
      const { parsedLyrics } = cachedLyrics.lyrics;

      const lines = parsedLyrics.map((line) => {
        if (typeof line.originalText === 'string') return line.originalText.trim();
        return line.originalText
          .map((x) => x.text)
          .join(' ')
          .trim();
      });
      const { raw } = await translateText(lines.join('\n'), languageCode || 'auto');
      const translatedLang = languageCode || 'en';

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
      if (copyright)
        lyricsArr.push(
          `[copyright:${copyright}.${!copyright.includes(GOOGLE_TRANSLATE_COPYRIGHT_STRING) ? GOOGLE_TRANSLATE_COPYRIGHT_STRING : ''}]`
        );

      const googleTranslateLyrics = getTranslatedLyricLines(repository, raw, translatedLang);

      for (let i = 0; i < parsedLyrics.length; i++) {
        const lyric = parsedLyrics[i];
        const translatedLyric = googleTranslateLyrics.at(i);

        if (translatedLyric && 'trans' in translatedLyric) {
          const translatedText = translatedLyric.trans.trim();

          if (
            translatedText !== INSTRUMENTAL_LYRIC_IDENTIFIER &&
            lyric.originalText !== translatedText
          )
            lyric.translatedTexts.push({
              lang: translatedLang,
              text: translatedText.replaceAll('\n', '')
            });
        }
      }

      const lrcLyricsLines = getLrcLyricLinesFromParsedLyrics(parsedLyrics);
      lyricsArr.push(...lrcLyricsLines);

      if (cachedLyrics.lyrics.translatedLanguages) {
        if (!cachedLyrics.lyrics.translatedLanguages.includes(translatedLang))
          cachedLyrics.lyrics.translatedLanguages.push(translatedLang);
      } else cachedLyrics.lyrics.translatedLanguages = [translatedLang];
      cachedLyrics.lyrics.isTranslated = true;

      const translatedLyrics = parseLyrics(lyricsArr.join('\n'));
      const convertedLyrics = cachedLyrics.lyrics.parsedLyrics.map((line) => line.romanizedText);
      const isRomanized = cachedLyrics.lyrics.isRomanized;

      cachedLyrics.lyrics = translatedLyrics;
      cachedLyrics.lyrics.parsedLyrics.map((line, index) => {
        line.romanizedText = convertedLyrics[index];
      });
      cachedLyrics.lyrics.isRomanized = isRomanized;
      await updateCachedLyrics(() => cachedLyrics);

      repository.sendMessage({
        messageCode: 'LYRICS_TRANSLATION_SUCCESS'
      });
    }
    return cachedLyrics;
  } catch (error) {
    logger.debug('Failed to translate lyrics.', { error });
    repository.sendMessage({
      messageCode: 'LYRICS_TRANSLATION_FAILED'
    });
    return undefined;
  }
};

export default getTranslatedLyrics;

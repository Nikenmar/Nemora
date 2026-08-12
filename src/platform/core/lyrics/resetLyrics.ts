import { getCachedLyrics, updateCachedLyrics } from './getSongLyrics';
import { logger } from './logger';
import type { LyricsRepository } from './repository';

const resetLyrics = async (repository: LyricsRepository) => {
  const cachedLyrics = getCachedLyrics();
  try {
    if (!cachedLyrics) return undefined;
    cachedLyrics.lyrics.isRomanized = false;
    cachedLyrics.lyrics.translatedLanguages = [];
    cachedLyrics.lyrics.isReset = true;
    cachedLyrics.lyrics.isTranslated = false;
    cachedLyrics.lyrics.parsedLyrics.forEach((line) => {
      line.romanizedText = '';
      line.translatedTexts = [];
    });
    await updateCachedLyrics(() => cachedLyrics);
    repository.sendMessage({
      messageCode: 'RESET_CONVERTED_LYRICS_SUCCESS'
    });
    return cachedLyrics;
  } catch (error) {
    logger.error('Failed to reset converted lyrics.', { error });
    repository.sendMessage({
      messageCode: 'RESET_CONVERTED_LYRICS_FAILED'
    });
  }
  return undefined;
};

export default resetLyrics;

import { describe, expect, jest, test } from '@jest/globals';

jest.mock('@tauri-apps/plugin-fs', () => ({
  readTextFile: jest.fn(),
  writeTextFile: jest.fn()
}));
// convertLyricsToPinyin pulls in getSongLyrics, which reads build-time env.
jest.mock('../../net/buildEnv', () => ({ getBuildEnvVariable: () => undefined }));

import convertLyricsToPinyin from '../convertToPinyin';
import { updateCachedLyrics } from '../getSongLyrics';
import type { LyricsRepository } from '../repository';

const makeRepository = (): LyricsRepository => ({
  getUserData: () => ({
    language: 'en',
    theme: { isDarkMode: true, useSystemTheme: false },
    musicFolders: [],
    preferences: {
      autoLaunchApp: false,
      openWindowMaximizedOnStart: false,
      openWindowAsHiddenOnSystemStart: false,
      isMiniPlayerAlwaysOnTop: false,
      isMusixmatchLyricsEnabled: false,
      hideWindowOnClose: false,
      sendSongScrobblingDataToLastFM: false,
      sendSongFavoritesDataToLastFM: false,
      sendNowPlayingSongDataToLastFM: false,
      saveLyricsInLrcFilesForSupportedSongs: false,
      enableDiscordRPC: false,
      saveVerboseLogs: false
    },
    windowPositions: {},
    windowDiamensions: {},
    windowState: 'normal',
    recentSearches: []
  }),
  readEmbeddedLyrics: () => Promise.resolve({}),
  writeEmbeddedLyrics: () => Promise.resolve(),
  decrypt: (encrypted) => Promise.resolve(encrypted),
  searchUnsyncedLyrics: () => Promise.resolve(undefined),
  sendMessage: () => undefined,
  emitDataUpdate: () => undefined
});

const chineseLyrics: SongLyrics = {
  title: '童話',
  source: 'IN_SONG_LYRICS',
  lyricsType: 'UN_SYNCED',
  lyrics: {
    isSynced: false,
    isRomanized: false,
    isTranslated: false,
    isReset: false,
    parsedLyrics: [
      {
        originalText: '忘了有多久',
        translatedTexts: [],
        isEnhancedSynced: false
      },
      {
        originalText: '♪',
        translatedTexts: [],
        isEnhancedSynced: false
      }
    ],
    unparsedLyrics: '[ti:童話]\n忘了有多久\n♪'
  },
  isOfflineLyricsAvailable: false
};

describe('convertLyricsToPinyin', () => {
  test('romanizes Chinese lines and leaves the instrumental marker untouched', async () => {
    const repository = makeRepository();
    await updateCachedLyrics(() => chineseLyrics);

    const result = await convertLyricsToPinyin(repository);

    expect(result?.lyrics.isRomanized).toBe(true);
    const [line, instrumental] = result!.lyrics.parsedLyrics;
    expect(typeof line.romanizedText).toBe('string');
    expect((line.romanizedText as string).length).toBeGreaterThan(0);
    // The ♪ instrumental line keeps an empty romanization.
    expect(instrumental.romanizedText).toBe('');
  });
});

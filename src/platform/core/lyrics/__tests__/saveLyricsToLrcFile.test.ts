import { beforeEach, describe, expect, jest, test } from '@jest/globals';

jest.mock('@tauri-apps/plugin-fs', () => ({
  readTextFile: jest.fn(),
  writeTextFile: jest.fn()
}));

import { writeTextFile } from '@tauri-apps/plugin-fs';

import saveLyricsToLRCFile, {
  getLrcLyricLinesFromParsedLyrics,
  getLrcLyricsMetadata
} from '../saveLyricsToLrcFile';
import type { LyricsRepository } from '../repository';

const mockWriteTextFile = writeTextFile as jest.Mock<(path: string, data: string) => Promise<void>>;

const makeUserData = (overrides: Partial<UserData> = {}): UserData => ({
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
  recentSearches: [],
  ...overrides
});

const makeRepository = (userData: UserData = makeUserData()): LyricsRepository => ({
  getUserData: () => userData,
  readEmbeddedLyrics: () => Promise.resolve({}),
  writeEmbeddedLyrics: () => Promise.resolve(),
  decrypt: (encrypted) => Promise.resolve(encrypted),
  searchUnsyncedLyrics: () => Promise.resolve(undefined),
  sendMessage: () => undefined,
  emitDataUpdate: () => undefined
});

const makeSongLyrics = (overrides: Partial<SongLyrics> = {}): SongLyrics => ({
  title: 'Halo',
  source: 'MUSIXMATCH',
  lyricsType: 'SYNCED',
  lyrics: {
    isSynced: true,
    isRomanized: false,
    isTranslated: false,
    isReset: false,
    parsedLyrics: [
      {
        originalText: 'Line one',
        translatedTexts: [{ lang: 'ru', text: 'Строка один' }],
        isEnhancedSynced: false,
        start: 62.34
      }
    ],
    unparsedLyrics: '[ti:Halo]\n[00:62.34] Line one'
  },
  isOfflineLyricsAvailable: false,
  ...overrides
});

describe('getLrcLyricsMetadata', () => {
  test('extracts the header fields from the unparsed lyrics', () => {
    const songLyrics = makeSongLyrics({
      lyrics: {
        ...makeSongLyrics().lyrics,
        unparsedLyrics: '[ti:Custom Title]\n[ar:An Artist]\n[al:An Album]\n[lang:en]\n[offset:500]',
        originalLanguage: 'fr'
      }
    });

    const metadata = getLrcLyricsMetadata(songLyrics);
    expect(metadata.title).toBe('Custom Title');
    expect(metadata.artist).toBe('An Artist');
    expect(metadata.album).toBe('An Album');
    expect(metadata.lang).toBe('en');
    // LRC offsets are milliseconds in the header but seconds in the parse.
    expect(metadata.offset).toBe(0.5);
  });

  test('falls back to the song title and original language', () => {
    const metadata = getLrcLyricsMetadata(
      makeSongLyrics({
        lyrics: { ...makeSongLyrics().lyrics, unparsedLyrics: 'just lines', originalLanguage: 'fr' }
      })
    );
    expect(metadata.title).toBe('Halo');
    expect(metadata.lang).toBe('fr');
  });
});

describe('getLrcLyricLinesFromParsedLyrics', () => {
  test('renders synced lines and their translations with timestamps', () => {
    const lines = getLrcLyricLinesFromParsedLyrics(makeSongLyrics().lyrics.parsedLyrics);

    expect(lines).toEqual(['[01:02.34] Line one', '[01:02.34][lang:ru] Строка один']);
  });

  test('renders enhanced-synced lines word by word', () => {
    const lines = getLrcLyricLinesFromParsedLyrics([
      {
        originalText: [
          { text: 'Hel', start: 1, end: 2, unparsedText: 'Hel' },
          { text: 'lo', start: 2.5, end: 3.5, unparsedText: 'lo' }
        ],
        translatedTexts: [],
        isEnhancedSynced: true,
        start: 1
      }
    ]);

    expect(lines).toEqual(['[00:01.0] <00:01.0> Hel <00:02.50> lo']);
  });
});

describe('saveLyricsToLRCFile', () => {
  beforeEach(() => {
    mockWriteTextFile.mockReset();
  });

  test('writes the LRC file next to the song by default', async () => {
    const repository = makeRepository();

    await saveLyricsToLRCFile(repository, 'C:/music/halo.mp3', makeSongLyrics());

    expect(mockWriteTextFile).toHaveBeenCalledTimes(1);
    const [path, content] = mockWriteTextFile.mock.calls[0];
    expect(path).toBe('C:/music\\halo.lrc');
    expect(content).toContain('[re:Nora (https://github.com/Sandakan/Nora)]');
    expect(content).toContain('[ti:Halo]');
    expect(content).toContain('[01:02.34] Line one');
    expect(content).toContain('[01:02.34][lang:ru] Строка один');
  });

  test('writes into the custom LRC location when configured', async () => {
    const repository = makeRepository(
      makeUserData({ customLrcFilesSaveLocation: 'D:/lrc-files' })
    );

    await saveLyricsToLRCFile(repository, 'C:/music/halo.mp3', makeSongLyrics());

    const [path] = mockWriteTextFile.mock.calls[0];
    expect(path).toBe('D:/lrc-files\\halo.lrc');
  });

  test('includes copyright metadata when present', async () => {
    const repository = makeRepository();
    const songLyrics = makeSongLyrics({
      lyrics: {
        ...makeSongLyrics().lyrics,
        copyright: 'Someone Records'
      }
    });

    await saveLyricsToLRCFile(repository, 'C:/music/halo.mp3', songLyrics);

    const [, content] = mockWriteTextFile.mock.calls[0];
    expect(content).toContain('[copyright:Someone Records]');
  });
});

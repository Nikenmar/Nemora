import { describe, expect, jest, test } from '@jest/globals';

jest.mock('@tauri-apps/plugin-fs', () => ({
  readTextFile: jest.fn(),
  writeTextFile: jest.fn()
}));
// saveLyricsToSong pulls in getSongLyrics, which reads build-time env.
jest.mock('../../net/buildEnv', () => ({ getBuildEnvVariable: () => undefined }));

import convertParsedLyricsToNodeID3Format from '../convertParsedLyricsToNodeID3Format';
import saveLyricsToSong, { isLyricsSavePending, savePendingSongLyrics } from '../saveLyricsToSong';
import { getCachedLyrics, updateCachedLyrics } from '../getSongLyrics';
import type { LyricsRepository } from '../repository';

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

interface FakeState {
  userData: UserData;
  embeddedLyrics: Awaited<ReturnType<LyricsRepository['readEmbeddedLyrics']>>;
  writtenTags: Parameters<LyricsRepository['writeEmbeddedLyrics']>[];
  sentMessages: string[];
}

const makeRepository = (state: FakeState): LyricsRepository => ({
  getUserData: () => state.userData,
  readEmbeddedLyrics: () => Promise.resolve(state.embeddedLyrics),
  writeEmbeddedLyrics: (songPath, tags) => {
    state.writtenTags.push([songPath, tags]);
    return Promise.resolve();
  },
  decrypt: (encrypted) => Promise.resolve(encrypted),
  searchUnsyncedLyrics: () => Promise.resolve(undefined),
  sendMessage: (message) => {
    state.sentMessages.push(message.messageCode);
  },
  emitDataUpdate: () => undefined
});

const makeState = (overrides: Partial<FakeState> = {}): FakeState => ({
  userData: makeUserData(),
  embeddedLyrics: {},
  writtenTags: [],
  sentMessages: [],
  ...overrides
});

const SONG_PATH = 'C:/music/halo.mp3';

const makeSyncedLyrics = (): SongLyrics => ({
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
        translatedTexts: [],
        isEnhancedSynced: false,
        start: 62.34
      }
    ],
    unparsedLyrics: '[00:62.34] Line one'
  },
  isOfflineLyricsAvailable: false
});

describe('convertParsedLyricsToNodeID3Format', () => {
  test('converts synced parsed lyrics into the node-id3 synchronised format', () => {
    const converted = convertParsedLyricsToNodeID3Format(makeSyncedLyrics().lyrics);

    expect(converted).toHaveLength(1);
    const [first] = converted!;
    expect(first.language).toBe('ENG');
    expect(first.synchronisedText).toEqual([{ text: 'Line one', timeStamp: 62340 }]);
  });

  test('appends to previous synced lyrics', () => {
    const previous = convertParsedLyricsToNodeID3Format(makeSyncedLyrics().lyrics);
    const converted = convertParsedLyricsToNodeID3Format(makeSyncedLyrics().lyrics, previous);

    expect(converted).toHaveLength(2);
  });

  test('keeps previous lyrics when the input is unsynced', () => {
    const unsynced: LyricsData = {
      ...makeSyncedLyrics().lyrics,
      isSynced: false
    };
    expect(convertParsedLyricsToNodeID3Format(unsynced)).toEqual([]);
    expect(convertParsedLyricsToNodeID3Format(undefined)).toEqual([]);
  });
});

describe('saveLyricsToSong', () => {
  test('queues the embedded-lyrics write for mp3 files without promising the user a save', async () => {
    const state = makeState();
    const repository = makeRepository(state);

    const result = await saveLyricsToSong(repository, SONG_PATH, makeSyncedLyrics());

    expect(result).toBeUndefined();
    expect(isLyricsSavePending('C:/music/halo.mp3')).toBe(true);
    // No LYRICS_SAVE_QUEUED: nothing drains the queue in this build, so telling
    // the user the lyrics "will be saved automatically" was a promise the app
    // does not keep. The queue itself stays, and the LRC message still fires
    // where the file really is written.
    expect(state.sentMessages).not.toContain('LYRICS_SAVE_QUEUED');
  });

  test('writes the pending lyrics later through savePendingSongLyrics', async () => {
    const state = makeState();
    const repository = makeRepository(state);

    await saveLyricsToSong(repository, SONG_PATH, makeSyncedLyrics());
    await savePendingSongLyrics(repository);

    expect(state.writtenTags).toHaveLength(1);
    expect(state.writtenTags[0][0]).toBe('C:/music/halo.mp3');
    expect(state.writtenTags[0][1].title).toBe('Halo');
    expect(state.sentMessages).toContain('PENDING_LYRICS_SAVED');
    expect(isLyricsSavePending('C:/music/halo.mp3')).toBe(false);
  });

  test('keeps the currently playing song pending unless forceSave is set', async () => {
    const state = makeState();
    const repository = makeRepository(state);

    await saveLyricsToSong(repository, SONG_PATH, makeSyncedLyrics());
    await savePendingSongLyrics(repository, 'C:/music/halo.mp3');
    expect(state.writtenTags).toHaveLength(0);

    await savePendingSongLyrics(repository, 'C:/music/halo.mp3', true);
    expect(state.writtenTags).toHaveLength(1);
  });

  test('routes unsupported formats to the LRC file and reports LYRICS_SAVED_IN_LRC_FILE', async () => {
    const state = makeState();
    const repository = makeRepository(state);

    const result = await saveLyricsToSong(repository, 'C:/music/halo.flac', makeSyncedLyrics());

    expect(result).toBeUndefined();
    expect(state.sentMessages).toContain('LYRICS_SAVED_IN_LRC_FILE');
    expect(isLyricsSavePending('C:/music/halo.flac')).toBe(false);
  });

  test('throws when there is nothing to save', async () => {
    const state = makeState();
    const repository = makeRepository(state);

    const emptyLyrics: SongLyrics = {
      ...makeSyncedLyrics(),
      lyrics: { ...makeSyncedLyrics().lyrics, parsedLyrics: [] }
    };

    await expect(saveLyricsToSong(repository, SONG_PATH, emptyLyrics)).rejects.toThrow(
      'No lyrics found to be saved to the song.'
    );
  });

  test('updates the lyrics cache with the in-song source', async () => {
    const state = makeState();
    const repository = makeRepository(state);
    await updateCachedLyrics(() => makeSyncedLyrics());

    await saveLyricsToSong(repository, SONG_PATH, makeSyncedLyrics());

    const cached = getCachedLyrics();
    expect(cached?.source).toBe('IN_SONG_LYRICS');
    expect(cached?.isOfflineLyricsAvailable).toBe(true);
  });
});

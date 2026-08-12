import { jest } from '@jest/globals';

import { joinPath } from '../../transfer/joinPath';
import type { AppDataRepository } from '../appDataRepository';
import type { CoreLogger } from '../../playlists/logger';

export const PROFILE_ROOT = 'C:\\Users\\test\\AppData\\Roaming\\Nora';

export interface MockAppDataState {
  songs: SavableSongData[];
  palettes: PaletteData[];
  artists: SavableArtist[];
  albums: SavableAlbum[];
  genres: SavableGenre[];
  playlists: SavablePlaylist[];
  userData: UserData;
  blacklist: Blacklist;
  listeningData: SongListeningData[];
  cmrStats: CmrStatsData;
}

export interface MockAppDataRepo extends AppDataRepository {
  state: MockAppDataState;
  files: Map<string, string>;
  dirs: Set<string>;
  writes: { path: string; contents: string }[];
  copies: { source: string; destination: string }[];
  removed: { path: string; options?: { recursive?: boolean } }[];
  sendMessageMock: jest.Mock<(messageCode: MessageCodes, data?: MessageToRendererData) => void>;
  restartAppMock: jest.Mock<(reason: string, force?: boolean) => void>;
}

const emptyUserData = (): UserData => ({
  language: 'en',
  theme: { isDarkMode: false, useSystemTheme: true },
  musicFolders: [],
  preferences: {
    autoLaunchApp: false,
    isMiniPlayerAlwaysOnTop: false,
    isMusixmatchLyricsEnabled: false,
    hideWindowOnClose: false,
    openWindowAsHiddenOnSystemStart: false,
    openWindowMaximizedOnStart: false,
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
});

const emptyCmrStats = (): CmrStatsData => ({
  elo: { ratings: {}, history: [], totalDuels: 0 },
  importedStatsExportIds: []
});

const enoent = (path: string): Error & { code: string } =>
  Object.assign(new Error(`ENOENT: no such file or directory, open '${path}'`), { code: 'ENOENT' });

export const createMockAppDataRepo = (
  overrides: Partial<AppDataRepository> = {},
  initialState: Partial<MockAppDataState> = {},
  initialFiles: Record<string, string> = {}
): MockAppDataRepo => {
  const state: MockAppDataState = {
    songs: initialState.songs ?? [],
    palettes: initialState.palettes ?? [],
    artists: initialState.artists ?? [],
    albums: initialState.albums ?? [],
    genres: initialState.genres ?? [],
    playlists: initialState.playlists ?? [],
    userData: initialState.userData ?? emptyUserData(),
    blacklist: initialState.blacklist ?? { songBlacklist: [], folderBlacklist: [] },
    listeningData: initialState.listeningData ?? [],
    cmrStats: initialState.cmrStats ?? emptyCmrStats()
  };

  const files = new Map(Object.entries(initialFiles));
  const dirs = new Set<string>();
  const writes: { path: string; contents: string }[] = [];
  const copies: { source: string; destination: string }[] = [];
  const removed: { path: string; options?: { recursive?: boolean } }[] = [];

  const sendMessageMock =
    jest.fn<(messageCode: MessageCodes, data?: MessageToRendererData) => void>();
  const restartAppMock = jest.fn<(reason: string, force?: boolean) => void>();

  const repo: MockAppDataRepo = {
    state,
    files,
    dirs,
    writes,
    copies,
    removed,
    sendMessageMock,
    restartAppMock,
    getSongsData: () => state.songs,
    setSongsData: (songs) => {
      state.songs = songs;
    },
    getPaletteData: () => state.palettes,
    setPaletteData: (palettes) => {
      state.palettes = palettes;
    },
    getArtistsData: () => state.artists,
    setArtistsData: (artists) => {
      state.artists = artists;
    },
    getAlbumsData: () => state.albums,
    setAlbumsData: (albums) => {
      state.albums = albums;
    },
    getGenresData: () => state.genres,
    setGenresData: (genres) => {
      state.genres = genres;
    },
    getPlaylistData: () => state.playlists,
    setPlaylistData: (playlists) => {
      state.playlists = playlists;
    },
    getUserData: () => state.userData,
    saveUserData: (userData) => {
      state.userData = userData;
    },
    getBlacklistData: () => state.blacklist,
    setBlacklist: (blacklist) => {
      state.blacklist = blacklist;
    },
    getListeningData: () => state.listeningData,
    saveListeningData: (data) => {
      state.listeningData = data;
    },
    getCmrStatsData: () => state.cmrStats,
    setCmrStatsData: (data) => {
      state.cmrStats = data;
    },
    profilePath: async (...segments) => joinPath(PROFILE_ROOT, ...segments),
    readTextFile: async (path) => {
      const contents = files.get(path);
      if (contents === undefined) throw enoent(path);
      return contents;
    },
    readDir: async (path) => {
      if (!dirs.has(path)) throw enoent(path);
      const prefix = path.endsWith('\\') || path.endsWith('/') ? path : `${path}\\`;
      const names = new Set<string>();
      for (const filePath of files.keys()) {
        if (filePath.startsWith(prefix)) {
          const rest = filePath.slice(prefix.length);
          const name = rest.split(/[\\/]/)[0];
          if (name) names.add(name);
        }
      }
      for (const dirPath of dirs.keys()) {
        if (dirPath.startsWith(prefix)) {
          const rest = dirPath.slice(prefix.length);
          const name = rest.split(/[\\/]/)[0];
          if (name) names.add(name);
        }
      }
      return [...names].map((name) => {
        const full = `${prefix}${name}`;
        return { name, isDirectory: dirs.has(full) };
      });
    },
    writeTextFileAtomic: async (path, contents) => {
      writes.push({ path, contents });
      files.set(path, contents);
    },
    makeDir: async (path) => {
      if (dirs.has(path)) return { exist: true };
      dirs.add(path);
      return { exist: false };
    },
    copyFile: async (source, destination) => {
      copies.push({ source, destination });
      const contents = files.get(source);
      if (contents === undefined) throw enoent(source);
      files.set(destination, contents);
    },
    remove: async (path, options) => {
      removed.push({ path, options });
      if (!files.has(path) && !dirs.has(path)) throw enoent(path);
      files.delete(path);
      dirs.delete(path);
    },
    sendMessage: sendMessageMock,
    restartApp: restartAppMock,
    logger: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    } as unknown as CoreLogger,
    ...overrides
  };

  return repo;
};

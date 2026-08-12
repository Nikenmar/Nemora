import { jest } from '@jest/globals';

import { joinPath } from '../joinPath';
import type { StatsTransferRepository } from '../statsTransferRepository';
import type { CoreLogger } from '../../playlists/logger';

export const PROFILE_ROOT = 'C:\\Users\\test\\AppData\\Roaming\\Nora';

export const createSong = (
  songId: string,
  overrides: Partial<SavableSongData> = {}
): SavableSongData => ({
  songId,
  title: `Song ${songId}`,
  duration: 200,
  isAFavorite: false,
  isArtworkAvailable: false,
  path: `D:\\Library\\${songId}.mp3`,
  addedDate: 1,
  ...overrides
});

export const createListeningEntry = (
  songId: string,
  overrides: Partial<SongListeningData> = {}
): SongListeningData => ({
  songId,
  listens: [],
  ...overrides
});

export const createPlaylist = (
  playlistId: string,
  overrides: Partial<SavablePlaylist> = {}
): SavablePlaylist => ({
  playlistId,
  name: playlistId,
  createdDate: new Date('2024-01-01T00:00:00Z'),
  songs: [],
  isArtworkAvailable: false,
  ...overrides
});

export const createTierlist = (
  tierlistId: string,
  overrides: Partial<SavableTierlist> = {}
): SavableTierlist => ({
  tierlistId,
  name: `Tierlist ${tierlistId}`,
  createdDate: new Date('2024-01-01T00:00:00Z'),
  sourcePlaylistIds: [],
  tiers: [],
  labelMode: 'track',
  ...overrides
});

const emptyCmrStats = (): CmrStatsData => ({
  elo: { ratings: {}, history: [], totalDuels: 0 },
  importedStatsExportIds: []
});

export interface MockTransferState {
  songs: SavableSongData[];
  listeningData: SongListeningData[];
  playlists: SavablePlaylist[];
  tierlists: SavableTierlist[];
  cmrStats: CmrStatsData;
}

export interface MockTransferRepo extends StatsTransferRepository {
  state: MockTransferState;
  /** All files "on disk" (used by readTextFile / exists / copyFile). */
  files: Map<string, string>;
  /** Folders created through makeDir. */
  dirs: Set<string>;
  /** Ordered side-effect log for ordering assertions (backup before write). */
  events: string[];
  writes: { path: string; contents: string }[];
  saveListeningDataMock: jest.Mock<(data: SongListeningData[]) => void>;
  setCmrStatsDataMock: jest.Mock<(data: CmrStatsData) => void>;
  emitDataUpdateMock: jest.Mock<
    (dataType: DataUpdateEventTypes, data?: string[], message?: string) => void
  >;
}

const enoent = (path: string): Error & { code: string } =>
  Object.assign(new Error(`ENOENT: no such file or directory, open '${path}'`), { code: 'ENOENT' });

export const createMockTransferRepo = (
  overrides: Partial<StatsTransferRepository> = {},
  initialState: Partial<MockTransferState> = {},
  initialFiles: Record<string, string> = {}
): MockTransferRepo => {
  const state: MockTransferState = {
    songs: initialState.songs ?? [],
    listeningData: initialState.listeningData ?? [],
    playlists: initialState.playlists ?? [],
    tierlists: initialState.tierlists ?? [],
    cmrStats: initialState.cmrStats ?? emptyCmrStats()
  };

  const files = new Map(Object.entries(initialFiles));
  const dirs = new Set<string>();
  const events: string[] = [];
  const writes: { path: string; contents: string }[] = [];

  const saveListeningDataMock = jest.fn<(data: SongListeningData[]) => void>((data) => {
    events.push('saveListeningData');
    state.listeningData = data;
  });
  const setCmrStatsDataMock = jest.fn<(data: CmrStatsData) => void>((data) => {
    events.push('setCmrStatsData');
    state.cmrStats = data;
  });
  const emitDataUpdateMock = jest.fn<
    (dataType: DataUpdateEventTypes, data?: string[], message?: string) => void
  >((dataType) => {
    events.push(`emitDataUpdate:${dataType}`);
  });

  const repo: MockTransferRepo = {
    state,
    files,
    dirs,
    events,
    writes,
    saveListeningDataMock,
    setCmrStatsDataMock,
    emitDataUpdateMock,
    getSongsData: () => state.songs,
    getListeningData: () => state.listeningData,
    saveListeningData: saveListeningDataMock,
    getPlaylistData: (playlistIds?: string[]) => {
      if (!playlistIds || playlistIds.length === 0) return state.playlists;
      return state.playlists.filter((playlist) => playlistIds.includes(playlist.playlistId));
    },
    setPlaylistData: (playlists) => {
      events.push('setPlaylistData');
      state.playlists = playlists;
    },
    getTierlistData: () => state.tierlists,
    setTierlistData: (tierlists) => {
      events.push('setTierlistData');
      state.tierlists = tierlists;
    },
    getCmrStatsData: () => state.cmrStats,
    setCmrStatsData: setCmrStatsDataMock,
    profilePath: async (...segments) => joinPath(PROFILE_ROOT, ...segments),
    readTextFile: async (path) => {
      const contents = files.get(path);
      if (contents === undefined) throw enoent(path);
      return contents;
    },
    writeTextFileAtomic: async (path, contents) => {
      writes.push({ path, contents });
      files.set(path, contents);
    },
    exists: async (path) => files.has(path) || dirs.has(path),
    makeDir: async (path) => {
      if (dirs.has(path)) return { exist: true };
      dirs.add(path);
      return { exist: false };
    },
    copyFile: async (source, destination) => {
      events.push(`copyFile:${destination}`);
      const contents = files.get(source);
      if (contents === undefined) throw enoent(source);
      files.set(destination, contents);
    },
    emitDataUpdate: emitDataUpdateMock,
    appVersion: '3.4.5-CMR-Fork',
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

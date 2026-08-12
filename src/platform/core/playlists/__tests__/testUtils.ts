import { jest } from '@jest/globals';

import type { PlaylistsRepository } from '../playlistRepository';
import type { BlacklistRepository } from '../../blacklist/blacklistRepository';
import { PLAYLIST_DATA_TEMPLATE } from '../playlistTemplates';

export const createSong = (
  songId: string,
  overrides: Partial<SavableSongData> = {}
): SavableSongData => ({
  songId,
  title: `Song ${songId}`,
  duration: 180,
  isAFavorite: false,
  isArtworkAvailable: false,
  path: `E:\\Music\\${songId}.mp3`,
  addedDate: 1,
  ...overrides
});

export const createArtist = (
  artistId: string,
  overrides: Partial<SavableArtist> = {}
): SavableArtist => ({
  artistId,
  songs: [],
  name: `Artist ${artistId}`,
  isAFavorite: false,
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

const artworkPathsFor = (id: string): ArtworkPaths => ({
  isDefaultArtwork: false,
  artworkPath: `nemora://localfiles/song_covers/${id}.webp`,
  optimizedArtworkPath: `nemora://localfiles/song_covers/${id}-optimized.webp`
});

export interface MockPlaylistsState {
  playlists: SavablePlaylist[];
  songs: SavableSongData[];
  artists: SavableArtist[];
  blacklist: Blacklist;
}

export interface MockPlaylistsRepo extends PlaylistsRepository {
  state: MockPlaylistsState;
  setPlaylistsMock: jest.Mock<(playlists: SavablePlaylist[]) => void>;
  setSongsMock: jest.Mock<(songs: SavableSongData[]) => void>;
  setArtistsMock: jest.Mock<(artists: SavableArtist[]) => void>;
  setBlacklistMock: jest.Mock<(blacklist: Blacklist) => void>;
  emitDataUpdateMock: jest.Mock<
    (dataType: DataUpdateEventTypes, data?: string[], message?: string) => void
  >;
  sendMessageMock: jest.Mock<(messageCode: MessageCodes, data?: MessageToRendererData) => void>;
}

export const createMockPlaylistsRepo = (
  overrides: Partial<PlaylistsRepository> = {},
  initialState: Partial<MockPlaylistsState> = {}
): MockPlaylistsRepo => {
  const state: MockPlaylistsState = {
    playlists: initialState.playlists ?? PLAYLIST_DATA_TEMPLATE.map((p) => ({ ...p })),
    songs: initialState.songs ?? [],
    artists: initialState.artists ?? [],
    blacklist: initialState.blacklist ?? { songBlacklist: [], folderBlacklist: [] }
  };

  const setPlaylistsMock = jest.fn<(playlists: SavablePlaylist[]) => void>((playlists) => {
    state.playlists = playlists;
  });
  const setSongsMock = jest.fn<(songs: SavableSongData[]) => void>((songs) => {
    state.songs = songs;
  });
  const setArtistsMock = jest.fn<(artists: SavableArtist[]) => void>((artists) => {
    state.artists = artists;
  });
  const setBlacklistMock = jest.fn<(blacklist: Blacklist) => void>((blacklist) => {
    state.blacklist = blacklist;
  });
  const emitDataUpdateMock =
    jest.fn<(dataType: DataUpdateEventTypes, data?: string[], message?: string) => void>();
  const sendMessageMock =
    jest.fn<(messageCode: MessageCodes, data?: MessageToRendererData) => void>();

  const repo: MockPlaylistsRepo = {
    state,
    setPlaylistsMock,
    setSongsMock,
    setArtistsMock,
    setBlacklistMock,
    emitDataUpdateMock,
    sendMessageMock,
    getPlaylists: (playlistIds?: string[]) => {
      if (!playlistIds || playlistIds.length === 0) return state.playlists;
      return state.playlists.filter((playlist) => playlistIds.includes(playlist.playlistId));
    },
    setPlaylists: setPlaylistsMock,
    getSongs: () => state.songs,
    setSongs: setSongsMock,
    getArtists: () => state.artists,
    setArtists: setArtistsMock,
    getBlacklist: () => state.blacklist,
    setBlacklist: setBlacklistMock,
    storePlaylistArtwork: jest.fn(async (playlistId: string, artworkPath?: string) =>
      artworkPath
        ? artworkPathsFor(playlistId)
        : {
            isDefaultArtwork: true,
            artworkPath: 'nemora://localfiles/playlist_default.webp',
            optimizedArtworkPath: 'nemora://localfiles/playlist_default.webp'
          }
    ),
    removePlaylistArtwork: jest.fn(async () => undefined),
    getPlaylistArtworkPath: jest.fn((playlistId: string, isArtworkAvailable: boolean) =>
      isArtworkAvailable
        ? artworkPathsFor(playlistId)
        : {
            isDefaultArtwork: true,
            artworkPath: 'nemora://localfiles/playlist_default.webp',
            optimizedArtworkPath: 'nemora://localfiles/playlist_default.webp'
          }
    ),
    getSongArtworkPath: jest.fn((songId: string, isArtworkAvailable?: boolean) =>
      isArtworkAvailable
        ? artworkPathsFor(songId)
        : {
            isDefaultArtwork: true,
            artworkPath: 'nemora://localfiles/song_default.webp',
            optimizedArtworkPath: 'nemora://localfiles/song_default.webp'
          }
    ),
    getArtistArtworkPath: jest.fn((artworkName?: string) =>
      artworkName
        ? artworkPathsFor(artworkName)
        : {
            isDefaultArtwork: true,
            artworkPath: 'nemora://localfiles/artist_default.webp',
            optimizedArtworkPath: 'nemora://localfiles/artist_default.webp'
          }
    ),
    resetArtworkCache: jest.fn(),
    addAFavoriteToLastFM: jest.fn(),
    removeAFavoriteFromLastFM: jest.fn(),
    emitDataUpdate: emitDataUpdateMock,
    sendMessage: sendMessageMock,
    ...overrides
  };

  return repo;
};

export interface MockBlacklistRepo extends BlacklistRepository {
  state: MockPlaylistsState;
  setBlacklistMock: jest.Mock<(blacklist: Blacklist) => void>;
  getSongInfoMock: jest.Mock<(songIds: string[]) => Promise<SongData[]>>;
  emitDataUpdateMock: jest.Mock<
    (dataType: DataUpdateEventTypes, data?: string[], message?: string) => void
  >;
  sendMessageMock: jest.Mock<(messageCode: MessageCodes, data?: MessageToRendererData) => void>;
}

export const createMockBlacklistRepo = (
  overrides: Partial<BlacklistRepository> = {},
  initialState: Partial<MockPlaylistsState> = {}
): MockBlacklistRepo => {
  const state: MockPlaylistsState = {
    playlists: initialState.playlists ?? [],
    songs: initialState.songs ?? [],
    artists: initialState.artists ?? [],
    blacklist: initialState.blacklist ?? { songBlacklist: [], folderBlacklist: [] }
  };

  const setBlacklistMock = jest.fn<(blacklist: Blacklist) => void>((blacklist) => {
    state.blacklist = blacklist;
  });
  const getSongInfoMock = jest.fn<(songIds: string[]) => Promise<SongData[]>>(async (songIds) =>
    state.songs
      .filter((song) => songIds.includes(song.songId))
      .map((song) => ({
        ...song,
        artworkPaths: artworkPathsFor(song.songId),
        isBlacklisted: false
      }))
  );
  const emitDataUpdateMock =
    jest.fn<(dataType: DataUpdateEventTypes, data?: string[], message?: string) => void>();
  const sendMessageMock =
    jest.fn<(messageCode: MessageCodes, data?: MessageToRendererData) => void>();

  const repo: MockBlacklistRepo = {
    state,
    setBlacklistMock,
    getSongInfoMock,
    emitDataUpdateMock,
    sendMessageMock,
    getBlacklist: () => state.blacklist,
    setBlacklist: setBlacklistMock,
    getSongInfo: getSongInfoMock,
    emitDataUpdate: emitDataUpdateMock,
    sendMessage: sendMessageMock,
    ...overrides
  };

  return repo;
};

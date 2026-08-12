import { beforeEach, describe, expect, jest, test } from '@jest/globals';

const addNewPlaylistMock = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const createTierlistArtworksMock = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const getSongLyricsMock = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const importStatsMock = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const getArtistDuplicatesMock = jest.fn<(...args: unknown[]) => unknown>();
const toggleLikeSongsMock = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const saveUserDataMock = jest.fn<(...args: unknown[]) => void>();

jest.mock('../../runtime', () => ({
  getRuntime: () => ({
    addNewPlaylist: addNewPlaylistMock,
    createTierlistArtworks: createTierlistArtworksMock,
    getSongLyrics: getSongLyricsMock,
    importStats: importStatsMock,
    getArtistDuplicates: getArtistDuplicatesMock,
    toggleLikeSongs: toggleLikeSongsMock,
    saveUserData: saveUserDataMock,
    getDiscordClientId: () => undefined,
    getUserData: () => ({ preferences: {} })
  })
}));

import { artistsData } from '../artists-data';
import { lyrics } from '../lyrics';
import { playerControls } from '../player-controls';
import { playlistsData } from '../playlists-data';
import { statsData } from '../stats-data';
import { suggestions } from '../suggestions';
import { tierlistsData } from '../tierlists-data';

beforeEach(() => jest.clearAllMocks());

describe('newly composed API channels', () => {
  test('forwards playlist creation arguments and its Promise result', async () => {
    const result = { success: true, playlist: { playlistId: 'new' } };
    addNewPlaylistMock.mockResolvedValue(result);

    await expect(playlistsData.addNewPlaylist('Mix', ['song'], 'E:\\cover.png')).resolves.toBe(
      result
    );
    expect(addNewPlaylistMock).toHaveBeenCalledWith('Mix', ['song'], 'E:\\cover.png');
  });

  test('forwards tierlist thumbnail ids without changing the returned map', async () => {
    const result = { song: 'nemora://thumbnail' };
    createTierlistArtworksMock.mockResolvedValue(result);

    await expect(tierlistsData.getTierlistArtworks(['song'])).resolves.toBe(result);
    expect(createTierlistArtworksMock).toHaveBeenCalledWith(['song']);
  });

  test('preserves all optional lyrics arguments in order', async () => {
    getSongLyricsMock.mockResolvedValue(undefined);
    const song: LyricsRequestTrackInfo = {
      songPath: 'E:\\song.mp3',
      songTitle: 'Song',
      songArtists: ['Artist'],
      duration: 180
    };

    await lyrics.getSongLyrics(song, 'SYNCED', 'ONLINE_ONLY', 'SYNCED_OR_UN_SYNCED');
    expect(getSongLyricsMock).toHaveBeenCalledWith(
      song,
      'SYNCED',
      'ONLINE_ONLY',
      'SYNCED_OR_UN_SYNCED'
    );
  });

  test('forwards both stats import discriminants', async () => {
    const report = { success: true, matchedSongs: 1 };
    importStatsMock.mockResolvedValue(report);

    await expect(statsData.importStatsData('sameOrigin', 'file')).resolves.toBe(report);
    expect(importStatsMock).toHaveBeenCalledWith('sameOrigin', 'file');
  });

  test('wraps synchronous artist lookup in the existing Promise API', async () => {
    const artists = [{ artistId: 'artist' }];
    getArtistDuplicatesMock.mockReturnValue(artists);

    expect(artistsData.getArtistData).toBeDefined();
    expect(artistsData.getArtistArtworks).toBeDefined();
    await expect(suggestions.getArtistDuplicates('Beyonce')).resolves.toBe(artists);
    expect(getArtistDuplicatesMock).toHaveBeenCalledWith('Beyonce');
  });

  test('keeps the player position channel synchronous and the like channel asynchronous', async () => {
    toggleLikeSongsMock.mockResolvedValue({ likes: ['song'], dislikes: [] });

    expect(playerControls.sendSongPosition(42)).toBeUndefined();
    expect(saveUserDataMock).toHaveBeenCalledWith('currentSong.stoppedPosition', 42);
    await expect(playerControls.toggleLikeSongs(['song'], true)).resolves.toEqual({
      likes: ['song'],
      dislikes: []
    });
    expect(toggleLikeSongsMock).toHaveBeenCalledWith(['song'], true);
  });
});

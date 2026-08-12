import { beforeEach, describe, expect, jest, test } from '@jest/globals';

const updateSongId3Tags = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const reParseSong = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const isMetadataUpdatesPending = jest.fn<(...args: unknown[]) => boolean>();
const resolveArtistDuplicates = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const resolveSeparateArtists = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const resolveFeaturingArtists = jest.fn<(...args: unknown[]) => Promise<unknown>>();

jest.mock('@tauri-apps/plugin-dialog', () => ({ open: jest.fn(), save: jest.fn() }));
jest.mock('../../runtime', () => ({
  getRuntime: () => ({
    updateSongId3Tags,
    reParseSong,
    isMetadataUpdatesPending,
    resolveArtistDuplicates,
    resolveSeparateArtists,
    resolveFeaturingArtists
  })
}));

import { songUpdates } from '../song-updates';
import { suggestions } from '../suggestions';

beforeEach(() => jest.clearAllMocks());

describe('metadata API wiring', () => {
  test('preserves all update-song arguments and its Promise result', async () => {
    const tags = { title: 'Song', duration: 10 } as SongTags;
    const result = { success: true };
    updateSongId3Tags.mockResolvedValue(result);

    await expect(songUpdates.updateSongId3Tags('song', tags, true, false)).resolves.toBe(result);
    expect(updateSongId3Tags).toHaveBeenCalledWith('song', tags, true, false);
  });

  test('keeps reparse asynchronous and pending-state lookup synchronous inside its Promise API', async () => {
    const parsed = { songId: 'song' };
    reParseSong.mockResolvedValue(parsed);
    isMetadataUpdatesPending.mockReturnValue(true);

    await expect(songUpdates.reParseSong('E:\\Song.mp3')).resolves.toBe(parsed);
    await expect(songUpdates.isMetadataUpdatesPending('E:\\Song.mp3')).resolves.toBe(true);
    expect(reParseSong).toHaveBeenCalledWith('E:\\Song.mp3');
    expect(isMetadataUpdatesPending).toHaveBeenCalledWith('E:\\Song.mp3');
  });

  test('forwards every duplicate-resolution argument without reshaping it', async () => {
    resolveArtistDuplicates.mockResolvedValue(undefined);
    resolveSeparateArtists.mockResolvedValue(undefined);
    resolveFeaturingArtists.mockResolvedValue(undefined);

    await suggestions.resolveArtistDuplicates('selected', ['duplicate']);
    await suggestions.resolveSeparateArtists('combined', ['One', 'Two']);
    await suggestions.resolveFeaturingArtists('song', ['Guest'], true);

    expect(resolveArtistDuplicates).toHaveBeenCalledWith('selected', ['duplicate']);
    expect(resolveSeparateArtists).toHaveBeenCalledWith('combined', ['One', 'Two']);
    expect(resolveFeaturingArtists).toHaveBeenCalledWith('song', ['Guest'], true);
  });
});

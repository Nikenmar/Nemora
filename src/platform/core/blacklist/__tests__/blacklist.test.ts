import { describe, expect, test } from '@jest/globals';

import blacklistFolders from '../blacklistFolders';
import blacklistSongs from '../blacklistSongs';
import {
  isFolderBlacklisted,
  isParentFolderBlacklisted,
  isSongBlacklisted
} from '../isBlacklisted';
import restoreBlacklistedFolders from '../restoreBlacklistedFolder';
import restoreBlacklistedSongs from '../restoreBlacklistedSongs';
import toggleBlacklistFolders from '../toggleBlacklistFolders';
import { createMockBlacklistRepo, createSong } from '../../playlists/__tests__/testUtils';

describe('blacklistFolders', () => {
  test('adds folders and deduplicates', () => {
    const repo = createMockBlacklistRepo(undefined, {
      blacklist: { songBlacklist: [], folderBlacklist: ['E:\\Music\\A'] }
    });

    blacklistFolders(repo, ['E:\\Music\\A', 'E:\\Music\\B']);

    expect(repo.state.blacklist.folderBlacklist).toEqual(['E:\\Music\\A', 'E:\\Music\\B']);
    expect(repo.emitDataUpdateMock).toHaveBeenCalledWith('blacklist/folderBlacklist');
  });
});

describe('blacklistSongs', () => {
  test('adds songs and deduplicates', () => {
    const repo = createMockBlacklistRepo(undefined, {
      blacklist: { songBlacklist: ['s1'], folderBlacklist: [] }
    });

    blacklistSongs(repo, ['s1', 's2']);

    expect(repo.state.blacklist.songBlacklist).toEqual(['s1', 's2']);
    expect(repo.emitDataUpdateMock).toHaveBeenCalledWith('blacklist/songBlacklist');
  });
});

describe('toggleBlacklistFolders', () => {
  test('toggles blacklist state per folder', async () => {
    const repo = createMockBlacklistRepo(undefined, {
      blacklist: { songBlacklist: [], folderBlacklist: ['E:\\Music\\A'] }
    });

    const result = await toggleBlacklistFolders(repo, ['E:\\Music\\A', 'E:\\Music\\B']);

    expect(result).toEqual({ blacklists: ['E:\\Music\\B'], whitelists: ['E:\\Music\\A'] });
    expect(repo.state.blacklist.folderBlacklist).toEqual(['E:\\Music\\B']);
    expect(repo.emitDataUpdateMock).toHaveBeenCalledWith('blacklist/folderBlacklist', [
      'E:\\Music\\B',
      'E:\\Music\\A'
    ]);
  });

  test('blacklists folders with an explicit flag, ignoring already-blacklisted ones', async () => {
    const repo = createMockBlacklistRepo(undefined, {
      blacklist: { songBlacklist: [], folderBlacklist: ['E:\\Music\\A'] }
    });

    const result = await toggleBlacklistFolders(repo, ['E:\\Music\\A', 'E:\\Music\\B'], true);

    expect(result).toEqual({ blacklists: ['E:\\Music\\B'], whitelists: [] });
    expect(repo.state.blacklist.folderBlacklist).toEqual(['E:\\Music\\A', 'E:\\Music\\B']);
  });

  test('whitelists folders with an explicit flag', async () => {
    const repo = createMockBlacklistRepo(undefined, {
      blacklist: { songBlacklist: [], folderBlacklist: ['E:\\Music\\A'] }
    });

    const result = await toggleBlacklistFolders(repo, ['E:\\Music\\A', 'E:\\Music\\B'], false);

    expect(result).toEqual({ blacklists: [], whitelists: ['E:\\Music\\A'] });
    expect(repo.state.blacklist.folderBlacklist).toEqual([]);
  });
});

describe('restoreBlacklistedFolders', () => {
  test('removes the folders from the blacklist', async () => {
    const repo = createMockBlacklistRepo(undefined, {
      blacklist: { songBlacklist: [], folderBlacklist: ['E:\\Music\\A', 'E:\\Music\\B'] }
    });

    await restoreBlacklistedFolders(repo, ['E:\\Music\\A']);

    expect(repo.state.blacklist.folderBlacklist).toEqual(['E:\\Music\\B']);
    expect(repo.emitDataUpdateMock).toHaveBeenCalledWith('blacklist/folderBlacklist');
  });

  test('warns when the parent folder is still blacklisted', async () => {
    const repo = createMockBlacklistRepo(undefined, {
      blacklist: { songBlacklist: [], folderBlacklist: ['E:\\Music', 'E:\\Music\\Sub'] }
    });

    await restoreBlacklistedFolders(repo, ['E:\\Music\\Sub']);

    expect(repo.sendMessageMock).toHaveBeenCalledWith(
      'WHITELISTING_FOLDER_FAILED_DUE_TO_BLACKLISTED_PARENT_FOLDER',
      {
        folderName: 'Sub',
        parentFolderName: 'E:\\Music'
      }
    );
    expect(repo.state.blacklist.folderBlacklist).toEqual(['E:\\Music']);
  });

  test('restores a parent and child together without warnings', async () => {
    const repo = createMockBlacklistRepo(undefined, {
      blacklist: { songBlacklist: [], folderBlacklist: ['E:\\Music', 'E:\\Music\\Sub'] }
    });

    await restoreBlacklistedFolders(repo, ['E:\\Music', 'E:\\Music\\Sub']);

    expect(repo.sendMessageMock).not.toHaveBeenCalled();
    expect(repo.state.blacklist.folderBlacklist).toEqual([]);
  });

  test('understands forward-slash paths in the warning data', async () => {
    const repo = createMockBlacklistRepo(undefined, {
      blacklist: { songBlacklist: [], folderBlacklist: ['E:/Music', 'E:/Music/Sub'] }
    });

    await restoreBlacklistedFolders(repo, ['E:/Music/Sub']);

    expect(repo.sendMessageMock).toHaveBeenCalledWith(
      'WHITELISTING_FOLDER_FAILED_DUE_TO_BLACKLISTED_PARENT_FOLDER',
      {
        folderName: 'Sub',
        parentFolderName: 'E:/Music'
      }
    );
  });
});

describe('restoreBlacklistedSongs', () => {
  test('removes songs from the blacklist and confirms the count', async () => {
    const repo = createMockBlacklistRepo(undefined, {
      blacklist: { songBlacklist: ['s1', 's2', 's3'], folderBlacklist: [] }
    });

    await restoreBlacklistedSongs(repo, ['s1', 's2']);

    expect(repo.state.blacklist.songBlacklist).toEqual(['s3']);
    expect(repo.sendMessageMock).toHaveBeenCalledWith('SONG_WHITELISTED', { count: 2 });
    expect(repo.emitDataUpdateMock).toHaveBeenCalledWith('blacklist/songBlacklist', ['s1', 's2']);
  });

  test('warns about songs that stay blacklisted through their directory', async () => {
    const songs = [
      createSong('s1', { title: 'Track One', path: 'E:\\Music\\Black\\one.mp3' }),
      createSong('s2', { title: 'Track Two', path: 'E:\\Music\\other\\two.mp3' })
    ];
    const repo = createMockBlacklistRepo(undefined, {
      songs,
      blacklist: { songBlacklist: [], folderBlacklist: ['E:\\Music\\Black'] }
    });
    repo.getSongInfoMock.mockImplementation(async (songIds: string[]) =>
      songs
        .filter((song) => songIds.includes(song.songId))
        .map((song) => ({
          ...song,
          artworkPaths: {
            isDefaultArtwork: false,
            artworkPath: 'nemora://localfiles/x.webp',
            optimizedArtworkPath: 'nemora://localfiles/x.webp'
          },
          isBlacklisted: song.path.includes('Black')
        }))
    );

    await restoreBlacklistedSongs(repo, ['s1', 's2']);

    expect(repo.sendMessageMock).toHaveBeenCalledWith(
      'WHITELISTING_SONG_FAILED_DUE_TO_BLACKLISTED_DIRECTORY',
      {
        songName: 'Track One',
        directoryName: 'Black'
      }
    );
    // Neither id was on the song blacklist, so no SONG_WHITELISTED confirmation
    // fires - exactly like the Electron build.
    expect(repo.sendMessageMock).not.toHaveBeenCalledWith('SONG_WHITELISTED', expect.anything());
    expect(repo.getSongInfoMock).toHaveBeenCalledWith(['s1', 's2']);
  });

  test('skips the song-info lookup when every id was blacklisted', async () => {
    const repo = createMockBlacklistRepo(undefined, {
      blacklist: { songBlacklist: ['s1'], folderBlacklist: [] }
    });

    await restoreBlacklistedSongs(repo, ['s1']);

    expect(repo.getSongInfoMock).not.toHaveBeenCalled();
    expect(repo.sendMessageMock).toHaveBeenCalledWith('SONG_WHITELISTED', { count: 1 });
  });
});

describe('isBlacklisted queries', () => {
  const repoWith = (folderBlacklist: string[], songBlacklist: string[] = []) =>
    createMockBlacklistRepo(undefined, { blacklist: { songBlacklist, folderBlacklist } });

  test('isParentFolderBlacklisted compares against the exact parent', () => {
    const repo = repoWith(['E:\\Music\\Sub']);

    expect(isParentFolderBlacklisted(repo, 'E:\\Music\\Sub\\Nested')).toBe(true);
    expect(isParentFolderBlacklisted(repo, 'E:\\Music\\Other')).toBe(false);
  });

  test('isFolderBlacklisted normalizes separators before matching', () => {
    const repo = repoWith(['E:\\Music\\Sub']);

    expect(isFolderBlacklisted(repo, 'E:/Music/Sub/')).toBe(true);
    expect(isFolderBlacklisted(repo, 'E:\\Music\\Sub\\Nested')).toBe(true);
    expect(isFolderBlacklisted(repo, 'E:\\Music\\Other')).toBe(false);
  });

  test('isSongBlacklisted matches song ids and folder prefixes', () => {
    const repo = repoWith(['E:\\Music\\Sub'], ['s9']);

    expect(isSongBlacklisted(repo, 's1', 'E:\\Music\\Sub\\a.mp3')).toBe(true);
    expect(isSongBlacklisted(repo, 's1', 'E:\\Music\\Other\\a.mp3')).toBe(false);
    expect(isSongBlacklisted(repo, 's9', 'E:\\Music\\Other\\a.mp3')).toBe(true);
    expect(isSongBlacklisted(repo, 's1', 'E:/Music/Sub/a.mp3')).toBe(true);
  });
});

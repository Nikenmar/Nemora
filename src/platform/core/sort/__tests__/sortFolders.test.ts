import { describe, expect, test } from '@jest/globals';

import type { BlacklistRepository } from '../../filters/repository';
import sortFolders from '../sortFolders';

const makeFolder = (
  path: string,
  songIds: string[] = [],
  subFolders: MusicFolder[] = []
): MusicFolder => ({
  path,
  stats: {
    lastModifiedDate: new Date(),
    lastChangedDate: new Date(),
    fileCreatedDate: new Date(),
    lastParsedDate: new Date()
  },
  subFolders,
  songIds,
  isBlacklisted: false
});

const pathsOf = (folders: MusicFolder[]) => folders.map(({ path }) => path);

const blacklistRepository: BlacklistRepository = {
  isSongBlacklisted: () => false,
  getFolderBlacklist: () => ['C:/black']
};

describe('sortFolders', () => {
  test('sorts folders aToZ and recurses into subfolders', () => {
    const data = [
      makeFolder('C:/z-folder', [], [
        makeFolder('C:/z-folder/b', ['s1']),
        makeFolder('C:/z-folder/a', ['s2'])
      ]),
      makeFolder('C:/a-folder', ['s3'], [makeFolder('C:/a-folder/y', ['s4'])])
    ];

    const sorted = sortFolders(blacklistRepository, data, 'aToZ');
    expect(pathsOf(sorted)).toEqual(['C:/a-folder', 'C:/z-folder']);
    expect(pathsOf(sorted[1].subFolders)).toEqual(['C:/z-folder/a', 'C:/z-folder/b']);
  });

  test('zToA reverses both levels', () => {
    const data = [
      makeFolder('C:/a-folder', [], [makeFolder('C:/a-folder/b'), makeFolder('C:/a-folder/a')]),
      makeFolder('C:/z-folder', [])
    ];

    const sorted = sortFolders(blacklistRepository, data, 'zToA');
    expect(pathsOf(sorted)).toEqual(['C:/z-folder', 'C:/a-folder']);
    expect(pathsOf(sorted[1].subFolders)).toEqual(['C:/a-folder/b', 'C:/a-folder/a']);
  });

  test('noOfSongsAscending and noOfSongsDescending break ties alphabetically', () => {
    const data = [
      makeFolder('C:/two', ['s1', 's2']),
      makeFolder('C:/four', ['s1', 's2', 's3', 's4']),
      makeFolder('C:/one', ['s1'])
    ];

    expect(pathsOf(sortFolders(blacklistRepository, data, 'noOfSongsAscending'))).toEqual([
      'C:/one',
      'C:/two',
      'C:/four'
    ]);
    expect(pathsOf(sortFolders(blacklistRepository, data, 'noOfSongsDescending'))).toEqual([
      'C:/four',
      'C:/two',
      'C:/one'
    ]);
  });

  test('blacklistedFolders keeps only blacklisted folders, sorted aToZ', () => {
    const data = [
      makeFolder('C:/white', ['s1']),
      makeFolder('C:/black', ['s2'])
    ];

    expect(pathsOf(sortFolders(blacklistRepository, data, 'blacklistedFolders'))).toEqual([
      'C:/black'
    ]);
  });

  test('whitelistedFolders keeps the rest', () => {
    const data = [
      makeFolder('C:/white', ['s1']),
      makeFolder('C:/black', ['s2'])
    ];

    expect(pathsOf(sortFolders(blacklistRepository, data, 'whitelistedFolders'))).toEqual([
      'C:/white'
    ]);
  });
});

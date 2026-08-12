import { describe, expect, jest, test } from '@jest/globals';

import { METADATA_HEAD_SIZE } from '../constants';
import { scanTraversal } from '../scanner';
import { walkMusicTrees } from '../traversal';
import type {
  DirectoryEntry,
  LibraryFileSystemPort,
  LibraryRepository,
  MetadataParserPort,
  ScannedLibraryTrack
} from '../types';

const directory = (name: string): DirectoryEntry => ({
  name,
  isDirectory: true,
  isFile: false,
  isSymlink: false
});

const file = (name: string): DirectoryEntry => ({
  name,
  isDirectory: false,
  isFile: true,
  isSymlink: false
});

const directoryStats = {
  isFile: false,
  isDirectory: true,
  size: 0,
  mtime: new Date('2026-08-11T00:00:00Z'),
  birthtime: new Date('2020-01-01T00:00:00Z')
};

describe('walkMusicTrees', () => {
  test('visits each directory once and derives paths and structures in that pass', async () => {
    const entries = new Map<string, DirectoryEntry[]>([
      ['C:\\Music', [file('root.flac'), file('notes.txt'), directory('Rock')]],
      ['C:\\Music\\Rock', [file('second.MP3'), directory('Deep')]],
      ['C:\\Music\\Rock\\Deep', [file('third.ogg')]]
    ]);
    const visits = new Map<string, number>();
    const fileSystem = {
      readDir: jest.fn(async (path: string) => {
        visits.set(path, (visits.get(path) ?? 0) + 1);
        return entries.get(path) ?? [];
      }),
      stat: jest.fn(async () => directoryStats)
    };

    const result = await walkMusicTrees(fileSystem, ['C:\\Music'], { concurrency: 2 });

    expect(Object.fromEntries(visits)).toEqual({
      'C:\\Music': 1,
      'C:\\Music\\Rock': 1,
      'C:\\Music\\Rock\\Deep': 1
    });
    expect(result.songPaths).toEqual([
      'C:\\Music\\root.flac',
      'C:\\Music\\Rock\\second.MP3',
      'C:\\Music\\Rock\\Deep\\third.ogg'
    ]);
    expect(result.structures[0]?.noOfSongs).toBe(3);
    expect(result.structures[0]?.subFolders[0]?.noOfSongs).toBe(2);
    expect(result.structures[0]?.subFolders[0]?.subFolders[0]?.noOfSongs).toBe(1);
  });

  test('bounds concurrent directory reads', async () => {
    const entries = new Map<string, DirectoryEntry[]>([
      ['C:\\Music', [directory('A'), directory('B'), directory('C')]],
      ['C:\\Music\\A', []],
      ['C:\\Music\\B', []],
      ['C:\\Music\\C', []]
    ]);
    let active = 0;
    let maximumActive = 0;
    const fileSystem = {
      readDir: async (path: string) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        active -= 1;
        return entries.get(path) ?? [];
      },
      stat: async () => directoryStats
    };

    await walkMusicTrees(fileSystem, ['C:\\Music'], { concurrency: 2 });

    expect(maximumActive).toBe(2);
  });
});

describe('scanLibrary', () => {
  test('honours the measured 256 KiB head limit', async () => {
    const requestedLengths: number[] = [];
    const committed: ScannedLibraryTrack[] = [];
    let directoryReads = 0;
    const fileSystem: LibraryFileSystemPort = {
      readDir: async () => {
        directoryReads += 1;
        return [file('track.flac')];
      },
      stat: async (path) =>
        path.endsWith('.flac')
          ? { ...directoryStats, isFile: true, isDirectory: false, size: 18 * 1024 * 1024 }
          : directoryStats,
      readHead: async (_path, length) => {
        requestedLengths.push(length);
        return new Uint8Array(length);
      }
    };
    const parser: MetadataParserPort = {
      parse: async () => ({
        common: { genres: [] },
        format: { container: 'FLAC' },
        pictures: [],
        metadataCompleteness: 'head'
      })
    };
    const repository: LibraryRepository = {
      getKnownSongPaths: () => [],
      commitFolderStructures: () => undefined,
      commitScanBatch: (tracks) => {
        committed.push(...tracks);
      },
      reportScanProgress: () => undefined
    };

    const traversal = await walkMusicTrees(fileSystem, ['C:\\Music']);
    const result = await scanTraversal(repository, fileSystem, parser, traversal);

    expect(directoryReads).toBe(1);
    expect(requestedLengths).toEqual([METADATA_HEAD_SIZE]);
    expect(committed).toHaveLength(1);
    expect(result.scanned).toBe(1);
    expect(result.failures).toEqual([]);
  });
});

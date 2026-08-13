import { describe, expect, jest, test } from '@jest/globals';

import { METADATA_HEAD_SIZE } from '../constants';
import { scanTraversal } from '../scanner';
import { walkMusicTrees } from '../traversal';
import type {
  DirectoryEntry,
  LibraryFileSystemPort,
  LibraryRepository,
  MetadataParserPort,
  NativeLibraryPort,
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

  test('builds the same folder structures from a host walk, without reading a directory', async () => {
    const readDir = jest.fn(async () => [] as DirectoryEntry[]);
    const native: NativeLibraryPort = {
      parse: async () => undefined,
      walk: async () => [
        {
          path: 'C:\\Music',
          modified: Date.parse('2026-08-11T00:00:00Z'),
          created: Date.parse('2020-01-01T00:00:00Z'),
          directories: ['C:\\Music\\Rock', 'C:\\Music\\Unreadable'],
          files: ['C:\\Music\\root.flac']
        },
        {
          path: 'C:\\Music\\Rock',
          directories: ['C:\\Music\\Rock\\Deep'],
          files: ['C:\\Music\\Rock\\second.MP3']
        },
        {
          path: 'C:\\Music\\Rock\\Deep',
          directories: [],
          files: ['C:\\Music\\Rock\\Deep\\third.ogg']
        }
        // "Unreadable" is named by its parent but never reported: that is how
        // the host says it could not open it.
      ]
    };

    const result = await walkMusicTrees(
      { readDir, stat: async () => directoryStats },
      ['C:\\Music'],
      { native }
    );

    expect(readDir).not.toHaveBeenCalled();
    expect(result.songPaths).toEqual([
      'C:\\Music\\root.flac',
      'C:\\Music\\Rock\\second.MP3',
      'C:\\Music\\Rock\\Deep\\third.ogg'
    ]);
    // Counts roll up exactly as they do in the readDir walk above.
    expect(result.structures[0]?.noOfSongs).toBe(3);
    expect(result.structures[0]?.subFolders).toHaveLength(1);
    expect(result.structures[0]?.subFolders[0]?.noOfSongs).toBe(2);
    expect(result.structures[0]?.stats.lastModifiedDate).toEqual(
      new Date('2026-08-11T00:00:00Z')
    );
    expect(result.visitedDirectories).toHaveLength(3);
  });

  test('falls back to reading directories when the host declines the walk', async () => {
    const readDir = jest.fn(async () => [file('only.flac')]);
    const native: NativeLibraryPort = {
      parse: async () => undefined,
      walk: async () => undefined
    };

    const result = await walkMusicTrees(
      { readDir, stat: async () => directoryStats },
      ['C:\\Music'],
      { native }
    );

    expect(readDir).toHaveBeenCalled();
    expect(result.songPaths).toEqual(['C:\\Music\\only.flac']);
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

  test('parses in batches through the host and falls back per batch', async () => {
    const committed: ScannedLibraryTrack[] = [];
    const parsedBatches: string[][] = [];
    const headReads: string[] = [];
    // More than one batch, so one can be answered natively while another is
    // refused - a single batch would only ever exercise one of the two routes.
    const paths = Array.from({ length: 40 }, (_, index) => `C:\\Music\\track-${index}.mp3`);
    const refused = paths[39];

    const fileSystem: LibraryFileSystemPort = {
      readDir: async () => [],
      stat: async () => ({
        ...directoryStats,
        isFile: true,
        isDirectory: false,
        size: 10
      }),
      readHead: async (path, length) => {
        headReads.push(path);
        return new Uint8Array(length);
      }
    };
    const parser: MetadataParserPort = {
      parse: async () => ({
        common: { title: 'From the head', genres: [] },
        format: { duration: 1 },
        pictures: [],
        metadataCompleteness: 'head'
      })
    };
    const native: NativeLibraryPort = {
      walk: async () => undefined,
      parse: async (batch) => {
        parsedBatches.push([...batch]);
        // One batch is refused outright, standing in for a build whose command
        // went away mid-scan.
        if (batch.includes(refused)) return undefined;
        return batch.map((path) => ({
          path,
          size: 4096,
          modifiedDate: 1_700_000_000_000,
          common: { title: `Native ${path.slice(-5)}`, genres: ['Phonk'] },
          format: { duration: 212.5 },
          // A cover that exists but was deliberately left in the file.
          pictures: [{ format: 'image/jpeg', byteLength: 3_000_000 }]
        }));
      }
    };
    const repository: LibraryRepository = {
      getKnownSongPaths: () => [],
      commitFolderStructures: () => undefined,
      commitScanBatch: (tracks) => {
        committed.push(...tracks);
      },
      reportScanProgress: () => undefined
    };

    const result = await scanTraversal(
      repository,
      fileSystem,
      parser,
      { structures: [], songPaths: paths, visitedDirectories: [] },
      { native, batchSize: 100 }
    );

    expect(result.scanned).toBe(40);
    expect(result.failures).toEqual([]);
    expect(committed).toHaveLength(40);
    expect(parsedBatches).toHaveLength(2);
    expect(parsedBatches[0]).toHaveLength(32);

    // The batch the host answered: covers named rather than carried.
    const native0 = committed.find((track) => track.path === paths[0]);
    expect(native0?.metadata.format.duration).toBe(212.5);
    expect(native0?.metadata.metadataCompleteness).toBe('file');
    expect(native0?.metadata.pictures[0]).toEqual({
      format: 'image/jpeg',
      byteLength: 3_000_000
    });
    expect(native0?.metadata.pictures[0].data).toBeUndefined();

    // The refused batch was read the ordinary way instead of being lost, and
    // ONLY that batch paid for a head read.
    expect(headReads).toHaveLength(8);
    expect(headReads).toContain(refused);
    expect(committed.find((track) => track.path === refused)?.metadata.common.title).toBe(
      'From the head'
    );
  });

  test('reports a file the host could not read as a failure, not as a lost batch', async () => {
    const committed: ScannedLibraryTrack[] = [];
    const paths = ['C:\\Music\\good.flac', 'C:\\Music\\locked.flac'];
    const fileSystem: LibraryFileSystemPort = {
      readDir: async () => [],
      stat: async () => ({ ...directoryStats, isFile: true, isDirectory: false, size: 10 }),
      readHead: async (_path, length) => new Uint8Array(length)
    };
    const parser: MetadataParserPort = {
      parse: async () => ({
        common: { genres: [] },
        format: {},
        pictures: [],
        metadataCompleteness: 'head'
      })
    };
    const native: NativeLibraryPort = {
      walk: async () => undefined,
      parse: async (batch) =>
        batch.map((path) =>
          path.endsWith('locked.flac')
            ? { path, size: 0, common: { genres: [] }, format: {}, pictures: [], error: 'locked' }
            : {
                path,
                size: 10,
                common: { title: 'Good', genres: [] },
                format: { duration: 3 },
                pictures: []
              }
        )
    };

    const result = await scanTraversal(
      {
        getKnownSongPaths: () => [],
        commitFolderStructures: () => undefined,
        commitScanBatch: (tracks) => {
          committed.push(...tracks);
        },
        reportScanProgress: () => undefined
      } satisfies LibraryRepository,
      fileSystem,
      parser,
      { structures: [], songPaths: paths, visitedDirectories: [] },
      { native }
    );

    expect(result.scanned).toBe(1);
    expect(committed.map((track) => track.path)).toEqual(['C:\\Music\\good.flac']);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].path).toBe('C:\\Music\\locked.flac');
  });

  test('asks the host for the properties of a file whose head held no duration', async () => {
    const committed: ScannedLibraryTrack[] = [];
    const askedFor: string[] = [];
    const fileSystem: LibraryFileSystemPort = {
      readDir: async () => [file('late-frame.mp3'), file('normal.flac')],
      stat: async (path) =>
        path.includes('.') && !path.endsWith('Music')
          ? { ...directoryStats, isFile: true, isDirectory: false, size: 4 * 1024 * 1024 }
          : directoryStats,
      readHead: async (_path, length) => new Uint8Array(length)
    };
    const parser: MetadataParserPort = {
      // The head of the MP3 is all ID3v2 tag, so nothing about the stream is
      // known; the FLAC states its length in the first block, as FLAC always
      // does.
      parse: async (path) => ({
        common: { genres: [] },
        format: path.endsWith('.mp3') ? {} : { duration: 180, sampleRate: 44_100 },
        pictures: [],
        metadataCompleteness: 'head'
      }),
      properties: async (path) => {
        askedFor.push(path);
        return { duration: 212.5, sampleRate: 48_000, bitrate: 320_000 };
      }
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
    await scanTraversal(repository, fileSystem, parser, traversal);

    expect(askedFor).toHaveLength(1);
    expect(askedFor[0]).toContain('late-frame.mp3');

    const late = committed.find((track) => track.path.endsWith('late-frame.mp3'));
    expect(late?.metadata.format).toMatchObject({
      duration: 212.5,
      sampleRate: 48_000,
      bitrate: 320_000
    });
    // The track that already had a duration keeps the one it was parsed with.
    const normal = committed.find((track) => track.path.endsWith('normal.flac'));
    expect(normal?.metadata.format.duration).toBe(180);
  });

  test('a host that cannot answer leaves the parsed metadata alone', async () => {
    const committed: ScannedLibraryTrack[] = [];
    const fileSystem: LibraryFileSystemPort = {
      readDir: async () => [file('track.mp3')],
      stat: async (path) =>
        path.endsWith('.mp3')
          ? { ...directoryStats, isFile: true, isDirectory: false, size: 1024 }
          : directoryStats,
      readHead: async (_path, length) => new Uint8Array(length)
    };
    const parser: MetadataParserPort = {
      parse: async () => ({
        common: { genres: [] },
        format: {},
        pictures: [],
        metadataCompleteness: 'head'
      }),
      properties: async () => {
        throw new Error('audio_properties not found');
      }
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

    // The track is still scanned; only its duration stays unknown.
    expect(result.failures).toEqual([]);
    expect(committed).toHaveLength(1);
    expect(committed[0].metadata.format.duration).toBeUndefined();
  });
});

describe('a slow catalog must not stop the scan', () => {
  test('scanning continues while a batch is being committed', async () => {
    const paths = Array.from({ length: 60 }, (_, index) => `E:\music\track-${index}.mp3`);
    const scannedAt: number[] = [];
    let releaseCommit: (() => void) | undefined;
    const commits: number[] = [];

    const fileSystem = {
      readDir: async () => [],
      stat: async () => ({ isFile: true, isDirectory: false, size: 1 }),
      readHead: async (path: string) => {
        scannedAt.push(paths.indexOf(path));
        return new Uint8Array([1]);
      }
    };
    const parser = { parse: async () => ({ common: {}, format: {}, pictures: [] }) };

    const repository = {
      getKnownSongPaths: () => [],
      commitFolderStructures: async () => undefined,
      reportScanProgress: () => undefined,
      commitScanBatch: async (batch: readonly { path: string }[]) => {
        commits.push(batch.length);
        // The first commit blocks until released; the scan must keep going.
        if (commits.length === 1) await new Promise<void>((resolve) => (releaseCommit = resolve));
      }
    };

    const scan = scanTraversal(
      repository as never,
      fileSystem as never,
      parser as never,
      { structures: [], songPaths: paths, visitedDirectories: [] },
      { batchSize: 25 }
    );

    // Give the scanner room to run past the first batch boundary while the
    // first commit is still held open.
    await new Promise((resolve) => setTimeout(resolve, 30));
    const scannedDuringCommit = scannedAt.length;

    releaseCommit?.();
    await scan;

    expect(scannedDuringCommit).toBeGreaterThan(25);
    expect(scannedAt).toHaveLength(60);
  });
});

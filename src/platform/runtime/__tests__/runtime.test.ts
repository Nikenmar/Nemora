import { afterEach, describe, expect, jest, test } from '@jest/globals';

jest.mock('any-ascii', () => ({ __esModule: true, default: (value: string) => value }));
jest.mock('pinyin-pro', () => ({ pinyin: (value: string) => value }));
jest.mock('romaja/src/romanize.js', () => ({ romanize: (value: string) => value }));
jest.mock('@tauri-apps/plugin-fs', () => ({ readTextFile: jest.fn(), writeTextFile: jest.fn() }));
jest.mock('@tauri-apps/plugin-dialog', () => ({ open: jest.fn(), save: jest.fn() }));

import { userData } from '../../api/user-data';
import type { StoreFile, StoreName, StorePort } from '../../contracts/store';
import type { RuntimeArtworkPaths } from '../artwork';
import type { RuntimeEventSink } from '../events';
import { RuntimeNotHydratedError } from '../errors';
import { configureRuntime, getRuntime, hydrateRuntime, resetRuntimeForTests } from '../registry';
import type { RuntimeServices } from '../services';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

class MemoryStorePort implements StorePort {
  readonly files = new Map<StoreName, StoreFile<unknown>>();
  readonly writes: StoreName[] = [];

  async exists(store: StoreName): Promise<boolean> {
    return this.files.has(store);
  }

  async read<T>(store: StoreName): Promise<StoreFile<T>> {
    const file = this.files.get(store);
    if (!file) throw new Error(`missing test store ${store}`);
    return clone(file) as StoreFile<T>;
  }

  async write<T>(store: StoreName, file: StoreFile<T>): Promise<void> {
    this.writes.push(store);
    this.files.set(store, clone(file) as StoreFile<unknown>);
  }
}

/** The songs actually persisted to the store, in the shape they were written. */
const committedSongs = (port: MemoryStorePort): SavableSongData[] =>
  (port.files.get('songs')?.payload as SavableSongData[] | undefined) ?? [];

const artworkPath = (name: string): ArtworkPaths => ({
  isDefaultArtwork: false,
  artworkPath: `nemora://${name}`,
  optimizedArtworkPath: `nemora://${name}`
});

const artwork: RuntimeArtworkPaths = {
  song: (id) => artworkPath(`song/${id}`),
  artist: (name) => artworkPath(`artist/${name ?? 'default'}`),
  album: (name) => artworkPath(`album/${name ?? 'default'}`),
  genre: (name) => artworkPath(`genre/${name ?? 'default'}`),
  playlist: (id) => artworkPath(`playlist/${id}`),
  songFile: (path) => `nemora://${path}`
};

const events: RuntimeEventSink = {
  dataUpdated: jest.fn(),
  message: jest.fn()
};

afterEach(() => resetRuntimeForTests());

describe('runtime/API composition', () => {
  test('rejects an API read before the runtime is hydrated', async () => {
    const port = new MemoryStorePort();
    configureRuntime(port, { version: 'test', artwork, events });

    await expect(userData.getUserData()).rejects.toBeInstanceOf(RuntimeNotHydratedError);
    expect(() => getRuntime()).toThrow(RuntimeNotHydratedError);
  });

  test('hydrates a fake StorePort and serves and persists an API call end to end', async () => {
    const port = new MemoryStorePort();
    port.files.set('userData', {
      version: 'legacy-root-version',
      internal: { migrations: { version: 'legacy-migration-version' } },
      unknownRootKeys: { sentinel: { keep: true } },
      payload: {
        language: 'uk',
        theme: { isDarkMode: true, useSystemTheme: false },
        musicFolders: [],
        preferences: {},
        windowPositions: {},
        windowDiamensions: {},
        windowState: 'normal',
        recentSearches: ['before']
      }
    });

    configureRuntime(port, { version: 'test', artwork, events });
    await hydrateRuntime();

    expect((await userData.getUserData()).language).toBe('uk');
    await userData.saveUserData('recentSearches', ['after']);
    await getRuntime().flush();

    expect((port.files.get('userData')?.payload as UserData).recentSearches).toEqual(['after']);
    expect(port.files.get('userData')?.version).toBe('legacy-root-version');
    expect(port.files.get('userData')?.internal?.migrations?.version).toBe(
      'legacy-migration-version'
    );
    expect(port.files.get('userData')?.unknownRootKeys).toEqual({ sentinel: { keep: true } });
    expect(port.writes).toContain('userData');
  });

  test('reuses the retained folder traversal and commits scanned catalog data', async () => {
    const port = new MemoryStorePort();
    let rootReads = 0;
    const root = 'E:\\Music';
    const songPath = `${root}\\Track.mp3`;
    const services: RuntimeServices = {
      selectMusicFolders: async () => [root],
      libraryFileSystem: {
        readDir: async (path) => {
          expect(path).toBe(root);
          rootReads += 1;
          return [{ name: 'Track.mp3', isDirectory: false, isFile: true, isSymlink: false }];
        },
        stat: async (path) => ({
          isFile: path === songPath,
          isDirectory: path === root,
          size: path === songPath ? 42 : 0,
          mtime: new Date('2025-01-02T00:00:00Z'),
          birthtime: new Date('2025-01-01T00:00:00Z')
        }),
        readHead: async () => new Uint8Array([1, 2, 3])
      },
      metadataParser: {
        parse: async () => ({
          common: {
            title: 'Track',
            artist: 'Artist',
            albumArtist: 'Album Artist',
            album: 'Album',
            genres: ['Genre'],
            year: 2025,
            trackNumber: 1,
            discNumber: 1
          },
          format: { duration: 123.456, sampleRate: 48_000 },
          pictures: [],
          metadataCompleteness: 'head'
        })
      },
      artwork: {
        storeArtworks: async () => ({
          isDefaultArtwork: true,
          artworkPath: 'default.webp',
          optimizedArtworkPath: 'default.webp'
        })
      } as unknown as NonNullable<RuntimeServices['artwork']>
    };

    configureRuntime(port, { version: 'test', artwork, events, services });
    await hydrateRuntime();
    const structures = await getRuntime().getFolderStructures();
    const songs = await getRuntime().addSongsFromFolderStructures(structures);

    expect(rootReads).toBe(1);
    expect(songs).toHaveLength(1);
    expect(songs[0]).toMatchObject({
      title: 'Track',
      path: songPath,
      duration: 123.46,
      artists: [{ name: 'Artist' }],
      album: { name: 'Album' },
      genres: [{ name: 'Genre' }]
    });
    expect(getRuntime().getUserData().musicFolders).toHaveLength(1);
    expect(getRuntime().getArtists()).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'Artist' })])
    );
  });

  test('commits scanned songs before their covers exist and repairs the ones that fail', async () => {
    const port = new MemoryStorePort();
    const root = 'E:\\Music';
    const names = ['Good.mp3', 'Bad.mp3'];
    let releaseArtwork = (): void => undefined;
    const artworkGate = new Promise<void>((resolve) => {
      releaseArtwork = resolve;
    });
    const storedFor: string[] = [];

    const services: RuntimeServices = {
      selectMusicFolders: async () => [root],
      libraryFileSystem: {
        readDir: async () =>
          names.map((name) => ({ name, isDirectory: false, isFile: true, isSymlink: false })),
        stat: async (path) => ({
          isFile: path !== root,
          isDirectory: path === root,
          size: 42,
          mtime: new Date('2025-01-02T00:00:00Z'),
          birthtime: new Date('2025-01-01T00:00:00Z')
        }),
        readHead: async () => new Uint8Array([1, 2, 3])
      },
      metadataParser: {
        parse: async (path) => ({
          common: { title: path.includes('Bad') ? 'Bad' : 'Good', genres: [] },
          format: { duration: 10 },
          // Both tracks carry a picture; only one of them will encode.
          pictures: [{ format: 'image/jpeg', data: new Uint8Array([7, 7, 7]), byteLength: 3 }],
          metadataCompleteness: 'head'
        })
      },
      artwork: {
        storeArtworks: async (id: string) => {
          storedFor.push(id);
          await artworkGate;
          const song = committedSongs(port)?.find(
            (entry) => entry.songId === id
          );
          if (song?.title === 'Bad') throw new Error('cover encode failed');
          return {
            isDefaultArtwork: false,
            artworkPath: `${id}.webp`,
            optimizedArtworkPath: `${id}.webp`
          };
        }
      } as unknown as NonNullable<RuntimeServices['artwork']>
    };

    configureRuntime(port, { version: 'test', artwork, events, services });
    await hydrateRuntime();
    const structures = await getRuntime().getFolderStructures();
    await getRuntime().addSongsFromFolderStructures(structures);

    // The scan returned while both covers are still stuck in the pipeline.
    const committed = committedSongs(port);
    expect(committed).toHaveLength(2);
    expect(committed.every((song) => song.isArtworkAvailable)).toBe(true);
    expect(storedFor).toHaveLength(2);

    releaseArtwork();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const repaired = committedSongs(port);
    expect(repaired.find((song) => song.title === 'Good')?.isArtworkAvailable).toBe(true);
    expect(repaired.find((song) => song.title === 'Bad')?.isArtworkAvailable).toBe(false);
  });

  test('announces covers in groups while they are still being generated', async () => {
    const port = new MemoryStorePort();
    const root = 'E:\\Music';
    const names = Array.from({ length: 30 }, (_, index) => `track-${index}.mp3`);
    jest.mocked(events.dataUpdated).mockClear();

    const services: RuntimeServices = {
      selectMusicFolders: async () => [root],
      libraryFileSystem: {
        readDir: async () =>
          names.map((name) => ({ name, isDirectory: false, isFile: true, isSymlink: false })),
        stat: async (path) => ({
          isFile: path !== root,
          isDirectory: path === root,
          size: 42,
          mtime: null,
          birthtime: null
        }),
        readHead: async () => new Uint8Array([1, 2, 3])
      },
      metadataParser: {
        parse: async () => ({
          common: { title: 'Track', genres: [] },
          format: { duration: 10 },
          pictures: [{ format: 'image/jpeg', data: new Uint8Array([7]), byteLength: 1 }],
          metadataCompleteness: 'head'
        })
      },
      artwork: {
        storeArtworks: async (id: string) => ({
          isDefaultArtwork: false,
          artworkPath: `${id}.webp`,
          optimizedArtworkPath: `${id}.webp`
        })
      } as unknown as NonNullable<RuntimeServices['artwork']>
    };

    configureRuntime(port, { version: 'test', artwork, events, services });
    await hydrateRuntime();
    const structures = await getRuntime().getFolderStructures();
    await getRuntime().addSongsFromFolderStructures(structures);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const announcements = jest
      .mocked(events.dataUpdated)
      .mock.calls.filter(([type]) => type === 'songs/artworks');

    // Thirty covers in groups of twelve: the interface hears about the first
    // ones long before the last one is encoded.
    expect(announcements.length).toBeGreaterThan(1);
    expect(announcements.flatMap(([, ids]) => ids)).toHaveLength(30);
  });

  test('a resync fills in durations a previous build could not read', async () => {
    const port = new MemoryStorePort();
    const asked: string[] = [];
    port.files.set('songs', {
      unknownRootKeys: {},
      payload: [
        {
          songId: 'broken',
          title: 'Late Frame',
          path: 'E:\\Music\\late.mp3',
          duration: 0,
          isAFavorite: false,
          isArtworkAvailable: false,
          addedDate: 1,
          genres: []
        },
        {
          songId: 'fine',
          title: 'Normal',
          path: 'E:\\Music\\fine.flac',
          duration: 180,
          isAFavorite: false,
          isArtworkAvailable: false,
          addedDate: 1,
          genres: []
        }
      ]
    });

    const services: RuntimeServices = {
      libraryFileSystem: {
        readDir: async () => [],
        stat: async () => ({
          isFile: true,
          isDirectory: false,
          size: 1,
          mtime: null,
          birthtime: null
        }),
        readHead: async () => new Uint8Array([1])
      },
      metadataParser: {
        parse: async () => ({
          common: { genres: [] },
          format: {},
          pictures: [],
          metadataCompleteness: 'head'
        }),
        properties: async (path) => {
          asked.push(path);
          return { duration: 212.567, sampleRate: 44_100, bitrate: 320_000 };
        }
      }
    };

    configureRuntime(port, { version: 'test', artwork, events, services });
    await hydrateRuntime();
    await getRuntime().resyncSongsLibrary();

    // Only the broken row is asked about; the one that already had a duration
    // is never re-read.
    expect(asked).toEqual(['E:\\Music\\late.mp3']);
    const songs = committedSongs(port);
    expect(songs.find((song) => song.songId === 'broken')).toMatchObject({
      duration: 212.57,
      sampleRate: 44_100,
      bitrate: 320_000
    });
    expect(songs.find((song) => song.songId === 'fine')?.duration).toBe(180);
  });

  test('a cached song order is dropped the moment the catalog changes', async () => {
    const port = new MemoryStorePort();
    const song = (id: string, title: string): SavableSongData =>
      ({
        songId: id,
        title,
        path: `E:\\Music\\${title}.mp3`,
        duration: 100,
        isAFavorite: false,
        isArtworkAvailable: false,
        addedDate: 1,
        genres: []
      }) as unknown as SavableSongData;

    port.files.set('songs', {
      unknownRootKeys: {},
      payload: [song('c', 'Charlie'), song('a', 'Alpha')]
    });

    configureRuntime(port, { version: 'test', artwork, events });
    await hydrateRuntime();
    const runtime = getRuntime();

    const first = runtime.getAllSongs('aToZ');
    expect(first.data.map((entry) => entry.title)).toEqual(['Alpha', 'Charlie']);
    expect(first.total).toBe(2);

    // Read again: served from the cache, and identical.
    expect(runtime.getAllSongs('aToZ').data.map((entry) => entry.title)).toEqual([
      'Alpha',
      'Charlie'
    ]);

    // A real catalog write, through the one path every mutation takes.
    runtime.toggleLikeSongs(['a']);

    const afterLike = runtime.getAllSongs('aToZ');
    expect(afterLike.data.find((entry) => entry.songId === 'a')?.isAFavorite).toBe(true);

    // Pagination reports the size of the whole result, not of the page.
    const page = runtime.getAllSongs('aToZ', undefined, { start: 1, end: 2 });
    expect(page.data.map((entry) => entry.title)).toEqual(['Charlie']);
    expect(page.total).toBe(2);
    expect(page.start).toBe(1);
    expect(page.end).toBe(2);
  });

  test('holds Rust-delivered open-file arguments behind the startup-song gate', async () => {
    const port = new MemoryStorePort();
    const path = 'E:\\Outside\\Track.flac';
    const services: RuntimeServices = {
      libraryFileSystem: {
        readDir: async () => [],
        stat: async () => ({
          isFile: true,
          isDirectory: false,
          size: 12,
          mtime: null,
          birthtime: null
        }),
        readHead: async () => new Uint8Array([1, 2, 3])
      },
      metadataParser: {
        parse: async () => ({
          common: { title: 'Outside Track', artist: 'Outside Artist', genres: [] },
          format: { duration: 42 },
          pictures: [],
          metadataCompleteness: 'head'
        })
      },
      singleInstance: {
        create: async (routes) => ({
          markRendererReady: async () => routes.openAudioFile(path),
          stop: () => undefined
        })
      }
    };

    configureRuntime(port, { version: 'test', artwork, events, services });
    await hydrateRuntime();
    const startupSong = await getRuntime().checkForStartUpSongs();

    expect(startupSong).toMatchObject({
      title: 'Outside Track',
      artists: [{ name: 'Outside Artist' }],
      duration: 42,
      path: `nemora://${path}`,
      isKnownSource: false
    });
    expect(typeof startupSong?.artwork).toBe('string');
  });
});

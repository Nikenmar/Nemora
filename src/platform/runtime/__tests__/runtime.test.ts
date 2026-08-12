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

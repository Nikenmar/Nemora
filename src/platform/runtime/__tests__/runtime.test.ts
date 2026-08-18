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

  test('a rebuilt library gets its listening history back', async () => {
    // The whole point of the fingerprint, end to end: the user removed the
    // folder and added it again (or moved the files, or reset the catalog).
    // The files are the same, the ids are new, and before this the history was
    // simply lost - one real profile ended up with 1260 of 1280 rows pointing
    // at ids that no longer existed.
    const port = new MemoryStorePort();
    const root = 'E:\\Music';
    const songPath = `${root}\\Track.mp3`;
    port.files.set('listeningData', {
      payload: [
        {
          songId: 'id-from-the-old-library',
          listens: [{ year: 2026, listens: [[1_770_000_000_000, 900]] }],
          fullListens: 850,
          skips: 12,
          fingerprint: {
            songId: 'id-from-the-old-library',
            title: 'Track',
            artists: ['Artist'],
            duration: 123.46,
            fileName: 'Track.mp3'
          }
        }
      ]
    } as unknown as StoreFile<unknown>);

    const services: RuntimeServices = {
      selectMusicFolders: async () => [root],
      libraryFileSystem: {
        readDir: async () => [
          { name: 'Track.mp3', isDirectory: false, isFile: true, isSymlink: false }
        ],
        stat: async (path) => ({
          isFile: path === songPath,
          isDirectory: path === root,
          size: 42,
          mtime: new Date('2025-01-02T00:00:00Z'),
          birthtime: new Date('2025-01-01T00:00:00Z')
        }),
        readHead: async () => new Uint8Array([1, 2, 3])
      },
      metadataParser: {
        parse: async () => ({
          common: { title: 'Track', artist: 'Artist', genres: [] },
          format: { duration: 123.456 },
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
    await getRuntime().flush();

    const newSongId = songs[0].songId;
    expect(newSongId).not.toBe('id-from-the-old-library');

    const rows = getRuntime().getListeningData([newSongId]);
    expect(rows).toHaveLength(1);
    expect(rows[0].songId).toBe(newSongId);
    expect(rows[0].fullListens).toBe(850);
    expect(rows[0].skips).toBe(12);
    // And the statistics page counts it, which it would not do for a row that
    // names a track the library does not have.
    expect(getRuntime().getStats('allTime').totals.totalListens).toBe(900);
  });

  test('a rebuilt library gets its duel rating and tier placement back', async () => {
    // The other half of the same protection. Removal already kept both - the
    // rating carries a fingerprint, the tier card waits in `orphanedItems` -
    // and the relinkers for them existed with tests and no caller, so the
    // history came back after a rebuild while the ranking silently did not.
    const port = new MemoryStorePort();
    const root = 'E:\\Music';
    const songPath = `${root}\\Track.mp3`;
    const fingerprint = {
      songId: 'id-from-the-old-library',
      title: 'Track',
      artists: ['Artist'],
      duration: 123.46,
      fileName: 'Track.mp3'
    };

    port.files.set('cmrStats', {
      payload: {
        elo: {
          ratings: {
            'id-from-the-old-library': {
              rating: 1440,
              games: 9,
              wins: 6,
              losses: 3,
              fingerprint
            }
          },
          history: [
            {
              at: 1,
              songAId: 'id-from-the-old-library',
              songBId: 'someone-else',
              winner: 'A',
              deltaA: 8,
              deltaB: -8
            }
          ],
          totalDuels: 1
        },
        importedStatsExportIds: []
      }
    } as unknown as StoreFile<unknown>);
    port.files.set('tierlists', {
      payload: [
        {
          tierlistId: 'tierlist',
          name: 'Ranking',
          createdDate: new Date(0),
          sourcePlaylistIds: [],
          labelMode: 'track',
          tiers: [
            {
              tierId: 's',
              name: 'S',
              items: [],
              orphanedItems: [{ songId: 'id-from-the-old-library', index: 0, fingerprint }]
            }
          ]
        }
      ]
    } as unknown as StoreFile<unknown>);

    const services: RuntimeServices = {
      selectMusicFolders: async () => [root],
      libraryFileSystem: {
        readDir: async () => [
          { name: 'Track.mp3', isDirectory: false, isFile: true, isSymlink: false }
        ],
        stat: async (path) => ({
          isFile: path === songPath,
          isDirectory: path === root,
          size: 42,
          mtime: null,
          birthtime: null
        }),
        readHead: async () => new Uint8Array([1, 2, 3])
      },
      metadataParser: {
        parse: async () => ({
          common: { title: 'Track', artist: 'Artist', genres: [] },
          format: { duration: 123.456 },
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
    await getRuntime().flush();

    const newSongId = songs[0].songId;
    expect(newSongId).not.toBe('id-from-the-old-library');

    const stats = port.files.get('cmrStats')?.payload as {
      elo: {
        ratings: Record<string, { rating: number }>;
        history: { songAId: string }[];
      };
    };
    expect(stats.elo.ratings).not.toHaveProperty('id-from-the-old-library');
    expect(stats.elo.ratings[newSongId]).toMatchObject({ rating: 1440, games: 9 });
    // The duel history follows the rating, or the standings would disagree with
    // the record they were computed from.
    expect(stats.elo.history[0].songAId).toBe(newSongId);

    const tierlists = port.files.get('tierlists')?.payload as {
      tiers: { items: string[]; orphanedItems?: unknown[] }[];
    }[];
    expect(tierlists[0].tiers[0].items).toEqual([newSongId]);
    expect(tierlists[0].tiers[0].orphanedItems).toBeUndefined();
  });

  test('reattaches a ranking at startup when the rebuild happened in an earlier run', async () => {
    // The other call site. A library rebuilt by a build that kept the data but
    // could not bring it back leaves the profile in this exact state: the songs
    // are already there under new ids, and nothing is going to scan them again.
    const port = new MemoryStorePort();
    const fingerprint = {
      songId: 'old',
      title: 'Track',
      artists: ['Artist'],
      duration: 120,
      fileName: 'Track.mp3'
    };

    port.files.set('songs', {
      payload: [
        {
          songId: 'current',
          title: 'Track',
          path: 'E:\\Music\\Track.mp3',
          duration: 120,
          artists: [{ artistId: 'a', name: 'Artist' }],
          isAFavorite: false,
          isArtworkAvailable: false,
          addedDate: 1,
          genres: []
        }
      ]
    } as unknown as StoreFile<unknown>);
    port.files.set('cmrStats', {
      payload: {
        elo: {
          ratings: { old: { rating: 1501, games: 2, wins: 1, losses: 1, fingerprint } },
          history: [],
          totalDuels: 0
        },
        importedStatsExportIds: []
      }
    } as unknown as StoreFile<unknown>);

    configureRuntime(port, { version: 'test', artwork, events });
    await hydrateRuntime();
    await getRuntime().flush();

    const stats = port.files.get('cmrStats')?.payload as {
      elo: { ratings: Record<string, { rating: number }> };
    };
    expect(stats.elo.ratings).not.toHaveProperty('old');
    expect(stats.elo.ratings.current).toMatchObject({ rating: 1501 });
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

  describe('the library watcher startup pass', () => {
    const root = 'E:\\Music';
    const known = `${root}\\Old.mp3`;
    const added = `${root}\\New.mp3`;

    const seed = (port: MemoryStorePort): void => {
      port.files.set('userData', {
        unknownRootKeys: {},
        payload: {
          musicFolders: [
            {
              path: root,
              stats: {
                lastModifiedDate: new Date('2025-01-01T00:00:00Z'),
                lastChangedDate: new Date('2025-01-01T00:00:00Z'),
                fileCreatedDate: new Date('2025-01-01T00:00:00Z'),
                lastParsedDate: new Date('2025-01-01T00:00:00Z')
              },
              subFolders: []
            }
          ],
          preferences: {},
          windowPositions: {},
          windowDiamensions: {},
          windowState: 'normal'
        }
      });
      port.files.set('songs', {
        unknownRootKeys: {},
        payload: [
          {
            songId: 'old',
            title: 'Old',
            path: known,
            duration: 100,
            isAFavorite: false,
            isArtworkAvailable: false,
            addedDate: 1,
            genres: []
          }
        ]
      });
    };

    /** `onDisk` is what the walk finds under the root at this moment. */
    const servicesFor = (
      onDisk: readonly string[],
      watchers: { callback?: (event: unknown) => void } = {}
    ): RuntimeServices => ({
      libraryFileSystem: {
        readDir: async () =>
          onDisk.map((path) => ({
            name: path.slice(root.length + 1),
            isDirectory: false,
            isFile: true,
            isSymlink: false
          })),
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
          common: { title: 'New', genres: [] },
          format: { duration: 90 },
          pictures: [],
          metadataCompleteness: 'head'
        })
      },
      watcherFileSystem: {
        exists: async () => true,
        watch: async (_paths, callback) => {
          watchers.callback ??= callback as (event: unknown) => void;
          return () => undefined;
        }
      },
      artwork: {
        storeArtworks: async () => ({
          isDefaultArtwork: true,
          artworkPath: 'default.webp',
          optimizedArtworkPath: 'default.webp'
        }),
        removeStoredArtwork: async () => undefined
      } as unknown as NonNullable<RuntimeServices['artwork']>
    });

    test('picks up a track added while the app was not running', async () => {
      const port = new MemoryStorePort();
      seed(port);

      configureRuntime(port, {
        version: 'test',
        artwork,
        events,
        services: servicesFor([known, added])
      });
      await hydrateRuntime();
      await getRuntime().startLibraryWatcher({ reconcile: true });
      await new Promise((resolve) => setTimeout(resolve, 0));

      // The watches themselves see nothing here: the file appeared before any
      // of this existed, which is exactly the case the pass is for.
      expect(committedSongs(port).map((song) => song.path)).toEqual(
        expect.arrayContaining([known, added])
      );
    });

    test('writes nothing when the library has not changed', async () => {
      const port = new MemoryStorePort();
      seed(port);

      configureRuntime(port, {
        version: 'test',
        artwork,
        events,
        services: servicesFor([known])
      });
      await hydrateRuntime();
      const writesAfterHydration = port.writes.length;
      const updatesAfterHydration = jest.mocked(events.dataUpdated).mock.calls.length;

      await getRuntime().startLibraryWatcher({ reconcile: true });
      await new Promise((resolve) => setTimeout(resolve, 0));

      // The pass runs on every launch, so the case where it finds nothing is
      // the common one: no store write, and no telling the interface that the
      // music folders changed when only the parse timestamp did.
      expect(port.writes).toHaveLength(writesAfterHydration);
      expect(jest.mocked(events.dataUpdated).mock.calls).toHaveLength(updatesAfterHydration);
    });

    test('keeps the catalog when the startup walk comes back empty', async () => {
      const port = new MemoryStorePort();
      seed(port);

      configureRuntime(port, { version: 'test', artwork, events, services: servicesFor([]) });
      await hydrateRuntime();
      await getRuntime().startLibraryWatcher({ reconcile: true });
      await new Promise((resolve) => setTimeout(resolve, 0));

      // A drive that has not finished mounting walks exactly like a folder the
      // user emptied, and only one of the two is worth acting on unprompted.
      expect(committedSongs(port).map((song) => song.path)).toEqual([known]);
    });

    test('still removes songs when a watcher event reports the folder as empty', async () => {
      const port = new MemoryStorePort();
      seed(port);
      const watchers: { callback?: (event: unknown) => void } = {};

      configureRuntime(port, {
        version: 'test',
        artwork,
        events,
        services: servicesFor([], watchers)
      });
      await hydrateRuntime();
      await getRuntime().startLibraryWatcher({ reconcile: true });
      await new Promise((resolve) => setTimeout(resolve, 0));

      watchers.callback?.({
        type: { remove: { kind: 'file' } },
        paths: [root],
        attrs: {}
      });
      await new Promise((resolve) => setTimeout(resolve, 0));

      // The event is the evidence the startup pass lacks: the user just
      // changed this directory, so an empty answer is an answer.
      expect(committedSongs(port)).toEqual([]);
    });
  });

  test('removing a music folder keeps the tierlist that was built from it', async () => {
    const port = new MemoryStorePort();
    const root = 'E:\\Music';
    port.files.set('userData', {
      unknownRootKeys: {},
      payload: {
        musicFolders: [
          {
            path: root,
            stats: {
              lastModifiedDate: new Date(0),
              lastChangedDate: new Date(0),
              fileCreatedDate: new Date(0),
              lastParsedDate: new Date(0)
            },
            subFolders: []
          }
        ],
        preferences: {},
        windowPositions: {},
        windowDiamensions: {},
        windowState: 'normal'
      }
    } as unknown as StoreFile<unknown>);
    port.files.set('songs', {
      unknownRootKeys: {},
      payload: [
        {
          songId: 'ranked',
          title: 'Ranked Track',
          path: `${root}\\Ranked.mp3`,
          duration: 100,
          isAFavorite: false,
          isArtworkAvailable: false,
          addedDate: 1,
          genres: []
        }
      ]
    } as unknown as StoreFile<unknown>);
    port.files.set('tierlists', {
      unknownRootKeys: {},
      payload: [
        {
          tierlistId: 'tl',
          name: 'Ranking',
          createdDate: new Date(0),
          sourcePlaylistIds: [],
          sourceFolderPaths: [root],
          labelMode: 'track',
          tiers: [{ tierId: 'S', name: 'S', items: ['ranked'] }]
        }
      ]
    } as unknown as StoreFile<unknown>);

    configureRuntime(port, { version: 'test', artwork, events });
    await hydrateRuntime();
    await getRuntime().removeMusicFolder(root);

    const tierlists = port.files.get('tierlists')?.payload as {
      sourceFolderPaths?: string[];
      tiers: { items: string[]; orphanedItems?: { songId: string }[] }[];
    }[];

    // Removing a folder is usually a step in a rebuild, not a decision about
    // the tierlist. Forgetting where its music came from left the ranking
    // attached to a tierlist with an empty pool once the folder came back.
    expect(tierlists[0].sourceFolderPaths).toEqual([root]);
    // The placement itself waits as an orphan, ready for the rescan.
    expect(tierlists[0].tiers[0].items).toEqual([]);
    expect(tierlists[0].tiers[0].orphanedItems?.[0].songId).toBe('ranked');
  });

  test('tierlist thumbnails are built a few at a time, not all at once', async () => {
    const port = new MemoryStorePort();
    const ids = Array.from({ length: 120 }, (_, index) => `song-${index}`);
    let inFlight = 0;
    let peak = 0;

    const services: RuntimeServices = {
      artwork: {
        createTierlistThumbnail: async (id: string) => {
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          await new Promise((resolve) => setTimeout(resolve, 1));
          inFlight -= 1;
          return `nemora://${id}-tl.webp`;
        }
      } as unknown as NonNullable<RuntimeServices['artwork']>
    };

    configureRuntime(port, { version: 'test', artwork, events, services });
    await hydrateRuntime();
    const thumbnails = await getRuntime().createTierlistArtworks(ids);

    expect(Object.keys(thumbnails)).toHaveLength(120);
    // The unbounded version peaked at 120 here and at seventeen hundred on a
    // real library, which stalled the whole desktop rather than just the app.
    expect(peak).toBeLessThanOrEqual(8);
    expect(peak).toBeGreaterThan(1);
  });

  test('one unbuildable thumbnail does not sink the rest of the grid', async () => {
    const port = new MemoryStorePort();
    const services: RuntimeServices = {
      artwork: {
        createTierlistThumbnail: async (id: string) => {
          if (id === 'broken') throw new Error('cover is unreadable');
          return `nemora://${id}-tl.webp`;
        }
      } as unknown as NonNullable<RuntimeServices['artwork']>
    };

    configureRuntime(port, { version: 'test', artwork, events, services });
    await hydrateRuntime();

    await expect(
      getRuntime().createTierlistArtworks(['a', 'broken', 'b'])
    ).resolves.toEqual({
      a: 'nemora://a-tl.webp',
      b: 'nemora://b-tl.webp'
    });
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

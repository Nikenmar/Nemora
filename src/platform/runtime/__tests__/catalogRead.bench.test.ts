/**
 * What a catalog READ costs, at real library size.
 *
 * Skipped unless `NEMORA_BENCH` is set: it measures rather than asserts, and a
 * timing test that runs in CI is a flaky test. Run it deliberately:
 *
 * ```text
 * NEMORA_BENCH=1 npx jest catalogRead.bench --silent=false
 * ```
 *
 * It exists because the next phase of the Rust migration is justified by this
 * number or it is not justified at all.
 */
import { afterEach, describe, expect, jest, test } from '@jest/globals';

jest.mock('any-ascii', () => ({ __esModule: true, default: (value: string) => value }));
jest.mock('pinyin-pro', () => ({ pinyin: (value: string) => value }));
jest.mock('romaja/src/romanize.js', () => ({ romanize: (value: string) => value }));
jest.mock('@tauri-apps/plugin-fs', () => ({ readTextFile: jest.fn(), writeTextFile: jest.fn() }));
jest.mock('@tauri-apps/plugin-dialog', () => ({ open: jest.fn(), save: jest.fn() }));

import type { StoreFile, StoreName, StorePort } from '../../contracts/store';
import type { RuntimeArtworkPaths } from '../artwork';
import type { RuntimeEventSink } from '../events';
import { configureRuntime, getRuntime, hydrateRuntime, resetRuntimeForTests } from '../registry';

const SONG_COUNT = Number(process.env.NEMORA_BENCH_SONGS ?? 3400);
const enabled = Boolean(process.env.NEMORA_BENCH);

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

class MemoryStorePort implements StorePort {
  readonly files = new Map<StoreName, StoreFile<unknown>>();

  async exists(store: StoreName): Promise<boolean> {
    return this.files.has(store);
  }

  async read<T>(store: StoreName): Promise<StoreFile<T>> {
    const file = this.files.get(store);
    if (!file) throw new Error(`missing test store ${store}`);
    return clone(file) as StoreFile<T>;
  }

  async write<T>(store: StoreName, file: StoreFile<T>): Promise<void> {
    this.files.set(store, clone(file) as StoreFile<unknown>);
  }
}

const artworkPaths = (name: string): ArtworkPaths => ({
  isDefaultArtwork: false,
  artworkPath: `nemora://${name}`,
  optimizedArtworkPath: `nemora://${name}`
});

const artwork: RuntimeArtworkPaths = {
  song: (id) => artworkPaths(`song/${id}`),
  artist: (name) => artworkPaths(`artist/${name ?? 'default'}`),
  album: (name) => artworkPaths(`album/${name ?? 'default'}`),
  genre: (name) => artworkPaths(`genre/${name ?? 'default'}`),
  playlist: (id) => artworkPaths(`playlist/${id}`),
  songFile: (path) => `nemora://${path}`
};

const events: RuntimeEventSink = { dataUpdated: jest.fn(), message: jest.fn() };

/** A catalog shaped like a real one: many artists, fewer albums, some genres. */
const buildSongs = (count: number): SavableSongData[] =>
  Array.from({ length: count }, (_, index) => {
    const artist = `Artist ${index % 400}`;
    const album = `Album ${index % 700}`;
    return {
      songId: `song-${index}`,
      title: `Track number ${index} with a realistic title`,
      artists: [{ artistId: `artist-${index % 400}`, name: artist }],
      albumArtists: [{ artistId: `artist-${index % 400}`, name: artist }],
      album: { albumId: `album-${index % 700}`, name: album },
      genres: [{ genreId: `genre-${index % 30}`, name: `Genre ${index % 30}` }],
      duration: 120 + (index % 240),
      year: 2000 + (index % 26),
      isAFavorite: index % 11 === 0,
      isArtworkAvailable: true,
      artworkName: `song-${index}.webp`,
      path: `E:\\Music\\Artist ${index % 400}\\${album}\\${index} track.mp3`,
      addedDate: 1_700_000_000_000 + index,
      sampleRate: 44_100,
      bitrate: 320_000
    } as SavableSongData;
  });

/**
 * Listening history shaped like a heavy user's: three years of it, and the
 * songs listened to most carry the most day-rows.
 */
const buildListeningData = (count: number): SongListeningData[] => {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  return Array.from({ length: count }, (_, index) => {
    const days = 1 + (index % 40);
    const byYear = new Map<number, [number, number][]>();
    for (let step = 0; step < days; step += 1) {
      const at = now - step * 17 * day;
      const year = new Date(at).getFullYear();
      const rows = byYear.get(year) ?? [];
      rows.push([at, 1 + (step % 4)]);
      byYear.set(year, rows);
    }
    return {
      songId: `song-${index}`,
      skips: index % 7,
      fullListens: days,
      inNoOfPlaylists: index % 3,
      listens: [...byYear].map(([year, listens]) => ({ year, listens }))
    };
  });
};

const measure = (label: string, iterations: number, run: () => void): number => {
  run();
  const start = performance.now();
  for (let index = 0; index < iterations; index += 1) run();
  const perCall = (performance.now() - start) / iterations;
  console.info(`${label.padEnd(42)} ${perCall.toFixed(1)} ms/call`);
  return perCall;
};

afterEach(() => resetRuntimeForTests());

(enabled ? describe : describe.skip)('catalog read cost', () => {
  test(`getAllSongs over ${SONG_COUNT} songs`, async () => {
    const port = new MemoryStorePort();
    port.files.set('songs', { unknownRootKeys: {}, payload: buildSongs(SONG_COUNT) });

    const heapBeforeHydration = process.memoryUsage().heapUsed;
    configureRuntime(port, { version: 'test', artwork, events });
    await hydrateRuntime();
    const heapAfterHydration = process.memoryUsage().heapUsed;
    const runtime = getRuntime();

    const first = measure('first page, sorted A-Z', 20, () => {
      runtime.getAllSongs('aToZ', undefined, { start: 0, end: 50 });
    });
    const deep = measure('page 40, same sort', 20, () => {
      runtime.getAllSongs('aToZ', undefined, { start: 2000, end: 2050 });
    });
    const unpaged = measure('every song, unpaginated', 5, () => {
      runtime.getAllSongs('aToZ');
    });
    const byDate = measure('first page, sorted by date added', 20, () => {
      runtime.getAllSongs('dateAddedDescending', undefined, { start: 0, end: 50 });
    });

    // What the catalog COSTS TO HOLD, which is the other half of the question:
    // every store hydrates fully into the heap before the first render.
    const heldBytes = heapAfterHydration - heapBeforeHydration;
    const perRead = (): number => {
      const before = process.memoryUsage().heapUsed;
      for (let index = 0; index < 20; index += 1) {
        runtime.getAllSongs('aToZ', undefined, { start: 0, end: 50 });
      }
      return (process.memoryUsage().heapUsed - before) / 20;
    };
    const allocated = perRead();

    console.info(
      `\nA 50-row page costs ${first.toFixed(1)} ms; the whole catalog costs ${unpaged.toFixed(1)} ms.`
    );
    console.info(
      `Heap the hydrated catalog of ${SONG_COUNT} songs holds: ${(heldBytes / 1024 / 1024).toFixed(1)} MB`
    );
    console.info(`Allocated per 50-row page read: ${(allocated / 1024).toFixed(0)} KB`);
    // The point of the measurement is the numbers above; this only keeps the
    // test honest about having actually produced them.
    expect(first).toBeGreaterThan(0);
    expect(deep).toBeGreaterThan(0);
    expect(byDate).toBeGreaterThan(0);
  }, 120_000);

  test(`getStats over ${SONG_COUNT} songs of listening history`, async () => {
    const port = new MemoryStorePort();
    port.files.set('songs', { unknownRootKeys: {}, payload: buildSongs(SONG_COUNT) });
    port.files.set('listeningData', {
      unknownRootKeys: {},
      payload: buildListeningData(SONG_COUNT)
    });

    configureRuntime(port, { version: 'test', artwork, events });
    await hydrateRuntime();
    const runtime = getRuntime();

    const rows = buildListeningData(SONG_COUNT).reduce(
      (sum, entry) => sum + entry.listens.reduce((days, year) => days + year.listens.length, 0),
      0
    );
    console.info(`listening history: ${rows} day-rows across ${SONG_COUNT} songs`);

    measure('stats, all time', 5, () => runtime.getStats('allTime'));
    measure('stats, last 12 months', 5, () => runtime.getStats('last12Months'));
    measure('stats, last 30 days', 5, () => runtime.getStats('last30Days'));
    expect(runtime.getStats('allTime')).toBeDefined();
  }, 120_000);
});

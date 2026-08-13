/**
 * Runs the real runtime against a COPY of a real profile.
 *
 * The unit suite proves each piece behaves; this proves the pieces still agree
 * on a library that was not designed to make them agree. It exists because the
 * things changed most recently - a cached song order and a cached day lookup -
 * fail in exactly the way a unit test cannot see: they return a stale answer
 * that is internally consistent.
 *
 * Reads only, and from a copy, so it can never touch the profile it describes.
 *
 * ```text
 * NEMORA_PROFILE_FIXTURE="E:\tmp\profile-copy" npx jest realProfile.acceptance
 * ```
 */
import nodeFs from 'node:fs';
import nodePath from 'node:path';

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

const fixture = process.env.NEMORA_PROFILE_FIXTURE;
const maybe = fixture && nodeFs.existsSync(fixture) ? describe : describe.skip;

/** The file each store lives in, and the key its payload sits under. */
const STORE_FILES: Partial<Record<StoreName, [file: string, key: string]>> = {
  songs: ['songs.json', 'songs'],
  artists: ['artists.json', 'artists'],
  albums: ['albums.json', 'albums'],
  genres: ['genres.json', 'genres'],
  playlists: ['playlists.json', 'playlists'],
  userData: ['userdata.json', 'userData'],
  listeningData: ['listening_data.json', 'listeningData'],
  blacklist: ['blacklist.json', 'blacklist'],
  palettes: ['palettes.json', 'palettes'],
  cmrStats: ['cmr_stats.json', 'cmrStats'],
  tierlists: ['tierlists.json', 'tierlists']
};

class ProfileStorePort implements StorePort {
  readonly files = new Map<StoreName, StoreFile<unknown>>();
  readonly writes: StoreName[] = [];

  constructor(directory: string) {
    for (const [store, entry] of Object.entries(STORE_FILES)) {
      const [fileName, key] = entry as [string, string];
      const path = nodePath.join(directory, fileName);
      if (!nodeFs.existsSync(path)) continue;
      const raw = JSON.parse(nodeFs.readFileSync(path, 'utf8')) as Record<string, unknown>;
      this.files.set(store as StoreName, {
        payload: raw[key],
        version: raw.version,
        internal: raw.__internal__ as StoreFile<unknown>['internal'],
        unknownRootKeys: {}
      });
    }
  }

  async exists(store: StoreName): Promise<boolean> {
    return this.files.has(store);
  }

  async read<T>(store: StoreName): Promise<StoreFile<T>> {
    const file = this.files.get(store);
    if (!file) throw new Error(`missing store ${store}`);
    return JSON.parse(JSON.stringify(file)) as StoreFile<T>;
  }

  // Writes stay in memory. The fixture is a copy and this suite never saves.
  async write<T>(store: StoreName, file: StoreFile<T>): Promise<void> {
    this.writes.push(store);
    this.files.set(store, JSON.parse(JSON.stringify(file)) as StoreFile<unknown>);
  }
}

const paths = (name: string): ArtworkPaths => ({
  isDefaultArtwork: false,
  artworkPath: `nemora://${name}`,
  optimizedArtworkPath: `nemora://${name}`
});

const artwork: RuntimeArtworkPaths = {
  song: (id) => paths(`song/${id}`),
  artist: (name) => paths(`artist/${name ?? 'default'}`),
  album: (name) => paths(`album/${name ?? 'default'}`),
  genre: (name) => paths(`genre/${name ?? 'default'}`),
  playlist: (id) => paths(`playlist/${id}`),
  songFile: (path) => `nemora://${path}`
};

const events: RuntimeEventSink = { dataUpdated: jest.fn(), message: jest.fn() };

const SORTS: SongSortTypes[] = [
  'aToZ',
  'zToA',
  'dateAddedAscending',
  'dateAddedDescending',
  'artistNameAscending',
  'albumNameAscending',
  'releasedYearDescending',
  'allTimeMostListened'
];

afterEach(() => resetRuntimeForTests());

maybe('the runtime on a real profile', () => {
  const load = async () => {
    const port = new ProfileStorePort(fixture!);
    configureRuntime(port, { version: 'test', artwork, events });
    await hydrateRuntime();
    return { port, runtime: getRuntime() };
  };

  test('every sort returns the whole library, in a stable and complete order', async () => {
    const { runtime } = await load();
    const total = runtime.getAllSongs('aToZ').total;
    expect(total).toBeGreaterThan(0);
    console.info(`library: ${total} songs`);

    for (const sort of SORTS) {
      const all = runtime.getAllSongs(sort);
      expect(all.total).toBe(total);

      // No song lost and none duplicated by the ordering.
      const ids = new Set(all.data.map((song) => song.songId));
      expect(ids.size).toBe(total);

      // Paging must be a window on that same order, not a second computation.
      const pageSize = Math.min(50, total);
      const page = runtime.getAllSongs(sort, undefined, { start: 0, end: pageSize });
      expect(page.total).toBe(total);
      expect(page.data.map((song) => song.songId)).toEqual(
        all.data.slice(0, pageSize).map((song) => song.songId)
      );

      const deepStart = Math.max(0, total - pageSize);
      const deep = runtime.getAllSongs(sort, undefined, { start: deepStart, end: total });
      expect(deep.data.map((song) => song.songId)).toEqual(
        all.data.slice(deepStart).map((song) => song.songId)
      );
    }
  }, 120_000);

  test('reading the same page twice gives the same answer', async () => {
    const { runtime } = await load();
    for (const sort of SORTS) {
      const first = runtime.getAllSongs(sort, undefined, { start: 0, end: 50 });
      const second = runtime.getAllSongs(sort, undefined, { start: 0, end: 50 });
      expect(second.data.map((song) => song.songId)).toEqual(
        first.data.map((song) => song.songId)
      );
    }
  }, 120_000);

  /**
   * The one a cache gets wrong: an edit must be visible in the NEXT read.
   *
   * Each of these mutates through a different path, and every path has to reach
   * the same invalidation. A stale cache passes the two tests above and fails
   * only here.
   */
  test('a change is visible in the next read, whichever path made it', async () => {
    const { runtime } = await load();
    const before = runtime.getAllSongs('aToZ', undefined, { start: 0, end: 5 });
    const victim = before.data[0];
    expect(victim).toBeDefined();

    runtime.toggleLikeSongs([victim.songId]);
    const afterLike = runtime.getAllSongs('aToZ', undefined, { start: 0, end: 5 });
    expect(afterLike.data[0]?.isAFavorite).toBe(!victim.isAFavorite);

    // A FILTER is a different cache entry than the unfiltered order above, so
    // it has to be invalidated by the same write.
    const whitelisted = runtime.getAllSongs('aToZ', 'whitelistedSongs');
    expect(whitelisted.data.some((song) => song.songId === victim.songId)).toBe(true);

    // Blacklisting changes which songs exist for every sort at once.
    await runtime.blacklistSongs([victim.songId]);
    expect(
      runtime
        .getAllSongs('aToZ', 'whitelistedSongs')
        .data.some((song) => song.songId === victim.songId)
    ).toBe(false);
    expect(
      runtime
        .getAllSongs('aToZ', 'blacklistedSongs')
        .data.some((song) => song.songId === victim.songId)
    ).toBe(true);

    await runtime.restoreBlacklistedSongs([victim.songId]);
    expect(
      runtime
        .getAllSongs('aToZ', 'whitelistedSongs')
        .data.some((song) => song.songId === victim.songId)
    ).toBe(true);
  }, 120_000);

  test('the stats page adds up on every range', async () => {
    const { runtime } = await load();

    for (const range of ['allTime', 'last12Months', 'last30Days'] as StatsTimeRange[]) {
      const stats = runtime.getStats(range);

      // A top song cannot have been played more than everything put together.
      const topListens = stats.topSongs[0]?.listensInRange ?? 0;
      expect(topListens).toBeLessThanOrEqual(stats.totals.totalListens);

      // The calendar is a fixed 53 weeks and its streaks must fit inside it.
      expect(stats.calendar.days).toHaveLength(371);
      expect(stats.calendar.currentStreak).toBeLessThanOrEqual(371);
      expect(stats.calendar.longestStreak).toBeLessThanOrEqual(371);
      expect(stats.calendar.currentStreak).toBeLessThanOrEqual(stats.calendar.longestStreak);

      // Buckets: 30 days daily, everything else 12 months.
      expect(stats.activity).toHaveLength(range === 'last30Days' ? 30 : 12);
      const bucketed = stats.activity.reduce((sum, bucket) => sum + bucket.listens, 0);
      expect(bucketed).toBeLessThanOrEqual(stats.totals.totalListens);

      console.info(
        `${range}: ${stats.totals.totalListens} listens, ` +
          `${Math.round(stats.totals.approxListeningTimeSec / 3600)} h, ` +
          `streak ${stats.calendar.currentStreak}/${stats.calendar.longestStreak}, ` +
          `top "${stats.topSongs[0]?.title ?? '-'}"`
      );
    }
  }, 120_000);

  test('the shorter the range, the fewer listens it can contain', async () => {
    const { runtime } = await load();
    const allTime = runtime.getStats('allTime').totals.totalListens;
    const year = runtime.getStats('last12Months').totals.totalListens;
    const month = runtime.getStats('last30Days').totals.totalListens;

    expect(month).toBeLessThanOrEqual(year);
    expect(year).toBeLessThanOrEqual(allTime);
  }, 120_000);

  test('every song still resolves through the paths the interface uses', async () => {
    const { runtime } = await load();
    const all = runtime.getAllSongs('aToZ');
    const sample = all.data.slice(0, 200).map((song) => song.songId);

    const info = runtime.getSongInfo(sample);
    expect(info).toHaveLength(sample.length);
    for (const song of info) {
      expect(song.title).toBeTruthy();
      expect(song.path).toBeTruthy();
      expect(song.artworkPaths?.artworkPath).toBeTruthy();
    }

    // Durations: a scan that could not read one leaves 0, which is the defect
    // the resync repairs. Reported, not asserted - an old profile legitimately
    // still has them until it is resynced once.
    const zero = all.data.filter((song) => !(song.duration > 0));
    console.info(`songs with no duration: ${zero.length} of ${all.total}`);
  }, 120_000);
});

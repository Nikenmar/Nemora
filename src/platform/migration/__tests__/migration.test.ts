import { createHash, webcrypto } from 'node:crypto';

jest.mock('@tauri-apps/api/core', () => ({ invoke: jest.fn() }));
jest.mock('@tauri-apps/api/path', () => ({
  dataDir: jest.fn(),
  join: jest.fn(),
  tempDir: jest.fn()
}));
jest.mock('@tauri-apps/plugin-fs', () => ({
  copyFile: jest.fn(),
  exists: jest.fn(),
  mkdir: jest.fn(),
  readDir: jest.fn(),
  readFile: jest.fn(),
  readTextFile: jest.fn(),
  remove: jest.fn(),
  stat: jest.fn()
}));

import { encodeUtf8 } from '../bytes';
import { migrateLocalStorage } from '../migration';
import { createStableLevelDbSnapshot } from '../snapshot';
import type {
  FileEntry,
  LocalStorageValues,
  MigrationDependencies,
  MigrationFileSystem,
  MigrationStorage
} from '../types';
import { canonicalValuesBytes } from '../validation';

class MemoryFileSystem implements MigrationFileSystem {
  readonly files = new Map<string, Uint8Array>();
  readonly directories = new Set<string>(['/']);
  readonly mtimes = new Map<string, number>();

  normalize(path: string): string {
    const normalized = path.replaceAll('\\', '/').replace(/\/+$/, '');
    return normalized || '/';
  }

  put(path: string, contents: Uint8Array | string): void {
    const normalized = this.normalize(path);
    this.files.set(normalized, typeof contents === 'string' ? encodeUtf8(contents) : contents);
    this.mtimes.set(normalized, this.mtimes.get(normalized) ?? 1);
    const parent = normalized.slice(0, normalized.lastIndexOf('/')) || '/';
    this.directories.add(parent);
  }

  async exists(path: string): Promise<boolean> {
    const normalized = this.normalize(path);
    return this.files.has(normalized) || this.directories.has(normalized);
  }

  async readText(path: string): Promise<string> {
    return new TextDecoder().decode(await this.readBinary(path));
  }

  async readBinary(path: string): Promise<Uint8Array> {
    const contents = this.files.get(this.normalize(path));
    if (!contents) throw new Error(`missing ${path}`);
    return contents;
  }

  async readDirectory(path: string): Promise<FileEntry[]> {
    const prefix = this.normalize(path) === '/' ? '/' : `${this.normalize(path)}/`;
    const names = new Set<string>();
    for (const file of this.files.keys()) {
      if (!file.startsWith(prefix)) continue;
      const relative = file.slice(prefix.length);
      if (relative && !relative.includes('/')) names.add(relative);
    }
    return [...names].map((name) => ({
      name,
      isFile: true,
      isDirectory: false,
      isSymlink: false
    }));
  }

  async metadata(path: string) {
    const normalized = this.normalize(path);
    return {
      size: (await this.readBinary(normalized)).length,
      mtimeMs: this.mtimes.get(normalized) ?? null
    };
  }

  async copyFile(source: string, destination: string): Promise<void> {
    this.put(destination, new Uint8Array(await this.readBinary(source)));
  }

  async createDirectory(path: string): Promise<void> {
    this.directories.add(this.normalize(path));
  }

  async removeDirectory(path: string): Promise<void> {
    const normalized = this.normalize(path);
    this.directories.delete(normalized);
    for (const file of [...this.files.keys()])
      if (file === normalized || file.startsWith(`${normalized}/`)) this.files.delete(file);
  }

  async join(...parts: string[]): Promise<string> {
    return this.normalize(parts.join('/'));
  }
}

class MemoryStorage implements MigrationStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const sha256 = async (contents: Uint8Array): Promise<string> =>
  createHash('sha256').update(contents).digest('hex');

const compositeLocalStorage = JSON.stringify({
  preferences: {
    seekbarScrollInterval: 5,
    isSongIndexingEnabled: false,
    disableBackgroundArtworks: false,
    doNotShowBlacklistSongConfirm: true,
    doNotVerifyWhenOpeningLinks: false,
    isReducedMotion: false,
    showArtistArtworkNearSongControls: true,
    showSongRemainingTime: false,
    noUpdateNotificationForNewUpdate: '',
    defaultPageOnStartUp: 'Songs',
    enableArtworkFromSongCovers: true,
    shuffleArtworkFromSongCovers: false,
    removeAnimationsOnBatteryPower: true,
    lyricsAutomaticallySaveState: 'NONE',
    showTrackNumberAsSongIndex: false,
    allowToPreventScreenSleeping: true,
    enableImageBasedDynamicThemes: true,
    doNotShowHelpPageOnLyricsEditorStartUp: false,
    autoTranslateLyrics: false,
    autoConvertLyrics: false,
    tierShuffleIntensity: 0.73,
    futurePreference: { preserved: true }
  },
  playback: {
    currentSong: { songId: 'song-1', stoppedPosition: 12.5, playlistId: 'Favorites' },
    isRepeating: 'false',
    isShuffling: true,
    isTierShuffling: true,
    volume: { isMuted: false, value: 0.42 },
    playbackRate: 1
  },
  queue: {
    currentSongIndex: 0,
    queue: ['song-1'],
    queueBeforeShuffle: [0],
    queueId: 'queue-1',
    queueType: 'songs'
  },
  ignoredSeparateArtists: [],
  ignoredSongsWithFeatArtists: [],
  ignoredDuplicates: { artists: [], albums: [], genres: [] },
  sortingStates: { songsPage: 'aToZ' },
  equalizerPreset: {
    thirtyTwoHertzFilter: 0,
    sixtyFourHertzFilter: 0,
    hundredTwentyFiveHertzFilter: 0,
    twoHundredFiftyHertzFilter: 0,
    fiveHundredHertzFilter: 0,
    thousandHertzFilter: 0,
    twoThousandHertzFilter: 0,
    fourThousandHertzFilter: 0,
    eightThousandHertzFilter: 0,
    sixteenThousandHertzFilter: 0
  },
  lyricsEditorSettings: { offset: 0, editNextAndCurrentStartAndEndTagsAutomatically: true },
  duels: {
    frequency: 'normal',
    lastInviteAt: 0,
    listensSinceInvite: 4,
    pendingDuels: 1,
    pendingDuelTickets: [{ anchorSongId: 'song-1', earnedAt: 123 }],
    duelAnchorCandidates: [{ songId: 'song-2', listenedAt: 456 }],
    pendingDuelPairs: [['song-1', 'song-2']]
  },
  futureRoot: { preserved: true }
});

const songGuessr = JSON.stringify({
  version: 1,
  stats: {
    gamesPlayed: 5,
    wins: 4,
    losses: 1,
    currentStreak: 2,
    maxStreak: 3,
    distribution: [1, 1, 1, 1, 0, 0],
    lastPlayedAt: 100,
    skips: 2,
    firstPlayedAt: 10,
    recentRounds: [
      { at: 100, won: true, attempts: 2, songId: 'song-1', title: 'Title', artists: ['Artist'] }
    ]
  },
  poolType: 'library',
  recentSongIds: ['song-1'],
  futureField: 'preserve-exactly'
});

const values: LocalStorageValues = {
  version: '3.4.5-CMR-Fork',
  localStorage: compositeLocalStorage,
  nora_song_guessr: songGuessr
};

interface Harness {
  dependencies: MigrationDependencies;
  fileSystem: MemoryFileSystem;
  storage: MemoryStorage;
  committedMarkers: number;
  failNextAtomicWrite: boolean;
}

const createHarness = async (withBridge = true): Promise<Harness> => {
  const fileSystem = new MemoryFileSystem();
  const storage = new MemoryStorage();
  const harness = {
    fileSystem,
    storage,
    committedMarkers: 0,
    failNextAtomicWrite: false
  } as Harness;
  if (withBridge) {
    const checksum = await sha256(canonicalValuesBytes(values));
    fileSystem.put(
      '/profile/tauri-bridge-localstorage.json',
      JSON.stringify({
        formatVersion: 1,
        sourceAppVersion: '3.4.5-CMR-Fork',
        exportedAt: '2026-08-11T12:00:00.000Z',
        values,
        checksum
      })
    );
  }
  let snapshotIndex = 0;
  harness.dependencies = {
    fileSystem,
    paths: {
      bridgeExport: async () => '/profile/tauri-bridge-localstorage.json',
      marker: async () => '/profile/tauri-migration-v1.json',
      legacyLevelDb: async () => '/profile/leveldb',
      createSnapshotDirectory: async () => `/tmp/snapshot-${++snapshotIndex}`
    },
    storage,
    atomicWrite: async (path, contents) => {
      if (harness.failNextAtomicWrite) {
        harness.failNextAtomicWrite = false;
        throw new Error('injected crash before atomic marker commit');
      }
      fileSystem.put(path, contents);
      harness.committedMarkers += 1;
    },
    sha256,
    now: () => new Date('2026-08-11T13:00:00.000Z')
  };
  return harness;
};

beforeAll(() => {
  if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
});

describe('localStorage migration decision flow', () => {
  test('imports exact bridge values, verifies read-back, and commits one idempotent marker', async () => {
    const harness = await createHarness();
    const first = await migrateLocalStorage(harness.dependencies);
    expect(first.status).toBe('migrated');
    expect(Object.fromEntries(harness.storage.values)).toEqual(values);
    expect(harness.committedMarkers).toBe(1);

    const second = await migrateLocalStorage(harness.dependencies);
    expect(second.status).toBe('already-migrated');
    expect(harness.committedMarkers).toBe(1);
    expect(Object.fromEntries(harness.storage.values)).toEqual(values);
  });

  test('is crash-idempotent after import but before marker commit', async () => {
    const harness = await createHarness();
    harness.failNextAtomicWrite = true;
    await expect(migrateLocalStorage(harness.dependencies)).rejects.toThrow(/injected crash/);
    expect(Object.fromEntries(harness.storage.values)).toEqual(values);
    expect(await harness.fileSystem.exists('/profile/tauri-migration-v1.json')).toBe(false);

    await expect(migrateLocalStorage(harness.dependencies)).resolves.toMatchObject({
      status: 'migrated'
    });
    expect(harness.committedMarkers).toBe(1);
    expect(Object.fromEntries(harness.storage.values)).toEqual(values);
  });

  test('allows defaults only when neither bridge nor legacy database exists', async () => {
    const harness = await createHarness(false);
    harness.storage.setItem('unrelated', 'keep');
    await expect(migrateLocalStorage(harness.dependencies)).resolves.toEqual({
      status: 'new-install'
    });
    expect(Object.fromEntries(harness.storage.values)).toEqual({ unrelated: 'keep' });
    expect(harness.committedMarkers).toBe(0);
  });

  test('fails closed for an invalid bridge when there is no legacy database', async () => {
    const harness = await createHarness(false);
    harness.fileSystem.put('/profile/tauri-bridge-localstorage.json', '{broken');
    await expect(migrateLocalStorage(harness.dependencies)).rejects.toThrow(/refusing defaults/i);
    expect(harness.storage.values.size).toBe(0);
    expect(harness.committedMarkers).toBe(0);
  });

  test('fails closed when a legacy database exists but cannot be read', async () => {
    const harness = await createHarness(false);
    harness.fileSystem.directories.add('/profile/leveldb');
    harness.fileSystem.put('/profile/leveldb/not-a-leveldb', 'evidence');
    await expect(migrateLocalStorage(harness.dependencies)).rejects.toThrow(
      /refusing to initialize defaults/i
    );
    expect(harness.storage.values.size).toBe(0);
    expect(harness.committedMarkers).toBe(0);
  });

  test('does not replay the source over legitimate post-migration renderer writes', async () => {
    const harness = await createHarness();
    await migrateLocalStorage(harness.dependencies);
    harness.storage.setItem('nora_song_guessr', '{"newTauriHistory":true}');
    await expect(migrateLocalStorage(harness.dependencies)).resolves.toMatchObject({
      status: 'already-migrated'
    });
    expect(harness.storage.getItem('nora_song_guessr')).toBe('{"newTauriHistory":true}');
    expect(harness.committedMarkers).toBe(1);
  });
});

test('snapshot retries when the source changes during a copy and hashes only a stable copy', async () => {
  const harness = await createHarness(false);
  harness.fileSystem.directories.add('/profile/leveldb');
  harness.fileSystem.put('/profile/leveldb/CURRENT', 'MANIFEST-000001\n');
  harness.fileSystem.put('/profile/leveldb/MANIFEST-000001', 'manifest');
  const originalReadDirectory = harness.fileSystem.readDirectory.bind(harness.fileSystem);
  let sourceScans = 0;
  harness.fileSystem.readDirectory = async (path) => {
    const result = await originalReadDirectory(path);
    if (path === '/profile/leveldb' && ++sourceScans === 2)
      harness.fileSystem.mtimes.set('/profile/leveldb/MANIFEST-000001', 2);
    return result;
  };

  const snapshot = await createStableLevelDbSnapshot(harness.dependencies, '/profile/leveldb');
  expect(snapshot.directory).toBe('/tmp/snapshot-2');
  expect(snapshot.sourceHashes).toEqual({
    CURRENT: expect.stringMatching(/^[a-f0-9]{64}$/),
    'MANIFEST-000001': expect.stringMatching(/^[a-f0-9]{64}$/)
  });
  expect(await harness.fileSystem.exists('/tmp/snapshot-1')).toBe(false);
});

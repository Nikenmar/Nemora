import { jest } from '@jest/globals';

import { joinPath } from '../../transfer/joinPath';
import { STORE_LAYOUT } from '../../../contracts/store';
import type { FileEntry, LocalStorageValues, MigrationFileSystem } from '../../../migration/types';
import { concatBytes, crc32c, encodeUtf8, maskCrc32c } from '../../../migration/bytes';
import type { CoreLogger } from '../../playlists/logger';
import type { NoraImportPort } from '../noraImportRepository';

export const NORA_ROOT = 'E:\\tmp\\nora-profile';
export const NEMORA_ROOT = 'E:\\tmp\\nemora-profile';
export const SNAPSHOT_ROOT = 'E:\\tmp\\snapshots';

export const decodeUtf8 = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

// ---------------------------------------------------------------------------
// In-memory filesystem
// ---------------------------------------------------------------------------

export class MemoryFileSystem implements MigrationFileSystem {
  readonly files: Map<string, Uint8Array>;
  readonly dirs: Set<string>;

  constructor(files: Map<string, Uint8Array> = new Map(), dirs: Set<string> = new Set()) {
    this.files = files;
    this.dirs = dirs;
  }

  put(path: string, contents: string | Uint8Array): void {
    this.files.set(path, typeof contents === 'string' ? encodeUtf8(contents) : contents);
  }

  list(path: string): string[] {
    const prefix = `${path}\\`;
    const names = new Set<string>();
    for (const file of this.files.keys()) {
      if (!file.startsWith(prefix)) continue;
      const rest = file.slice(prefix.length);
      if (!rest.includes('\\')) names.add(rest);
    }
    for (const dir of this.dirs) {
      if (!dir.startsWith(prefix)) continue;
      const rest = dir.slice(prefix.length);
      if (!rest.includes('\\')) names.add(rest);
    }
    return [...names];
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.dirs.has(path);
  }

  async readText(path: string): Promise<string> {
    return decodeUtf8(await this.readBinary(path));
  }

  async readBinary(path: string): Promise<Uint8Array> {
    const value = this.files.get(path);
    if (value === undefined) throw new Error(`ENOENT: no such file, open '${path}'`);
    return value;
  }

  async readDirectory(path: string): Promise<FileEntry[]> {
    const entries: FileEntry[] = [];
    for (const name of this.list(path)) {
      const full = joinPath(path, name);
      entries.push({
        name,
        isFile: this.files.has(full),
        isDirectory: this.dirs.has(full),
        isSymlink: false
      });
    }
    return entries;
  }

  async metadata(path: string): Promise<{ size: number; mtimeMs: number | null }> {
    return { size: (await this.readBinary(path)).length, mtimeMs: 1 };
  }

  async copyFile(source: string, destination: string): Promise<void> {
    this.put(destination, new Uint8Array(await this.readBinary(source)));
  }

  async createDirectory(path: string): Promise<void> {
    this.dirs.add(path);
  }

  async removeDirectory(path: string): Promise<void> {
    this.dirs.delete(path);
    for (const file of [...this.files.keys()])
      if (file.startsWith(`${path}\\`)) this.files.delete(file);
    for (const dir of [...this.dirs]) if (dir.startsWith(`${path}\\`)) this.dirs.delete(dir);
  }

  async join(...parts: string[]): Promise<string> {
    return joinPath(...parts);
  }
}

// ---------------------------------------------------------------------------
// Port mock
// ---------------------------------------------------------------------------

export const fakeSha256 = async (contents: Uint8Array): Promise<string> => {
  let hash = 2166136261;
  for (const byte of contents) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0').repeat(8);
};

export const FIXED_NOW = new Date('2026-08-11T12:00:00.000Z');
export const BACKUP_DIR = joinPath(NEMORA_ROOT, 'backups', 'nora-import-2026-08-11T12-00-00-000Z');

export interface MockNoraImportPort extends NoraImportPort {
  files: Map<string, Uint8Array>;
  dirs: Set<string>;
  events: string[];
  storageMap: Map<string, string>;
  logger: CoreLogger;
}

export const createMockNoraImportPort = (
  files: Map<string, Uint8Array>,
  dirs: Set<string>,
  overrides: Partial<NoraImportPort> = {}
): MockNoraImportPort => {
  const fs = new MemoryFileSystem(files, dirs);
  const events: string[] = [];
  const storageMap = new Map<string, string>();
  const logger = {
    debug: jest.fn<(message: string, data?: Record<string, unknown>) => void>(),
    info: jest.fn<(message: string, data?: Record<string, unknown>) => void>(),
    warn: jest.fn<(message: string, data?: Record<string, unknown>) => void>(),
    error: jest.fn<(message: string, data?: Record<string, unknown>) => void>()
  } as unknown as CoreLogger;

  const port: MockNoraImportPort = {
    files,
    dirs,
    events,
    storageMap,
    logger,
    fileSystem: fs,
    noraProfilePath: async (...segments) => joinPath(NORA_ROOT, ...segments),
    nemoraProfilePath: async (...segments) => joinPath(NEMORA_ROOT, ...segments),
    createSnapshotDirectory: async () => joinPath(SNAPSHOT_ROOT, 'leveldb-snapshot'),
    writeTextFileAtomic: async (path, contents) => {
      events.push(`write:${path}`);
      files.set(path, encodeUtf8(contents));
    },
    writeFileAtomic: async (path, contents) => {
      events.push(`writeBytes:${path}`);
      files.set(path, new Uint8Array(contents));
    },
    copyFileAtomic: async (source, destination) => {
      events.push(`copyFileAtomic:${destination}`);
      const bytes = files.get(source);
      if (bytes === undefined) throw new Error(`ENOENT: no such file, open '${source}'`);
      files.set(destination, new Uint8Array(bytes));
    },
    removeFile: async (path) => {
      events.push(`removeFile:${path}`);
      files.delete(path);
    },
    storage: {
      getItem: (key) => storageMap.get(key) ?? null,
      setItem: (key, value) => {
        events.push(`storage:set:${key}`);
        storageMap.set(key, value);
      },
      removeItem: (key) => {
        events.push(`storage:remove:${key}`);
        storageMap.delete(key);
      }
    },
    sha256: fakeSha256,
    now: () => FIXED_NOW,
    ...overrides
  };
  return port;
};

// ---------------------------------------------------------------------------
// Minimal read-only LevelDB fixture builder (CURRENT + MANIFEST + one .log)
// ---------------------------------------------------------------------------

const varint = (input: number): Uint8Array => {
  let value = input;
  const result: number[] = [];
  do {
    let byte = value & 0x7f;
    value >>>= 7;
    if (value > 0) byte |= 0x80;
    result.push(byte);
  } while (value > 0);
  return new Uint8Array(result);
};

const fixed64 = (value: bigint): Uint8Array => {
  const result = new Uint8Array(8);
  for (let index = 0; index < 8; index += 1)
    result[index] = Number((value >> BigInt(index * 8)) & 0xffn);
  return result;
};

const lengthPrefixed = (value: Uint8Array): Uint8Array => concatBytes(varint(value.length), value);

const logFile = (...logicalRecords: Uint8Array[]): Uint8Array => {
  const physical: Uint8Array[] = [];
  for (const record of logicalRecords) {
    const type = new Uint8Array([1]);
    const checksum = maskCrc32c(crc32c(concatBytes(type, record)));
    physical.push(
      concatBytes(
        new Uint8Array([
          checksum & 0xff,
          (checksum >>> 8) & 0xff,
          (checksum >>> 16) & 0xff,
          (checksum >>> 24) & 0xff
        ]),
        new Uint8Array([record.length & 0xff, record.length >>> 8]),
        type,
        record
      )
    );
  }
  return concatBytes(...physical);
};

const writeBatch = (
  sequence: bigint,
  records: Array<{ key: Uint8Array; value?: Uint8Array }>
): Uint8Array => {
  const body: Uint8Array[] = [];
  for (const record of records) {
    body.push(new Uint8Array([record.value ? 1 : 0]), lengthPrefixed(record.key));
    if (record.value) body.push(lengthPrefixed(record.value));
  }
  const count = Number(records.length);
  const countBytes = new Uint8Array([
    count & 0xff,
    (count >>> 8) & 0xff,
    (count >>> 16) & 0xff,
    (count >>> 24) & 0xff
  ]);
  return concatBytes(fixed64(sequence), countBytes, ...body);
};

const chromiumString = (value: string): Uint8Array => {
  if ([...value].every((character) => character.charCodeAt(0) <= 0xff))
    return concatBytes(
      new Uint8Array([1]),
      new Uint8Array([...value].map((character) => character.charCodeAt(0)))
    );
  const bytes: number[] = [0];
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    bytes.push(code & 0xff, code >>> 8);
  }
  return new Uint8Array(bytes);
};

const mapKey = (origin: string, key: string): Uint8Array =>
  concatBytes(encodeUtf8(`_${origin}\0`), chromiumString(key));

const manifestEdit = (options: { logNumber: number }): Uint8Array =>
  concatBytes(varint(2), varint(options.logNumber));

/** Writes CURRENT, MANIFEST-000001 and 000006.log with the given localStorage values. */
export const putLevelDb = (
  files: Map<string, Uint8Array>,
  directory: string,
  values: Record<string, string>
): void => {
  const records: Array<{ key: Uint8Array; value?: Uint8Array }> = [
    { key: encodeUtf8('VERSION'), value: encodeUtf8('1') }
  ];
  for (const [key, value] of Object.entries(values))
    records.push({ key: mapKey('file://', key), value: chromiumString(value) });

  files.set(joinPath(directory, 'CURRENT'), encodeUtf8('MANIFEST-000001\n'));
  files.set(joinPath(directory, 'MANIFEST-000001'), logFile(manifestEdit({ logNumber: 6 })));
  files.set(joinPath(directory, '000006.log'), logFile(writeBatch(100n, records)));
};

// ---------------------------------------------------------------------------
// Store envelope builder (electron-store / conf shape)
// ---------------------------------------------------------------------------

interface StoreTextOptions {
  version?: string;
  internal?: boolean;
  rootExtras?: Record<string, unknown>;
}

export const storeText = (
  payloadKey: string,
  payload: unknown,
  options: StoreTextOptions = {}
): string => {
  const version = options.version ?? '3.4.5-CMR-Fork';
  const root: Record<string, unknown> = {
    version,
    [payloadKey]: payload,
    ...options.rootExtras
  };
  if (options.internal !== false) root.__internal__ = { migrations: { version } };
  return JSON.stringify(root, null, 2);
};

// ---------------------------------------------------------------------------
// Fixture payloads
// ---------------------------------------------------------------------------

export const FORK_SONGS = [
  {
    songId: 's1',
    title: 'Midnight Drive',
    artists: [{ artistId: 'a1', name: 'Artist One' }],
    duration: 210,
    isAFavorite: false,
    isArtworkAvailable: true,
    path: 'D:\\Library\\midnight_drive.mp3',
    addedDate: 1700000000000
  },
  {
    songId: 's2',
    title: 'Slow Waves',
    artists: [{ artistId: 'a2', name: 'Artist Two' }],
    duration: 184.5,
    isAFavorite: true,
    isArtworkAvailable: true,
    path: 'D:\\Library\\slow_waves.flac',
    addedDate: 1700000000000,
    paletteId: 'pal-1'
  },
  {
    songId: 's3',
    title: 'Echoes',
    artists: [],
    duration: 241,
    isAFavorite: false,
    isArtworkAvailable: false,
    path: 'D:\\Library\\echoes.mp3',
    addedDate: 1700000000000
  }
];

export const FORK_ARTISTS = [
  {
    artistId: 'a1',
    songs: [{ title: 'Midnight Drive', songId: 's1' }],
    albums: [],
    name: 'Artist One',
    isAFavorite: false
  },
  {
    artistId: 'a2',
    songs: [{ title: 'Slow Waves', songId: 's2' }],
    albums: [],
    name: 'Artist Two',
    isAFavorite: true
  }
];

export const FORK_ALBUMS = [
  {
    albumId: 'al-1',
    title: 'Night Sessions',
    artists: [{ name: 'Artist One', artistId: 'a1' }],
    songs: [{ title: 'Midnight Drive', songId: 's1' }],
    year: 2025
  }
];

export const FORK_GENRES = [
  { genreId: 'g-1', name: 'Synthwave', songs: [{ title: 'Midnight Drive', songId: 's1' }] }
];

export const FORK_PLAYLISTS = [
  {
    playlistId: 'Favorites',
    name: 'Favorites',
    songs: ['s2'],
    createdDate: '2024-01-01T00:00:00.000Z',
    isArtworkAvailable: false
  },
  {
    playlistId: 'pl-1',
    name: 'Road Trip',
    songs: ['s1', 's2'],
    createdDate: '2025-06-01T00:00:00.000Z',
    isArtworkAvailable: true
  }
];

export const FORK_USER_DATA = {
  language: 'en',
  theme: { isDarkMode: true, background: { isDefault: true } },
  musicFolders: [],
  preferences: {
    autoLaunchApp: false,
    openWindowMaximizedOnStart: false,
    openWindowAsHiddenOnSystemStart: false,
    isMiniPlayerAlwaysOnTop: false,
    isMusixmatchLyricsEnabled: true,
    hideWindowOnClose: false,
    sendSongScrobblingDataToLastFM: false,
    sendSongFavoritesDataToLastFM: false,
    sendNowPlayingSongDataToLastFM: false,
    saveLyricsInLrcFilesForSupportedSongs: false,
    enableDiscordRPC: false,
    saveVerboseLogs: false
  },
  windowPositions: {},
  windowDiamensions: {},
  windowState: { isMaximized: false },
  recentSearches: ['midnight'],
  storageMetrics: {}
};

export const FORK_LISTENING = [
  {
    songId: 's1',
    fullListens: 5,
    skips: 2,
    listens: [{ year: 2025, listens: [[1735689600000, 3]] }]
  },
  {
    songId: 's2',
    fullListens: 1,
    listens: [{ year: 2025, listens: [[1735689600000, 1]] }],
    seeks: [{ position: 30, seeks: 2 }]
  }
];

export const FORK_BLACKLIST = { songBlacklist: [], folderBlacklist: [] };

export const FORK_TIERLISTS = [
  {
    tierlistId: 't-1',
    name: 'Essentials',
    createdDate: '2025-06-01T00:00:00.000Z',
    sourcePlaylistIds: ['pl-1'],
    tiers: [{ tierId: 'tr-1', name: 'S', items: ['s1'] }],
    labelMode: 'track'
  }
];

export const FORK_CMR_STATS = {
  elo: {
    ratings: { s1: { rating: 1243.5, games: 10, wins: 6, losses: 4 } },
    history: [
      { at: 1735689600000, songAId: 's1', songBId: 's2', winner: 'A', deltaA: 10, deltaB: -10 }
    ],
    totalDuels: 10
  },
  importedStatsExportIds: [],
  duelMatchmaking: { skippedPairs: [] }
};

export const FORK_PALETTES = [
  {
    paletteId: 'pal-1',
    Vibrant: { hsl: [0.5, 0.5, 0.5], hex: '#808080', population: 100 }
  }
];

export const FORK_LOCAL_STORAGE = {
  preferences: {
    seekbarScrollInterval: 5,
    isSongIndexingEnabled: true,
    disableBackgroundArtworks: false,
    doNotShowBlacklistSongConfirm: false,
    doNotVerifyWhenOpeningLinks: false,
    isReducedMotion: false,
    showArtistArtworkNearSongControls: true,
    showSongRemainingTime: false,
    noUpdateNotificationForNewUpdate: '',
    defaultPageOnStartUp: 'Songs',
    enableArtworkFromSongCovers: true,
    shuffleArtworkFromSongCovers: false,
    removeAnimationsOnBatteryPower: false,
    lyricsAutomaticallySaveState: 'SYNCED',
    showTrackNumberAsSongIndex: false,
    allowToPreventScreenSleeping: false,
    enableImageBasedDynamicThemes: false,
    doNotShowHelpPageOnLyricsEditorStartUp: false,
    autoTranslateLyrics: false,
    autoConvertLyrics: false,
    tierShuffleIntensity: 0.6
  },
  playback: {
    currentSong: { songId: 's1', stoppedPosition: 42, playlistId: 'pl-1' },
    isRepeating: 'false',
    isShuffling: true,
    isTierShuffling: false,
    volume: { isMuted: false, value: 0.8 },
    playbackRate: 1
  },
  queue: {
    currentSongIndex: 0,
    queue: ['s1', 's2'],
    queueBeforeShuffle: [0, 1],
    queueId: 'q-1',
    queueType: 'playlist'
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
    listensSinceInvite: 2,
    pendingDuels: 1,
    pendingDuelTickets: [{ anchorSongId: 's2', earnedAt: 1735689600000 }],
    duelAnchorCandidates: [],
    pendingDuelPairs: []
  }
};

export const FORK_SONG_GUESSR = {
  version: 1,
  poolType: 'library',
  recentSongIds: [],
  stats: {
    gamesPlayed: 3,
    wins: 2,
    losses: 1,
    currentStreak: 1,
    maxStreak: 2,
    lastPlayedAt: 1735689600000,
    distribution: [0, 0, 0, 0, 0, 0]
  }
};

// --- upstream Nora 3.1.0 shape (no fork-only stores, older schema) ---

export const UPSTREAM_SONGS = [
  {
    songId: 'u1',
    title: 'First Light',
    artists: [{ artistId: 'ua1', name: 'Upstream Artist' }],
    duration: 200,
    isAFavorite: false,
    isArtworkAvailable: true,
    path: 'D:\\Music\\first_light.mp3',
    addedDate: 1600000000000
  },
  {
    songId: 'u2',
    title: 'Second Wave',
    artists: [],
    duration: 178,
    isAFavorite: true,
    isArtworkAvailable: false,
    path: 'D:\\Music\\second_wave.flac',
    addedDate: 1600000000000
  }
];

export const UPSTREAM_ARTISTS = [
  {
    artistId: 'ua1',
    songs: [{ title: 'First Light', songId: 'u1' }],
    name: 'Upstream Artist',
    isAFavorite: false
  }
];

export const UPSTREAM_ALBUMS = [
  { albumId: 'ual-1', title: 'Dawn', artists: [], songs: [{ title: 'First Light', songId: 'u1' }] }
];

export const UPSTREAM_GENRES = [
  { genreId: 'ug-1', name: 'Ambient', songs: [{ title: 'First Light', songId: 'u1' }] }
];

export const UPSTREAM_PLAYLISTS = [
  {
    playlistId: 'Favorites',
    name: 'Favorites',
    songs: ['u2'],
    createdDate: '2023-01-01T00:00:00.000Z',
    isArtworkAvailable: false
  }
];

export const UPSTREAM_USER_DATA = {
  language: 'en',
  theme: { isDarkMode: false },
  musicFolders: [],
  preferences: {
    autoLaunchApp: false,
    openWindowMaximizedOnStart: false,
    openWindowAsHiddenOnSystemStart: false,
    isMiniPlayerAlwaysOnTop: false,
    isMusixmatchLyricsEnabled: false,
    hideWindowOnClose: false,
    sendSongScrobblingDataToLastFM: false,
    sendSongFavoritesDataToLastFM: false,
    sendNowPlayingSongDataToLastFM: false,
    saveLyricsInLrcFilesForSupportedSongs: false,
    enableDiscordRPC: false,
    saveVerboseLogs: false
  },
  windowPositions: {},
  windowDiamensions: {},
  windowState: { isMaximized: false },
  recentSearches: []
};

export const UPSTREAM_LISTENING = [
  { songId: 'u1', fullListens: 12, listens: [{ year: 2024, listens: [[1704067200000, 4]] }] }
];

export const UPSTREAM_BLACKLIST = { songBlacklist: [], folderBlacklist: [] };

export const UPSTREAM_PALETTES = [
  { paletteId: 'upal-1', Vibrant: { hsl: [0.2, 0.4, 0.6], hex: '#336699', population: 50 } }
];

// The 3.1.0 composite predates the fork's duels / tierShuffle fields.
export const UPSTREAM_LOCAL_STORAGE = {
  preferences: {
    seekbarScrollInterval: 3,
    isSongIndexingEnabled: false,
    disableBackgroundArtworks: false,
    doNotShowBlacklistSongConfirm: false,
    doNotVerifyWhenOpeningLinks: false,
    isReducedMotion: false,
    showArtistArtworkNearSongControls: false,
    showSongRemainingTime: false,
    noUpdateNotificationForNewUpdate: '3.1.0',
    defaultPageOnStartUp: 'Songs',
    enableArtworkFromSongCovers: true,
    shuffleArtworkFromSongCovers: false,
    removeAnimationsOnBatteryPower: false,
    lyricsAutomaticallySaveState: 'NONE',
    showTrackNumberAsSongIndex: false,
    allowToPreventScreenSleeping: false,
    enableImageBasedDynamicThemes: false,
    doNotShowHelpPageOnLyricsEditorStartUp: false,
    autoTranslateLyrics: false,
    autoConvertLyrics: false
  },
  playback: {
    currentSong: { songId: 'u1', stoppedPosition: 0 },
    isRepeating: 'false',
    isShuffling: false,
    volume: { isMuted: false, value: 1 },
    playbackRate: 1
  },
  queue: { currentSongIndex: null, queue: [], queueType: 'songs' },
  ignoredSeparateArtists: [],
  ignoredSongsWithFeatArtists: [],
  ignoredDuplicates: { artists: [], albums: [], genres: [] },
  sortingStates: {},
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
  lyricsEditorSettings: { offset: 0, editNextAndCurrentStartAndEndTagsAutomatically: false }
};

// ---------------------------------------------------------------------------
// Full profile builders
// ---------------------------------------------------------------------------

const putStores = (
  files: Map<string, Uint8Array>,
  root: string,
  entries: Array<
    [fileName: string, payloadKey: string, payload: unknown, options?: StoreTextOptions]
  >
): void => {
  for (const [fileName, payloadKey, payload, options] of entries)
    files.set(joinPath(root, fileName), encodeUtf8(storeText(payloadKey, payload, options)));
};

export interface ProfileFixture {
  files: Map<string, Uint8Array>;
  dirs: Set<string>;
}

/** A CMR-fork-shaped Nora profile: all eleven stores, full LevelDB, covers. */
export const buildForkProfile = (): ProfileFixture => {
  const files = new Map<string, Uint8Array>();
  const dirs = new Set<string>([
    NORA_ROOT,
    joinPath(NORA_ROOT, 'Local Storage'),
    joinPath(NORA_ROOT, 'Local Storage', 'leveldb'),
    joinPath(NORA_ROOT, 'song_covers')
  ]);

  putStores(files, NORA_ROOT, [
    ['songs.json', 'songs', FORK_SONGS],
    ['artists.json', 'artists', FORK_ARTISTS],
    ['albums.json', 'albums', FORK_ALBUMS],
    ['genres.json', 'genres', FORK_GENRES],
    ['playlists.json', 'playlists', FORK_PLAYLISTS],
    ['userData.json', 'userData', FORK_USER_DATA],
    ['listening_data.json', 'listeningData', FORK_LISTENING],
    ['blacklist.json', 'blacklist', FORK_BLACKLIST],
    ['tierlists.json', 'tierlists', FORK_TIERLISTS, { internal: false }],
    ['cmr_stats.json', 'cmrStats', FORK_CMR_STATS, { internal: false }],
    ['palettes.json', 'palettes', FORK_PALETTES, { internal: false }]
  ]);

  putLevelDb(files, joinPath(NORA_ROOT, 'Local Storage', 'leveldb'), {
    version: '3.4.5-CMR-Fork',
    localStorage: JSON.stringify(FORK_LOCAL_STORAGE),
    nora_song_guessr: JSON.stringify(FORK_SONG_GUESSR)
  });

  for (const cover of ['s1.webp', 's1-optimized.webp', 'pl-1.webp', 't-1-tl.webp'])
    files.set(joinPath(NORA_ROOT, 'song_covers', cover), encodeUtf8(`cover:${cover}`));

  return { files, dirs };
};

/**
 * An upstream-Nora-3.1.0-shaped profile: nine stores (NO tierlists.json,
 * NO cmr_stats.json), LevelDB without SongGuessr/duel keys, older schema.
 */
export const buildUpstreamProfile = (): ProfileFixture => {
  const files = new Map<string, Uint8Array>();
  const dirs = new Set<string>([
    NORA_ROOT,
    joinPath(NORA_ROOT, 'Local Storage'),
    joinPath(NORA_ROOT, 'Local Storage', 'leveldb'),
    joinPath(NORA_ROOT, 'song_covers')
  ]);

  putStores(files, NORA_ROOT, [
    ['songs.json', 'songs', UPSTREAM_SONGS, { version: '3.1.0' }],
    ['artists.json', 'artists', UPSTREAM_ARTISTS, { version: '3.1.0' }],
    ['albums.json', 'albums', UPSTREAM_ALBUMS, { version: '3.1.0' }],
    ['genres.json', 'genres', UPSTREAM_GENRES, { version: '3.1.0' }],
    ['playlists.json', 'playlists', UPSTREAM_PLAYLISTS, { version: '3.1.0' }],
    ['userData.json', 'userData', UPSTREAM_USER_DATA, { version: '3.1.0' }],
    ['listening_data.json', 'listeningData', UPSTREAM_LISTENING, { version: '3.1.0' }],
    ['blacklist.json', 'blacklist', UPSTREAM_BLACKLIST, { version: '3.1.0' }],
    ['palettes.json', 'palettes', UPSTREAM_PALETTES, { version: '3.1.0', internal: false }]
  ]);

  putLevelDb(files, joinPath(NORA_ROOT, 'Local Storage', 'leveldb'), {
    version: '3.1.0',
    localStorage: JSON.stringify(UPSTREAM_LOCAL_STORAGE)
  });

  for (const cover of ['u1.webp', 'u1-optimized.webp'])
    files.set(joinPath(NORA_ROOT, 'song_covers', cover), encodeUtf8(`cover:${cover}`));

  return { files, dirs };
};

/**
 * A pre-existing Nemora profile that will be replaced: own stores, own
 * fork-only stores (removed when importing from upstream) and own covers.
 */
export const buildNemoraProfile = (): ProfileFixture => {
  const files = new Map<string, Uint8Array>();
  const dirs = new Set<string>([NEMORA_ROOT, joinPath(NEMORA_ROOT, 'song_covers')]);

  putStores(files, NEMORA_ROOT, [
    [
      'songs.json',
      'songs',
      [
        {
          songId: 'n1',
          title: 'Nemora Song',
          artists: [],
          duration: 100,
          isAFavorite: false,
          isArtworkAvailable: true,
          path: 'D:\\Nemora\\n1.mp3',
          addedDate: 1
        }
      ]
    ],
    ['tierlists.json', 'tierlists', [], { internal: false }],
    [
      'cmr_stats.json',
      'cmrStats',
      {
        elo: { ratings: {}, history: [], totalDuels: 0 },
        importedStatsExportIds: ['old-export']
      },
      { internal: false }
    ]
  ]);

  for (const cover of ['n1.webp', 'n1-optimized.webp'])
    files.set(joinPath(NEMORA_ROOT, 'song_covers', cover), encodeUtf8(`nemora-cover:${cover}`));

  return { files, dirs };
};

/** Convenience text reader for assertions. */
export const textOf = (files: Map<string, Uint8Array>, path: string): string => {
  const bytes = files.get(path);
  if (bytes === undefined) throw new Error(`missing fixture file ${path}`);
  return decodeUtf8(bytes);
};

/** Store file names, for reading fixtures back. */
export const storeFileName = (store: keyof typeof STORE_LAYOUT): string => STORE_LAYOUT[store].file;

export const EMPTY_LOCAL_STORAGE_VALUES: LocalStorageValues = {
  version: null,
  localStorage: null,
  nora_song_guessr: null
};

import { STORE_LAYOUT, type StoreFile, type StoreName, type StorePort } from '../contracts/store';

export const STORE_NAMES = Object.freeze(Object.keys(STORE_LAYOUT) as StoreName[]);

export type StoreDefaults = Record<StoreName, StoreFile<unknown>>;

const STORES_WITH_ELECTRON_MIGRATION_METADATA = new Set<StoreName>([
  'songs',
  'artists',
  'albums',
  'genres',
  'playlists',
  'userData',
  'listeningData',
  'blacklist'
]);

const jsonClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const defaultUserData = () => ({
  language: 'en',
  theme: { isDarkMode: false, useSystemTheme: true },
  musicFolders: [],
  preferences: {
    autoLaunchApp: false,
    isMiniPlayerAlwaysOnTop: false,
    isMusixmatchLyricsEnabled: false,
    hideWindowOnClose: false,
    openWindowAsHiddenOnSystemStart: false,
    openWindowMaximizedOnStart: false,
    sendSongScrobblingDataToLastFM: false,
    sendSongFavoritesDataToLastFM: false,
    sendNowPlayingSongDataToLastFM: false,
    saveLyricsInLrcFilesForSupportedSongs: false,
    // On by default, unlike upstream. It costs nothing while idle - the IPC
    // connection is opened by the first playback event, not at startup - and
    // it is the one feature nobody discovers unless it is already working.
    // It does publish what you are listening to, so the Settings toggle stays
    // the way out. Existing profiles are unaffected: defaults apply only when
    // a store file is genuinely absent, so anyone who already chose off - or
    // imported that choice from Nora - keeps it.
    enableDiscordRPC: true,
    saveVerboseLogs: false
  },
  windowPositions: {},
  windowDiamensions: {},
  windowState: 'normal',
  recentSearches: []
});

/** Defaults are used only when the corresponding file is genuinely absent. */
export function createDefaultStoreFiles(
  version: string,
  now: () => Date = () => new Date()
): StoreDefaults {
  const createdDate = now().toISOString();
  const payloads: Record<StoreName, unknown> = {
    songs: [],
    artists: [],
    albums: [],
    genres: [],
    playlists: [
      { name: 'History', playlistId: 'History', createdDate, songs: [], isArtworkAvailable: true },
      {
        name: 'Favorites',
        playlistId: 'Favorites',
        createdDate,
        songs: [],
        isArtworkAvailable: true
      },
      {
        name: 'Rediscover',
        playlistId: 'Rediscover',
        createdDate,
        songs: [],
        isArtworkAvailable: true
      }
    ],
    userData: defaultUserData(),
    listeningData: [],
    blacklist: { songBlacklist: [], folderBlacklist: [] },
    tierlists: [],
    cmrStats: {
      elo: { ratings: {}, history: [], totalDuels: 0 },
      importedStatsExportIds: [],
      duelMatchmaking: { skippedPairs: [] }
    },
    palettes: []
  };

  return Object.fromEntries(
    STORE_NAMES.map((store) => {
      const file: StoreFile<unknown> = {
        version,
        payload: payloads[store],
        unknownRootKeys: {}
      };
      if (STORES_WITH_ELECTRON_MIGRATION_METADATA.has(store)) {
        file.internal = { migrations: { version } };
      }
      return [store, file];
    })
  ) as StoreDefaults;
}

export class StoreNotHydratedError extends Error {
  constructor() {
    super('Nemora stores were read before hydrate() completed');
    this.name = 'StoreNotHydratedError';
  }
}

export class StoreWriteError extends Error {
  // Plain fields: the repo compiles with `erasableSyntaxOnly`, which forbids
  // constructor parameter properties.
  readonly store: StoreName;
  override readonly cause: unknown;

  constructor(store: StoreName, cause: unknown) {
    super(`store "${store}" could not be flushed`);
    this.name = 'StoreWriteError';
    this.store = store;
    this.cause = cause;
  }
}

/**
 * Synchronous cache over StorePort with one serialized, coalescing queue per
 * store. Hydration stages all eleven stores before making any of them visible.
 */
export class CachedStores {
  private readonly files = new Map<StoreName, StoreFile<unknown>>();
  private readonly pending = new Set<StoreName>();
  private readonly drains = new Map<StoreName, Promise<void>>();
  private readonly writeErrors = new Map<StoreName, unknown>();
  private hydrationPromise: Promise<void> | undefined;
  private hydrated = false;
  private sealed = false;

  private readonly port: StorePort;
  private readonly defaults: StoreDefaults;

  constructor(port: StorePort, defaults: StoreDefaults) {
    this.port = port;
    this.defaults = defaults;
  }

  hydrate(): Promise<void> {
    if (this.hydrated) return Promise.resolve();
    if (this.hydrationPromise) return this.hydrationPromise;

    const hydration = this.loadAllStores();
    this.hydrationPromise = hydration.catch((error: unknown) => {
      this.hydrationPromise = undefined;
      throw error;
    });
    return this.hydrationPromise;
  }

  private async loadAllStores(): Promise<void> {
    const loaded = await Promise.all(
      STORE_NAMES.map(async (store): Promise<[StoreName, StoreFile<unknown>]> => {
        const file = (await this.port.exists(store))
          ? await this.port.read<unknown>(store)
          : jsonClone(this.defaults[store]);
        return [store, file];
      })
    );

    this.files.clear();
    for (const [store, file] of loaded) this.files.set(store, file);
    this.hydrated = true;
  }

  private requireFile(store: StoreName): StoreFile<unknown> {
    if (!this.hydrated) throw new StoreNotHydratedError();
    const file = this.files.get(store);
    if (!file) throw new Error(`hydrated store "${store}" is missing from the cache`);
    return file;
  }

  get<T>(store: StoreName): T {
    return this.requireFile(store).payload as T;
  }

  set<T>(store: StoreName, payload: T): void {
    const file = this.requireFile(store);
    this.files.set(store, { ...file, payload });
    // Sealed: the files on disk belong to whoever sealed the cache, and this
    // in-memory state is about to be discarded by a relaunch. The update is
    // still applied in memory so the running UI keeps behaving normally until
    // then — it is only the write-back that would destroy the new profile.
    if (this.sealed) return;
    this.pending.add(store);
    this.startDrain(store);
  }

  update<T>(store: StoreName, updater: (current: T) => T): void {
    const workingCopy = jsonClone(this.get<T>(store));
    this.set(store, updater(workingCopy));
  }

  private startDrain(store: StoreName): void {
    if (this.drains.has(store) || this.writeErrors.has(store)) return;
    const drain = Promise.resolve()
      .then(() => this.drainStore(store))
      .finally(() => {
        this.drains.delete(store);
        if (this.pending.has(store) && !this.writeErrors.has(store)) this.startDrain(store);
      });
    this.drains.set(store, drain);
  }

  private async drainStore(store: StoreName): Promise<void> {
    while (this.pending.delete(store)) {
      try {
        const snapshot = jsonClone(this.requireFile(store));
        await this.port.write(store, snapshot);
      } catch (error) {
        this.pending.add(store);
        this.writeErrors.set(store, error);
        return;
      }
    }
  }

  async flush(store?: StoreName): Promise<void> {
    const stores = store ? [store] : STORE_NAMES;

    while (true) {
      const active = stores
        .map((name) => this.drains.get(name))
        .filter((drain): drain is Promise<void> => drain !== undefined);
      if (active.length === 0) break;
      await Promise.all(active);
    }

    for (const name of stores) {
      const error = this.writeErrors.get(name);
      if (error !== undefined) throw new StoreWriteError(name, error);
    }
  }

  /**
   * Hands ownership of the store files to an external writer — the Nora
   * import, which replaces every JSON in the profile underneath a running app.
   * Without this the next `set()` from ordinary playback would drain stale
   * pre-import state straight over the freshly imported files.
   *
   * Callers must `flush()` first (so nothing legitimately pending is lost) and
   * relaunch afterwards. `unseal()` exists for the case where the import
   * aborted before touching anything.
   */
  seal(): void {
    this.sealed = true;
  }

  unseal(): void {
    this.sealed = false;
  }

  get isSealed(): boolean {
    return this.sealed;
  }

  async retryFailedWrites(store?: StoreName): Promise<void> {
    const stores = store ? [store] : STORE_NAMES;
    for (const name of stores) {
      if (!this.writeErrors.delete(name)) continue;
      if (this.pending.has(name)) this.startDrain(name);
    }
    await this.flush(store);
  }
}

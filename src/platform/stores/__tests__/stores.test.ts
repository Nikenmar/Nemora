import { describe, expect, jest, test } from '@jest/globals';

import {
  STORE_LAYOUT,
  StoreReadError,
  type StoreFile,
  type StoreName,
  type StorePort
} from '../../contracts/store';
import {
  CachedStores,
  createDefaultStoreFiles,
  STORE_NAMES,
  StoreNotHydratedError
} from '../storeCache';
import { TauriStorePort, type StoreIo } from '../storePort';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const storePath = (fileName: string) => `E:\\tmp\\Nemora\\${fileName}`;

class MemoryPort implements StorePort {
  readonly files = new Map<StoreName, StoreFile<unknown>>();
  readonly writes: Array<{ store: StoreName; file: StoreFile<unknown> }> = [];

  async exists(store: StoreName): Promise<boolean> {
    return this.files.has(store);
  }

  async read<T>(store: StoreName): Promise<StoreFile<T>> {
    const file = this.files.get(store);
    if (!file) throw new Error(`missing fixture ${store}`);
    return clone(file) as StoreFile<T>;
  }

  async write<T>(store: StoreName, file: StoreFile<T>): Promise<void> {
    const snapshot = clone(file) as StoreFile<unknown>;
    this.writes.push({ store, file: snapshot });
    this.files.set(store, snapshot);
  }
}

function tauriFixture(initialFiles: Record<string, string> = {}) {
  const disk = new Map(Object.entries(initialFiles));
  const atomicWrites: Array<{ path: string; contents: string }> = [];
  const io: StoreIo = {
    exists: async (path) => disk.has(path),
    readTextFile: async (path) => {
      const contents = disk.get(path);
      if (contents === undefined) throw new Error('file not found');
      return contents;
    },
    invoke: async <T>(command: string, args: Record<string, unknown>) => {
      expect(command).toBe('write_text_file_atomic');
      const path = args.path as string;
      // Stores travel as text, never as a JSON array of bytes; see storePort.write.
      const contents = args.contents as string;
      atomicWrites.push({ path, contents });
      disk.set(path, contents);
      return undefined as T;
    },
    resolvePath: async (fileName) => storePath(fileName)
  };
  return { disk, atomicWrites, port: new TauriStorePort(io) };
}

describe('TauriStorePort fidelity and failure behavior', () => {
  test('preserves unknown fields plus both distinct version fields through a known mutation', async () => {
    const path = storePath('userData.json');
    const root = {
      version: '3.4.5-CMR-Fork',
      userData: {
        language: 'en',
        preferences: { enableDiscordRPC: false, nestedSentinel: { future: 42 } },
        payloadSentinel: ['keep', { thisToo: true }]
      },
      __internal__: {
        migrations: { version: '3.1.0', futureMigrationField: 'keep' },
        metadataSentinel: 7
      },
      rootSentinel: { untouched: true }
    };
    const fixture = tauriFixture({ [path]: JSON.stringify(root) });
    const cache = new CachedStores(
      fixture.port,
      createDefaultStoreFiles('3.4.5-CMR-Fork', () => new Date('2026-01-01T00:00:00Z'))
    );

    expect((await fixture.port.read('userData')).internal).toEqual(root.__internal__);
    await cache.hydrate();
    cache.update<typeof root.userData>('userData', (userData) => ({
      ...userData,
      preferences: { ...userData.preferences, enableDiscordRPC: true }
    }));
    await cache.flush('userData');

    const written = JSON.parse(fixture.disk.get(path) ?? '') as typeof root;
    expect(written.version).toBe('3.4.5-CMR-Fork');
    expect(written.__internal__.migrations.version).toBe('3.1.0');
    expect(written.rootSentinel).toEqual(root.rootSentinel);
    expect(written.userData.payloadSentinel).toEqual(root.userData.payloadSentinel);
    expect(written.userData.preferences.nestedSentinel).toEqual({ future: 42 });
    expect(written.__internal__.metadataSentinel).toBe(7);
    expect(written.__internal__.migrations.futureMigrationField).toBe('keep');
    expect(written.userData.preferences.enableDiscordRPC).toBe(true);
    expect(fixture.atomicWrites).toHaveLength(1);
  });

  test('keeps __internal__ absent for stores that never had Electron migrations', async () => {
    for (const store of ['tierlists', 'cmrStats', 'palettes'] as const) {
      const { file, payloadKey } = STORE_LAYOUT[store];
      const path = storePath(file);
      const fixture = tauriFixture({
        [path]: JSON.stringify({
          version: '3.4.5-CMR-Fork',
          [payloadKey]: store === 'cmrStats' ? {} : []
        })
      });
      const loaded = await fixture.port.read<unknown>(store);
      await fixture.port.write(store, loaded);
      const written = JSON.parse(fixture.disk.get(path) ?? '') as Record<string, unknown>;
      expect(Object.prototype.hasOwnProperty.call(written, '__internal__')).toBe(false);
    }
  });

  test('throws StoreReadError for malformed or structurally invalid existing files and never writes', async () => {
    const malformedPath = storePath('songs.json');
    const fixture = tauriFixture({ [malformedPath]: '{"version":' });
    const cache = new CachedStores(fixture.port, createDefaultStoreFiles('3.4.5-CMR-Fork'));

    await expect(cache.hydrate()).rejects.toBeInstanceOf(StoreReadError);
    expect(fixture.atomicWrites).toHaveLength(0);

    fixture.disk.set(malformedPath, JSON.stringify({ version: '3.4.5-CMR-Fork', songs: {} }));
    await expect(cache.hydrate()).rejects.toBeInstanceOf(StoreReadError);
    expect(fixture.atomicWrites).toHaveLength(0);
  });

  test('uses only the Rust atomic command for writes', async () => {
    const fixture = tauriFixture();
    await fixture.port.write('songs', {
      version: '3.4.5-CMR-Fork',
      payload: [{ songId: 'one' }],
      unknownRootKeys: {}
    });

    expect(fixture.atomicWrites).toHaveLength(1);
    expect(fixture.atomicWrites[0]?.path).toBe(storePath('songs.json'));
    expect(fixture.disk.get(storePath('songs.json'))).toContain('"songId": "one"');
  });

  test('rejects every identifier-derived store path before any I/O call', async () => {
    const ioCalls = jest.fn();
    const port = new TauriStorePort({
      exists: async () => {
        ioCalls();
        return false;
      },
      readTextFile: async () => {
        ioCalls();
        return '{}';
      },
      invoke: async <T>() => {
        ioCalls();
        return undefined as T;
      },
      resolvePath: async (fileName) =>
        `E:\\Users\\test\\AppData\\Roaming\\com.cmrdevs.nemora\\${fileName}`
    });

    for (const store of STORE_NAMES) {
      await expect(port.exists(store)).rejects.toBeInstanceOf(StoreReadError);
    }
    await expect(
      port.write('songs', { payload: [], unknownRootKeys: {}, version: '3.4.5-CMR-Fork' })
    ).rejects.toThrow('identifier-derived');
    expect(ioCalls).not.toHaveBeenCalled();
  });
});

describe('CachedStores synchronous API and write queues', () => {
  test('fails loudly before hydration and hydrates all eleven missing stores from defaults', async () => {
    const port = new MemoryPort();
    const defaults = createDefaultStoreFiles(
      '3.4.5-CMR-Fork',
      () => new Date('2026-01-01T00:00:00Z')
    );
    const cache = new CachedStores(port, defaults);

    expect(() => cache.get('songs')).toThrow(StoreNotHydratedError);
    expect(() => cache.set('songs', [])).toThrow(StoreNotHydratedError);
    await cache.hydrate();

    for (const store of STORE_NAMES) expect(cache.get(store)).toEqual(defaults[store].payload);
    expect(port.writes).toHaveLength(0);
    for (const store of ['tierlists', 'cmrStats', 'palettes'] as const) {
      expect(Object.prototype.hasOwnProperty.call(defaults[store], 'internal')).toBe(false);
    }
  });

  test('coalesces rapid writes and never interleaves writes for one store', async () => {
    const base = new MemoryPort();
    let activeWrites = 0;
    let maximumActiveWrites = 0;
    const releases: Array<() => void> = [];
    const snapshots: StoreFile<unknown>[] = [];
    base.write = async <T>(_store: StoreName, file: StoreFile<T>) => {
      activeWrites += 1;
      maximumActiveWrites = Math.max(maximumActiveWrites, activeWrites);
      snapshots.push(clone(file));
      await new Promise<void>((resolve) => releases.push(resolve));
      activeWrites -= 1;
    };

    const cache = new CachedStores(base, createDefaultStoreFiles('3.4.5-CMR-Fork'));
    await cache.hydrate();
    cache.set('songs', [{ songId: 'one' }]);
    cache.set('songs', [{ songId: 'two' }]);
    cache.set('songs', [{ songId: 'three' }]);
    await jestWaitFor(() => snapshots.length === 1);

    expect(snapshots[0]?.payload).toEqual([{ songId: 'three' }]);
    cache.set('songs', [{ songId: 'four' }]);
    cache.set('songs', [{ songId: 'five' }]);
    releases.shift()?.();
    await jestWaitFor(() => snapshots.length === 2);
    expect(snapshots[1]?.payload).toEqual([{ songId: 'five' }]);
    const firstFlush = cache.flush('songs');
    const secondFlush = cache.flush('songs');
    releases.shift()?.();
    await Promise.all([firstFlush, secondFlush]);

    expect(maximumActiveWrites).toBe(1);
    expect(snapshots).toHaveLength(2);
  });
});

describe('Discord Rich Presence is on for new profiles only', () => {
  test('a fresh profile defaults it on', async () => {
    const port = new MemoryPort();
    const cache = new CachedStores(port, createDefaultStoreFiles('1.0.0-stable'));
    await cache.hydrate();

    const userData = cache.get<{ preferences: { enableDiscordRPC: boolean } }>('userData');
    expect(userData.preferences.enableDiscordRPC).toBe(true);
  });

  test('an existing profile keeps its own answer, including off', async () => {
    // The load-bearing half of the change: turning a default ON must never
    // start broadcasting for someone who already declined - or who imported
    // that refusal from Nora, where the preference shipped off.
    const port = new MemoryPort();
    port.files.set('userData', {
      version: '3.4.5-CMR-Fork',
      payload: { preferences: { enableDiscordRPC: false } },
      unknownRootKeys: {}
    });

    const cache = new CachedStores(port, createDefaultStoreFiles('1.0.0-stable'));
    await cache.hydrate();

    const userData = cache.get<{ preferences: { enableDiscordRPC: boolean } }>('userData');
    expect(userData.preferences.enableDiscordRPC).toBe(false);
    expect(port.writes).toHaveLength(0);
  });
});

describe('sealing hands the store files to the Nora import', () => {
  const hydratedCache = async () => {
    const port = new MemoryPort();
    const cache = new CachedStores(port, createDefaultStoreFiles('1.0.0-stable'));
    await cache.hydrate();
    return { port, cache };
  };

  test('a sealed cache stops writing to disk but keeps serving the running UI', async () => {
    const { port, cache } = await hydratedCache();

    cache.set('songs', [{ songId: 'before-seal' }]);
    await cache.flush('songs');
    expect(port.writes).toHaveLength(1);

    cache.seal();
    expect(cache.isSealed).toBe(true);

    // This is the regression the seal exists for: ordinary playback keeps
    // calling set() while the import replaces every file underneath us, and
    // draining it would put pre-import state back over the imported profile.
    cache.set('songs', [{ songId: 'during-import' }]);
    await cache.flush('songs');
    expect(port.writes).toHaveLength(1);
    expect(port.files.get('songs')?.payload).toEqual([{ songId: 'before-seal' }]);

    // In memory the update still applies, so the live UI does not freeze or
    // silently disagree with itself in the seconds before the relaunch.
    expect(cache.get('songs')).toEqual([{ songId: 'during-import' }]);
  });

  test('unsealing resumes writes, for an import that aborted before touching anything', async () => {
    const { port, cache } = await hydratedCache();

    cache.seal();
    cache.set('playlists', [{ playlistId: 'made-while-sealed' }]);
    await cache.flush('playlists');
    expect(port.writes).toHaveLength(0);

    cache.unseal();
    expect(cache.isSealed).toBe(false);

    cache.set('playlists', [{ playlistId: 'after-unseal' }]);
    await cache.flush('playlists');
    expect(port.writes).toHaveLength(1);
    expect(port.files.get('playlists')?.payload).toEqual([{ playlistId: 'after-unseal' }]);
  });
});

async function jestWaitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error('timed out waiting for asynchronous store queue');
}

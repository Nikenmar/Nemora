import { afterEach, describe, expect, jest, test } from '@jest/globals';

// ESM-only dependencies the runtime pulls in transitively; same stubs as runtime.test.ts.
jest.mock('any-ascii', () => ({ __esModule: true, default: (value: string) => value }));
jest.mock('pinyin-pro', () => ({ pinyin: (value: string) => value }));
jest.mock('romaja/src/romanize.js', () => ({ romanize: (value: string) => value }));
jest.mock('@tauri-apps/plugin-fs', () => ({ readTextFile: jest.fn(), writeTextFile: jest.fn() }));
jest.mock('@tauri-apps/plugin-dialog', () => ({ open: jest.fn(), save: jest.fn() }));

const importNoraProfile = jest.fn<() => Promise<NoraImportReport>>();
jest.mock('../../core/import/importNora', () => ({ importNoraProfile }));

import type { NoraImportReport } from '../../core/import/importNora';
import type { NoraImportPort } from '../../core/import/noraImportRepository';
import { userData } from '../../api/user-data';
import type { StoreFile, StoreName, StorePort } from '../../contracts/store';
import type { RuntimeArtworkPaths } from '../artwork';
import type { RuntimeEventSink } from '../events';
import { configureRuntime, getRuntime, hydrateRuntime, resetRuntimeForTests } from '../registry';

/**
 * The Nora import replaces every store file while the app is running, so what
 * matters here is not the copying — that is covered in core/import — but the
 * ordering around it. Pending writes must land BEFORE the import takes its
 * backup, and no write may land after, or ordinary playback would drain
 * pre-import state straight over the freshly imported profile.
 */

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

const events: RuntimeEventSink = { dataUpdated: jest.fn(), message: jest.fn() };

const report = (overrides: Partial<NoraImportReport> = {}): NoraImportReport => ({
  success: true,
  detectedSource: 'cmr-fork',
  storesImported: ['songs'],
  storesAbsent: [],
  storesRemoved: [],
  counts: { songs: 3, playlists: 1, listeningRows: 9, artworkFiles: 4 },
  localStorageKeys: { version: true, localStorage: true, nora_song_guessr: true },
  localStorageSource: 'leveldb',
  backupPath: 'E:\\tmp\\Nemora\\backup-2026-08-11',
  backupVerified: true,
  ...overrides
});

const startRuntime = async () => {
  const port = new MemoryStorePort();
  configureRuntime(port, {
    version: 'test',
    artwork,
    events,
    services: { createNoraImportPort: () => ({}) as NoraImportPort }
  });
  await hydrateRuntime();
  return port;
};

/** A write that is queued but not yet drained when the import starts. */
const queuePendingWrite = async (value: string) => {
  await userData.saveUserData('recentSearches', [value]);
};

afterEach(() => {
  resetRuntimeForTests();
  importNoraProfile.mockReset();
});

describe('runtime/Nora import ordering', () => {
  test('flushes pending writes before the import, and writes nothing after it', async () => {
    const port = await startRuntime();
    let writesWhenImportStarted: StoreName[] = [];
    importNoraProfile.mockImplementation(async () => {
      writesWhenImportStarted = [...port.writes];
      return report();
    });

    await queuePendingWrite('queued-before-import');
    const result = await getRuntime().importNoraProfileData();

    expect(result.success).toBe(true);
    // The backup the importer takes must capture the real current profile.
    expect(writesWhenImportStarted).toContain('userData');

    const writesAfterImport = port.writes.length;
    await queuePendingWrite('typed-after-import');
    await getRuntime().flush();
    expect(port.writes).toHaveLength(writesAfterImport);
    expect((port.files.get('userData')?.payload as UserData).recentSearches).toEqual([
      'queued-before-import'
    ]);
  });

  test('keeps the cache sealed when the import failed after taking its backup', async () => {
    const port = await startRuntime();
    importNoraProfile.mockResolvedValue(
      report({ success: false, message: 'artwork copy failed', storesImported: [] })
    );

    const result = await getRuntime().importNoraProfileData();
    expect(result.success).toBe(false);

    // A backup exists, so writes may already have begun and this in-memory
    // state no longer describes the disk. Resuming writes would mix profiles.
    const writesAfterImport = port.writes.length;
    await queuePendingWrite('after-partial-failure');
    await getRuntime().flush();
    expect(port.writes).toHaveLength(writesAfterImport);
  });

  test('resumes normal writes when the import aborted before touching anything', async () => {
    const port = await startRuntime();
    importNoraProfile.mockResolvedValue(
      report({
        success: false,
        message: 'Nora profile not found',
        detectedSource: null,
        storesImported: [],
        backupPath: undefined,
        backupVerified: false
      })
    );

    const result = await getRuntime().importNoraProfileData();
    expect(result.success).toBe(false);

    await queuePendingWrite('app-still-usable');
    await getRuntime().flush();
    expect((port.files.get('userData')?.payload as UserData).recentSearches).toEqual([
      'app-still-usable'
    ]);
  });

  test('rethrows an unexpected failure and leaves the app writable', async () => {
    const port = await startRuntime();
    importNoraProfile.mockRejectedValue(new Error('the port exploded'));

    await expect(getRuntime().importNoraProfileData()).rejects.toThrow('the port exploded');

    await queuePendingWrite('app-still-usable');
    await getRuntime().flush();
    expect((port.files.get('userData')?.payload as UserData).recentSearches).toEqual([
      'app-still-usable'
    ]);
  });

  test('refuses to run when the runtime has no import port', async () => {
    const port = new MemoryStorePort();
    configureRuntime(port, { version: 'test', artwork, events });
    await hydrateRuntime();

    await expect(getRuntime().importNoraProfileData()).rejects.toThrow(
      'The Nora import port is not available in this runtime.'
    );
    expect(importNoraProfile).not.toHaveBeenCalled();

    // Refusing must not leave the profile sealed and silently read-only.
    await queuePendingWrite('app-still-usable');
    await getRuntime().flush();
    expect((port.files.get('userData')?.payload as UserData).recentSearches).toEqual([
      'app-still-usable'
    ]);
  });
});

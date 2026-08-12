import { describe, expect, jest, test } from '@jest/globals';

import importNoraProfile from '../importNora';
import {
  BACKUP_DIR,
  NEMORA_ROOT,
  NORA_ROOT,
  buildForkProfile,
  buildNemoraProfile,
  buildUpstreamProfile,
  createMockNoraImportPort,
  FORK_LOCAL_STORAGE,
  FORK_SONG_GUESSR,
  storeText,
  textOf,
  UPSTREAM_LOCAL_STORAGE
} from './testUtils';

const forkImport = () => {
  const source = buildForkProfile();
  const destination = buildNemoraProfile();
  const port = createMockNoraImportPort(source.files, source.dirs);
  // The destination profile shares the same in-memory disk.
  for (const [path, contents] of destination.files) source.files.set(path, contents);
  for (const dir of destination.dirs) source.dirs.add(dir);
  return { source: source.files, port };
};

const stripLevelDb = (files: Map<string, Uint8Array>, dirs: Set<string>): void => {
  for (const path of [...files.keys()])
    if (path.startsWith(`${NORA_ROOT}\\Local Storage`)) files.delete(path);
  for (const dir of [...dirs]) if (dir.startsWith(`${NORA_ROOT}\\Local Storage`)) dirs.delete(dir);
};

describe('importNoraProfile — wholesale replacement with a verified backup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('imports a CMR-fork profile wholesale and preserves every byte', async () => {
    const { source, port } = forkImport();

    const report = await importNoraProfile(port);

    expect(report.success).toBe(true);
    expect(report.detectedSource).toBe('cmr-fork');
    expect(report.storesImported).toHaveLength(11);
    expect(report.storesAbsent).toHaveLength(0);
    expect(report.storesRemoved).toHaveLength(0);
    expect(report.counts).toEqual({ songs: 3, playlists: 2, listeningRows: 2, artworkFiles: 4 });
    expect(report.localStorageSource).toBe('leveldb');
    expect(report.localStorageKeys).toEqual({
      version: true,
      localStorage: true,
      nora_song_guessr: true
    });
    expect(report.backupPath).toBe(BACKUP_DIR);
    expect(report.backupVerified).toBe(true);
    expect(report.markerPath).toBe(`${NEMORA_ROOT}\\import-nora-v1.json`);

    // Stores are a byte-for-byte copy, not a transformation.
    for (const fileName of [
      'songs.json',
      'artists.json',
      'albums.json',
      'genres.json',
      'playlists.json',
      'userData.json',
      'listening_data.json',
      'blacklist.json',
      'tierlists.json',
      'cmr_stats.json',
      'palettes.json'
    ]) {
      expect(textOf(source, `${NEMORA_ROOT}\\${fileName}`)).toBe(
        textOf(source, `${NORA_ROOT}\\${fileName}`)
      );
    }

    // Renderer state: all three keys arrive verbatim.
    expect(port.storageMap.get('version')).toBe('3.4.5-CMR-Fork');
    expect(port.storageMap.get('localStorage')).toBe(JSON.stringify(FORK_LOCAL_STORAGE));
    expect(port.storageMap.get('nora_song_guessr')).toBe(JSON.stringify(FORK_SONG_GUESSR));

    // Artwork: destination covers are the source's, old ones replaced.
    expect(textOf(source, `${NEMORA_ROOT}\\song_covers\\s1.webp`)).toBe('cover:s1.webp');
    expect(source.has(`${NEMORA_ROOT}\\song_covers\\n1.webp`)).toBe(false);

    // The backup holds the PRE-import profile and is verified.
    expect(textOf(source, `${BACKUP_DIR}\\songs.json`)).toContain('Nemora Song');
    expect(textOf(source, `${BACKUP_DIR}\\song_covers\\n1.webp`)).toBe('nemora-cover:n1.webp');

    // The marker is written last.
    const events = port.events;
    expect(events[events.length - 1]).toBe(`write:${NEMORA_ROOT}\\import-nora-v1.json`);
    const marker = JSON.parse(textOf(source, `${NEMORA_ROOT}\\import-nora-v1.json`)) as {
      formatVersion: number;
      detectedSource: string;
      backupPath: string;
      counts: { songs: number };
    };
    expect(marker.formatVersion).toBe(1);
    expect(marker.detectedSource).toBe('cmr-fork');
    expect(marker.backupPath).toBe(BACKUP_DIR);
    expect(marker.counts.songs).toBe(3);
  });

  test('imports an upstream 3.1.0 profile: missing fork stores removed, SongGuessr cleared', async () => {
    const source = buildUpstreamProfile();
    const destination = buildNemoraProfile();
    const port = createMockNoraImportPort(source.files, source.dirs);
    for (const [path, contents] of destination.files) source.files.set(path, contents);
    for (const dir of destination.dirs) source.dirs.add(dir);
    // Nemora had renderer state the upstream source must clear.
    port.storageMap.set('nora_song_guessr', '{"version":1}');

    const report = await importNoraProfile(port);

    expect(report.success).toBe(true);
    expect(report.detectedSource).toBe('upstream');
    expect(report.storesImported).toHaveLength(9);
    expect(report.storesAbsent).toEqual(expect.arrayContaining(['tierlists', 'cmrStats']));
    expect(report.storesRemoved).toEqual(expect.arrayContaining(['tierlists', 'cmrStats']));
    expect(report.counts).toEqual({ songs: 2, playlists: 1, listeningRows: 1, artworkFiles: 2 });

    // Fork-only stores are gone from the destination — wholesale replacement.
    expect(source.files.has(`${NEMORA_ROOT}\\tierlists.json`)).toBe(false);
    expect(source.files.has(`${NEMORA_ROOT}\\cmr_stats.json`)).toBe(false);
    expect(textOf(source.files, `${NEMORA_ROOT}\\songs.json`)).toContain('First Light');

    // localStorage composite arrives verbatim; the missing key is removed.
    expect(port.storageMap.get('version')).toBe('3.1.0');
    expect(port.storageMap.get('localStorage')).toBe(JSON.stringify(UPSTREAM_LOCAL_STORAGE));
    expect(port.storageMap.has('nora_song_guessr')).toBe(false);
    expect(port.events).toContain(`storage:remove:nora_song_guessr`);
  });

  test('a corrupt source store aborts BEFORE any write, backup or storage change', async () => {
    const { source, port } = forkImport();
    source.set(`${NORA_ROOT}\\songs.json`, new TextEncoder().encode('{not json'));

    const report = await importNoraProfile(port);

    expect(report.success).toBe(false);
    expect(report.message).toMatch(/songs/);
    expect(report.backupPath).toBeUndefined();
    // The destination profile is untouched — its own songs.json still present.
    expect(textOf(source, `${NEMORA_ROOT}\\songs.json`)).toContain('Nemora Song');
    expect(source.has(`${BACKUP_DIR}\\songs.json`)).toBe(false);
    expect(source.has(`${NEMORA_ROOT}\\import-nora-v1.json`)).toBe(false);
    expect(port.events.some((event) => event.startsWith('storage:'))).toBe(false);
  });

  test('a store that parses but has the wrong shape aborts before any write', async () => {
    const { source, port } = forkImport();
    source.set(
      `${NORA_ROOT}\\songs.json`,
      new TextEncoder().encode(storeText('songs', [{ songId: 'x' }]))
    );

    const report = await importNoraProfile(port);

    expect(report.success).toBe(false);
    expect(report.message).toMatch(/songs/);
    expect(textOf(source, `${NEMORA_ROOT}\\songs.json`)).toContain('Nemora Song');
  });

  test('an interrupted import is recoverable: re-running converges to a pure Nora state', async () => {
    const { source, port } = forkImport();
    const baseWrite = port.writeTextFileAtomic;
    let importWrites = 0;
    port.writeTextFileAtomic = async (path, contents) => {
      if (path.startsWith(NEMORA_ROOT) && !path.includes('\\backups\\')) {
        importWrites += 1;
        if (importWrites === 2) throw new Error('simulated crash');
      }
      await baseWrite(path, contents);
    };

    const first = await importNoraProfile(port);
    expect(first.success).toBe(false);
    expect(first.message).toBe('simulated crash');
    expect(first.backupPath).toBe(BACKUP_DIR);
    expect(first.backupVerified).toBe(true);
    // Backup was verified BEFORE the interrupted writes.
    expect(port.events.indexOf(`write:${BACKUP_DIR}\\songs.json`)).toBeLessThan(
      port.events.indexOf(`write:${NEMORA_ROOT}\\songs.json`)
    );
    expect(source.has(`${NEMORA_ROOT}\\import-nora-v1.json`)).toBe(false);
    // Transient mixture: songs.json already Nora's, tierlists still Nemora's.
    expect(textOf(source, `${NEMORA_ROOT}\\songs.json`)).toContain('Midnight Drive');
    expect(textOf(source, `${NEMORA_ROOT}\\tierlists.json`)).toContain('tierlists');

    // Re-run after the "crash" — the importer redoes everything.
    port.writeTextFileAtomic = baseWrite;
    const second = await importNoraProfile(port);

    expect(second.success).toBe(true);
    for (const fileName of ['songs.json', 'tierlists.json', 'cmr_stats.json'])
      expect(textOf(source, `${NEMORA_ROOT}\\${fileName}`)).toBe(
        textOf(source, `${NORA_ROOT}\\${fileName}`)
      );
    const marker = JSON.parse(textOf(source, `${NEMORA_ROOT}\\import-nora-v1.json`)) as {
      formatVersion: number;
      detectedSource: string;
    };
    expect(marker.formatVersion).toBe(1);
    expect(marker.detectedSource).toBe('cmr-fork');
  });

  test('a storage failure aborts after the files committed; re-running fixes it', async () => {
    const { source, port } = forkImport();
    const originalStorage = port.storage;
    port.storage = {
      ...originalStorage,
      setItem: () => {
        throw new Error('storage blocked');
      }
    };

    const first = await importNoraProfile(port);

    expect(first.success).toBe(false);
    expect(first.message).toBe('storage blocked');
    expect(textOf(source, `${NEMORA_ROOT}\\songs.json`)).toContain('Midnight Drive');
    expect(source.has(`${NEMORA_ROOT}\\import-nora-v1.json`)).toBe(false);

    port.storage = originalStorage;
    const second = await importNoraProfile(port);

    expect(second.success).toBe(true);
    expect(port.storageMap.get('version')).toBe('3.4.5-CMR-Fork');
  });

  test('a profile without LevelDB imports the stores and leaves storage untouched', async () => {
    const source = buildForkProfile();
    stripLevelDb(source.files, source.dirs);
    const destination = buildNemoraProfile();
    const port = createMockNoraImportPort(source.files, source.dirs);
    for (const [path, contents] of destination.files) source.files.set(path, contents);
    for (const dir of destination.dirs) source.dirs.add(dir);
    port.storageMap.set('localStorage', '{"keep":true}');

    const report = await importNoraProfile(port);

    expect(report.success).toBe(true);
    expect(report.localStorageSource).toBe('absent');
    expect(report.localStorageKeys).toEqual({
      version: false,
      localStorage: false,
      nora_song_guessr: false
    });
    expect(port.events.some((event) => event.startsWith('storage:'))).toBe(false);
    expect(port.storageMap.get('localStorage')).toBe('{"keep":true}');
    expect(textOf(source.files, `${NEMORA_ROOT}\\songs.json`)).toContain('Midnight Drive');
  });

  test('a Nora profile without songs.json is refused before anything is touched', async () => {
    const source = buildForkProfile();
    source.files.delete(`${NORA_ROOT}\\songs.json`);
    const destination = buildNemoraProfile();
    const port = createMockNoraImportPort(source.files, source.dirs);
    for (const [path, contents] of destination.files) source.files.set(path, contents);
    for (const dir of destination.dirs) source.dirs.add(dir);

    const report = await importNoraProfile(port);

    expect(report.success).toBe(false);
    expect(report.message).toMatch(/songs\.json/);
    expect(report.backupPath).toBeUndefined();
    expect(source.files.has(`${BACKUP_DIR}\\songs.json`)).toBe(false);
  });

  test('unknown root keys survive the import byte-for-byte', async () => {
    const { source, port } = forkImport();
    source.set(
      `${NORA_ROOT}\\userData.json`,
      new TextEncoder().encode(
        storeText('userData', { language: 'en' }, { rootExtras: { futureSetting: { x: 1 } } })
      )
    );

    const report = await importNoraProfile(port);

    expect(report.success).toBe(true);
    expect(textOf(source, `${NEMORA_ROOT}\\userData.json`)).toBe(
      textOf(source, `${NORA_ROOT}\\userData.json`)
    );
  });
});

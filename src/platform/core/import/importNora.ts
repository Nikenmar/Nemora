import { STORE_LAYOUT, type StoreName } from '../../contracts/store';
import { parseStoreText } from '../../stores/storePort';
import { LOCAL_STORAGE_KEYS, type LocalStorageKey } from '../../migration/types';
import { joinPath } from '../transfer/joinPath';
import type { NoraSourceInventory } from './detectNoraSource';
import { detectNoraSource } from './detectNoraSource';
import type { NoraImportPort } from './noraImportRepository';
import { NoraImportError } from './noraImportRepository';
import type { NoraLocalStorageRecovery } from './recoverNoraLocalStorage';
import { recoverNoraLocalStorage } from './recoverNoraLocalStorage';
import { validateNoraStorePayload } from './validateNoraStores';

/**
 * "Import from Nora" — replaces Nemora's profile wholesale with
 * `%APPDATA%\Nora`'s, preserving every byte it can and backing up everything
 * it replaces.
 *
 * Why this is a copy, not a merge (and not a transformation): Nemora's stores
 * are byte-identical in shape to Nora's, the data contains no `nemora://` or
 * `nora://` URLs (artwork paths are derived at runtime from an
 * `isArtworkAvailable` flag), and absolute song paths are valid for both apps
 * on the same machine. So each present store is parsed, validated and then
 * re-written with its ORIGINAL bytes (unknown root keys, `version` and
 * `__internal__.migrations.version` included — the destination hydrator runs
 * its normal migrations against that version, exactly like an in-place
 * upgrade would).
 *
 * Safety contract (each step completes before the next begins):
 *   1. detect the source shape by contents — cmr fork vs upstream 3.1.0;
 *   2. read + validate EVERY present store and the LevelDB in memory first —
 *      a half-finished import is the worst outcome;
 *   3. back up Nemora's current stores + song_covers into a timestamped
 *      folder under `backups/`, and VERIFY the backup (stores re-parse,
 *      artwork sizes match) before touching any destination data;
 *   4. write the destination through the Rust atomic commands only
 *      (`write_text_file_atomic` for JSON, `copy_file_atomic` for artwork);
 *   5. store absent in the source is REMOVED from the destination (wholesale
 *      replacement) — except song_covers, where an absent source folder is
 *      reported and the existing covers are kept rather than deleted;
 *   6. write the three localStorage keys, then the completion marker.
 *
 * Interruptibility: every individual write is atomic, so a crash leaves each
 * file either complete-old or complete-new. Re-running the import (which the
 * caller is expected to offer after an error report) rewrites everything and
 * converges to a full, unmixed Nora state — the verified backup is the
 * rollback path.
 *
 * The Nora profile is READ-ONLY for this subsystem.
 * Signature: `importNoraProfile(port)`.
 */

const EMPTY_KEYS: Record<LocalStorageKey, boolean> = {
  version: false,
  localStorage: false,
  nora_song_guessr: false
};

export interface NoraImportReport {
  success: boolean;
  /** Failure reason, when success is false. */
  message?: string;
  /** Which Nora was detected in `%APPDATA%\Nora` (null when detection failed). */
  detectedSource: NoraSourceInventory['kind'] | null;
  /** Stores actually written to Nemora's profile. */
  storesImported: StoreName[];
  /** Stores absent from Nora's profile (normal for upstream: tierlists, cmrStats). */
  storesAbsent: StoreName[];
  /** Destination stores removed because the source profile lacks them. */
  storesRemoved: StoreName[];
  counts: {
    songs: number;
    playlists: number;
    listeningRows: number;
    artworkFiles: number;
  };
  /** Which of the three localStorage keys were (re)written. */
  localStorageKeys: Record<LocalStorageKey, boolean>;
  /** 'leveldb' when renderer state was recovered, 'absent' when Nora had none. */
  localStorageSource: NoraLocalStorageRecovery['source'] | null;
  /** The timestamped backup folder inside Nemora's profile. */
  backupPath?: string;
  backupVerified: boolean;
  /** The completion marker `import-nora-v1.json` inside Nemora's profile. */
  markerPath?: string;
}

interface SourceStore {
  store: StoreName;
  text: string;
  payload: unknown;
}

const readSourceStores = async (
  port: NoraImportPort,
  inventory: NoraSourceInventory
): Promise<SourceStore[]> => {
  const stores: SourceStore[] = [];
  for (const store of inventory.presentStores) {
    const path = await port.noraProfilePath(STORE_LAYOUT[store].file);
    let text: string;
    try {
      text = await port.fileSystem.readText(path);
    } catch (error) {
      throw new NoraImportError(`Nora store "${store}" at ${path} could not be read`, error);
    }
    const file = parseStoreText<unknown>(store, path, text);
    const validationError = validateNoraStorePayload(store, file.payload);
    if (validationError) throw new NoraImportError(`Nora store "${store}" ${validationError}`);
    stores.push({ store, text, payload: file.payload });
  }
  return stores;
};

const presentDestinationStores = async (port: NoraImportPort): Promise<StoreName[]> => {
  const present: StoreName[] = [];
  for (const store of Object.keys(STORE_LAYOUT) as StoreName[]) {
    const path = await port.nemoraProfilePath(STORE_LAYOUT[store].file);
    if (await port.fileSystem.exists(path)) present.push(store);
  }
  return present;
};

interface BackupResult {
  backupPath: string;
  backedUpStores: number;
  backedUpCovers: number;
}

/**
 * Backs up everything the import will replace — the stores present in the
 * destination plus its whole song_covers — into
 * `%APPDATA%\Nemora\backups\nora-import-<timestamp>\` and VERIFIES the copy
 * (every backed-up store re-parses, every backed-up artwork file has the
 * source size) before returning. All writes go through the atomic commands.
 */
const backupCurrentProfile = async (port: NoraImportPort): Promise<BackupResult> => {
  const stamp = port.now().toISOString().replace(/[:.]/g, '-');
  const backupDir = joinPath(await port.nemoraProfilePath('backups'), `nora-import-${stamp}`);
  await port.fileSystem.createDirectory(backupDir);
  await port.fileSystem.createDirectory(joinPath(backupDir, 'song_covers'));

  const destStores = await presentDestinationStores(port);
  for (const store of destStores) {
    const fileName = STORE_LAYOUT[store].file;
    const text = await port.fileSystem.readText(await port.nemoraProfilePath(fileName));
    await port.writeTextFileAtomic(joinPath(backupDir, fileName), text);
  }

  // Verify the store backup is readable before anything is touched.
  for (const store of destStores) {
    const fileName = STORE_LAYOUT[store].file;
    const backupText = await port.fileSystem.readText(joinPath(backupDir, fileName));
    parseStoreText<unknown>(store, joinPath(backupDir, fileName), backupText);
  }

  const coversDir = await port.nemoraProfilePath('song_covers');
  let backedUpCovers = 0;
  if (await port.fileSystem.exists(coversDir)) {
    const entries = (await port.fileSystem.readDirectory(coversDir)).filter(
      (entry) => entry.isFile
    );
    for (const entry of entries) {
      await port.copyFileAtomic(
        joinPath(coversDir, entry.name),
        joinPath(backupDir, 'song_covers', entry.name)
      );
      backedUpCovers += 1;
    }
    // Verify every artwork copy has the exact source size.
    for (const entry of entries) {
      const source = joinPath(coversDir, entry.name);
      const destination = joinPath(backupDir, 'song_covers', entry.name);
      const sourceMeta = await port.fileSystem.metadata(source);
      const backupMeta = await port.fileSystem.metadata(destination);
      if (sourceMeta.size !== backupMeta.size)
        throw new NoraImportError(`backup verification failed for ${entry.name}`);
    }
  }

  return { backupPath: backupDir, backedUpStores: destStores.length, backedUpCovers };
};

const fail = (message: string, partial: Partial<NoraImportReport> = {}): NoraImportReport => ({
  success: false,
  message,
  detectedSource: null,
  storesImported: [],
  storesAbsent: [],
  storesRemoved: [],
  counts: { songs: 0, playlists: 0, listeningRows: 0, artworkFiles: 0 },
  localStorageKeys: { ...EMPTY_KEYS },
  localStorageSource: null,
  backupVerified: false,
  ...partial
});

const arrayLength = (value: unknown): number => (Array.isArray(value) ? value.length : 0);

export async function importNoraProfile(port: NoraImportPort): Promise<NoraImportReport> {
  // 1. Detect the source shape by inspecting contents (never the folder name).
  let inventory: NoraSourceInventory;
  try {
    inventory = await detectNoraSource(port);
  } catch (error) {
    const message = (error as Error).message;
    port.logger.error('Nora import aborted: source detection failed.', { error });
    return fail(message);
  }

  if (!inventory.presentStores.includes('songs'))
    return fail('The Nora profile has no songs.json — nothing to import.');

  // 2. Read + validate everything in memory BEFORE any write.
  let sourceStores: SourceStore[];
  try {
    sourceStores = await readSourceStores(port, inventory);
  } catch (error) {
    const message = (error as Error).message;
    port.logger.error('Nora import aborted: invalid source stores.', { error });
    return fail(message, {
      detectedSource: inventory.kind,
      storesAbsent: inventory.absentStores
    });
  }

  let localStorage: NoraLocalStorageRecovery;
  try {
    localStorage = await recoverNoraLocalStorage(port);
  } catch (error) {
    const message = (error as Error).message;
    port.logger.error('Nora import aborted: renderer state could not be recovered.', { error });
    return fail(message, {
      detectedSource: inventory.kind,
      storesAbsent: inventory.absentStores
    });
  }

  // 3. Back up the current profile and verify the backup before touching data.
  let backup: BackupResult;
  try {
    backup = await backupCurrentProfile(port);
  } catch (error) {
    const message = (error as Error).message;
    port.logger.error('Nora import aborted: backup failed; nothing was changed.', { error });
    return fail(`Failed to back up the current profile: ${message}`, {
      detectedSource: inventory.kind,
      storesAbsent: inventory.absentStores
    });
  }
  const partialForFailure = (): Partial<NoraImportReport> => ({
    detectedSource: inventory.kind,
    storesAbsent: inventory.absentStores,
    backupPath: backup.backupPath,
    backupVerified: true
  });

  // 4. Write everything through the atomic commands. The store payloads are
  //    copied byte-for-byte; the backup above is the rollback path.
  const writtenStores: StoreName[] = [];
  const removedStores: StoreName[] = [];
  let artworkFiles = 0;
  try {
    for (const source of sourceStores) {
      const destination = await port.nemoraProfilePath(STORE_LAYOUT[source.store].file);
      await port.writeTextFileAtomic(destination, source.text);
      writtenStores.push(source.store);
    }

    // Wholesale replacement: a store the source profile lacks is removed.
    for (const store of Object.keys(STORE_LAYOUT) as StoreName[]) {
      if (inventory.presentStores.includes(store)) continue;
      const destination = await port.nemoraProfilePath(STORE_LAYOUT[store].file);
      if (await port.fileSystem.exists(destination)) {
        await port.removeFile(destination);
        removedStores.push(store);
      }
    }

    // song_covers: authoritative artwork, replaced wholesale per file. When
    // the source has no song_covers at all (pathological), existing covers
    // are kept — deleting hundreds of MB because a folder is missing is
    // destructive without any data to gain.
    const coversSource = await port.noraProfilePath('song_covers');
    const coversDestination = await port.nemoraProfilePath('song_covers');
    if (await port.fileSystem.exists(coversSource)) {
      if (await port.fileSystem.exists(coversDestination))
        await port.fileSystem.removeDirectory(coversDestination);
      await port.fileSystem.createDirectory(coversDestination);
      const entries = (await port.fileSystem.readDirectory(coversSource)).filter(
        (entry) => entry.isFile
      );
      for (const entry of entries) {
        await port.copyFileAtomic(
          joinPath(coversSource, entry.name),
          joinPath(coversDestination, entry.name)
        );
        artworkFiles += 1;
      }
    } else {
      port.logger.warn('Nora has no song_covers folder; existing Nemora covers were kept.', {
        coversSource
      });
    }

    // 5. Renderer state (the three physical localStorage keys). Null means the
    //    source has no such key (upstream 3.1.0 has no SongGuessr/duels) and
    //    the destination key is removed. A missing LevelDB leaves the
    //    destination storage untouched.
    const localStorageKeys: Record<LocalStorageKey, boolean> = { ...EMPTY_KEYS };
    if (localStorage.source === 'leveldb') {
      for (const key of LOCAL_STORAGE_KEYS) {
        const value = localStorage.values[key];
        if (value === null) port.storage.removeItem(key);
        else {
          port.storage.setItem(key, value);
          localStorageKeys[key] = true;
        }
      }
    }

    // 6. Completion marker — written last, after every byte is durable.
    const markerPath = await port.nemoraProfilePath('import-nora-v1.json');
    const marker = {
      formatVersion: 1,
      detectedSource: inventory.kind,
      storesImported: writtenStores,
      storesAbsent: inventory.absentStores,
      storesRemoved: removedStores,
      counts: {
        songs: arrayLength(sourceStores.find((store) => store.store === 'songs')?.payload),
        playlists: arrayLength(sourceStores.find((store) => store.store === 'playlists')?.payload),
        listeningRows: arrayLength(
          sourceStores.find((store) => store.store === 'listeningData')?.payload
        ),
        artworkFiles
      },
      localStorageKeys,
      localStorageSource: localStorage.source,
      backupPath: backup.backupPath,
      backedUpStores: backup.backedUpStores,
      backedUpCovers: backup.backedUpCovers,
      completedAt: port.now().toISOString()
    };
    await port.writeTextFileAtomic(markerPath, JSON.stringify(marker, null, 2));

    port.logger.info('Nora profile imported.', {
      detectedSource: inventory.kind,
      storesImported: writtenStores,
      backupPath: backup.backupPath
    });

    return {
      success: true,
      detectedSource: inventory.kind,
      storesImported: writtenStores,
      storesAbsent: inventory.absentStores,
      storesRemoved: removedStores,
      counts: {
        songs: arrayLength(sourceStores.find((store) => store.store === 'songs')?.payload),
        playlists: arrayLength(sourceStores.find((store) => store.store === 'playlists')?.payload),
        listeningRows: arrayLength(
          sourceStores.find((store) => store.store === 'listeningData')?.payload
        ),
        artworkFiles
      },
      localStorageKeys,
      localStorageSource: localStorage.source,
      backupPath: backup.backupPath,
      backupVerified: true,
      markerPath
    };
  } catch (error) {
    const message = (error as Error).message;
    port.logger.error('Nora import interrupted.', { error });
    return fail(message, {
      ...partialForFailure(),
      storesImported: writtenStores,
      storesRemoved: removedStores,
      counts: { songs: 0, playlists: 0, listeningRows: 0, artworkFiles }
    });
  }
}

export default importNoraProfile;

import { STORE_LAYOUT, type StoreName } from '../../contracts/store';
import type { NoraImportPort } from './noraImportRepository';
import { NoraImportError } from './noraImportRepository';

/**
 * Identifies which Nora lives in `%APPDATA%\Nora` by inspecting its CONTENTS,
 * never by trusting the folder name — both the CMR fork and upstream Nora
 * 3.1.0 ship with productName "Nora" and therefore share the same profile
 * directory (docs/tauri-port/01-appdata-compat.md).
 *
 * Detection rule: `cmr_stats.json` and `tierlists.json` exist only in the CMR
 * fork (3.2 - 3.4.x). Their absence is the normal, healthy shape of an
 * upstream 3.1.0 profile, not an error.
 */

export type NoraSourceKind = 'cmr-fork' | 'upstream';

export interface NoraSourceInventory {
  kind: NoraSourceKind;
  /** Stores present in the Nora profile, in STORE_LAYOUT order. */
  presentStores: StoreName[];
  /** Stores absent from the Nora profile (normal for upstream: tierlists, cmrStats). */
  absentStores: StoreName[];
  /** The Chromium LevelDB folder exists (renderer state). */
  hasLevelDb: boolean;
  /** The artwork folder exists. */
  hasSongCovers: boolean;
}

const ALL_STORES = Object.keys(STORE_LAYOUT) as StoreName[];

export async function detectNoraSource(port: NoraImportPort): Promise<NoraSourceInventory> {
  const root = await port.noraProfilePath();
  if (!(await port.fileSystem.exists(root)))
    throw new NoraImportError(`Nora profile not found at ${root}`);

  const presentStores: StoreName[] = [];
  const absentStores: StoreName[] = [];
  for (const store of ALL_STORES) {
    const path = await port.noraProfilePath(STORE_LAYOUT[store].file);
    if (await port.fileSystem.exists(path)) presentStores.push(store);
    else absentStores.push(store);
  }

  if (presentStores.length === 0) throw new NoraImportError(`No Nora stores found at ${root}`);

  const hasForkStores = presentStores.includes('cmrStats') || presentStores.includes('tierlists');

  return {
    kind: hasForkStores ? 'cmr-fork' : 'upstream',
    presentStores,
    absentStores,
    hasLevelDb: await port.fileSystem.exists(
      await port.noraProfilePath('Local Storage', 'leveldb')
    ),
    hasSongCovers: await port.fileSystem.exists(await port.noraProfilePath('song_covers'))
  };
}

import {
  ByteCursor,
  bytesEqual,
  bytesToHex,
  concatBytes,
  crc32c,
  decodeChromiumString,
  decodeSnappy,
  maskCrc32c,
  readUint32Le,
  readUint64Le
} from './bytes';
import {
  LOCAL_STORAGE_KEYS,
  LocalStorageRecoveryError,
  type LocalStorageValues,
  type MigrationFileSystem
} from './types';

const LOG_BLOCK_SIZE = 32_768;
const LOG_HEADER_SIZE = 7;
const TABLE_FOOTER_SIZE = 48;
const TABLE_MAGIC = new Uint8Array([0x57, 0xfb, 0x80, 0x8b, 0x24, 0x75, 0x47, 0xdb]);
const PRODUCTION_MAP_PREFIX = new TextEncoder().encode('_file://\0');
const LEVELDB_SCHEMA_KEY = new TextEncoder().encode('VERSION');
const LEVELDB_SCHEMA_VALUE = new TextEncoder().encode('1');

interface PhysicalRecord {
  key: Uint8Array;
  sequence: bigint;
  deleted: boolean;
  value?: Uint8Array;
}

interface TableReference {
  number: number;
  size: number;
}

interface ManifestState {
  tables: Map<number, TableReference>;
  logNumber: number;
  previousLogNumber: number;
}

export interface LevelDbRecoveryResult {
  values: LocalStorageValues;
  filesRead: string[];
}

const readLogRecords = (bytes: Uint8Array, context: string): Uint8Array[] => {
  const records: Uint8Array[] = [];
  let offset = 0;
  let fragments: Uint8Array[] | undefined;

  while (offset < bytes.length) {
    const blockRemaining = LOG_BLOCK_SIZE - (offset % LOG_BLOCK_SIZE);
    if (blockRemaining < LOG_HEADER_SIZE) {
      offset += blockRemaining;
      continue;
    }
    if (offset + LOG_HEADER_SIZE > bytes.length) break;

    const storedChecksum = readUint32Le(bytes, offset);
    const length = bytes[offset + 4] | (bytes[offset + 5] << 8);
    const type = bytes[offset + 6];
    if (storedChecksum === 0 && length === 0 && type === 0) {
      offset += blockRemaining;
      continue;
    }
    if (length > blockRemaining - LOG_HEADER_SIZE)
      throw new LocalStorageRecoveryError(`${context}: physical record crosses a log block`);
    if (offset + LOG_HEADER_SIZE + length > bytes.length) break; // legal incomplete crash tail

    const payload = bytes.subarray(offset + LOG_HEADER_SIZE, offset + LOG_HEADER_SIZE + length);
    const actualChecksum = maskCrc32c(crc32c(concatBytes(new Uint8Array([type]), payload)));
    if (storedChecksum !== actualChecksum)
      throw new LocalStorageRecoveryError(`${context}: physical record checksum mismatch`);
    offset += LOG_HEADER_SIZE + length;

    if (type === 1) {
      if (fragments) throw new LocalStorageRecoveryError(`${context}: full record inside fragment`);
      records.push(payload);
    } else if (type === 2) {
      if (fragments) throw new LocalStorageRecoveryError(`${context}: nested first fragment`);
      fragments = [payload];
    } else if (type === 3) {
      if (!fragments) throw new LocalStorageRecoveryError(`${context}: orphan middle fragment`);
      fragments.push(payload);
    } else if (type === 4) {
      if (!fragments) throw new LocalStorageRecoveryError(`${context}: orphan last fragment`);
      fragments.push(payload);
      records.push(concatBytes(...fragments));
      fragments = undefined;
    } else {
      throw new LocalStorageRecoveryError(`${context}: unsupported physical record type ${type}`);
    }
  }
  // An incomplete fragmented tail is an uncommitted crash tail and is ignored.
  return records;
};

const parseManifest = (bytes: Uint8Array, context: string): ManifestState => {
  const tables = new Map<number, TableReference>();
  let logNumber = 0;
  let previousLogNumber = 0;

  for (const [recordIndex, record] of readLogRecords(bytes, context).entries()) {
    const cursor = new ByteCursor(record, `${context} edit ${recordIndex}`);
    while (cursor.remaining > 0) {
      const tag = cursor.readSafeVarint();
      if (tag === 1) cursor.readLengthPrefixed();
      else if (tag === 2) logNumber = cursor.readSafeVarint();
      else if (tag === 3 || tag === 4) cursor.readVarint();
      else if (tag === 5) {
        cursor.readSafeVarint();
        cursor.readLengthPrefixed();
      } else if (tag === 6) {
        cursor.readSafeVarint();
        tables.delete(cursor.readSafeVarint());
      } else if (tag === 7) {
        cursor.readSafeVarint();
        const number = cursor.readSafeVarint();
        const size = cursor.readSafeVarint();
        cursor.readLengthPrefixed();
        cursor.readLengthPrefixed();
        tables.set(number, { number, size });
      } else if (tag === 9) previousLogNumber = cursor.readSafeVarint();
      else cursor.fail(`unknown VersionEdit tag ${tag}`);
    }
  }
  return { tables, logNumber, previousLogNumber };
};

const decodeBlockHandle = (
  bytes: Uint8Array,
  context: string
): { offset: number; size: number } => {
  const cursor = new ByteCursor(bytes, context);
  const offset = cursor.readSafeVarint();
  const size = cursor.readSafeVarint();
  return { offset, size };
};

const readTableBlock = (
  table: Uint8Array,
  handle: { offset: number; size: number },
  context: string
): Uint8Array => {
  if (handle.offset < 0 || handle.size < 0 || handle.offset + handle.size + 5 > table.length)
    throw new LocalStorageRecoveryError(`${context}: block handle outside table`);
  const stored = table.subarray(handle.offset, handle.offset + handle.size);
  const compression = table[handle.offset + handle.size];
  const storedChecksum = readUint32Le(table, handle.offset + handle.size + 1);
  const actualChecksum = maskCrc32c(crc32c(concatBytes(stored, new Uint8Array([compression]))));
  if (storedChecksum !== actualChecksum)
    throw new LocalStorageRecoveryError(`${context}: table block checksum mismatch`);
  if (compression === 0) return stored;
  if (compression === 1) return decodeSnappy(stored, `${context} Snappy`);
  throw new LocalStorageRecoveryError(`${context}: unsupported table compression ${compression}`);
};

const parsePrefixBlock = (
  block: Uint8Array,
  context: string
): Array<{ key: Uint8Array; value: Uint8Array }> => {
  if (block.length < 4) throw new LocalStorageRecoveryError(`${context}: block is too short`);
  const restartCount = readUint32Le(block, block.length - 4);
  if (restartCount === 0 || restartCount > Math.floor((block.length - 4) / 4))
    throw new LocalStorageRecoveryError(`${context}: invalid restart count ${restartCount}`);
  const restartOffset = block.length - 4 * (restartCount + 1);
  let offset = 0;
  let previousKey: Uint8Array = new Uint8Array();
  const entries: Array<{ key: Uint8Array; value: Uint8Array }> = [];

  while (offset < restartOffset) {
    const cursor = new ByteCursor(block.subarray(offset, restartOffset), `${context} entry`);
    const shared = cursor.readSafeVarint();
    const unshared = cursor.readSafeVarint();
    const valueLength = cursor.readSafeVarint();
    if (shared > previousKey.length) cursor.fail('shared prefix exceeds previous key');
    const suffix = cursor.readBytes(unshared);
    const key = concatBytes(previousKey.subarray(0, shared), suffix);
    const value = cursor.readBytes(valueLength);
    offset += cursor.position;
    previousKey = key;
    entries.push({ key, value });
  }
  if (offset !== restartOffset)
    throw new LocalStorageRecoveryError(`${context}: entries overlap restart array`);
  return entries;
};

const parseTable = (table: Uint8Array, context: string): PhysicalRecord[] => {
  if (table.length < TABLE_FOOTER_SIZE)
    throw new LocalStorageRecoveryError(`${context}: table is shorter than its footer`);
  const footer = table.subarray(table.length - TABLE_FOOTER_SIZE);
  if (!bytesEqual(footer.subarray(40), TABLE_MAGIC))
    throw new LocalStorageRecoveryError(`${context}: invalid table magic`);
  return parseTableWithFooter(table, footer, context);
};

// Block handles are adjacent varints. This helper decodes both directly to avoid
// accepting trailing garbage in the fixed-width footer padding.
const parseTableWithFooter = (
  table: Uint8Array,
  footer: Uint8Array,
  context: string
): PhysicalRecord[] => {
  const cursor = new ByteCursor(footer.subarray(0, 40), `${context} footer`);
  cursor.readSafeVarint();
  cursor.readSafeVarint();
  const indexHandle = { offset: cursor.readSafeVarint(), size: cursor.readSafeVarint() };
  const indexBlock = readTableBlock(table, indexHandle, `${context} index`);
  const records: PhysicalRecord[] = [];
  for (const [index, entry] of parsePrefixBlock(indexBlock, `${context} index`).entries()) {
    const dataHandle = decodeBlockHandle(entry.value, `${context} index handle ${index}`);
    const dataBlock = readTableBlock(table, dataHandle, `${context} data block ${index}`);
    for (const dataEntry of parsePrefixBlock(dataBlock, `${context} data block ${index}`)) {
      if (dataEntry.key.length < 8)
        throw new LocalStorageRecoveryError(`${context}: internal key is shorter than 8 bytes`);
      const tag = readUint64Le(dataEntry.key, dataEntry.key.length - 8);
      const valueType = Number(tag & 0xffn);
      if (valueType !== 0 && valueType !== 1)
        throw new LocalStorageRecoveryError(`${context}: invalid internal value type ${valueType}`);
      records.push({
        key: dataEntry.key.subarray(0, dataEntry.key.length - 8),
        sequence: tag >> 8n,
        deleted: valueType === 0,
        value: valueType === 1 ? dataEntry.value : undefined
      });
    }
  }
  return records;
};

const parseWriteBatch = (batch: Uint8Array, context: string): PhysicalRecord[] => {
  if (batch.length < 12)
    throw new LocalStorageRecoveryError(`${context}: write batch is truncated`);
  const initialSequence = readUint64Le(batch, 0);
  const expectedCount = readUint32Le(batch, 8);
  const cursor = new ByteCursor(batch.subarray(12), context);
  const records: PhysicalRecord[] = [];
  while (cursor.remaining > 0) {
    const valueType = cursor.readByte();
    const key = cursor.readLengthPrefixed();
    if (valueType === 1) {
      records.push({
        key,
        sequence: initialSequence + BigInt(records.length),
        deleted: false,
        value: cursor.readLengthPrefixed()
      });
    } else if (valueType === 0) {
      records.push({ key, sequence: initialSequence + BigInt(records.length), deleted: true });
    } else cursor.fail(`unknown write batch value type ${valueType}`);
  }
  if (records.length !== expectedCount)
    throw new LocalStorageRecoveryError(
      `${context}: write batch count mismatch (expected ${expectedCount}, found ${records.length})`
    );
  return records;
};

const startsWith = (value: Uint8Array, prefix: Uint8Array): boolean => {
  if (value.length < prefix.length) return false;
  for (let index = 0; index < prefix.length; index += 1)
    if (value[index] !== prefix[index]) return false;
  return true;
};

const chooseNewestRecords = (records: PhysicalRecord[]): Map<string, PhysicalRecord> => {
  const newest = new Map<string, PhysicalRecord>();
  for (const record of records) {
    const key = bytesToHex(record.key);
    const previous = newest.get(key);
    if (!previous || record.sequence > previous.sequence) newest.set(key, record);
  }
  return newest;
};

const decodeNoraValues = (records: Map<string, PhysicalRecord>): LocalStorageValues => {
  const schemaRecord = records.get(bytesToHex(LEVELDB_SCHEMA_KEY));
  if (!schemaRecord || schemaRecord.deleted || !schemaRecord.value)
    throw new LocalStorageRecoveryError('LevelDB localStorage schema VERSION is missing');
  if (!bytesEqual(schemaRecord.value, LEVELDB_SCHEMA_VALUE))
    throw new LocalStorageRecoveryError('unsupported Chromium localStorage schema version');

  const result: LocalStorageValues = { version: null, localStorage: null, nora_song_guessr: null };
  for (const record of records.values()) {
    if (!startsWith(record.key, PRODUCTION_MAP_PREFIX)) continue;
    const encodedScriptKey = record.key.subarray(PRODUCTION_MAP_PREFIX.length);
    const scriptKey = decodeChromiumString(encodedScriptKey, 'Chromium localStorage key');
    if (!LOCAL_STORAGE_KEYS.includes(scriptKey as (typeof LOCAL_STORAGE_KEYS)[number])) continue;
    if (record.deleted || !record.value) result[scriptKey as keyof LocalStorageValues] = null;
    else
      result[scriptKey as keyof LocalStorageValues] = decodeChromiumString(
        record.value,
        `Chromium localStorage value ${scriptKey}`
      );
  }
  return result;
};

const parseFileNumber = (name: string, extension: string): number | undefined => {
  const match = new RegExp(`^(\\d+)\\.${extension}$`, 'i').exec(name);
  if (!match) return undefined;
  const number = Number(match[1]);
  return Number.isSafeInteger(number) ? number : undefined;
};

export async function recoverLocalStorageFromLevelDb(
  fileSystem: MigrationFileSystem,
  directory: string
): Promise<LevelDbRecoveryResult> {
  const currentPath = await fileSystem.join(directory, 'CURRENT');
  const current = (await fileSystem.readText(currentPath)).trim();
  if (!/^MANIFEST-\d+$/.test(current))
    throw new LocalStorageRecoveryError(`invalid LevelDB CURRENT value ${JSON.stringify(current)}`);
  const entries = await fileSystem.readDirectory(directory);
  const fileNames = new Set(entries.filter((entry) => entry.isFile).map((entry) => entry.name));
  if (!fileNames.has(current))
    throw new LocalStorageRecoveryError(`CURRENT references missing ${current}`);

  const manifestPath = await fileSystem.join(directory, current);
  const manifest = parseManifest(await fileSystem.readBinary(manifestPath), current);
  const records: PhysicalRecord[] = [];
  const filesRead = ['CURRENT', current];

  for (const tableReference of manifest.tables.values()) {
    const base = tableReference.number.toString().padStart(6, '0');
    const name = fileNames.has(`${base}.ldb`)
      ? `${base}.ldb`
      : fileNames.has(`${base}.sst`)
        ? `${base}.sst`
        : undefined;
    if (!name) throw new LocalStorageRecoveryError(`manifest references missing table ${base}`);
    const table = await fileSystem.readBinary(await fileSystem.join(directory, name));
    if (table.length !== tableReference.size)
      throw new LocalStorageRecoveryError(
        `${name}: manifest size ${tableReference.size} does not match file size ${table.length}`
      );
    records.push(...parseTable(table, name));
    filesRead.push(name);
  }

  const logEntries = entries
    .filter((entry) => entry.isFile)
    .map((entry) => ({ entry, number: parseFileNumber(entry.name, 'log') }))
    .filter(
      (item): item is { entry: (typeof entries)[number]; number: number } =>
        item.number !== undefined
    )
    .filter(
      (item) =>
        item.number >= manifest.logNumber ||
        (manifest.previousLogNumber !== 0 && item.number === manifest.previousLogNumber)
    )
    .sort((left, right) => left.number - right.number);

  for (const { entry } of logEntries) {
    const log = await fileSystem.readBinary(await fileSystem.join(directory, entry.name));
    for (const [index, batch] of readLogRecords(log, entry.name).entries())
      records.push(...parseWriteBatch(batch, `${entry.name} batch ${index}`));
    filesRead.push(entry.name);
  }

  return { values: decodeNoraValues(chooseNewestRecords(records)), filesRead };
}

// Test exports deliberately expose format readers, not any write path.
export const __levelDbTesting = { readLogRecords, parseManifest, parseTable, parseWriteBatch };

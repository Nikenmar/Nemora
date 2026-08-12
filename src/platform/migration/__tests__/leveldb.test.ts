import { createHash } from 'node:crypto';
import { promises as nodeFs } from 'node:fs';
import nodePath from 'node:path';
import { concatBytes, crc32c, encodeUtf8, maskCrc32c } from '../bytes';
import { recoverLocalStorageFromLevelDb } from '../leveldb';
import type { FileEntry, MigrationFileSystem } from '../types';
import { validateLocalStorageValues } from '../validation';

const varint = (input: number | bigint): Uint8Array => {
  let value = BigInt(input);
  const result: number[] = [];
  do {
    let byte = Number(value & 0x7fn);
    value >>= 7n;
    if (value > 0n) byte |= 0x80;
    result.push(byte);
  } while (value > 0n);
  return new Uint8Array(result);
};

const fixed32 = (value: number): Uint8Array =>
  new Uint8Array([value, value >>> 8, value >>> 16, value >>> 24]);

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
        fixed32(checksum),
        new Uint8Array([record.length & 0xff, record.length >>> 8]),
        type,
        record
      )
    );
  }
  return concatBytes(...physical);
};

interface Entry {
  key: Uint8Array;
  value?: Uint8Array;
  sequence: bigint;
}

const internalKey = (entry: Entry): Uint8Array =>
  concatBytes(entry.key, fixed64((entry.sequence << 8n) | BigInt(entry.value ? 1 : 0)));

const prefixBlock = (entries: Array<{ key: Uint8Array; value: Uint8Array }>): Uint8Array => {
  const encoded: Uint8Array[] = [];
  const restarts: number[] = [];
  let offset = 0;
  for (const entry of entries) {
    restarts.push(offset);
    const bytes = concatBytes(
      varint(0),
      varint(entry.key.length),
      varint(entry.value.length),
      entry.key,
      entry.value
    );
    encoded.push(bytes);
    offset += bytes.length;
  }
  return concatBytes(...encoded, ...restarts.map(fixed32), fixed32(restarts.length));
};

const snappyLiteral = (input: Uint8Array): Uint8Array => {
  const lengthMinusOne = input.length - 1;
  let tag: Uint8Array;
  if (input.length <= 60) tag = new Uint8Array([lengthMinusOne << 2]);
  else if (input.length <= 0x100) tag = new Uint8Array([60 << 2, lengthMinusOne]);
  else tag = new Uint8Array([61 << 2, lengthMinusOne & 0xff, lengthMinusOne >>> 8]);
  return concatBytes(varint(input.length), tag, input);
};

const tableBlock = (contents: Uint8Array, compression: 0 | 1): Uint8Array => {
  const stored = compression === 1 ? snappyLiteral(contents) : contents;
  const type = new Uint8Array([compression]);
  return concatBytes(stored, type, fixed32(maskCrc32c(crc32c(concatBytes(stored, type)))));
};

const tableFile = (entries: Entry[], compressData = false): Uint8Array => {
  const dataContents = prefixBlock(
    entries.map((entry) => ({ key: internalKey(entry), value: entry.value ?? new Uint8Array() }))
  );
  const dataBlock = tableBlock(dataContents, compressData ? 1 : 0);
  const metaContents = prefixBlock([]);
  // Empty LevelDB blocks still contain one restart at offset zero.
  const normalizedMeta =
    metaContents.length === 4 ? concatBytes(fixed32(0), fixed32(1)) : metaContents;
  const metaBlock = tableBlock(normalizedMeta, 0);
  const dataHandle = concatBytes(varint(0), varint(dataBlock.length - 5));
  const metaOffset = dataBlock.length;
  const metaHandle = concatBytes(varint(metaOffset), varint(metaBlock.length - 5));
  const indexContents = prefixBlock([
    { key: internalKey(entries[entries.length - 1]), value: dataHandle }
  ]);
  const indexOffset = dataBlock.length + metaBlock.length;
  const indexBlock = tableBlock(indexContents, 0);
  const indexHandle = concatBytes(varint(indexOffset), varint(indexBlock.length - 5));
  const handles = concatBytes(metaHandle, indexHandle);
  const footerPadding = new Uint8Array(40 - handles.length);
  const magic = new Uint8Array([0x57, 0xfb, 0x80, 0x8b, 0x24, 0x75, 0x47, 0xdb]);
  return concatBytes(dataBlock, metaBlock, indexBlock, handles, footerPadding, magic);
};

const manifestEdit = (options: {
  logNumber?: number;
  add?: Array<{ number: number; size: number }>;
  remove?: number[];
}): Uint8Array => {
  const fields: Uint8Array[] = [];
  if (options.logNumber !== undefined) fields.push(varint(2), varint(options.logNumber));
  for (const number of options.remove ?? []) fields.push(varint(6), varint(0), varint(number));
  for (const file of options.add ?? []) {
    const boundary = concatBytes(encodeUtf8('k'), fixed64(1n << 8n));
    fields.push(
      varint(7),
      varint(0),
      varint(file.number),
      varint(file.size),
      lengthPrefixed(boundary),
      lengthPrefixed(boundary)
    );
  }
  return concatBytes(...fields);
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
  return concatBytes(fixed64(sequence), fixed32(records.length), ...body);
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

class MemoryFileSystem implements MigrationFileSystem {
  readonly files = new Map<string, Uint8Array>();
  readonly directories = new Set<string>(['/db']);

  normalize(path: string): string {
    return path.replaceAll('\\', '/').replace(/\/$/, '');
  }

  put(path: string, contents: Uint8Array | string): void {
    this.files.set(
      this.normalize(path),
      typeof contents === 'string' ? encodeUtf8(contents) : contents
    );
  }

  async exists(path: string): Promise<boolean> {
    const normalized = this.normalize(path);
    return this.files.has(normalized) || this.directories.has(normalized);
  }

  async readText(path: string): Promise<string> {
    return new TextDecoder().decode(await this.readBinary(path));
  }

  async readBinary(path: string): Promise<Uint8Array> {
    const value = this.files.get(this.normalize(path));
    if (!value) throw new Error(`missing ${path}`);
    return value;
  }

  async readDirectory(path: string): Promise<FileEntry[]> {
    const prefix = `${this.normalize(path)}/`;
    return [...this.files.keys()]
      .filter((file) => file.startsWith(prefix) && !file.slice(prefix.length).includes('/'))
      .map((file) => ({
        name: file.slice(prefix.length),
        isFile: true,
        isDirectory: false,
        isSymlink: false
      }));
  }

  async metadata(path: string) {
    return { size: (await this.readBinary(path)).length, mtimeMs: 1 };
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
    for (const file of this.files.keys())
      if (file.startsWith(`${normalized}/`)) this.files.delete(file);
  }

  async join(...parts: string[]): Promise<string> {
    return this.normalize(parts.join('/'));
  }
}

const buildDatabase = (
  tables: Array<{ number: number; bytes: Uint8Array }>,
  edits: Uint8Array[],
  log?: { number: number; bytes: Uint8Array }
): MemoryFileSystem => {
  const fileSystem = new MemoryFileSystem();
  fileSystem.put('/db/CURRENT', 'MANIFEST-000001\n');
  fileSystem.put('/db/MANIFEST-000001', logFile(...edits));
  for (const table of tables)
    fileSystem.put(`/db/${table.number.toString().padStart(6, '0')}.ldb`, table.bytes);
  if (log) fileSystem.put(`/db/${log.number.toString().padStart(6, '0')}.log`, log.bytes);
  return fileSystem;
};

describe('read-only Chromium LevelDB recovery', () => {
  test('chooses newest production-origin values and honours log tombstones', async () => {
    const table = tableFile(
      [
        { key: encodeUtf8('VERSION'), value: encodeUtf8('1'), sequence: 1n },
        {
          key: mapKey('file://', 'version'),
          value: chromiumString('3.4.5-CMR-Fork'),
          sequence: 2n
        },
        {
          key: mapKey('file://', 'localStorage'),
          value: chromiumString('{"old":true}'),
          sequence: 3n
        },
        {
          key: mapKey('file://', 'nora_song_guessr'),
          value: chromiumString('{"old":true}'),
          sequence: 4n
        },
        {
          key: mapKey('http://localhost:5173', 'localStorage'),
          value: chromiumString('dev'),
          sequence: 5n
        }
      ],
      true
    );
    const batch = writeBatch(100n, [
      {
        key: mapKey('file://', 'localStorage'),
        value: chromiumString('{"new":true,"кириллица":1}')
      },
      { key: mapKey('file://', 'nora_song_guessr') },
      { key: mapKey('http://localhost:5173', 'localStorage'), value: chromiumString('new-dev') }
    ]);
    const fileSystem = buildDatabase(
      [{ number: 5, bytes: table }],
      [manifestEdit({ logNumber: 6, add: [{ number: 5, size: table.length }] })],
      { number: 6, bytes: logFile(batch) }
    );

    await expect(recoverLocalStorageFromLevelDb(fileSystem, '/db')).resolves.toMatchObject({
      values: {
        version: '3.4.5-CMR-Fork',
        localStorage: '{"new":true,"кириллица":1}',
        nora_song_guessr: null
      }
    });
  });

  test('uses only manifest-live tables after compaction and never resurrects an obsolete value', async () => {
    const stale = tableFile([
      { key: encodeUtf8('VERSION'), value: encodeUtf8('1'), sequence: 1n },
      { key: mapKey('file://', 'version'), value: chromiumString('obsolete'), sequence: 2n }
    ]);
    const compacted = tableFile([
      { key: encodeUtf8('VERSION'), value: encodeUtf8('1'), sequence: 10n },
      { key: mapKey('file://', 'version'), value: chromiumString('current'), sequence: 11n }
    ]);
    const fileSystem = buildDatabase(
      [
        { number: 5, bytes: stale },
        { number: 6, bytes: compacted }
      ],
      [
        manifestEdit({ logNumber: 7, add: [{ number: 5, size: stale.length }] }),
        manifestEdit({ remove: [5], add: [{ number: 6, size: compacted.length }] })
      ],
      { number: 7, bytes: new Uint8Array() }
    );

    const recovered = await recoverLocalStorageFromLevelDb(fileSystem, '/db');
    expect(recovered.values.version).toBe('current');
    expect(recovered.filesRead).toContain('000006.ldb');
    expect(recovered.filesRead).not.toContain('000005.ldb');
  });

  test('fails closed on a corrupt table checksum', async () => {
    const table = tableFile([{ key: encodeUtf8('VERSION'), value: encodeUtf8('1'), sequence: 1n }]);
    table[5] ^= 0xff;
    const fileSystem = buildDatabase(
      [{ number: 5, bytes: table }],
      [manifestEdit({ add: [{ number: 5, size: table.length }] })]
    );
    await expect(recoverLocalStorageFromLevelDb(fileSystem, '/db')).rejects.toThrow(/checksum/i);
  });
});

const realFixture = process.env.NORA_LEVELDB_FIXTURE;
const realFixtureTest = realFixture ? test : test.skip;

realFixtureTest('recovers all three keys from the read-only copied real fixture', async () => {
  const fileSystem: MigrationFileSystem = {
    exists: async (path) =>
      nodeFs.access(path).then(
        () => true,
        () => false
      ),
    readText: (path) => nodeFs.readFile(path, 'utf8'),
    readBinary: async (path) => new Uint8Array(await nodeFs.readFile(path)),
    readDirectory: async (path) =>
      (await nodeFs.readdir(path, { withFileTypes: true })).map((entry) => ({
        name: entry.name,
        isFile: entry.isFile(),
        isDirectory: entry.isDirectory(),
        isSymlink: entry.isSymbolicLink()
      })),
    metadata: async (path) => {
      const value = await nodeFs.stat(path);
      return { size: value.size, mtimeMs: value.mtimeMs };
    },
    copyFile: (source, destination) => nodeFs.copyFile(source, destination),
    createDirectory: (path) => nodeFs.mkdir(path, { recursive: true }).then(() => undefined),
    removeDirectory: (path) => nodeFs.rm(path, { recursive: true, force: true }),
    join: async (...parts) => nodePath.join(...parts)
  };
  const result = await recoverLocalStorageFromLevelDb(fileSystem, realFixture!);
  expect(() => validateLocalStorageValues(result.values)).not.toThrow();
  expect(result.values.version).toMatch(/CMR-Fork/);
  expect(JSON.parse(result.values.localStorage!)).toEqual(expect.any(Object));
  expect(JSON.parse(result.values.nora_song_guessr!)).toEqual(expect.any(Object));
  expect(createHash('sha256').update(result.values.localStorage!).digest('hex')).toHaveLength(64);
});

import { LocalStorageRecoveryError } from './types';

const textEncoder = new TextEncoder();
const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

export const encodeUtf8 = (value: string): Uint8Array => textEncoder.encode(value);

export const decodeUtf8 = (value: Uint8Array): string => utf8Decoder.decode(value);

export const concatBytes = (...parts: Uint8Array[]): Uint8Array => {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
};

export const bytesEqual = (left: Uint8Array, right: Uint8Array): boolean => {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
};

export const bytesToHex = (value: Uint8Array): string =>
  Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');

export const readUint32Le = (bytes: Uint8Array, offset: number): number => {
  if (offset < 0 || offset + 4 > bytes.length)
    throw new LocalStorageRecoveryError('truncated uint32');
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  );
};

export const readUint64Le = (bytes: Uint8Array, offset: number): bigint => {
  if (offset < 0 || offset + 8 > bytes.length)
    throw new LocalStorageRecoveryError('truncated uint64');
  let result = 0n;
  for (let index = 7; index >= 0; index -= 1)
    result = (result << 8n) | BigInt(bytes[offset + index]);
  return result;
};

export class ByteCursor {
  position = 0;
  readonly bytes: Uint8Array;
  readonly context: string;

  constructor(bytes: Uint8Array, context: string) {
    this.bytes = bytes;
    this.context = context;
  }

  get remaining(): number {
    return this.bytes.length - this.position;
  }

  readByte(): number {
    this.require(1);
    return this.bytes[this.position++];
  }

  readBytes(length: number): Uint8Array {
    if (!Number.isSafeInteger(length) || length < 0) this.fail(`invalid byte length ${length}`);
    this.require(length);
    const result = this.bytes.subarray(this.position, this.position + length);
    this.position += length;
    return result;
  }

  readVarint(): bigint {
    let result = 0n;
    for (let shift = 0n; shift <= 63n; shift += 7n) {
      const byte = this.readByte();
      result |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return result;
    }
    return this.fail('varint exceeds 64 bits');
  }

  readSafeVarint(): number {
    const value = this.readVarint();
    if (value > BigInt(Number.MAX_SAFE_INTEGER))
      return this.fail('varint exceeds safe integer range');
    return Number(value);
  }

  readLengthPrefixed(): Uint8Array {
    return this.readBytes(this.readSafeVarint());
  }

  require(length: number): void {
    if (this.position + length > this.bytes.length)
      this.fail(`truncated input (needed ${length} bytes)`);
  }

  fail(message: string): never {
    throw new LocalStorageRecoveryError(`${this.context}: ${message} at byte ${this.position}`);
  }
}

const CRC32C_POLYNOMIAL = 0x82f63b78;
const crc32cTable = new Uint32Array(256);
for (let value = 0; value < crc32cTable.length; value += 1) {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1)
    crc = (crc & 1) === 1 ? (crc >>> 1) ^ CRC32C_POLYNOMIAL : crc >>> 1;
  crc32cTable[value] = crc >>> 0;
}

export const crc32c = (bytes: Uint8Array): number => {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crc32cTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

export const maskCrc32c = (crc: number): number =>
  ((((crc >>> 15) | (crc << 17)) >>> 0) + 0xa282ead8) >>> 0;

/** Decodes LevelDB's raw Snappy block format (not the framed stream format). */
export const decodeSnappy = (input: Uint8Array, context: string): Uint8Array => {
  const cursor = new ByteCursor(input, context);
  const outputLength = cursor.readSafeVarint();
  const output = new Uint8Array(outputLength);
  let outputPosition = 0;

  const copyFromOutput = (offset: number, length: number): void => {
    if (offset <= 0 || offset > outputPosition || outputPosition + length > output.length)
      cursor.fail(`invalid Snappy copy offset=${offset} length=${length}`);
    for (let index = 0; index < length; index += 1)
      output[outputPosition + index] = output[outputPosition - offset + index];
    outputPosition += length;
  };

  while (cursor.remaining > 0 && outputPosition < output.length) {
    const tag = cursor.readByte();
    const type = tag & 0x03;
    if (type === 0) {
      let length = tag >>> 2;
      if (length < 60) length += 1;
      else {
        const extraBytes = length - 59;
        if (extraBytes > 4) cursor.fail('invalid Snappy literal length');
        length = 0;
        for (let index = 0; index < extraBytes; index += 1)
          length += cursor.readByte() * 2 ** (8 * index);
        length += 1;
      }
      if (outputPosition + length > output.length)
        cursor.fail('Snappy literal exceeds output length');
      output.set(cursor.readBytes(length), outputPosition);
      outputPosition += length;
    } else if (type === 1) {
      const length = 4 + ((tag >>> 2) & 0x07);
      const offset = ((tag & 0xe0) << 3) | cursor.readByte();
      copyFromOutput(offset, length);
    } else if (type === 2) {
      const length = 1 + (tag >>> 2);
      const offset = cursor.readByte() | (cursor.readByte() << 8);
      copyFromOutput(offset, length);
    } else {
      const length = 1 + (tag >>> 2);
      const offset =
        cursor.readByte() |
        (cursor.readByte() << 8) |
        (cursor.readByte() << 16) |
        (cursor.readByte() << 24);
      copyFromOutput(offset >>> 0, length);
    }
  }

  if (outputPosition !== output.length || cursor.remaining !== 0)
    cursor.fail(`Snappy length mismatch (expected ${output.length}, decoded ${outputPosition})`);
  return output;
};

/** Chromium localStorage stores either UTF-16LE (tag 0) or one-byte Latin-1 (tag 1). */
export const decodeChromiumString = (bytes: Uint8Array, context: string): string => {
  if (bytes.length === 0)
    throw new LocalStorageRecoveryError(`${context}: missing string encoding tag`);
  const format = bytes[0];
  const payload = bytes.subarray(1);
  if (format === 1) {
    // TextDecoder('iso-8859-1') aliases Windows-1252 in browsers. Build the code
    // units directly so bytes 0x80..0x9f remain Latin-1, matching Blink.
    let result = '';
    for (let offset = 0; offset < payload.length; offset += 0x4000)
      result += String.fromCharCode(...payload.subarray(offset, offset + 0x4000));
    return result;
  }
  if (format === 0) {
    if (payload.length % 2 !== 0)
      throw new LocalStorageRecoveryError(`${context}: odd UTF-16 payload length`);
    let result = '';
    const chunk: number[] = [];
    for (let index = 0; index < payload.length; index += 2) {
      chunk.push(payload[index] | (payload[index + 1] << 8));
      if (chunk.length === 0x4000) {
        result += String.fromCharCode(...chunk);
        chunk.length = 0;
      }
    }
    if (chunk.length > 0) result += String.fromCharCode(...chunk);
    return result;
  }
  throw new LocalStorageRecoveryError(`${context}: unsupported Chromium string tag ${format}`);
};

import type { ByteVector } from 'node-taglib-sharp';
import type { IFileAbstraction } from 'node-taglib-sharp/dist/fileAbstraction';
import type { IStream, SeekOrigin } from 'node-taglib-sharp/dist/stream';

type MemoryStorage = { bytes: Uint8Array };

const assertSafeUnsigned = (value: number, name: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
};

const assertBufferRange = (bufferLength: number, offset: number, length: number): void => {
  assertSafeUnsigned(offset, 'bufferOffset');
  assertSafeUnsigned(length, 'length');
  if (offset + length > bufferLength) throw new RangeError('buffer range is out of bounds');
};

/** Synchronous, seekable stream backed by a shared in-memory byte array. */
export class MemoryTagStream implements IStream {
  private readonly storage: MemoryStorage;
  private readonly writable: boolean;
  private cursor = 0;
  private closed = false;

  constructor(storage: MemoryStorage, writable: boolean) {
    this.storage = storage;
    this.writable = writable;
  }

  get canWrite(): boolean {
    return this.writable;
  }

  get length(): number {
    this.assertOpen();
    return this.storage.bytes.byteLength;
  }

  get position(): number {
    this.assertOpen();
    return this.cursor;
  }

  set position(value: number) {
    this.assertOpen();
    assertSafeUnsigned(value, 'position');
    this.cursor = value;
  }

  close(): void {
    this.closed = true;
  }

  read(buffer: Uint8Array, bufferOffset: number, length: number): number {
    this.assertOpen();
    assertBufferRange(buffer.byteLength, bufferOffset, length);
    const available = Math.max(0, this.storage.bytes.byteLength - this.cursor);
    const count = Math.min(length, available);
    if (count > 0) {
      buffer.set(this.storage.bytes.subarray(this.cursor, this.cursor + count), bufferOffset);
      this.cursor += count;
    }
    return count;
  }

  seek(offset: number, origin: SeekOrigin): void {
    this.assertOpen();
    if (!Number.isSafeInteger(offset)) throw new RangeError('offset must be a safe integer');

    let position: number;
    if (origin === 0) position = offset;
    else if (origin === 1) position = this.cursor + offset;
    else if (origin === 2) position = this.storage.bytes.byteLength + offset;
    else throw new RangeError(`unknown seek origin: ${String(origin)}`);
    assertSafeUnsigned(position, 'seek position');
    this.cursor = position;
  }

  setLength(length: number): void {
    this.assertWritable();
    assertSafeUnsigned(length, 'length');
    if (length !== this.storage.bytes.byteLength) {
      const resized = new Uint8Array(length);
      resized.set(this.storage.bytes.subarray(0, Math.min(length, this.storage.bytes.byteLength)));
      this.storage.bytes = resized;
    }
    if (this.cursor > length) this.cursor = length;
  }

  write(buffer: Uint8Array | ByteVector, bufferOffset: number, length: number): number {
    this.assertWritable();
    const source = buffer instanceof Uint8Array ? buffer : buffer.toByteArray();
    assertBufferRange(source.byteLength, bufferOffset, length);
    const end = this.cursor + length;
    if (!Number.isSafeInteger(end)) throw new RangeError('write end must be a safe integer');
    if (end > this.storage.bytes.byteLength) {
      const resized = new Uint8Array(end);
      resized.set(this.storage.bytes);
      this.storage.bytes = resized;
    }
    this.storage.bytes.set(source.subarray(bufferOffset, bufferOffset + length), this.cursor);
    this.cursor = end;
    return length;
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('stream is closed');
  }

  private assertWritable(): void {
    this.assertOpen();
    if (!this.writable) throw new Error('stream is read-only');
  }
}

/**
 * TagLib file abstraction that never touches the filesystem. Each opened stream
 * shares one backing buffer, so TagLib's read/write mode transitions are visible.
 */
export class MemoryFileAbstraction implements IFileAbstraction {
  readonly name: string;
  private readonly storage: MemoryStorage;

  constructor(name: string, contents: Uint8Array) {
    if (!name) throw new TypeError('name must not be empty');
    this.name = name;
    this.storage = { bytes: Uint8Array.from(contents) };
  }

  get readStream(): IStream {
    return new MemoryTagStream(this.storage, false);
  }

  get writeStream(): IStream {
    return new MemoryTagStream(this.storage, true);
  }

  closeStream(stream: IStream): void {
    stream.close();
  }

  snapshot(): Uint8Array {
    return Uint8Array.from(this.storage.bytes);
  }
}

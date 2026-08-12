import { ByteVector, SeekOrigin } from 'node-taglib-sharp';

import { MemoryFileAbstraction, MemoryTagStream } from '../memoryFileAbstraction';

describe('MemoryFileAbstraction', () => {
  test('read, seek, overwrite, extend, and truncate share one backing buffer', () => {
    const abstraction = new MemoryFileAbstraction('track.flac', Uint8Array.of(1, 2, 3, 4));
    const reader = abstraction.readStream;
    const destination = new Uint8Array(3);

    reader.seek(1, SeekOrigin.Begin);
    expect(reader.read(destination, 0, 3)).toBe(3);
    expect([...destination]).toEqual([2, 3, 4]);
    expect(reader.read(destination, 0, 1)).toBe(0);
    abstraction.closeStream(reader);

    const writer = abstraction.writeStream as MemoryTagStream;
    writer.seek(-2, SeekOrigin.End);
    expect(writer.write(Uint8Array.of(8, 9, 10), 0, 3)).toBe(3);
    expect([...abstraction.snapshot()]).toEqual([1, 2, 8, 9, 10]);
    writer.setLength(3);
    expect(writer.position).toBe(3);
    expect([...abstraction.snapshot()]).toEqual([1, 2, 8]);
  });

  test('supports ByteVector writes and zero-fills a seek gap', () => {
    const abstraction = new MemoryFileAbstraction('track.flac', Uint8Array.of(1));
    const writer = abstraction.writeStream;
    writer.seek(3, SeekOrigin.Begin);
    const vector = ByteVector.fromByteArray(Uint8Array.of(5, 6));
    writer.write(vector, 0, vector.length);

    expect([...abstraction.snapshot()]).toEqual([1, 0, 0, 5, 6]);
  });

  test('rejects invalid ranges, writes on read streams, and use after close', () => {
    const abstraction = new MemoryFileAbstraction('track.flac', Uint8Array.of(1, 2));
    const reader = abstraction.readStream;
    expect(() => reader.write(Uint8Array.of(1), 0, 1)).toThrow('read-only');
    expect(() => reader.read(new Uint8Array(1), 1, 1)).toThrow(RangeError);
    reader.close();
    expect(() => reader.read(new Uint8Array(1), 0, 1)).toThrow('closed');
  });

  test('snapshot is defensive', () => {
    const abstraction = new MemoryFileAbstraction('track.flac', Uint8Array.of(1, 2));
    const snapshot = abstraction.snapshot();
    snapshot[0] = 99;
    expect([...abstraction.snapshot()]).toEqual([1, 2]);
  });
});

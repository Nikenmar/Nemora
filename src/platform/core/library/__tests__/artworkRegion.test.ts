import { describe, expect, test } from '@jest/globals';

import { artworkRegionSize } from '../artworkRegion';

const ascii = (value: string): number[] => [...value].map((char) => char.charCodeAt(0));

/** `[flags][3-byte big-endian length][payload]`, flags = isLast<<7 | type. */
const flacBlock = (type: number, length: number, isLast = false, payload = length): number[] => [
  (isLast ? 0x80 : 0) | type,
  (length >> 16) & 0xff,
  (length >> 8) & 0xff,
  length & 0xff,
  ...new Array<number>(payload).fill(0)
];

const flacFile = (...blocks: number[][]): Uint8Array =>
  new Uint8Array([...ascii('fLaC'), ...blocks.flat()]);

describe('artworkRegionSize', () => {
  test('returns the end of a FLAC picture block that fits in the head', () => {
    // 4 marker + (4 + 34) STREAMINFO + (4 + 16) PICTURE = 62
    const head = flacFile(flacBlock(0, 34), flacBlock(6, 16, true));
    expect(artworkRegionSize(head)).toBe(62);
  });

  test('returns the end of a picture block whose payload is truncated', () => {
    // The whole point: the header is readable, the data is not. 4 + 38 + 4 +
    // 900_000 = 900_046, which is what the scanner must ask for.
    const head = flacFile(flacBlock(0, 34), flacBlock(6, 900_000, true, 100));
    expect(artworkRegionSize(head)).toBe(900_046);
  });

  test('gives up when an earlier block runs past the head', () => {
    // A huge comment block hides whatever follows it, so nothing can be claimed
    // about a picture behind it.
    const head = flacFile(flacBlock(0, 34), flacBlock(4, 900_000, false, 100));
    expect(artworkRegionSize(head)).toBeUndefined();
  });

  test('returns undefined for a FLAC with no picture block', () => {
    const head = flacFile(flacBlock(0, 34), flacBlock(4, 16, true));
    expect(artworkRegionSize(head)).toBeUndefined();
  });

  test('returns the end of an ID3v2 tag', () => {
    // Syncsafe 0x00 0x00 0x02 0x01 = (2 << 7) | 1 = 257, plus the 10-byte header.
    const head = new Uint8Array([...ascii('ID3'), 3, 0, 0, 0x00, 0x00, 0x02, 0x01, 0, 0]);
    expect(artworkRegionSize(head)).toBe(267);
  });

  test('rejects an ID3v2 size that is not syncsafe', () => {
    const head = new Uint8Array([...ascii('ID3'), 3, 0, 0, 0x00, 0x00, 0x80, 0x01, 0, 0]);
    expect(artworkRegionSize(head)).toBeUndefined();
  });

  test('returns undefined for a container it cannot read', () => {
    expect(artworkRegionSize(new Uint8Array([...ascii('RIFF'), 0, 0, 0, 0]))).toBeUndefined();
    expect(artworkRegionSize(new Uint8Array())).toBeUndefined();
  });
});

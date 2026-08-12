/**
 * Hashing for the ported network core.
 *
 * The Electron code used Node's `crypto.createHash`. A webview has Web Crypto
 * (`crypto.subtle`), which is async and has no MD5 — and Last.fm request
 * signing needs a synchronous MD5. This module provides the MD5 path as a
 * pure-TypeScript RFC 1321 implementation (verified against known vectors and
 * Node's `crypto` in the test suite). SHA-256/512 are deliberately NOT
 * implemented synchronously: they are not used by any ported network call, and
 * a future caller must use `crypto.subtle.digest` instead.
 */

const SHIFT_AMOUNTS = new Uint8Array([
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
]);

const ROUND_CONSTANTS = new Uint32Array(64);
for (let i = 0; i < 64; i += 1) {
  ROUND_CONSTANTS[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32);
}

const INITIAL_A = 0x67452301;
const INITIAL_B = 0xefcdab89;
const INITIAL_C = 0x98badcfe;
const INITIAL_D = 0x10325476;

const leftRotate = (value: number, amount: number) =>
  ((value << amount) | (value >>> (32 - amount))) >>> 0;

/** MD5 of the UTF-8 encoding of `content`, as 16 little-endian bytes. */
const md5Digest = (content: string): Uint8Array => {
  const bytes = new TextEncoder().encode(content);
  const bitLength = bytes.length * 8;
  const paddedLength = (((bytes.length + 8) >> 6) + 1) << 6;

  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, bitLength >>> 0, true);
  view.setUint32(paddedLength - 4, Math.floor(bitLength / 2 ** 32), true);

  let a0 = INITIAL_A;
  let b0 = INITIAL_B;
  let c0 = INITIAL_C;
  let d0 = INITIAL_D;

  for (let offset = 0; offset < paddedLength; offset += 64) {
    const words = new Uint32Array(16);
    for (let i = 0; i < 16; i += 1) words[i] = view.getUint32(offset + i * 4, true);

    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;

    for (let i = 0; i < 64; i += 1) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }

      const temp = d;
      d = c;
      c = b;
      b = (b + leftRotate((a + f + ROUND_CONSTANTS[i] + words[g]) >>> 0, SHIFT_AMOUNTS[i])) >>> 0;
      a = temp;
    }

    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  const digest = new Uint8Array(16);
  const output = new DataView(digest.buffer);
  output.setUint32(0, a0, true);
  output.setUint32(4, b0, true);
  output.setUint32(8, c0, true);
  output.setUint32(12, d0, true);
  return digest;
};

const toHex = (digest: Uint8Array) =>
  Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');

const toBase64 = (digest: Uint8Array) => {
  let binary = '';
  for (const byte of digest) binary += String.fromCharCode(byte);
  return btoa(binary);
};

type HashingAlgorithm = 'md5' | 'sha256' | 'sha512';
type DigestEncoding = 'hex' | 'base64';

function hashText(
  content: string,
  algo: HashingAlgorithm = 'md5',
  digestEncoding: DigestEncoding = 'hex'
) {
  if (algo === 'sha256' || algo === 'sha512') {
    throw new Error(
      `${algo} hashing is not available in the webview core; use Web Crypto (crypto.subtle.digest).`
    );
  }
  const digest = md5Digest(content);
  return digestEncoding === 'base64' ? toBase64(digest) : toHex(digest);
}

export default hashText;

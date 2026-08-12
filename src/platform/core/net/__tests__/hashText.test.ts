import { createHash } from 'node:crypto';
import { describe, expect, test } from '@jest/globals';

import hashText from '../hashText';

const nodeHash = (content: string, algo: 'md5' | 'sha256' | 'sha512', encoding: 'hex' | 'base64') =>
  createHash(algo).update(content).digest(encoding);

describe('hashText (pure-TypeScript MD5)', () => {
  test('matches the RFC 1321 known vectors', () => {
    expect(hashText('')).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(hashText('abc')).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(hashText('The quick brown fox jumps over the lazy dog')).toBe(
      '9e107d9d372bb6826bd81d3542a419d6'
    );
    expect(hashText('message digest')).toBe('f96b697d7cb7938d525a2f31aaf161d0');
    expect(hashText('abcdefghijklmnopqrstuvwxyz')).toBe('c3fcd3d76192e4007dfb496cca67e13b');
  });

  test('handles UTF-8 input the same way Node crypto does', () => {
    const inputs = ['ひかり', 'Ελλάδα', 'Цой', 'música — café', 'øneheart ½'];
    for (const input of inputs) {
      expect(hashText(input)).toBe(nodeHash(input, 'md5', 'hex'));
    }
  });

  test('handles input lengths around the 64-byte block boundary', () => {
    for (const length of [55, 56, 63, 64, 65, 127, 128, 129, 1000]) {
      const input = 'a'.repeat(length);
      expect(hashText(input)).toBe(nodeHash(input, 'md5', 'hex'));
    }
  });

  test('produces the same base64 output as Node crypto', () => {
    const input = 'methodtrack.scrobbleapikeyabcsksecret';
    expect(hashText(input, 'md5', 'base64')).toBe(nodeHash(input, 'md5', 'base64'));
  });

  test('matches Node crypto for every byte value', () => {
    let input = '';
    for (let i = 0; i < 256; i += 1) input += String.fromCharCode(i);
    expect(hashText(input)).toBe(nodeHash(input, 'md5', 'hex'));
  });

  test('rejects the async SHA algorithms with a clear message', () => {
    expect(() => hashText('x', 'sha256')).toThrow(/Web Crypto/);
    expect(() => hashText('x', 'sha512')).toThrow(/Web Crypto/);
  });
});

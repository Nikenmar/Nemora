import { describe, expect, test } from '@jest/globals';
import { createHash } from 'crypto';

import { md5Hex } from '../md5';

describe('md5Hex (RFC 1321, WebCrypto-free replacement for node:crypto md5)', () => {
  const vectors: [string, string][] = [
    ['', 'd41d8cd98f00b204e9800998ecf8427e'],
    ['a', '0cc175b9c0f1b6a831c399e269772661'],
    ['abc', '900150983cd24fb0d6963f7d28e17f72'],
    ['message digest', 'f96b697d7cb7938d525a2f31aaf161d0'],
    ['abcdefghijklmnopqrstuvwxyz', 'c3fcd3d76192e4007dfb496cca67e13b'],
    [
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
      'd174ab98d277d9f5a5611c2c9f419d9f'
    ],
    [
      '12345678901234567890123456789012345678901234567890123456789012345678901234567890',
      '57edf4a22be3c955ac49da2e2107b67a'
    ],
    ['The quick brown fox jumps over the lazy dog', '9e107d9d372bb6826bd81d3542a419d6'],
    ['The quick brown fox jumps over the lazy dog.', 'e4d909c290d0fb1ca068ffaddf22cbd0']
  ];

  for (const [input, expected] of vectors) {
    test(`hashes ${JSON.stringify(input.slice(0, 40))}${input.length > 40 ? '...' : ''}`, () => {
      expect(md5Hex(input)).toBe(expected);
    });
  }

  test('matches node crypto for multi-byte UTF-8 input', () => {
    const inputs = [
      'Пётр Ильич Чайковский',
      'Ελλάδα — 你好，世界',
      'a'.repeat(1000),
      'в'.repeat(500) + 'mixed 123 !@#',
      JSON.stringify({ listeningData: [{ songId: 'x', listens: [[1723, 2]] }] })
    ];
    for (const input of inputs) {
      expect(md5Hex(input)).toBe(createHash('md5').update(input).digest('hex'));
    }
  });

  test('is idempotent and case-stable', () => {
    expect(md5Hex('stats')).toBe(md5Hex('stats'));
    expect(md5Hex('stats')).toMatch(/^[0-9a-f]{32}$/);
  });
});

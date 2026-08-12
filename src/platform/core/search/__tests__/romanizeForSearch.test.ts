import { describe, expect, jest, test } from '@jest/globals';

// any-ascii ships ESM-only and jest's CJS runtime cannot load it. The mock
// mirrors the real package's output for the fixtures used here, verified
// against node_modules via Node's require(esm):
//   anyAscii('Ελλάδα') === 'Ellada', anyAscii('Цой') === 'Tsoy'
jest.mock('any-ascii', () => ({
  __esModule: true,
  default: (value: string) => {
    const verified: Record<string, string> = { Ελλάδα: 'Ellada', Цой: 'Tsoy' };
    return verified[value] ?? value;
  }
}));

import { hasRomanizableScript, romanizeForSearch } from '../romanizeForSearch';

describe('hasRomanizableScript', () => {
  test('is true for anything outside printable ASCII', () => {
    expect(hasRomanizableScript('Ελλάδα')).toBe(true);
    expect(hasRomanizableScript('ひかり')).toBe(true);
    expect(hasRomanizableScript('안녕')).toBe(true);
    expect(hasRomanizableScript('你好')).toBe(true);
  });

  test('is false for plain ASCII', () => {
    expect(hasRomanizableScript('hello world')).toBe(false);
    expect(hasRomanizableScript('')).toBe(false);
  });
});

describe('romanizeForSearch', () => {
  test('transliterates Greek via the generic table', () => {
    expect(romanizeForSearch('Ελλάδα')).toBe('Ellada');
  });

  test('transliterates Cyrillic via the generic table', () => {
    expect(romanizeForSearch('Цой')).toBe('Tsoy');
  });

  test('reads kana with its long vowels', () => {
    expect(romanizeForSearch('ひかり')).toBe('hikari');
    expect(romanizeForSearch('とうきょう')).toBe('toukyou');
  });

  test('reads hangul', () => {
    const reading = romanizeForSearch('안녕하세요');
    expect(typeof reading).toBe('string');
    expect(reading.length).toBeGreaterThan(0);
    expect(reading).not.toBe('안녕하세요');
  });

  test('reads hanzi via pinyin', () => {
    const reading = romanizeForSearch('你好');
    expect(reading).toMatch(/^ni\s+hao$/);
  });

  test('leaves plain ASCII alone', () => {
    expect(romanizeForSearch('nirvana')).toBeUndefined();
    expect(romanizeForSearch('')).toBeUndefined();
  });

  test('never throws on unreadable input', () => {
    expect(() => romanizeForSearch('🤖')).not.toThrow();
  });
});

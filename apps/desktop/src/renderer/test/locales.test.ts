import { describe, expect, it } from 'vitest';
import en from '../src/assets/locales/en/en.json';

/**
 * A language may lag English (the missing strings read in English), but what it has must be usable:
 * no key English does not know, and the same placeholders, tags and nested strings as the English.
 */
const locales = import.meta.glob<{ default: Record<string, unknown> }>(
  '../src/assets/locales/*/*.json',
  { eager: true }
);

const flatten = (value: unknown, prefix = '', out: Record<string, string> = {}) => {
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof item === 'string') out[path] = item;
    else flatten(item, path, out);
  }
  return out;
};

const PLURAL = /_(zero|one|two|few|many|other)$/;
const TOKEN = /\{\{[^}]*\}\}|\$t\([^)]*\)|<\/?[A-Za-z][A-Za-z0-9]*\s*\/?>/g;

const tokens = (text: string) =>
  (text.match(TOKEN) ?? [])
    .map((token) => token.replace(/\s+/g, '').replace(/"title":"[^"]*"/, '"title":""'))
    .sort();

const english = flatten(en);

describe.each(Object.keys(locales).filter((path) => !path.endsWith('/en.json')))('%s', (path) => {
  const strings = flatten(locales[path].default);

  it('has every English string', () => {
    const missing = Object.keys(english).filter((key) =>
      PLURAL.test(key) ? !strings[key.replace(PLURAL, '_other')] : !strings[key]
    );
    expect(missing).toEqual([]);
  });

  it('keeps the placeholders, tags and nested strings', () => {
    const wrong = Object.entries(strings).filter(([key, text]) => {
      const stem = key.replace(PLURAL, '');
      const accepted = PLURAL.test(key)
        ? [english[`${stem}_other`], english[`${stem}_one`]].filter(Boolean)
        : [english[key]];
      if (!accepted.length || accepted[0] === undefined) return true;
      return !accepted.some((source) => tokens(source).join() === tokens(text).join());
    });
    expect(wrong.map(([key]) => key)).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { isSelectAll, isTypingIn, shortcutKey } from '../src/utils/shortcutKey';

const key = (k: string, code: string, shiftKey = false) => ({ key: k, code, shiftKey });

describe('a shortcut on any keyboard layout', () => {
  it('names the key a Latin layout prints, AZERTY and QWERTZ included', () => {
    expect(shortcutKey(key('a', 'KeyA'))).toBe('a');
    // AZERTY: the key printed A sits where QWERTY has Q.
    expect(shortcutKey(key('a', 'KeyQ'))).toBe('a');
    // QWERTZ: Y and Z trade places.
    expect(shortcutKey(key('z', 'KeyY'))).toBe('z');
    expect(shortcutKey(key('ArrowLeft', 'ArrowLeft'))).toBe('ArrowLeft');
  });

  it('names the US key under another script, so Ctrl+A on a Russian layout is Ctrl+A', () => {
    expect(shortcutKey(key('ф', 'KeyA'))).toBe('a');
    expect(shortcutKey(key('Ф', 'KeyA', true))).toBe('A');
    expect(shortcutKey(key('л', 'KeyK'))).toBe('k');
    expect(shortcutKey(key('х', 'BracketLeft'))).toBe('[');
    expect(shortcutKey(key('.', 'Slash'))).toBe('/');
    expect(shortcutKey(key('α', 'KeyA'))).toBe('a');
  });

  it('leaves Ctrl+A to the text field the focus is in', () => {
    const field = document.createElement('input');
    const checkbox = Object.assign(document.createElement('input'), { type: 'checkbox' });
    const list = document.createElement('div');
    expect(isTypingIn(field)).toBe(true);
    expect(isTypingIn(checkbox)).toBe(false);
    expect(isSelectAll({ ...key('ф', 'KeyA'), ctrlKey: true, target: list })).toBe(true);
    expect(isSelectAll({ ...key('a', 'KeyA'), ctrlKey: true, target: field })).toBe(false);
    expect(isSelectAll({ ...key('a', 'KeyA'), ctrlKey: false, target: list })).toBe(false);
  });
});

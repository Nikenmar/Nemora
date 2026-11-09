import { describe, expect, it } from 'vitest';
import { pickLanguage } from '../src/other/appLanguage';

const supported = ['en', 'ru', 'pt', 'zh-CN'];

describe('pickLanguage', () => {
  it('uses a saved language the app has', () => {
    expect(pickLanguage('pt', ['ru-RU'], supported)).toBe('pt');
  });

  it('follows the system for system, nothing saved and a language no longer offered', () => {
    expect(pickLanguage('system', ['ru-RU', 'en-US'], supported)).toBe('ru');
    expect(pickLanguage(undefined, ['ru-RU'], supported)).toBe('ru');
    expect(pickLanguage('tr', ['ru-RU'], supported)).toBe('ru');
  });

  it('matches regional variants', () => {
    expect(pickLanguage('system', ['pt-PT'], supported)).toBe('pt');
    expect(pickLanguage('system', ['zh-TW'], supported)).toBe('zh-CN');
    expect(pickLanguage('system', ['zh-Hans-CN'], supported)).toBe('zh-CN');
  });

  it('takes the first system language the app has, then English', () => {
    expect(pickLanguage('system', ['tr-TR', 'ru-RU', 'en-US'], supported)).toBe('ru');
    expect(pickLanguage('system', ['tr-TR'], supported)).toBe('en');
    expect(pickLanguage('system', [], supported)).toBe('en');
  });
});

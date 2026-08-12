import { describe, expect, test } from '@jest/globals';

import { basename, dirname, extname, isAbsolute, normalize } from '../pathUtils';

describe('pathUtils (Windows-correct synchronous adapter)', () => {
  describe('basename', () => {
    test('splits on both backslash and forward slash', () => {
      expect(basename('C:\\Music\\Song.mp3')).toBe('Song.mp3');
      expect(basename('C:/Music/Song.mp3')).toBe('Song.mp3');
      expect(basename('C:\\Music\\Mixed/Song.mp3')).toBe('Song.mp3');
    });

    test('drops trailing separators like win32 basename', () => {
      expect(basename('C:\\Music\\')).toBe('Music');
      expect(basename('C:\\Music\\\\')).toBe('Music');
    });

    test('returns an empty string for a root', () => {
      expect(basename('C:\\')).toBe('');
      expect(basename('\\\\server\\share\\')).toBe('share');
    });
  });

  describe('extname', () => {
    test('returns the extension including the dot', () => {
      expect(extname('C:\\Music\\Song.mp3')).toBe('.mp3');
      expect(extname('a.tar.gz')).toBe('.gz');
      expect(extname('C:\\a.b\\Song.flac')).toBe('.flac');
    });

    test('treats dotfiles as extension-less like win32', () => {
      expect(extname('.mp3')).toBe('');
      expect(extname('C:\\Music\\.flac')).toBe('');
    });

    test('returns an empty string without a dot', () => {
      expect(extname('C:\\Music\\Song')).toBe('');
      expect(extname('C:\\Music')).toBe('');
    });
  });

  describe('dirname', () => {
    test('returns the parent directory', () => {
      expect(dirname('C:\\Music\\Sub\\Song.mp3')).toBe('C:\\Music\\Sub');
      expect(dirname('C:\\Music\\Song.mp3')).toBe('C:\\Music');
      expect(dirname('C:/Music/Song.mp3')).toBe('C:/Music');
    });

    test('preserves drive roots', () => {
      expect(dirname('C:\\')).toBe('C:\\');
      expect(dirname('C:\\Music')).toBe('C:\\');
      expect(dirname('C:\\Music\\')).toBe('C:\\');
    });

    test('preserves UNC share roots', () => {
      expect(dirname('\\\\server\\share')).toBe('\\\\server\\share');
      expect(dirname('\\\\server\\share\\')).toBe('\\\\server\\share\\');
      expect(dirname('\\\\server\\share\\Sub\\Song.mp3')).toBe('\\\\server\\share\\Sub');
    });

    test('returns dot for a bare name and root slash for a rooted name', () => {
      expect(dirname('Song.mp3')).toBe('.');
      expect(dirname('/Song.mp3')).toBe('/');
      expect(dirname('/foo/bar')).toBe('/foo');
    });
  });

  describe('normalize', () => {
    test('converts forward slashes to backslashes and collapses duplicates', () => {
      expect(normalize('C:/Music/Files/')).toBe('C:\\Music\\Files');
      expect(normalize('C:\\Music\\\\Files')).toBe('C:\\Music\\Files');
    });

    test('resolves dot and dotdot segments', () => {
      expect(normalize('C:\\Music\\Sub\\..')).toBe('C:\\Music');
      expect(normalize('C:\\Music\\..')).toBe('C:\\');
      expect(normalize('C:\\Music\\.\\Files')).toBe('C:\\Music\\Files');
      expect(normalize('..\\..\\x')).toBe('..\\..\\x');
    });

    test('preserves UNC roots', () => {
      expect(normalize('\\\\server\\share\\a\\..')).toBe('\\\\server\\share');
      expect(normalize('\\\\server\\share\\Sub')).toBe('\\\\server\\share\\Sub');
    });

    test('keeps relative paths relative', () => {
      expect(normalize('Music/Song.mp3')).toBe('Music\\Song.mp3');
      expect(normalize('Song.mp3')).toBe('Song.mp3');
      expect(normalize('')).toBe('.');
    });
  });

  describe('isAbsolute', () => {
    test('accepts drive-letter and rooted paths', () => {
      expect(isAbsolute('C:\\Music\\Song.mp3')).toBe(true);
      expect(isAbsolute('C:/Music/Song.mp3')).toBe(true);
      expect(isAbsolute('\\Music\\Song.mp3')).toBe(true);
      expect(isAbsolute('/Music/Song.mp3')).toBe(true);
    });

    test('accepts UNC shares with any separator style', () => {
      expect(isAbsolute('\\\\server\\share\\Song.mp3')).toBe(true);
      expect(isAbsolute('//server/share/Song.mp3')).toBe(true);
    });

    test('rejects relative and drive-relative paths', () => {
      expect(isAbsolute('Music\\Song.mp3')).toBe(false);
      expect(isAbsolute('Song.mp3')).toBe(false);
      expect(isAbsolute('C:Music\\Song.mp3')).toBe(false);
      expect(isAbsolute('')).toBe(false);
    });
  });
});

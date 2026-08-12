/**
 * Synchronous, pure-string path adapter used by the ported core.
 *
 * The Electron code relied on Node's `path` module, whose win32 behaviour is
 * meaningful on Windows but differs on POSIX hosts and is unavailable to a
 * renderer bundle. These helpers reproduce the win32 semantics Nora depends on
 * for drive letters, UNC shares, mixed separators and trailing separators:
 *   * basename  - last non-empty segment (`C:\a\b.mp3` -> `b.mp3`)
 *   * extname   - `.ext` of the last segment, dot included (`.mp3` -> ``)
 *   * dirname   - parent directory, roots preserved (`C:\` stays `C:\`)
 *   * normalize - collapses separators, resolves `.`/`..`, keeps the root
 *   * isAbsolute- drive-rooted (`C:\`, `C:/`), rooted (`\`, `/`) or UNC
 *
 * They are string transforms only: no OS calls, no current-directory
 * resolution, so behaviour cannot drift between test host and target host.
 */

const SPLIT_SEPARATORS = /[\\/]+/;
const TRAILING_SEPARATORS = /[\\/]+$/;
const DRIVE_LETTER = /^[A-Za-z]:/;
const UNC_SHARE = /^[\\/]{2}([^\\/]+)[\\/]([^\\/]+)/;

const stripTrailingSeparators = (value: string): string => value.replace(TRAILING_SEPARATORS, '');

/** Win32-compatible `basename`. Roots return an empty string. */
export const basename = (value: string): string => {
  const trimmed = stripTrailingSeparators(value);
  if (/^[A-Za-z]:$/.test(trimmed)) return '';
  const segments = trimmed.split(SPLIT_SEPARATORS);
  return segments[segments.length - 1] ?? '';
};

/** Win32-compatible `extname`. A dotfile like `.mp3` has no extension. */
export const extname = (value: string): string => {
  const base = basename(value);
  const dotIndex = base.lastIndexOf('.');
  if (dotIndex <= 0) return '';
  return base.slice(dotIndex);
};

/** Win32-compatible `dirname`. Drive, UNC and rooted paths keep their root. */
export const dirname = (value: string): string => {
  if (/^[A-Za-z]:$/.test(value)) return value;
  if (/^[A-Za-z]:[\\/]$/.test(value)) return value;
  if (/^[\\/]{2}[^\\/]+[\\/][^\\/]+[\\/]?$/.test(value)) return value;

  const trimmed = stripTrailingSeparators(value);
  if (trimmed === '') return value.startsWith('\\') || value.startsWith('/') ? '\\' : '.';

  const lastSeparator = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  if (lastSeparator === -1) return '.';

  const parent = trimmed.slice(0, lastSeparator);
  if (parent === '') return '/';
  if (/^[A-Za-z]:$/.test(parent)) return `${parent}\\`;
  return parent;
};

/** Win32-compatible `normalize`: backslashes, collapsed separators, `.`/`..`. */
export const normalize = (value: string): string => {
  if (value === '') return '.';

  const drive = DRIVE_LETTER.test(value) ? value.slice(0, 2) : '';
  let rest = drive !== '' ? value.slice(2) : value;

  let root = '';
  const uncMatch = UNC_SHARE.exec(rest);
  if (uncMatch) {
    root = `\\\\${uncMatch[1]}\\${uncMatch[2]}`;
    rest = rest.slice(uncMatch[0].length);
  }

  const isRooted = drive !== '' ? /^[\\/]/.test(rest) : root !== '' || /^[\\/]/.test(rest);
  const segments: string[] = [];

  for (const segment of rest.split(SPLIT_SEPARATORS)) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (segments.length > 0 && segments[segments.length - 1] !== '..') segments.pop();
      else if (!isRooted) segments.push('..');
      continue;
    }
    segments.push(segment);
  }

  const joined = segments.join('\\');
  if (drive !== '') return drive + (isRooted ? '\\' : '') + joined;
  if (root !== '') return joined === '' ? root : `${root}\\${joined}`;
  if (isRooted) return `\\${joined}`;
  return joined === '' ? '.' : joined;
};

/** Win32-compatible `isAbsolute`: drive-rooted, rooted, or UNC share. */
export const isAbsolute = (value: string): boolean => {
  if (value === '') return false;
  if (/^[\\/][\\/]/.test(value)) return true;
  if (/^[\\/]/.test(value)) return true;
  if (DRIVE_LETTER.test(value) && value.length > 2) return /^[\\/]/.test(value.slice(2));
  return false;
};

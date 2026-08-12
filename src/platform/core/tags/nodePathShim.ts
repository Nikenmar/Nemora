/**
 * The parts of Node's `path` that bundled tag libraries reach for at runtime.
 *
 * `node-taglib-sharp` calls `Path.extname` and `path.basename` to guess a
 * picture's MIME type from its filename. Under Electron those resolved to
 * Node's own module; in a WebView2 renderer `path` is not a module at all, so
 * Vite externalises it and every property comes back undefined. The failure
 * surfaced far from its cause - `Path.extname is not a function` was reported
 * as "TagLib buffer parse failed", i.e. as a corrupt music file.
 *
 * Tests could not catch it: Jest runs on Node, where the real `path` exists, so
 * the tag suites pass against a module the renderer never gets.
 *
 * Semantics follow Node's win32 rules, since every path here is a Windows path:
 * both separators are accepted, and a leading dot is a hidden file rather than
 * an extension.
 */
const SEPARATORS = /[\\/]/u;
const TRAILING_SEPARATORS = /[\\/]+$/u;

export const sep = '\\';
export const delimiter = ';';

export const basename = (value: string, suffix?: string): string => {
  const trimmed = value.replace(TRAILING_SEPARATORS, '');
  const name = trimmed.split(SEPARATORS).at(-1) ?? trimmed;
  if (suffix && suffix !== name && name.endsWith(suffix)) return name.slice(0, -suffix.length);
  return name;
};

export const extname = (value: string): string => {
  const name = basename(value);
  const dot = name.lastIndexOf('.');
  // `<= 0` and not `< 0`: ".gitignore" is a name, not an extension.
  return dot <= 0 ? '' : name.slice(dot);
};

export const dirname = (value: string): string => {
  const trimmed = value.replace(TRAILING_SEPARATORS, '');
  const index = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  if (index < 0) return '.';
  if (index === 0) return trimmed.slice(0, 1);
  return trimmed.slice(0, index);
};

export const normalize = (value: string): string => value.replace(/[\\/]+/gu, sep);

export const join = (...parts: string[]): string => {
  const joined = parts.filter((part) => part.length > 0).join(sep);
  return joined ? normalize(joined) : '.';
};

export const isAbsolute = (value: string): boolean =>
  /^[a-z]:[\\/]/iu.test(value) || /^[\\/]{2}/u.test(value) || SEPARATORS.test(value.slice(0, 1));

export const resolve = (...parts: string[]): string => {
  let resolved = '';
  for (const part of parts) {
    if (!part) continue;
    resolved = isAbsolute(part) ? part : resolved ? join(resolved, part) : part;
  }
  return normalize(resolved);
};

export const parse = (
  value: string
): { root: string; dir: string; base: string; ext: string; name: string } => {
  const base = basename(value);
  const ext = extname(value);
  return {
    root: '',
    dir: dirname(value),
    base,
    ext,
    name: ext ? base.slice(0, -ext.length) : base
  };
};

const path = {
  sep,
  delimiter,
  basename,
  extname,
  dirname,
  normalize,
  join,
  isAbsolute,
  resolve,
  parse
};

// Both spellings are in use by bundled CommonJS: `require("path")` gets the
// default, `import * as Path` gets the namespace.
export default path;

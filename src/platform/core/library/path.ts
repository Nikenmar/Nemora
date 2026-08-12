const WINDOWS_ABSOLUTE_PATH = /^(?:[a-z]:[\\/]|\\\\)/i;

export const pathSeparator = (path: string): '/' | '\\' =>
  path.includes('\\') && !path.includes('/') ? '\\' : '/';

export const joinPath = (parent: string, child: string): string => {
  const separator = pathSeparator(parent);
  const trimmedParent = parent.replace(/[\\/]+$/u, '');
  const trimmedChild = child.replace(/^[\\/]+/u, '');
  return `${trimmedParent}${separator}${trimmedChild}`;
};

export const parentPath = (path: string): string => {
  const trimmed = path.replace(/[\\/]+$/u, '');
  const separatorIndex = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  if (separatorIndex < 0) return '';
  if (separatorIndex === 2 && /^[a-z]:/iu.test(trimmed)) return trimmed.slice(0, 3);
  if (separatorIndex === 0) return trimmed.slice(0, 1);
  return trimmed.slice(0, separatorIndex);
};

export const extensionOf = (path: string): string => {
  const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot).toLowerCase() : '';
};

export const canonicalPathKey = (path: string): string => {
  const normalized = path.replace(/[\\/]+/gu, '/').replace(/\/$/u, '');
  return WINDOWS_ABSOLUTE_PATH.test(path) ? normalized.toLowerCase() : normalized;
};

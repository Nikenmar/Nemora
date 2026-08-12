import { canonicalPathKey, extensionOf } from '../library/path';

export const isPathWithin = (path: string, directory: string): boolean => {
  const pathKey = canonicalPathKey(path);
  const directoryKey = canonicalPathKey(directory);
  return pathKey === directoryKey || pathKey.startsWith(`${directoryKey}/`);
};

export const fileNameOf = (path: string): string =>
  path.replace(/[\\/]+$/u, '').split(/[\\/]/u).at(-1) ?? path;

export const titleFromPath = (path: string): string => {
  const fileName = fileNameOf(path);
  const extension = extensionOf(fileName);
  return extension ? fileName.slice(0, -extension.length) : fileName;
};


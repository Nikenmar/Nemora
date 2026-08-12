/**
 * Path helpers used by the lyrics subsystem.
 *
 * The win32-compatible primitives live in the playlists subsystem
 * (`pathUtils.ts`); this file only adds what lyrics needs on top of them:
 * a pure-string `join` and the `nemora://` protocol-stripping helper.
 */

import { basename, dirname, extname } from '../playlists/pathUtils';

/** Pure-string win32-style join of two path parts (no OS calls). */
export const join = (left: string, right: string): string =>
  `${left.replace(/[\\/]+$/, '')}\\${right}`;

/**
 * Strips the `nemora://localfiles` prefix and the artwork cache query string
 * from a song path, mirroring the Electron `removeDefaultAppProtocolFromFilePath`.
 */
export const removeDefaultAppProtocolFromFilePath = (filePath: string): string => {
  const strippedPath = filePath.replaceAll(
    /nora:[/\\]{1,2}localfiles[/\\]{1,2}|\?[\w+=\w+&?]+$/gm,
    ''
  );

  const isLinux =
    typeof navigator !== 'undefined' &&
    typeof navigator.platform === 'string' &&
    /linux/i.test(navigator.platform);

  if (isLinux) return `/${strippedPath}`;
  return strippedPath;
};

export { basename, dirname, extname };

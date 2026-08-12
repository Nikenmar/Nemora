import { open, readDir, stat } from '@tauri-apps/plugin-fs';

import type { LibraryFileSystemPort } from './types';

const readHead = async (path: string, length: number): Promise<Uint8Array> => {
  if (!Number.isInteger(length) || length < 0) {
    throw new RangeError('Head length must be a non-negative integer.');
  }

  const file = await open(path, { read: true });
  try {
    const head = new Uint8Array(length);
    let offset = 0;
    while (offset < length) {
      const read = await file.read(head.subarray(offset));
      if (read === null || read === 0) break;
      offset += read;
    }
    return head.slice(0, offset);
  } finally {
    await file.close();
  }
};

export const tauriLibraryFileSystem: LibraryFileSystemPort = {
  readDir,
  stat: async (path) => {
    const info = await stat(path);
    return {
      isFile: info.isFile,
      isDirectory: info.isDirectory,
      size: info.size,
      mtime: info.mtime,
      birthtime: info.birthtime
    };
  },
  readHead
};

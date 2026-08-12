import { invoke } from '@tauri-apps/api/core';
import { readFile } from '@tauri-apps/plugin-fs';

import { TagIoError } from './errors';

export interface TagFileIo {
  read(path: string): Promise<Uint8Array>;
  writeAtomic(path: string, contents: Uint8Array): Promise<void>;
}

export const tauriTagFileIo: TagFileIo = {
  read: (path) => readFile(path),
  writeAtomic: async (path, contents) => {
    // Vec<u8> is serialized as an array; plugin-fs writeFile is intentionally
    // forbidden here because it can expose a truncated destination on a crash.
    await invoke<void>('write_file_atomic', { path, contents: Array.from(contents) });
  }
};

export async function readTagFile(
  path: string,
  io: TagFileIo = tauriTagFileIo
): Promise<Uint8Array> {
  try {
    return await io.read(path);
  } catch (cause) {
    throw new TagIoError('read-failed', path, 'failed to read music file', cause);
  }
}

export async function commitTagFile(
  path: string,
  contents: Uint8Array,
  io: TagFileIo = tauriTagFileIo
): Promise<void> {
  try {
    await io.writeAtomic(path, contents);
  } catch (cause) {
    throw new TagIoError(
      'atomic-write-failed',
      path,
      'atomic music-file replacement failed',
      cause
    );
  }
}

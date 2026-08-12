import {
  exists,
  watch,
  watchImmediate,
  type WatchEvent as TauriWatchEvent
} from '@tauri-apps/plugin-fs';

import type { WatcherFileSystemPort } from './types';

export const tauriWatcherFileSystem: WatcherFileSystemPort = {
  exists,
  watch: async (paths, callback, options = {}) => {
    const listener = (event: TauriWatchEvent): void => callback(event);
    if (options.immediate) {
      return watchImmediate(paths, listener, { recursive: options.recursive });
    }
    return watch(paths, listener, {
      recursive: options.recursive,
      delayMs: options.delayMs
    });
  }
};

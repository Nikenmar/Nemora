import { describe, expect, jest, test } from '@jest/globals';

import { InternalWriteSuppression } from '../suppression';
import type { WatchEvent, WatcherFileSystemPort } from '../types';
import { LibraryWatcherManager } from '../watcherManager';

describe('InternalWriteSuppression', () => {
  test('suppresses watcher events only inside the configured post-write window', () => {
    let now = 1_000;
    const suppression = new InternalWriteSuppression(() => now, 2_000);

    suppression.suppress('C:\\Music\\Track.FLAC');

    expect(suppression.isSuppressed('c:/music/track.flac')).toBe(true);
    now = 2_999;
    expect(suppression.isSuppressed('C:\\Music\\Track.FLAC')).toBe(true);
    now = 3_000;
    expect(suppression.isSuppressed('C:\\Music\\Track.FLAC')).toBe(false);
  });

  test('extends suppression from the time an internal write finishes', async () => {
    let now = 10_000;
    const suppression = new InternalWriteSuppression(() => now, 500);

    await suppression.during('C:\\Music\\track.flac', async () => {
      expect(suppression.isSuppressed('C:\\Music\\track.flac')).toBe(true);
      now = 11_000;
      expect(suppression.isSuppressed('C:\\Music\\track.flac')).toBe(true);
    });

    now = 11_499;
    expect(suppression.isSuppressed('C:\\Music\\track.flac')).toBe(true);
    now = 11_500;
    expect(suppression.isSuppressed('C:\\Music\\track.flac')).toBe(false);
  });

  test('prevents the watcher from reparsing an app-owned write', async () => {
    let now = 1_000;
    let rootListener: ((event: WatchEvent) => void) | undefined;
    const suppression = new InternalWriteSuppression(() => now, 500);
    const scanSong = jest.fn(async () => undefined);
    const fileSystem: WatcherFileSystemPort = {
      exists: async () => true,
      watch: async (_paths, callback, options) => {
        if (options?.recursive) rootListener = callback;
        return () => undefined;
      }
    };
    const repository = {
      getMusicFolders: () => [
        {
          path: 'C:\\Music',
          stats: {
            lastModifiedDate: new Date(0),
            lastChangedDate: new Date(0),
            fileCreatedDate: new Date(0),
            lastParsedDate: new Date(0)
          },
          subFolders: []
        }
      ],
      getKnownSongPaths: () => ['C:\\Music\\track.flac'],
      scanSong,
      removeSongs: async () => undefined,
      reconcileFolder: async () => undefined,
      reportWatcherError: () => undefined
    };
    const manager = new LibraryWatcherManager(repository, fileSystem, suppression);
    await manager.start();
    const event: WatchEvent = {
      type: { modify: { kind: 'data', mode: 'content' } },
      paths: ['C:\\Music\\track.flac'],
      attrs: {}
    };

    suppression.suppress('C:\\Music\\track.flac');
    rootListener?.(event);
    await Promise.resolve();
    expect(scanSong).not.toHaveBeenCalled();

    now = 1_500;
    rootListener?.(event);
    await Promise.resolve();
    await Promise.resolve();
    expect(scanSong).toHaveBeenCalledTimes(1);
    manager.stop();
  });
});

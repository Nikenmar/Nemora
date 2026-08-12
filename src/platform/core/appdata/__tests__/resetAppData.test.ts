import { describe, expect, test } from '@jest/globals';

import resetAppData from '../resetAppData';
import { createMockAppDataRepo, PROFILE_ROOT } from './testUtils';
import { joinPath } from '../../transfer/joinPath';
import { configureLogger, type CoreLogger } from '../../playlists/logger';

describe('resetAppData', () => {
  test('removes every user-data resource, directories recursively', async () => {
    const repo = createMockAppDataRepo();
    repo.dirs.add(joinPath(PROFILE_ROOT, 'song_covers'));

    await resetAppData(repo);

    expect(repo.removed.map((entry) => entry.path)).toEqual(
      [
        'songs.json',
        'artists.json',
        'albums.json',
        'genres.json',
        'playlists.json',
        'userData.json',
        'listening_data.json',
        'blacklist.json',
        'song_covers'
      ].map((name) => joinPath(PROFILE_ROOT, name))
    );
    expect(repo.removed[8]?.options).toEqual({ recursive: true });
    expect(repo.removed[0]?.options).toEqual({ recursive: false });
  });

  test('tolerates missing resources (ENOENT) and keeps going', async () => {
    const repo = createMockAppDataRepo();
    // Nothing exists on disk — remove throws ENOENT for every resource.
    let removedCount = 0;
    repo.remove = async () => {
      removedCount += 1;
      throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    };

    await resetAppData(repo);

    expect(removedCount).toBe(9);
  });

  test('swallows unrecoverable errors and reports them through the logger', async () => {
    const mockLogger: CoreLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };
    configureLogger(mockLogger);
    try {
      const repo = createMockAppDataRepo();
      repo.remove = async () => {
        throw new Error('access denied');
      };

      await resetAppData(repo);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'An unrecoverable error occurred when resetting the app.',
        expect.objectContaining({ error: expect.any(Error) })
      );
    } finally {
      configureLogger(undefined);
    }
  });
});

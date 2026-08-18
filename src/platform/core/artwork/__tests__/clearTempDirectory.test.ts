import { describe, expect, jest, test } from '@jest/globals';

const removed: string[] = [];
const entries = [{ name: 'old.webp' }, { name: 'fresh.webp' }, { name: 'unreadable.webp' }];
const modified: Record<string, Date | undefined> = {
  'old.webp': new Date('2026-08-17T10:00:00Z'),
  'fresh.webp': new Date('2026-08-17T12:00:05Z'),
  'unreadable.webp': undefined
};

jest.mock('@tauri-apps/api/core', () => ({ convertFileSrc: (path: string) => path }));
jest.mock('@tauri-apps/api/path', () => ({
  join: async (...segments: string[]) => segments.join('\\')
}));
jest.mock('@tauri-apps/plugin-fs', () => ({
  exists: async () => true,
  mkdir: async () => undefined,
  readDir: async () => entries,
  remove: async (path: string) => {
    removed.push(path);
  },
  stat: async (path: string) => {
    const name = path.split('\\').pop() as string;
    const mtime = modified[name];
    if (!mtime) throw new Error('stat failed');
    return { mtime, birthtime: null };
  }
}));
jest.mock('../../../contracts/paths', () => ({
  profilePath: async (folder: string) => `E:\\profile\\${folder}`,
  songCoversDir: async () => 'E:\\profile\\song_covers'
}));

import { TauriArtworkStorage } from '../artworkStorage';

const storage = new TauriArtworkStorage({
  album: 'a',
  playlist: 'p',
  song: 's'
});

describe('clearing the temporary artwork directory', () => {
  test('removes everything when no cutoff is given', async () => {
    removed.length = 0;

    await storage.clearTempDirectory();

    expect(removed).toHaveLength(3);
  });

  test('keeps anything this run produced, and anything it cannot date', async () => {
    removed.length = 0;

    await storage.clearTempDirectory(new Date('2026-08-17T12:00:00Z'));

    // `fresh.webp` was written after the cutoff, so it belongs to the running
    // session - an "Open with" launch can create one while the app is still
    // starting, and deleting it would blank the cover of the playing track.
    // `unreadable.webp` has no usable timestamp, and an undated file is not
    // evidence of an abandoned one.
    expect(removed).toEqual(['E:\\profile\\temp_artworks\\old.webp']);
  });
});

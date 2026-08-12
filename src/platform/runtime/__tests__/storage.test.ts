import { describe, expect, jest, test } from '@jest/globals';

import { generateStorageMetrics, type StorageUsagePort } from '../storage';

const profileRoot = 'P:\\Nora';
const applicationDirectory = 'C:\\Programs\\Nora';

const createPort = (sameVolume: boolean): StorageUsagePort => {
  const sizes = new Map<string, number>([
    [applicationDirectory, 1_000],
    [profileRoot, 500],
    [`${profileRoot}\\song_covers`, 100],
    [`${profileRoot}\\temp_artworks`, 20],
    [`${profileRoot}\\logs`, 10],
    [`${profileRoot}\\songs.json`, 30],
    [`${profileRoot}\\artists.json`, 40],
    [`${profileRoot}\\albums.json`, 50],
    [`${profileRoot}\\genres.json`, 60],
    [`${profileRoot}\\playlists.json`, 70],
    [`${profileRoot}\\palettes.json`, 80],
    [`${profileRoot}\\userData.json`, 25]
  ]);
  return {
    applicationDirectory: async () => applicationDirectory,
    profilePath: async (...segments) =>
      segments.length === 0 ? profileRoot : `${profileRoot}\\${segments.join('\\')}`,
    directorySize: async (path) => sizes.get(path) ?? 0,
    diskCapacity: async (path) =>
      path === applicationDirectory
        ? { totalBytes: 10_000, freeBytes: 4_000 }
        : { totalBytes: 20_000, freeBytes: 8_000 },
    pathsShareVolume: jest.fn(async () => sameVolume)
  };
};

describe('storage usage aggregation', () => {
  test('counts the shared volume once and preserves the legacy metric breakdown', async () => {
    const metrics = await generateStorageMetrics(createPort(true));

    expect(metrics).toMatchObject({
      rootSizes: { size: 10_000, freeSpace: 4_000 },
      remainingSize: 9_000,
      appFolderSize: 1_000,
      totalSize: 1_500,
      appDataSizes: {
        appDataSize: 500,
        totalArtworkCacheSize: 120,
        librarySize: 330,
        totalKnownItemsSize: 485,
        otherSize: 15
      }
    });
    expect(Number.isNaN(Date.parse(metrics.generatedDate))).toBe(false);
  });

  test('adds capacity when the application and profile are on different volumes', async () => {
    const metrics = await generateStorageMetrics(createPort(false));

    expect(metrics.rootSizes).toEqual({ size: 30_000, freeSpace: 12_000 });
    expect(metrics.remainingSize).toBe(29_000);
  });
});

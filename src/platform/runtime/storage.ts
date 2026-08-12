import type { RuntimeDiskCapacity } from './services';

export interface StorageUsagePort {
  applicationDirectory(): Promise<string>;
  profilePath(...segments: string[]): Promise<string>;
  directorySize(path: string): Promise<number>;
  diskCapacity(path: string): Promise<RuntimeDiskCapacity>;
  pathsShareVolume(first: string, second: string): Promise<boolean>;
}

const measureProfileItems = async (
  port: StorageUsagePort,
  profileRoot: string
): Promise<AppDataStorageMetrics> => {
  const paths = await Promise.all([
    port.profilePath('song_covers'),
    port.profilePath('temp_artworks'),
    port.profilePath('logs'),
    port.profilePath('songs.json'),
    port.profilePath('artists.json'),
    port.profilePath('albums.json'),
    port.profilePath('genres.json'),
    port.profilePath('playlists.json'),
    port.profilePath('palettes.json'),
    port.profilePath('userData.json')
  ]);
  const [
    artworkCacheSize,
    tempArtworkCacheSize,
    logSize,
    songDataSize,
    artistDataSize,
    albumDataSize,
    genreDataSize,
    playlistDataSize,
    paletteDataSize,
    userDataSize,
    appDataSize
  ] = await Promise.all([
    ...paths.map((path) => port.directorySize(path)),
    port.directorySize(profileRoot)
  ]);

  const totalArtworkCacheSize = artworkCacheSize + tempArtworkCacheSize;
  const librarySize =
    songDataSize +
    artistDataSize +
    albumDataSize +
    genreDataSize +
    playlistDataSize +
    paletteDataSize;
  const totalKnownItemsSize = librarySize + totalArtworkCacheSize + userDataSize + logSize;

  return {
    appDataSize,
    artworkCacheSize,
    tempArtworkCacheSize,
    totalArtworkCacheSize,
    logSize,
    songDataSize,
    artistDataSize,
    albumDataSize,
    genreDataSize,
    playlistDataSize,
    paletteDataSize,
    userDataSize,
    librarySize,
    totalKnownItemsSize,
    otherSize: Math.max(0, appDataSize - totalKnownItemsSize)
  };
};

export async function generateStorageMetrics(port: StorageUsagePort): Promise<StorageMetrics> {
  const [applicationDirectory, profileRoot] = await Promise.all([
    port.applicationDirectory(),
    port.profilePath()
  ]);
  const [applicationCapacity, profileCapacity, sameVolume, appFolderSize, appDataSizes] =
    await Promise.all([
      port.diskCapacity(applicationDirectory),
      port.diskCapacity(profileRoot),
      port.pathsShareVolume(applicationDirectory, profileRoot),
      port.directorySize(applicationDirectory),
      measureProfileItems(port, profileRoot)
    ]);

  const rootSizes = sameVolume
    ? { size: applicationCapacity.totalBytes, freeSpace: applicationCapacity.freeBytes }
    : {
        size: applicationCapacity.totalBytes + profileCapacity.totalBytes,
        freeSpace: applicationCapacity.freeBytes + profileCapacity.freeBytes
      };

  return {
    rootSizes,
    remainingSize: Math.max(0, rootSizes.size - appFolderSize),
    appFolderSize,
    appDataSizes,
    totalSize: appFolderSize + appDataSizes.appDataSize,
    generatedDate: new Date().toISOString()
  };
}

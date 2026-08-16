import { describe, expect, jest, test } from '@jest/globals';

import { MetadataService } from '../metadataService';
import type {
  MetadataCatalog,
  MetadataFileData,
  MetadataRepository,
  MetadataTagPatch
} from '../types';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const song = (songId: string, title: string): SavableSongData => ({
  songId,
  title,
  duration: 180,
  artists: [{ artistId: 'old', name: 'Old Artist' }],
  albumArtists: [],
  genres: [],
  isAFavorite: false,
  isArtworkAvailable: true,
  path: `E:\\Music\\${songId}.mp3`,
  addedDate: 1
});

const createCatalog = (): MetadataCatalog => ({
  songs: [song('one', 'One'), song('two', 'Two')],
  artists: [
    {
      artistId: 'old',
      name: 'Old Artist',
      songs: [
        { songId: 'one', title: 'One' },
        { songId: 'two', title: 'Two' }
      ],
      albums: [],
      isAFavorite: false
    }
  ],
  albums: [],
  genres: []
});

const metadataFile: MetadataFileData = {
  artists: [],
  albumArtists: [],
  genres: [],
  duration: 180
};

const createRepository = () => {
  let catalog = createCatalog();
  let nextId = 0;
  const writes: { path: string; patch: MetadataTagPatch }[] = [];
  const commitCatalog = jest.fn((value: MetadataCatalog) => {
    catalog = clone(value);
  });
  const repository: MetadataRepository = {
    getCatalog: () => clone(catalog),
    commitCatalog,
    createId: () => `created-${++nextId}`,
    file: {
      read: async () => metadataFile,
      write: async (path, patch) => {
        writes.push({ path, patch: clone(patch) });
      },
      healBlankPictureMime: async () => 0
    },
    getSongArtwork: (value) => ({
      isDefaultArtwork: false,
      artworkPath: `nemora://covers/${value.songId}.webp`,
      optimizedArtworkPath: `nemora://covers/${value.songId}-optimized.webp`
    }),
    replaceSongArtwork: async (songId) => ({
      isDefaultArtwork: false,
      artworkPath: `nemora://covers/${songId}.webp`,
      optimizedArtworkPath: `nemora://covers/${songId}-optimized.webp`
    }),
    createTemporaryArtwork: async (path) => path,
    getUnknownSong: () => undefined,
    updateUnknownSong: () => undefined,
    createPlayerData: (value) => ({
      songId: value.songId,
      title: value.title,
      artists: value.artists,
      duration: value.duration,
      artworkPath: `nemora://covers/${value.songId}.webp`,
      path: `nemora://${value.path}`,
      isAFavorite: value.isAFavorite,
      album: value.album,
      isKnownSource: true,
      isBlacklisted: false
    }),
    emitDataUpdate: () => undefined,
    sendMessage: () => undefined
  };
  return { repository, writes, commitCatalog, catalog: () => clone(catalog) };
};

const editedTags = (title: string): SongTags => ({
  title,
  artists: [{ name: 'Renamed Artist' }],
  albumArtists: [],
  genres: [],
  duration: 180,
  artworkPath: 'nemora://covers/one.webp'
});

describe('metadata catalog reconciliation', () => {
  test('keeps an old artist while another song references it and removes it after the last unlink', async () => {
    const testRepository = createRepository();
    const service = new MetadataService(testRepository.repository);

    await expect(service.updateSongId3Tags('one', editedTags('One'), false, true)).resolves.toEqual(
      {
        success: true
      }
    );
    let catalog = testRepository.catalog();
    expect(catalog.artists.find((artist) => artist.artistId === 'old')?.songs).toEqual([
      { songId: 'two', title: 'Two' }
    ]);
    const renamed = catalog.artists.find((artist) => artist.name === 'Renamed Artist');
    expect(renamed?.songs).toEqual([{ songId: 'one', title: 'One' }]);

    const secondTags = editedTags('Two');
    secondTags.artworkPath = 'nemora://covers/two.webp';
    await expect(service.updateSongId3Tags('two', secondTags, false, true)).resolves.toEqual({
      success: true
    });
    catalog = testRepository.catalog();
    expect(catalog.artists.some((artist) => artist.artistId === 'old')).toBe(false);
    expect(catalog.artists.find((artist) => artist.name === 'Renamed Artist')?.songs).toEqual([
      { songId: 'one', title: 'One' },
      { songId: 'two', title: 'Two' }
    ]);
    expect(testRepository.writes).toHaveLength(2);
  });

  test('validates a duplicate merge completely before any tag or catalog write', async () => {
    const testRepository = createRepository();
    const service = new MetadataService(testRepository.repository);

    await expect(service.resolveArtistDuplicates('old', ['missing'])).rejects.toThrow(
      'Duplicate artist does not exist: missing'
    );
    expect(testRepository.writes).toHaveLength(0);
    expect(testRepository.commitCatalog).not.toHaveBeenCalled();
  });

  test('returns only a cache-busted artwork URL, never artwork bytes or base64', async () => {
    const testRepository = createRepository();
    const service = new MetadataService(testRepository.repository);

    const result = await service.updateSongId3Tags('one', editedTags('One'), true, true);

    expect(result.updatedData?.artworkPath).toMatch(/^nemora:\/\/covers\/one\.webp\?metadata=\d+$/u);
    expect(result.updatedData?.artwork).toBe(result.updatedData?.artworkPath);
  });

  test('reports a path as pending while its atomic tag transaction is unresolved', async () => {
    const testRepository = createRepository();
    let release: (() => void) | undefined;
    testRepository.repository.file.write = () =>
      new Promise<void>((resolve) => {
        release = resolve;
      });
    const service = new MetadataService(testRepository.repository);
    const update = service.updateSongId3Tags('one', editedTags('One'), false, true);

    await Promise.resolve();
    expect(service.isMetadataUpdatesPending('E:\\Music\\one.mp3')).toBe(true);
    release?.();
    await update;
    expect(service.isMetadataUpdatesPending('E:\\Music\\one.mp3')).toBe(false);
  });
});

describe('repairing a file the player refused to open', () => {
  test('reports how many pictures were repaired', async () => {
    const testRepository = createRepository();
    const heals: string[] = [];
    testRepository.repository.file.healBlankPictureMime = async (path: string) => {
      heals.push(path);
      return 2;
    };
    const service = new MetadataService(testRepository.repository);

    await expect(service.healBlankPictureMime('E:\Music\one.mp3')).resolves.toBe(2);
    expect(heals).toEqual(['E:\Music\one.mp3']);
  });

  test('reports zero for a file that had nothing wrong with it', async () => {
    const testRepository = createRepository();
    const service = new MetadataService(testRepository.repository);

    // Zero is what stops the player retrying forever: the failure is something
    // other than the blank MIME type, and a retry would only hide it.
    await expect(service.healBlankPictureMime('E:\Music\one.mp3')).resolves.toBe(0);
  });
});

import { describe, expect, jest, test } from '@jest/globals';

import { ArtworkService, UnsupportedArtworkFormatError } from '../artworkService';
import { pathArtwork, urlArtwork } from '../artworkSource';
import type { ArtworkStorage } from '../artworkStorage';
import type { ArtworkWriter } from '../atomicArtworkWriter';
import {
  ImageTransformer,
  type ArtworkImageSource,
  type DecodedArtwork,
  type ImageBackend,
  type ImageTransformPlan
} from '../imageTransform';

const makeBlob = (plan: ImageTransformPlan): Blob =>
  new Blob([`${plan.output.width}x${plan.output.height}`], { type: plan.mimeType });

class RecordingBackend implements ImageBackend {
  readonly sources: ArtworkImageSource[] = [];
  readonly plans: ImageTransformPlan[] = [];

  async decode(source: ArtworkImageSource): Promise<DecodedArtwork> {
    this.sources.push(source);
    return { width: 1200, height: 800, handle: {}, close: () => undefined };
  }

  async encode(_image: DecodedArtwork, plan: ImageTransformPlan): Promise<Blob> {
    this.plans.push(plan);
    return makeBlob(plan);
  }
}

function createFixture() {
  const generatedWrites: Array<{ path: string; blob: Blob }> = [];
  const copies: Array<{ source: string; destination: string }> = [];
  const files = new Set<string>();
  const writer: ArtworkWriter = {
    writeGenerated: jest.fn(async (path: string, blob: Blob) => {
      generatedWrites.push({ path, blob });
      files.add(path);
    }),
    copyExisting: jest.fn(async (source: string, destination: string) => {
      copies.push({ source, destination });
      files.add(destination);
    })
  };
  const storage: ArtworkStorage = {
    writer,
    coverPath: async (name) => `E:\\tmp\\Nora\\song_covers\\${name}`,
    tempPath: async (name) => `E:\\tmp\\Nora\\temp_artworks\\${name}`,
    ensureCoversDirectory: async () => undefined,
    ensureTempDirectory: async () => undefined,
    exists: async (path) => files.has(path),
    remove: async (path) => {
      files.delete(path);
    },
    clearTempDirectory: async () => undefined,
    toArtworkUrl: (path) => `nemora://encoded/${encodeURIComponent(path)}`,
    defaultArtworkUrl: (type) => `asset://default/${type}.webp`
  };
  const backend = new RecordingBackend();
  const service = new ArtworkService(
    storage,
    new ImageTransformer(backend),
    undefined,
    () => 'TemporaryA'
  );
  return { backend, copies, files, generatedWrites, service };
}

describe('ArtworkService', () => {
  test('writes full and optimized WebP variants atomically and returns only nora URLs', async () => {
    const fixture = createFixture();

    const result = await fixture.service.storeArtworks(
      'song-one',
      'songs',
      pathArtwork('E:\\incoming\\cover.jpg')
    );

    expect(fixture.backend.sources).toEqual([
      `nemora://encoded/${encodeURIComponent('E:\\incoming\\cover.jpg')}`
    ]);
    expect(fixture.generatedWrites.map((entry) => entry.path)).toEqual([
      'E:\\tmp\\Nora\\song_covers\\song-one.webp',
      'E:\\tmp\\Nora\\song_covers\\song-one-optimized.webp'
    ]);
    expect(fixture.generatedWrites.map((entry) => entry.blob.type)).toEqual([
      'image/webp',
      'image/webp'
    ]);
    expect(result).toEqual({
      isDefaultArtwork: false,
      artworkPath: `nemora://encoded/${encodeURIComponent('E:\\tmp\\Nora\\song_covers\\song-one.webp')}`,
      optimizedArtworkPath: `nemora://encoded/${encodeURIComponent('E:\\tmp\\Nora\\song_covers\\song-one-optimized.webp')}`
    });
  });

  test('creates and caches the exact 400px tier-list profile', async () => {
    const fixture = createFixture();
    fixture.files.add('E:\\tmp\\Nora\\song_covers\\song-one.webp');

    const first = await fixture.service.createTierlistThumbnail('song-one');
    const second = await fixture.service.createTierlistThumbnail('song-one');

    expect(first).toBe(second);
    expect(fixture.generatedWrites).toHaveLength(1);
    expect(fixture.backend.plans[0]?.output).toEqual({ width: 400, height: 400 });
    expect(fixture.backend.plans[0]?.quality).toBe(0.8);
  });

  test('copies an existing same-format file without sending image bytes through invoke', async () => {
    const fixture = createFixture();

    await fixture.service.saveArtwork(
      pathArtwork('E:\\incoming\\animated.gif'),
      'E:\\exports\\animated.gif'
    );

    expect(fixture.copies).toEqual([
      { source: 'E:\\incoming\\animated.gif', destination: 'E:\\exports\\animated.gif' }
    ]);
    expect(fixture.generatedWrites).toHaveLength(0);
    expect(fixture.backend.sources).toHaveLength(0);
  });

  test('converts remote artwork only to canvas-supported formats and fails loudly otherwise', async () => {
    const fixture = createFixture();

    await fixture.service.saveArtwork(
      urlArtwork('https://example.test/cover'),
      'E:\\out\\cover.png'
    );
    expect(fixture.generatedWrites[0]?.blob.type).toBe('image/png');

    await expect(
      fixture.service.saveArtwork(urlArtwork('https://example.test/cover'), 'E:\\out\\cover.tiff')
    ).rejects.toBeInstanceOf(UnsupportedArtworkFormatError);
  });

  test('returns configured default artwork without decoding or writing', async () => {
    const fixture = createFixture();
    const result = await fixture.service.storeArtworks('song-one', 'playlist');

    expect(result).toEqual({
      isDefaultArtwork: true,
      artworkPath: 'asset://default/playlist.webp',
      optimizedArtworkPath: 'asset://default/playlist.webp'
    });
    expect(fixture.generatedWrites).toHaveLength(0);
    expect(fixture.backend.sources).toHaveLength(0);
  });
});

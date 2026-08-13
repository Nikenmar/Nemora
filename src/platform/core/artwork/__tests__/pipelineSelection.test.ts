import { beforeEach, describe, expect, jest, test } from '@jest/globals';

import { ArtworkService } from '../artworkService';
import { embeddedArtwork, pathArtwork, urlArtwork } from '../artworkSource';
import { IMAGE_PROFILES, ImageTransformer } from '../imageTransform';
import type {
  ArtworkImageSource,
  DecodedArtwork,
  ImageBackend,
  ImageTransformPlan
} from '../imageTransform';
import type { ArtworkJob, ArtworkPipeline } from '../pipeline';
import type { ArtworkStorage } from '../artworkStorage';

/**
 * The point of these tests is the CHOICE, not the pixels.
 *
 * A native route that quietly stops being taken looks exactly like one that
 * works, and a fallback that never runs looks exactly like one that does. Both
 * failure modes have shipped in this codebase before, so which route ran is
 * asserted directly.
 */
class RecordingBackend implements ImageBackend {
  readonly decoded: ArtworkImageSource[] = [];

  async decode(source: ArtworkImageSource): Promise<DecodedArtwork> {
    this.decoded.push(source);
    return { width: 200, height: 100, handle: {}, close: () => undefined };
  }

  async encode(_image: DecodedArtwork, plan: ImageTransformPlan): Promise<Blob> {
    return new Blob([new Uint8Array([1, 2, 3])], { type: plan.mimeType });
  }
}

class RecordingPipeline implements ArtworkPipeline {
  readonly calls: { source: string; destinations: string[] }[] = [];
  handled = true;

  nativePath(source: { kind: string; path?: string; nativeAudioPath?: string }): string | undefined {
    if (source.kind === 'path') return source.path;
    if (source.kind === 'blob') return source.nativeAudioPath;
    return undefined;
  }

  async write(source: Parameters<ArtworkPipeline['write']>[0], jobs: readonly ArtworkJob[]) {
    const path = this.nativePath(source);
    if (!path || !this.handled) return false;
    this.calls.push({ source: path, destinations: jobs.map((job) => job.destination) });
    return true;
  }
}

const storage = (): ArtworkStorage =>
  ({
    ensureCoversDirectory: jest.fn(async () => undefined),
    ensureTempDirectory: jest.fn(async () => undefined),
    coverPath: jest.fn(async (name: string) => `E:\\covers\\${name}`),
    tempPath: jest.fn(async (name: string) => `E:\\temp\\${name}`),
    // The stored cover exists, the thumbnail does not - which is the only
    // state in which a thumbnail is generated at all.
    exists: jest.fn(async (path: string) => !path.includes('-tl')),
    toArtworkUrl: (path: string) => `nemora://${path}`,
    defaultArtworkUrl: () => 'nemora://default.webp',
    writer: { writeGenerated: jest.fn(async () => undefined) }
  }) as unknown as ArtworkStorage;

describe('artwork route selection', () => {
  let backend: RecordingBackend;
  let pipeline: RecordingPipeline;

  beforeEach(() => {
    backend = new RecordingBackend();
    pipeline = new RecordingPipeline();
  });

  const service = (withPipeline: boolean) =>
    new ArtworkService(
      storage(),
      new ImageTransformer(backend),
      { error: jest.fn(), debug: jest.fn() } as never,
      () => 'palette-id',
      withPipeline ? pipeline : undefined
    );

  test('a scanned song sends its AUDIO path natively, never the extracted bytes', async () => {
    const source = embeddedArtwork(new Uint8Array([9, 9]), 'image/jpeg', 'E:\\music\\song.flac');

    await service(true).storeArtworks('song-1', 'songs', source);

    expect(pipeline.calls).toHaveLength(1);
    expect(pipeline.calls[0]?.source).toBe('E:\\music\\song.flac');
    expect(pipeline.calls[0]?.destinations).toEqual([
      'E:\\covers\\song-1.webp',
      'E:\\covers\\song-1-optimized.webp'
    ]);
    expect(backend.decoded).toHaveLength(0);
  });

  test('embedded bytes with no file behind them still produce artwork, in the browser', async () => {
    const source = embeddedArtwork(new Uint8Array([9, 9]), 'image/jpeg');

    const paths = await service(true).storeArtworks('song-2', 'songs', source);

    expect(pipeline.calls).toHaveLength(0);
    expect(backend.decoded).toHaveLength(1);
    expect(paths.isDefaultArtwork).toBe(false);
  });

  test('a remote cover is never handed to the native route', async () => {
    await service(true).storeArtworks('song-3', 'songs', urlArtwork('https://example.test/a.jpg'));

    expect(pipeline.calls).toHaveLength(0);
    expect(backend.decoded).toEqual(['https://example.test/a.jpg']);
  });

  test('a native failure falls back for that file rather than losing the artwork', async () => {
    pipeline.handled = false;

    const paths = await service(true).storeArtworks(
      'song-4',
      'songs',
      pathArtwork('E:\\covers\\existing.webp')
    );

    expect(pipeline.calls).toHaveLength(0);
    expect(backend.decoded).toHaveLength(1);
    expect(paths.isDefaultArtwork).toBe(false);
  });

  test('without a pipeline at all the service behaves exactly as before', async () => {
    await service(false).storeArtworks(
      'song-5',
      'songs',
      embeddedArtwork(new Uint8Array([1]), 'image/png', 'E:\\music\\song.flac')
    );

    expect(backend.decoded).toHaveLength(1);
  });

  test('the tier-list thumbnail is generated from the stored cover natively', async () => {
    const url = await service(true).createTierlistThumbnail('song-6');

    expect(pipeline.calls[0]?.source).toBe('E:\\covers\\song-6.webp');
    expect(pipeline.calls[0]?.destinations).toEqual(['E:\\covers\\song-6-tl.webp']);
    expect(url).toBe('nemora://E:\\covers\\song-6-tl.webp');
    expect(backend.decoded).toHaveLength(0);
  });

  test('IMAGE_PROFILES stay the contract both routes are held to', () => {
    expect(IMAGE_PROFILES.optimizedWebp.resize).toEqual({ fit: 'cover', width: 50, height: 50 });
    expect(IMAGE_PROFILES.tierlistWebp.resize).toEqual({ fit: 'cover', width: 400, height: 400 });
    expect(IMAGE_PROFILES.fullWebp.quality).toBe(0.8);
  });
});

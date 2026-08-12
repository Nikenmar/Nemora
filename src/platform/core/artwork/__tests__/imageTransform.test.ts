import { describe, expect, jest, test } from '@jest/globals';

import {
  IMAGE_PROFILES,
  ImageTransformer,
  createTransformPlan,
  type ArtworkImageSource,
  type DecodedArtwork,
  type ImageBackend,
  type ImageDimensions,
  type ImageTransformPlan
} from '../imageTransform';

class FakeImageBackend implements ImageBackend {
  readonly plans: ImageTransformPlan[] = [];
  readonly close = jest.fn();
  private readonly dimensions: ImageDimensions;

  constructor(dimensions: ImageDimensions) {
    this.dimensions = dimensions;
  }

  async decode(_source: ArtworkImageSource): Promise<DecodedArtwork> {
    return { ...this.dimensions, handle: {}, close: this.close };
  }

  async encode(_image: DecodedArtwork, plan: ImageTransformPlan): Promise<Blob> {
    this.plans.push(plan);
    return new Blob([`${plan.output.width}x${plan.output.height}`], { type: plan.mimeType });
  }
}

describe('Sharp-compatible image transform decisions', () => {
  test('center-crops the copied real non-square 3400x3000 cover to 400x400 WebP', async () => {
    // Dimensions come from the read-only profile cover copied to E:\tmp for the verification run.
    const backend = new FakeImageBackend({ width: 3400, height: 3000 });
    const transformer = new ImageTransformer(backend);

    const result = await transformer.transform(
      'nemora://fixture/non-square.webp',
      IMAGE_PROFILES.tierlistWebp
    );

    expect(result.type).toBe('image/webp');
    expect(backend.plans).toEqual([
      {
        mimeType: 'image/webp',
        quality: 0.8,
        output: { width: 400, height: 400 },
        source: { x: 200, y: 0, width: 3000, height: 3000 }
      }
    ]);
    expect(backend.close).toHaveBeenCalledTimes(1);
  });

  test('downsizes the copied real 3840x3840 cover to the 50px optimized WebP profile', async () => {
    const backend = new FakeImageBackend({ width: 3840, height: 3840 });
    const transformer = new ImageTransformer(backend);

    const [full, optimized] = await transformer.transformMany('nemora://fixture/large.webp', [
      IMAGE_PROFILES.fullWebp,
      IMAGE_PROFILES.optimizedWebp
    ]);

    expect(full?.type).toBe('image/webp');
    expect(optimized?.type).toBe('image/webp');
    expect(backend.plans[0]?.output).toEqual({ width: 3840, height: 3840 });
    expect(backend.plans[1]?.output).toEqual({ width: 50, height: 50 });
    expect(backend.plans[1]?.quality).toBe(0.5);
    expect(backend.close).toHaveBeenCalledTimes(1);
  });

  test('preserves dimensions for lossless PNG conversion', () => {
    expect(createTransformPlan({ width: 947, height: 621 }, IMAGE_PROFILES.png)).toEqual({
      mimeType: 'image/png',
      quality: undefined,
      output: { width: 947, height: 621 },
      source: { x: 0, y: 0, width: 947, height: 621 }
    });
  });

  test('rejects corrupt dimensions and invalid quality before reaching a backend', () => {
    expect(() => createTransformPlan({ width: 0, height: 10 }, IMAGE_PROFILES.fullWebp)).toThrow(
      'source width'
    );
    expect(() =>
      createTransformPlan({ width: 10, height: 10 }, { mimeType: 'image/webp', quality: 2 })
    ).toThrow('quality');
  });
});

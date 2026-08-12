import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from '@jest/globals';
/**
 * Sharp is the REFERENCE this test compares against, not a dependency of the
 * app: the port replaced it with OffscreenCanvas, and it was dropped from
 * package.json with the rest of the Electron toolchain. Importing it at module
 * scope therefore failed the whole suite on any machine that had not kept a
 * stale copy in node_modules. It is loaded optionally instead, alongside the
 * fixtures this test already treats as optional, so it runs where a reference
 * is available and skips quietly where one is not.
 *
 * To run it: npm i --no-save sharp, with the fixtures in FIXTURE_DIRECTORY.
 */
type SharpModule = (input: string) => {
  metadata(): Promise<{ width?: number; height?: number; format?: string }>;
  resize(width: number, height: number, options: { fit: string }): SharpChain;
};
interface SharpChain {
  webp(options: { quality: number; effort?: number }): SharpChain;
  toBuffer(options?: { resolveWithObject?: boolean }): Promise<{
    info: { width: number; height: number; format: string };
  }>;
}

const sharp: SharpModule | null = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('sharp') as SharpModule;
  } catch {
    return null;
  }
})();

import {
  IMAGE_PROFILES,
  ImageTransformer,
  type ArtworkImageSource,
  type DecodedArtwork,
  type ImageBackend,
  type ImageTransformPlan
} from '../imageTransform';

const FIXTURE_DIRECTORY = 'E:\\tmp\\nora-artwork-validation';
const NON_SQUARE_COVER = join(FIXTURE_DIRECTORY, 'non-square.webp');
const VERY_LARGE_COVER = join(FIXTURE_DIRECTORY, 'very-large.webp');

class SharpDimensionBackend implements ImageBackend {
  plan?: ImageTransformPlan;

  async decode(source: ArtworkImageSource): Promise<DecodedArtwork> {
    if (typeof source !== 'string') throw new TypeError('the compatibility fixture must be a path');
    const metadata = await sharp!(source).metadata();
    if (!metadata.width || !metadata.height) throw new Error(`fixture has no dimensions: ${source}`);
    return { width: metadata.width, height: metadata.height, handle: {}, close: () => undefined };
  }

  async encode(_image: DecodedArtwork, plan: ImageTransformPlan): Promise<Blob> {
    this.plan = plan;
    return new Blob([], { type: plan.mimeType });
  }
}

const describeWithCopiedCovers =
  sharp && existsSync(NON_SQUARE_COVER) && existsSync(VERY_LARGE_COVER)
    ? describe
    : describe.skip;

describeWithCopiedCovers('real-cover compatibility with Sharp reference output', () => {
  test('matches Sharp WebP format and 400x400 cover dimensions for a non-square cover', async () => {
    const reference = await sharp!(NON_SQUARE_COVER)
      .resize(400, 400, { fit: 'cover' })
      .webp({ quality: 80, effort: 2 })
      .toBuffer({ resolveWithObject: true });
    const backend = new SharpDimensionBackend();
    const output = await new ImageTransformer(backend).transform(
      NON_SQUARE_COVER,
      IMAGE_PROFILES.tierlistWebp
    );

    expect(reference.info).toMatchObject({ format: 'webp', width: 400, height: 400 });
    expect(output.type).toBe(`image/${reference.info.format}`);
    expect(backend.plan?.output).toEqual({
      width: reference.info.width,
      height: reference.info.height
    });
  });

  test('matches Sharp WebP format and 50x50 cover dimensions for a very large cover', async () => {
    const reference = await sharp!(VERY_LARGE_COVER)
      .resize(50, 50, { fit: 'cover' })
      .webp({ quality: 50, effort: 0 })
      .toBuffer({ resolveWithObject: true });
    const backend = new SharpDimensionBackend();
    const output = await new ImageTransformer(backend).transform(
      VERY_LARGE_COVER,
      IMAGE_PROFILES.optimizedWebp
    );

    expect(reference.info).toMatchObject({ format: 'webp', width: 50, height: 50 });
    expect(output.type).toBe(`image/${reference.info.format}`);
    expect(backend.plan?.output).toEqual({
      width: reference.info.width,
      height: reference.info.height
    });
  });
});

import type {
  ArtworkImageSource,
  DecodedArtwork,
  ImageBackend,
  ImageTransformPlan
} from './imageTransform';

export const isBrowserImageStackAvailable = (): boolean =>
  typeof createImageBitmap === 'function' && typeof OffscreenCanvas === 'function';

const loadBlob = async (source: ArtworkImageSource): Promise<Blob> => {
  if (source instanceof Blob) return source;

  const response = await fetch(source);
  if (!response.ok) {
    throw new Error(`artwork request failed with HTTP ${response.status}: ${source}`);
  }
  return response.blob();
};

/**
 * Browser/WebView2 image backend replacing native Sharp/libvips.
 *
 * `createImageBitmap` exposes one decoded frame to canvas. Same-format file
 * exports therefore use `copy_file_atomic` elsewhere to retain animation;
 * transforms intentionally produce a static WebP/PNG/JPEG from that frame.
 */
export class BrowserImageBackend implements ImageBackend {
  async decode(source: ArtworkImageSource): Promise<DecodedArtwork> {
    if (!isBrowserImageStackAvailable()) {
      throw new Error('createImageBitmap and OffscreenCanvas are required for artwork transforms');
    }

    const bitmap = await createImageBitmap(await loadBlob(source));
    if (bitmap.width <= 0 || bitmap.height <= 0) {
      bitmap.close();
      throw new Error('decoded artwork has invalid dimensions');
    }

    return {
      width: bitmap.width,
      height: bitmap.height,
      handle: bitmap,
      close: () => bitmap.close()
    };
  }

  async encode(image: DecodedArtwork, plan: ImageTransformPlan): Promise<Blob> {
    const bitmap = image.handle as ImageBitmap;
    const canvas = new OffscreenCanvas(plan.output.width, plan.output.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('OffscreenCanvas 2D context is unavailable');

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(
      bitmap,
      plan.source.x,
      plan.source.y,
      plan.source.width,
      plan.source.height,
      0,
      0,
      plan.output.width,
      plan.output.height
    );

    const blob = await canvas.convertToBlob({
      type: plan.mimeType,
      quality: plan.quality
    });
    if (blob.type !== plan.mimeType) {
      throw new Error(
        `browser encoder returned ${blob.type || 'an unknown MIME type'} instead of ${plan.mimeType}`
      );
    }
    return blob;
  }
}

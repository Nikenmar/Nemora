export type ArtworkMimeType = 'image/jpeg' | 'image/png' | 'image/webp';

export type ArtworkImageSource = string | Blob;

export interface ImageDimensions {
  width: number;
  height: number;
}

export interface CoverResize {
  fit: 'cover';
  width: number;
  height: number;
}

export interface ImageTransformProfile {
  mimeType: ArtworkMimeType;
  quality?: number;
  resize?: CoverResize;
}

export interface ImageTransformPlan {
  mimeType: ArtworkMimeType;
  quality?: number;
  output: ImageDimensions;
  source: { x: number; y: number; width: number; height: number };
}

export interface DecodedArtwork extends ImageDimensions {
  handle: unknown;
  close(): void;
}

export interface ImageBackend {
  decode(source: ArtworkImageSource): Promise<DecodedArtwork>;
  encode(image: DecodedArtwork, plan: ImageTransformPlan): Promise<Blob>;
}

/**
 * Sharp uses libwebp and exposes an `effort` compression knob. Canvas exposes
 * only normalized quality, so these profiles preserve MIME, dimensions and
 * Sharp quality while encoded bytes and compression effort can differ.
 */
export const IMAGE_PROFILES = Object.freeze({
  fullWebp: {
    mimeType: 'image/webp',
    quality: 0.8
  },
  optimizedWebp: {
    mimeType: 'image/webp',
    quality: 0.5,
    resize: { fit: 'cover', width: 50, height: 50 }
  },
  tierlistWebp: {
    mimeType: 'image/webp',
    quality: 0.8,
    resize: { fit: 'cover', width: 400, height: 400 }
  },
  png: {
    mimeType: 'image/png'
  },
  jpeg: {
    mimeType: 'image/jpeg',
    quality: 0.8
  }
} satisfies Record<string, ImageTransformProfile>);

const assertDimension = (value: number, name: string): void => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
};

const assertQuality = (quality: number | undefined): void => {
  if (quality !== undefined && (!Number.isFinite(quality) || quality < 0 || quality > 1)) {
    throw new RangeError('image quality must be between 0 and 1');
  }
};

/** Pure geometry equivalent of Sharp's centered `fit: cover`. */
export function createTransformPlan(
  input: ImageDimensions,
  profile: ImageTransformProfile
): ImageTransformPlan {
  assertDimension(input.width, 'source width');
  assertDimension(input.height, 'source height');
  assertQuality(profile.quality);

  if (!profile.resize) {
    return {
      mimeType: profile.mimeType,
      quality: profile.quality,
      output: { width: input.width, height: input.height },
      source: { x: 0, y: 0, width: input.width, height: input.height }
    };
  }

  const { width, height } = profile.resize;
  assertDimension(width, 'output width');
  assertDimension(height, 'output height');

  const scale = Math.max(width / input.width, height / input.height);
  const sourceWidth = width / scale;
  const sourceHeight = height / scale;

  return {
    mimeType: profile.mimeType,
    quality: profile.quality,
    output: { width, height },
    source: {
      x: (input.width - sourceWidth) / 2,
      y: (input.height - sourceHeight) / 2,
      width: sourceWidth,
      height: sourceHeight
    }
  };
}

export class ImageTransformer {
  private readonly backend: ImageBackend;

  constructor(backend: ImageBackend) {
    this.backend = backend;
  }

  async transform(source: ArtworkImageSource, profile: ImageTransformProfile): Promise<Blob> {
    const [output] = await this.transformMany(source, [profile]);
    if (!output) throw new Error('image transform produced no output');
    return output;
  }

  async transformMany(
    source: ArtworkImageSource,
    profiles: readonly ImageTransformProfile[]
  ): Promise<Blob[]> {
    if (profiles.length === 0) return [];

    const decoded = await this.backend.decode(source);
    try {
      const output: Blob[] = [];
      for (const profile of profiles) {
        output.push(await this.backend.encode(decoded, createTransformPlan(decoded, profile)));
      }
      return output;
    } finally {
      decoded.close();
    }
  }
}

import type { ArtworkLogger } from './logger';
import { silentArtworkLogger } from './logger';
import type { ArtworkSource } from './artworkSource';
import { resolveArtworkSource } from './artworkSource';
import type { ArtworkStorage } from './artworkStorage';
import {
  IMAGE_PROFILES,
  ImageTransformer,
  type ArtworkMimeType,
  type ImageTransformProfile
} from './imageTransform';
import { generatePaletteId } from './randomId';

const extensionOf = (path: string): string => {
  const fileName = path.split(/[\\/]/u).at(-1) ?? '';
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(dot + 1).toLocaleLowerCase('en-US') : '';
};

const mimeForExtension = (extension: string): ArtworkMimeType | undefined => {
  if (extension === 'png') return 'image/png';
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'webp') return 'image/webp';
  return undefined;
};

const exportProfile = (mimeType: ArtworkMimeType): ImageTransformProfile => {
  if (mimeType === 'image/png') return IMAGE_PROFILES.png;
  if (mimeType === 'image/jpeg') return IMAGE_PROFILES.jpeg;
  return IMAGE_PROFILES.fullWebp;
};

export class UnsupportedArtworkFormatError extends Error {
  constructor(extension: string) {
    super(`the browser canvas cannot encode .${extension || '(missing)'}; use PNG, JPEG or WebP`);
    this.name = 'UnsupportedArtworkFormatError';
  }
}

export class ArtworkService {
  private readonly storage: ArtworkStorage;
  private readonly transformer: ImageTransformer;
  private readonly logger: ArtworkLogger;
  private readonly createId: () => string;

  constructor(
    storage: ArtworkStorage,
    transformer: ImageTransformer,
    logger: ArtworkLogger = silentArtworkLogger,
    createId: () => string = generatePaletteId
  ) {
    this.storage = storage;
    this.transformer = transformer;
    this.logger = logger;
    this.createId = createId;
  }

  private resolveSource(source: ArtworkSource): string | Blob {
    if (source.kind === 'path') return this.storage.toArtworkUrl(source.path);
    return resolveArtworkSource(source);
  }

  private defaultPaths(type: QueueTypes): ArtworkPaths {
    const artworkUrl = this.storage.defaultArtworkUrl(type);
    return {
      isDefaultArtwork: true,
      artworkPath: artworkUrl,
      optimizedArtworkPath: artworkUrl
    };
  }

  async storedArtworkPaths(id: string): Promise<ArtworkPaths> {
    const fullPath = await this.storage.coverPath(`${id}.webp`);
    const optimizedPath = await this.storage.coverPath(`${id}-optimized.webp`);
    return {
      isDefaultArtwork: false,
      artworkPath: this.storage.toArtworkUrl(fullPath),
      optimizedArtworkPath: this.storage.toArtworkUrl(optimizedPath)
    };
  }

  /** Replaces `sharp(...).webp()` and the 50x50 optimized variant. */
  async storeArtworks(id: string, type: QueueTypes, source?: ArtworkSource): Promise<ArtworkPaths> {
    if (!source) return this.defaultPaths(type);

    try {
      await this.storage.ensureCoversDirectory();
      const [full, optimized] = await this.transformer.transformMany(this.resolveSource(source), [
        IMAGE_PROFILES.fullWebp,
        IMAGE_PROFILES.optimizedWebp
      ]);
      if (!full || !optimized) throw new Error('artwork transform did not return both variants');

      const fullPath = await this.storage.coverPath(`${id}.webp`);
      const optimizedPath = await this.storage.coverPath(`${id}-optimized.webp`);
      await this.storage.writer.writeGenerated(fullPath, full);
      await this.storage.writer.writeGenerated(optimizedPath, optimized);
      return this.storedArtworkPaths(id);
    } catch (error) {
      this.logger.error('Failed to create artwork variants.', { error, id, type });
      return this.defaultPaths(type);
    }
  }

  /** Replaces the 400px Sharp tier-list thumbnail cache. */
  async createTierlistThumbnail(id: string): Promise<string | undefined> {
    const thumbnailPath = await this.storage.coverPath(`${id}-tl.webp`);
    if (!(await this.storage.exists(thumbnailPath))) {
      const sourcePath = await this.storage.coverPath(`${id}.webp`);
      if (!(await this.storage.exists(sourcePath))) return undefined;
      const thumbnail = await this.transformer.transform(
        this.storage.toArtworkUrl(sourcePath),
        IMAGE_PROFILES.tierlistWebp
      );
      await this.storage.writer.writeGenerated(thumbnailPath, thumbnail);
    }
    return this.storage.toArtworkUrl(thumbnailPath);
  }

  /** PNG conversion for embedded ID3 artwork and legacy default-cover callers. */
  convertToPng(source: ArtworkSource): Promise<Blob> {
    return this.transformer.transform(this.resolveSource(source), IMAGE_PROFILES.png);
  }

  async createTempArtwork(source: ArtworkSource): Promise<string | undefined> {
    try {
      await this.storage.ensureTempDirectory();
      const path = await this.storage.tempPath(`${this.createId()}.webp`);
      const artwork = await this.transformer.transform(
        this.resolveSource(source),
        IMAGE_PROFILES.fullWebp
      );
      await this.storage.writer.writeGenerated(path, artwork);
      return path;
    } catch (error) {
      this.logger.error('Failed to create temporary artwork.', { error });
      return undefined;
    }
  }

  clearTempArtworkFolder(): Promise<void> {
    return this.storage.clearTempDirectory();
  }

  async removeStoredArtwork(id: string): Promise<void> {
    await Promise.all([
      this.storage.remove(await this.storage.coverPath(`${id}.webp`)),
      this.storage.remove(await this.storage.coverPath(`${id}-optimized.webp`)),
      this.storage.remove(await this.storage.coverPath(`${id}-tl.webp`))
    ]);
  }

  /**
   * Local same-format saves are true path-to-path atomic copies. Conversions
   * are limited to the formats OffscreenCanvas can guarantee in WebView2.
   */
  async saveArtwork(source: ArtworkSource, destination: string): Promise<void> {
    const destinationExtension = extensionOf(destination);
    if (source.kind === 'path' && extensionOf(source.path) === destinationExtension) {
      await this.storage.writer.copyExisting(source.path, destination);
      return;
    }

    const mimeType = mimeForExtension(destinationExtension);
    if (!mimeType) throw new UnsupportedArtworkFormatError(destinationExtension);
    const output = await this.transformer.transform(
      this.resolveSource(source),
      exportProfile(mimeType)
    );
    await this.storage.writer.writeGenerated(destination, output);
  }
}

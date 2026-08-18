import type { ArtworkLogger } from './logger';
import { silentArtworkLogger } from './logger';
import type { ArtworkSource } from './artworkSource';
import { pathArtwork, resolveArtworkSource } from './artworkSource';
import type { ArtworkStorage } from './artworkStorage';
import {
  IMAGE_PROFILES,
  ImageTransformer,
  type ArtworkMimeType,
  type ImageTransformProfile
} from './imageTransform';
import type { ArtworkPipeline } from './pipeline';
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

/**
 * Lifts an embedded picture out of an audio file.
 *
 * Exists so the browser image route can still serve a cover that a native scan
 * only named. Optional everywhere: a host without file access never produces an
 * `audio` source in the first place.
 */
export interface EmbeddedPictureReader {
  read(path: string): Promise<{ bytes: Uint8Array; mimeType: string } | undefined>;
}

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
  /**
   * The native route, when the host has one. Absent on every non-Tauri host -
   * the browser route below is complete and stays that way.
   */
  private readonly pipeline: ArtworkPipeline | undefined;
  /** Only needed for `audio` sources; see `resolveSource`. */
  private readonly embeddedPictures: EmbeddedPictureReader | undefined;

  constructor(
    storage: ArtworkStorage,
    transformer: ImageTransformer,
    logger: ArtworkLogger = silentArtworkLogger,
    createId: () => string = generatePaletteId,
    pipeline?: ArtworkPipeline,
    embeddedPictures?: EmbeddedPictureReader
  ) {
    this.storage = storage;
    this.transformer = transformer;
    this.pipeline = pipeline;
    this.embeddedPictures = embeddedPictures;
    this.logger = logger;
    this.createId = createId;
  }

  /**
   * Gives the browser route something it can decode.
   *
   * Every source but one already is that. An `audio` source names a picture
   * still inside an audio file, and only a host that can open files can lift it
   * out - which is fine, because an `audio` source is produced by a native
   * library scan and a build that has one also has the reader. When the native
   * artwork route handles the cover, as it normally does, this is never called
   * at all.
   */
  private async resolveSource(source: ArtworkSource): Promise<string | Blob | undefined> {
    if (source.kind === 'path') return this.storage.toArtworkUrl(source.path);
    if (source.kind !== 'audio') return resolveArtworkSource(source);

    if (!this.embeddedPictures) {
      this.logger.error('An embedded cover was named but this host cannot read it.', {
        path: source.path
      });
      return undefined;
    }
    const picture = await this.embeddedPictures.read(source.path).catch((error: unknown) => {
      this.logger.error('Failed to read an embedded cover for the browser route.', {
        error,
        path: source.path
      });
      return undefined;
    });
    if (!picture) return undefined;
    return new Blob([picture.bytes], { type: picture.mimeType || source.mimeType || '' });
  }

  /**
   * The same resolution, for callers that have no way to carry on without one.
   *
   * Every one of them already fails the whole operation on a bad source, so a
   * named error is strictly better than a silent `undefined` travelling one
   * more layer before something else breaks on it.
   */
  private async requireDecodableSource(source: ArtworkSource): Promise<string | Blob> {
    const resolved = await this.resolveSource(source);
    if (resolved === undefined) {
      throw new Error(
        source.kind === 'audio'
          ? `the embedded cover of ${source.path} could not be read`
          : 'the artwork source could not be resolved'
      );
    }
    return resolved;
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

      const fullDestination = await this.storage.coverPath(`${id}.webp`);
      const optimizedDestination = await this.storage.coverPath(`${id}-optimized.webp`);
      if (
        await this.pipeline?.write(source, [
          { destination: fullDestination, profile: IMAGE_PROFILES.fullWebp },
          { destination: optimizedDestination, profile: IMAGE_PROFILES.optimizedWebp }
        ])
      ) {
        return this.storedArtworkPaths(id);
      }

      const [full, optimized] = await this.transformer.transformMany(
        await this.requireDecodableSource(source),
        [IMAGE_PROFILES.fullWebp, IMAGE_PROFILES.optimizedWebp]
      );
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

      if (
        await this.pipeline?.write(pathArtwork(sourcePath), [
          { destination: thumbnailPath, profile: IMAGE_PROFILES.tierlistWebp }
        ])
      ) {
        return this.storage.toArtworkUrl(thumbnailPath);
      }

      const thumbnail = await this.transformer.transform(
        this.storage.toArtworkUrl(sourcePath),
        IMAGE_PROFILES.tierlistWebp
      );
      await this.storage.writer.writeGenerated(thumbnailPath, thumbnail);
    }
    return this.storage.toArtworkUrl(thumbnailPath);
  }

  /** PNG conversion for embedded ID3 artwork and legacy default-cover callers. */
  async convertToPng(source: ArtworkSource): Promise<Blob> {
    return this.transformer.transform(
      await this.requireDecodableSource(source),
      IMAGE_PROFILES.png
    );
  }

  async createTempArtwork(source: ArtworkSource): Promise<string | undefined> {
    try {
      await this.storage.ensureTempDirectory();
      const path = await this.storage.tempPath(`${this.createId()}.webp`);
      const artwork = await this.transformer.transform(
        await this.requireDecodableSource(source),
        IMAGE_PROFILES.fullWebp
      );
      await this.storage.writer.writeGenerated(path, artwork);
      return path;
    } catch (error) {
      this.logger.error('Failed to create temporary artwork.', { error });
      return undefined;
    }
  }

  clearTempArtworkFolder(olderThan?: Date): Promise<void> {
    return this.storage.clearTempDirectory(olderThan);
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
      await this.requireDecodableSource(source),
      exportProfile(mimeType)
    );
    await this.storage.writer.writeGenerated(destination, output);
  }
}

import { invoke } from '@tauri-apps/api/core';

import { emitTagFileWritten } from '../tags/events';
import type { MetadataFileData, MetadataFilePort, MetadataTagPatch } from './types';

interface NativeTagData {
  title?: string;
  artists: string[];
  albumArtists: string[];
  album?: string;
  genres: string[];
  year?: number;
  trackNumber?: number;
  discNumber?: number;
  duration: number;
  bitrate?: number;
  sampleRate?: number;
  numberOfChannels?: number;
  pictureMimeType?: string;
  pictureBytes?: number[];
}

export interface MetadataFileStats {
  createdDate?: number | null;
  modifiedDate?: number | null;
}

/**
 * Tags read and written by Rust, with the TagLib route kept behind it.
 *
 * The route this fronts loads the whole audio file into the renderer to read a
 * title - nine megabytes for one FLAC - and only works at all because a shim
 * was written for the Node `path` module it calls. Here the file stays on disk.
 *
 * The one place bytes still cross is a picture, and only when the caller asks:
 * re-parsing a song replaces its stored artwork and has no other handle on the
 * image, while a library scan points the artwork pipeline at the same file and
 * moves nothing. `include_picture` is what lets one command serve both without
 * paying for the picture every time.
 *
 * Failure is two-tier, as everywhere in this migration. A missing command means
 * the build has no native route and disables it for the session; a failure on
 * one file falls back for that file and is logged with the path, because a
 * native route that quietly stops being taken looks exactly like one that works.
 */
export class TauriMetadataFilePort implements MetadataFilePort {
  private available = true;
  private readonly fallback: MetadataFilePort;
  private readonly stat: (path: string) => Promise<MetadataFileStats>;
  private readonly logger: { error(message: string, data?: object): void };

  constructor(
    fallback: MetadataFilePort,
    stat: (path: string) => Promise<MetadataFileStats>,
    logger: { error(message: string, data?: object): void }
  ) {
    this.fallback = fallback;
    this.stat = stat;
    this.logger = logger;
  }

  async read(path: string): Promise<MetadataFileData> {
    if (!this.available) return this.fallback.read(path);

    try {
      const [native, stats] = await Promise.all([
        invoke<NativeTagData>('tags_read', { path, includePicture: true }),
        this.stat(path)
      ]);

      return {
        title: native.title,
        artists: native.artists,
        albumArtists: native.albumArtists,
        album: native.album,
        genres: native.genres,
        year: native.year ?? null,
        trackNumber: native.trackNumber ?? null,
        discNumber: native.discNumber ?? null,
        duration: native.duration,
        bitrate: native.bitrate ?? null,
        sampleRate: native.sampleRate ?? null,
        numberOfChannels: native.numberOfChannels ?? null,
        createdDate: stats.createdDate ?? null,
        modifiedDate: stats.modifiedDate ?? null,
        picture: native.pictureBytes
          ? {
              bytes: new Uint8Array(native.pictureBytes),
              // A blank MIME is the defect the heal step exists for; it is
              // reported as it is on disk rather than guessed at here.
              mimeType: native.pictureMimeType || 'image/jpeg'
            }
          : undefined
      };
    } catch (error) {
      if (this.disableOnMissingCommand(error, 'read')) return this.fallback.read(path);
      this.logger.error('Native tag read failed for one file; using TagLib.', { error, path });
      return this.fallback.read(path);
    }
  }

  async write(path: string, patch: MetadataTagPatch): Promise<void> {
    // Artwork and lyrics are still written by the TagLib route: they are the
    // parts that rewrite picture frames and synchronised lyrics, and moving
    // them is its own piece of work with its own way of going wrong.
    const needsTagLib =
      patch.artwork !== undefined ||
      patch.synchronizedLyrics !== undefined ||
      patch.unsynchronizedLyrics !== undefined;

    if (!this.available || needsTagLib) return this.fallback.write(path, patch);

    try {
      await invoke<void>('tags_write', {
        path,
        patch: {
          title: patch.title,
          artists: patch.artists,
          albumArtists: patch.albumArtists,
          album: patch.album,
          genres: patch.genres,
          composer: patch.composer,
          trackNumber: patch.trackNumber,
          year: patch.year
        }
      });
      // Without this the app treats its own edit as someone else's: the folder
      // watcher sees the file change and re-scans it while the write is still
      // settling. The TypeScript route emits the same event from inside
      // `updateTagLibFile`, and skipping it here is what made a first tag edit
      // fail and the second one succeed.
      emitTagFileWritten({ path, reason: 'native-tag-edit' });
    } catch (error) {
      if (this.disableOnMissingCommand(error, 'write')) return this.fallback.write(path, patch);
      this.logger.error('Native tag write failed for one file; using TagLib.', { error, path });
      return this.fallback.write(path, patch);
    }
  }

  async healBlankPictureMime(path: string): Promise<number> {
    if (!this.available) return this.fallback.healBlankPictureMime(path);

    try {
      const healed = await invoke<number>('tags_heal_picture_mime', { path });
      // Only a real repair touches the file, so only a real repair has an event
      // to suppress.
      if (healed > 0) emitTagFileWritten({ path, reason: 'native-picture-mime-heal' });
      return healed;
    } catch (error) {
      if (this.disableOnMissingCommand(error, 'heal')) {
        return this.fallback.healBlankPictureMime(path);
      }
      this.logger.error('Native picture-MIME repair failed for one file; using TagLib.', {
        error,
        path
      });
      return this.fallback.healBlankPictureMime(path);
    }
  }

  private disableOnMissingCommand(error: unknown, operation: string): boolean {
    const message = error instanceof Error ? error.message : String(error);
    if (!/not found|not allowed|unknown command|missing/iu.test(message)) return false;
    this.available = false;
    this.logger.error(`Native tag ${operation} unavailable; TagLib will handle tags.`, { error });
    return true;
  }
}

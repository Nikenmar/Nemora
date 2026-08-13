import { invoke } from '@tauri-apps/api/core';

import type { ArtworkSource } from './artworkSource';
import type { ArtworkLogger } from './logger';
import { silentArtworkLogger } from './logger';
import type { ArtworkJob, ArtworkPipeline } from './pipeline';
import type { VibrantPaletteLike } from './palette';

interface NativeJob {
  destination: string;
  mimeType: string;
  quality?: number;
  resize?: { width: number; height: number };
}

const toNativeJob = (job: ArtworkJob): NativeJob => ({
  destination: job.destination,
  mimeType: job.profile.mimeType,
  quality: job.profile.quality,
  resize: job.profile.resize
    ? { width: job.profile.resize.width, height: job.profile.resize.height }
    : undefined
});

/**
 * Artwork done in Rust, with the browser route kept as the fallback.
 *
 * Two shapes of source reach the native side. A `path` source is an image file
 * already on disk - a stored cover being turned into a tier-list thumbnail. An
 * embedded picture is the interesting one: the scanner knows the AUDIO file's
 * path, so Rust reads the picture out of the file itself and the bytes never
 * enter the renderer at all. The Blob carried alongside stays as the fallback's
 * input, so nothing is lost if the native route declines.
 *
 * Failure handling is deliberately two-tier. A missing command or a broken
 * install disables the native route for the rest of the session - retrying it
 * per file would just repeat the same error 1745 times. A failure on one file
 * falls back for that file only and is logged with the path, because "Rust
 * silently stopped working" is exactly the class of defect this project keeps
 * finding.
 */
export class TauriArtworkPipeline implements ArtworkPipeline {
  private available = true;
  private readonly logger: ArtworkLogger;

  constructor(logger: ArtworkLogger = silentArtworkLogger) {
    this.logger = logger;
  }

  nativePath(source: ArtworkSource): string | undefined {
    if (source.kind === 'path') return source.path;
    if (source.kind === 'blob') return source.nativeAudioPath;
    // An `audio` source IS a native path and nothing else - it names a picture
    // still inside an audio file. Forgetting it here is what made every cover
    // from a native scan fall back to the canvas: the browser route, on the UI
    // thread, one at a time, after an extra round trip that hauled the picture
    // into the renderer. The whole point of the source was to avoid exactly
    // that.
    if (source.kind === 'audio') return source.path;
    return undefined;
  }

  async write(source: ArtworkSource, jobs: readonly ArtworkJob[]): Promise<boolean> {
    if (!this.available || jobs.length === 0) return false;

    const path = this.nativePath(source);
    if (!path) return false;

    // Which command depends on what the path POINTS AT, not on how the source
    // was built: `blob` and `audio` both name an audio file to read a picture
    // out of, `path` names an image file already on disk.
    const command =
      source.kind === 'path' ? 'artwork_transform_file' : 'artwork_transform_audio';
    const nativeJobs = jobs.map(toNativeJob);

    try {
      const handled = await invoke<boolean | null>(command, { source: path, jobs: nativeJobs });
      // The audio command answers false when the file simply carries no picture.
      // That is a real answer, not a failure, and the browser route would find
      // nothing either - but the caller still has the Blob, so let it try.
      return handled !== false;
    } catch (error) {
      if (isCommandMissing(error)) {
        this.available = false;
        this.logger.error('Native artwork pipeline unavailable; using the browser route.', {
          error
        });
        return false;
      }
      this.logger.error('Native artwork transform failed for one file.', { error, path });
      return false;
    }
  }

  async palette(path: string): Promise<VibrantPaletteLike | undefined> {
    if (!this.available) return undefined;
    try {
      return await invoke<VibrantPaletteLike>('artwork_palette', { source: path });
    } catch (error) {
      if (isCommandMissing(error)) {
        this.available = false;
        this.logger.error('Native palette extraction unavailable; using node-vibrant.', { error });
        return undefined;
      }
      this.logger.error('Native palette extraction failed for one file.', { error, path });
      return undefined;
    }
  }
}

/**
 * Tells "this build has no such command" apart from "this file went wrong".
 *
 * Tauri answers an unregistered command with a message naming it, and a
 * capability refusal with `not allowed`. Both mean the route does not exist in
 * this build; anything else is about the one file being processed.
 */
const isCommandMissing = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return /not found|not allowed|unknown command|missing/iu.test(message);
};

/**
 * Builds the pipeline unless the environment asks for the TypeScript route.
 *
 * `NEMORA_FORCE_TS` exists for two jobs: diagnosing whether a defect belongs to
 * the native side, and running both routes against each other in the benchmark.
 */
export const createArtworkPipeline = (
  logger: ArtworkLogger = silentArtworkLogger,
  forceTypeScript = false
): TauriArtworkPipeline | undefined =>
  forceTypeScript ? undefined : new TauriArtworkPipeline(logger);

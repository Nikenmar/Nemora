import type { ArtworkSource } from './artworkSource';
import type { ImageTransformProfile } from './imageTransform';

export interface ArtworkJob {
  /** Absolute filesystem path the variant is written to. */
  destination: string;
  profile: ImageTransformProfile;
}

/**
 * A native path that decodes, transforms and WRITES artwork in one step.
 *
 * The browser route cannot do this: it decodes into the renderer, encodes into
 * a Blob, and hands the bytes back through `invoke` to be written - so every
 * cover crosses the process boundary twice and lives in the JS heap in between.
 * A pipeline takes a source it can reach on disk and produces the files itself.
 *
 * `write` and `palette` both return undefined-ish results rather than throwing
 * when they cannot handle a source (a remote URL, in-memory bytes with no file
 * behind them). That is not a failure: it is the signal to use the browser
 * route, which remains complete and is the only route a non-Tauri host has.
 */
export interface ArtworkPipeline {
  /** True when every variant was written natively; false to use the browser route. */
  write(source: ArtworkSource, jobs: readonly ArtworkJob[]): Promise<boolean>;
  /** A filesystem path this source maps to, or undefined when there is none. */
  nativePath(source: ArtworkSource): string | undefined;
}

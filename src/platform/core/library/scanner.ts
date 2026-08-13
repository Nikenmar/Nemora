import {
  DEFAULT_FILE_CONCURRENCY,
  DEFAULT_SCAN_BATCH_SIZE,
  MAX_ARTWORK_REGION_SIZE,
  METADATA_HEAD_SIZE
} from './constants';
import { artworkRegionSize } from './artworkRegion';
import { runWithConcurrency } from './concurrency';
import { canonicalPathKey } from './path';
import { retryLockedFile, type RetryOptions } from './retry';
import { walkMusicTrees, type TraversalOptions } from './traversal';
import type {
  LibraryFileSystemPort,
  NativeParsedFile,
  LibraryRepository,
  LibraryScanResult,
  MetadataParserPort,
  ScanFailure,
  ScannedLibraryTrack,
  TraversalResult
} from './types';

export interface LibraryScannerOptions extends TraversalOptions {
  fileConcurrency?: number;
  batchSize?: number;
  headSize?: number;
  includeArtwork?: boolean;
  reparseKnownSongs?: boolean;
  retry?: RetryOptions;
}

/**
 * Files handed to the host at once.
 *
 * The point of a batch is to stop paying the bridge crossing per file; past a
 * few dozen the saving flattens while the wait before the first result grows,
 * and that wait is what the progress counter shows as a stall.
 */
const NATIVE_PARSE_BATCH = 32;

const toScannedTrack = (parsed: NativeParsedFile): ScannedLibraryTrack => ({
  path: parsed.path,
  size: parsed.size,
  createdDate: parsed.createdDate,
  modifiedDate: parsed.modifiedDate,
  metadata: {
    common: { ...parsed.common, genres: parsed.common.genres ?? [] },
    format: parsed.format,
    // Byte-less by construction. The commit path reads `byteLength` to learn
    // that a cover exists and points the artwork pipeline at the audio file.
    pictures: parsed.pictures,
    metadataCompleteness: 'file'
  }
});

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
};

const scanOne = async (
  fileSystem: LibraryFileSystemPort,
  parser: MetadataParserPort,
  path: string,
  headSize: number,
  includeArtwork: boolean,
  retry: RetryOptions | undefined
): Promise<ScannedLibraryTrack> =>
  retryLockedFile(async () => {
    const [stats, head] = await Promise.all([
      fileSystem.stat(path),
      fileSystem.readHead(path, headSize)
    ]);
    if (!stats.isFile) throw new Error(`Library candidate is not a file: ${path}`);
    if (head.byteLength > headSize) {
      throw new Error(`Head reader exceeded its ${headSize}-byte contract for: ${path}`);
    }
    let metadata = await parser.parse(path, toArrayBuffer(head), includeArtwork);

    // A cover larger than what is left of the head ends past it, so the parser
    // sees a truncated picture block and reports no artwork - the track gets a
    // placeholder for a cover it has. The metadata HEADERS are inside the head
    // though, so the exact end of the artwork region can be computed and asked
    // for precisely. Bounded, and only for a file that provably has artwork
    // further in: a file without one is never read a second time.
    if (includeArtwork && !metadata.pictures.some((picture) => picture.data)) {
      const region = artworkRegionSize(head);
      if (region !== undefined && region > head.byteLength && region <= MAX_ARTWORK_REGION_SIZE) {
        const extended = await fileSystem.readHead(path, region);
        if (extended.byteLength > head.byteLength) {
          metadata = await parser.parse(path, toArrayBuffer(extended), includeArtwork);
        }
      }
    }

    // No duration means the head did not reach the audio.
    //
    // FLAC states its length in STREAMINFO, which is the first thing in the
    // file, so this never fires for one. MP3 has no such block: the length is
    // derived from the first MPEG frame, and an ID3v2 tag bigger than the head
    // - one full-resolution embedded cover is enough - puts that frame out of
    // reach. Those tracks showed 00:00 with no bitrate and no sample rate, and
    // the seek bar had nothing to scale against. Asking the host for the real
    // properties is cheap and happens only for the few files that need it.
    if (!metadata.format.duration && parser.properties) {
      const properties = await parser.properties(path).catch(() => undefined);
      if (properties?.duration) {
        metadata = {
          ...metadata,
          format: {
            ...metadata.format,
            duration: properties.duration,
            sampleRate: metadata.format.sampleRate ?? properties.sampleRate,
            bitrate: metadata.format.bitrate ?? properties.bitrate,
            numberOfChannels: metadata.format.numberOfChannels ?? properties.numberOfChannels
          }
        };
      }
    }

    return {
      path,
      size: stats.size,
      createdDate: stats.birthtime?.getTime(),
      modifiedDate: stats.mtime?.getTime(),
      metadata
    };
  }, retry);

/**
 * Scans selected roots without ever requesting a whole audio file. Repository
 * writes are batched; the API bridge supplies the concrete catalog adapter.
 */
export const scanLibrary = async (
  repository: LibraryRepository,
  fileSystem: LibraryFileSystemPort,
  parser: MetadataParserPort,
  roots: readonly string[],
  options: LibraryScannerOptions = {}
): Promise<LibraryScanResult> => {
  const traversal = await walkMusicTrees(fileSystem, roots, options);
  return scanTraversal(repository, fileSystem, parser, traversal, options);
};

/**
 * Consumes a traversal that was already produced for getFolderStructures.
 * The compatibility adapter must retain and pass this plan instead of walking
 * the selected directories again when addSongsFromFolderStructures follows.
 */
export const scanTraversal = async (
  repository: LibraryRepository,
  fileSystem: LibraryFileSystemPort,
  parser: MetadataParserPort,
  traversal: TraversalResult,
  options: LibraryScannerOptions = {}
): Promise<LibraryScanResult> => {
  const headSize = options.headSize ?? METADATA_HEAD_SIZE;
  const fileConcurrency = options.fileConcurrency ?? DEFAULT_FILE_CONCURRENCY;
  const batchSize = options.batchSize ?? DEFAULT_SCAN_BATCH_SIZE;
  if (!Number.isInteger(headSize) || headSize < 1 || headSize > METADATA_HEAD_SIZE) {
    throw new RangeError(`Metadata head size must be between 1 and ${METADATA_HEAD_SIZE} bytes.`);
  }
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new RangeError('Scan batch size must be a positive integer.');
  }

  const knownPaths = new Set(repository.getKnownSongPaths().map(canonicalPathKey));
  const candidates = options.reparseKnownSongs
    ? traversal.songPaths
    : traversal.songPaths.filter((path) => !knownPaths.has(canonicalPathKey(path)));
  const failures: ScanFailure[] = [];
  const pendingBatch: ScannedLibraryTrack[] = [];
  let scanned = 0;
  let commitQueue = Promise.resolve();

  await repository.commitFolderStructures(traversal.structures);

  let pendingCommits = 0;
  let commitError: unknown;

  /**
   * Hands a batch to the catalog WITHOUT stopping the scan for it.
   *
   * Committing a batch is expensive - it generates artwork for every new track
   * and rewrites four stores - and awaiting it here froze everything: the
   * worker that hit the batch boundary waited for the whole commit, the other
   * workers piled up behind it, and the progress counter stood still until the
   * commit finished. That is what "the scan hangs at 99, then jumps to 124"
   * was: batches of 25, each one a stall.
   *
   * Commits still run one at a time, because the catalog assigns ids and edits
   * shared arrays. Only the waiting moved: at most one batch queues behind the
   * running commit, so a slow catalog applies back-pressure instead of letting
   * scanned tracks accumulate without bound.
   */
  const flush = async (): Promise<void> => {
    if (commitError) throw commitError;
    if (pendingBatch.length === 0) return;

    const batch = pendingBatch.splice(0, pendingBatch.length);
    pendingCommits += 1;
    commitQueue = commitQueue
      .then(() => repository.commitScanBatch(batch))
      // Recorded rather than thrown here: a rejected chain would make every
      // later `.then` skip its commit, and batches would vanish in silence.
      .catch((error: unknown) => {
        commitError ??= error;
      })
      .finally(() => {
        pendingCommits -= 1;
      });

    if (pendingCommits > 1) await commitQueue;
  };

  const reportProgress = (): void =>
    repository.reportScanProgress({
      completed: scanned + failures.length,
      total: candidates.length,
      failed: failures.length
    });

  const accept = async (track: ScannedLibraryTrack): Promise<void> => {
    pendingBatch.push(track);
    scanned += 1;
    if (pendingBatch.length >= batchSize) await flush();
    reportProgress();
  };

  const reject = (path: string, error: unknown): void => {
    failures.push({ path, error });
    reportProgress();
  };

  const scanInTypeScript = async (paths: readonly string[]): Promise<void> => {
    await runWithConcurrency(paths, fileConcurrency, async (path) => {
      try {
        const track = await scanOne(
          fileSystem,
          parser,
          path,
          headSize,
          options.includeArtwork ?? false,
          options.retry
        );
        await accept(track);
      } catch (error) {
        reject(path, error);
      }
    });
  };

  if (options.native) {
    const native = options.native;
    const chunks: string[][] = [];
    for (let index = 0; index < candidates.length; index += NATIVE_PARSE_BATCH) {
      chunks.push(candidates.slice(index, index + NATIVE_PARSE_BATCH));
    }

    // Two batches in flight: one being parsed by the host while the results of
    // the other are turned into catalog rows. More would only queue work the
    // single-threaded caller cannot consume any faster.
    await runWithConcurrency(chunks, 2, async (chunk) => {
      const parsed = await native.parse(chunk).catch(() => undefined);
      if (!parsed) {
        // Not a scan failure: the host declined, so these files are read the
        // way every host without a native route reads them.
        await scanInTypeScript(chunk);
        return;
      }

      for (const entry of parsed) {
        if (entry.error) reject(entry.path, new Error(entry.error));
        else await accept(toScannedTrack(entry));
      }
    });
  } else {
    await scanInTypeScript(candidates);
  }

  await flush();
  await commitQueue;
  if (commitError) throw commitError;

  return {
    ...traversal,
    scanned,
    skipped: traversal.songPaths.length - candidates.length,
    failures
  };
};

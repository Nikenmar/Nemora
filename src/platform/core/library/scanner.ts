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

  const flush = async (): Promise<void> => {
    if (pendingBatch.length === 0) return;
    const batch = pendingBatch.splice(0, pendingBatch.length);
    commitQueue = commitQueue.then(async () => repository.commitScanBatch(batch));
    await commitQueue;
  };

  await runWithConcurrency(candidates, fileConcurrency, async (path) => {
    let track: ScannedLibraryTrack;
    try {
      track = await scanOne(
        fileSystem,
        parser,
        path,
        headSize,
        options.includeArtwork ?? false,
        options.retry
      );
    } catch (error) {
      failures.push({ path, error });
      repository.reportScanProgress({
        completed: scanned + failures.length,
        total: candidates.length,
        failed: failures.length
      });
      return;
    }

    pendingBatch.push(track);
    scanned += 1;
    if (pendingBatch.length >= batchSize) await flush();
    repository.reportScanProgress({
      completed: scanned + failures.length,
      total: candidates.length,
      failed: failures.length
    });
  });
  await flush();

  return {
    ...traversal,
    scanned,
    skipped: traversal.songPaths.length - candidates.length,
    failures
  };
};

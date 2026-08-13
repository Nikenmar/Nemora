/**
 * The real-library spike parsed 100/100 FLAC files from this prefix at
 * 5.1 ms/file. Whole-file reads measured 115.3 ms/file and are forbidden on
 * the normal scan path.
 */
export const METADATA_HEAD_SIZE = 256 * 1024;

/**
 * Ceiling for the one extra read that fetches an embedded cover ending past the
 * head. Embedded artwork is a picture, not an album: 8 MB is far above anything
 * a tagger writes, and the cap is what stops a corrupt or hostile header from
 * turning "read the metadata" back into "read the whole file".
 */
export const MAX_ARTWORK_REGION_SIZE = 8 * 1024 * 1024;

export const DEFAULT_DIRECTORY_CONCURRENCY = 8;
export const DEFAULT_FILE_CONCURRENCY = 4;
/**
 * Tracks committed to the catalog at once.
 *
 * The cost of a commit is dominated by the CATALOG, not by the batch: every
 * commit copies and rewrites the whole songs/artists/albums/genres set. Small
 * batches therefore multiply an O(library) cost by the number of batches, which
 * is what made a scan stall repeatedly and for longer as it progressed. Larger
 * batches trade a slightly coarser "songs appear in the list" step for far less
 * total work.
 */
export const DEFAULT_SCAN_BATCH_SIZE = 100;

export const SUPPORTED_MUSIC_EXTENSIONS = [
  '.mp3',
  '.wav',
  '.ogg',
  '.aac',
  '.m4r',
  '.m4a',
  '.opus',
  '.flac'
] as const;

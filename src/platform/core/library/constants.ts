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
export const DEFAULT_SCAN_BATCH_SIZE = 25;

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

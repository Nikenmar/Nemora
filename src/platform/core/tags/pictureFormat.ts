/**
 * What an embedded picture really is, decided from its bytes.
 *
 * The MIME type written next to a cover is the least trustworthy thing about
 * it, and it is the thing that decides whether a song plays at all. FFmpeg -
 * which is what decodes audio inside every Chromium, and therefore inside this
 * app - looks that string up in a small table of picture formats it accepts as
 * an attached picture. A miss does not skip the cover: it fails the whole
 * container open, and the player reports `DEMUXER_ERROR_COULD_NOT_OPEN` on a
 * file that is otherwise perfect.
 *
 * This module is the single description of that rule, shared by both repair
 * routes so they cannot drift apart. It is pure: no file access, no host API,
 * nothing a plain TypeScript consumer cannot run.
 */

/** The formats an audio demuxer accepts as an attached picture. */
export type AcceptedPictureFormat = 'jpeg' | 'png' | 'gif' | 'bmp' | 'tiff';

export type PictureFormat =
  | AcceptedPictureFormat
  /** A real image, but not one the demuxer's table names. WebP and AVIF. */
  | 'foreign'
  /** Not an image at all, or too short to be one. */
  | 'not-an-image';

export const CANONICAL_PICTURE_MIME: Record<AcceptedPictureFormat, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  bmp: 'image/bmp',
  tiff: 'image/tiff'
};

const startsWith = (bytes: Uint8Array, signature: readonly number[]): boolean =>
  signature.every((byte, index) => bytes[index] === byte);

const ascii = (bytes: Uint8Array, from: number, text: string): boolean =>
  [...text].every((character, index) => bytes[from + index] === character.charCodeAt(0));

/** Identifies a picture by its magic number. */
export const sniffPictureFormat = (bytes: Uint8Array): PictureFormat => {
  if (bytes.length < 12) return 'not-an-image';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (ascii(bytes, 0, 'GIF87a') || ascii(bytes, 0, 'GIF89a')) return 'gif';
  if (ascii(bytes, 0, 'BM')) return 'bmp';
  if (startsWith(bytes, [0x49, 0x49, 0x2a, 0x00]) || startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2a]))
    return 'tiff';
  if (ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WEBP')) return 'foreign';
  // AVIF and HEIC, both `ftyp`-branded, both refused by audio demuxers.
  if (ascii(bytes, 4, 'ftyp')) return 'foreign';
  return 'not-an-image';
};

export type PictureRepair =
  /** Already something the demuxer accepts, and it says so correctly. */
  | { action: 'keep' }
  /** Same bytes, corrected MIME type. */
  | { action: 'set-mime'; mimeType: string }
  /**
   * Nothing here can be made acceptable, and the song is worth more than the
   * cover. The artwork the user sees is served from the app's own store, which
   * was filled at scan time and is not touched by this.
   */
  | { action: 'remove'; reason: 'foreign-format' | 'not-an-image' | 'empty' };

/**
 * Decides what one picture needs, covering every way the declared type goes
 * wrong: absent, blank, unknown to the table, or confidently naming the wrong
 * format. The last one matters more than it looks - the original repair in this
 * fork stamped `image/jpeg` on every blank picture including the PNGs, which
 * trades a file that will not open for a cover that will not decode.
 */
export const planPictureRepair = (
  bytes: Uint8Array,
  declaredMimeType: string | undefined | null
): PictureRepair => {
  if (bytes.length === 0) return { action: 'remove', reason: 'empty' };

  const format = sniffPictureFormat(bytes);
  if (format === 'not-an-image') return { action: 'remove', reason: 'not-an-image' };
  if (format === 'foreign') return { action: 'remove', reason: 'foreign-format' };

  const canonical = CANONICAL_PICTURE_MIME[format];
  const declared = declaredMimeType?.trim().toLowerCase();
  if (declared === canonical) return { action: 'keep' };
  return { action: 'set-mime', mimeType: canonical };
};

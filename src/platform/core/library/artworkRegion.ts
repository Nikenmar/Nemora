/**
 * Works out how many leading bytes of a file must be read to reach its embedded
 * artwork, from the metadata headers alone.
 *
 * The scanner reads only the first 256 KB of a file, which is what keeps a
 * library scan at 5 ms per file instead of 115. That rule costs nothing for
 * metadata - tags live at the front - but a cover is not small: a 452 KB
 * embedded picture starts inside the head and ends past it, so the parser sees
 * a truncated block, reports no picture at all, and the track gets a
 * placeholder for a cover it actually has.
 *
 * This is the narrow way out. The headers that describe the artwork ARE inside
 * the head, so the exact size of the leading metadata region can be computed
 * without reading anything more, and the scanner can then ask for precisely
 * that many bytes. The spike rule holds where it matters: the audio is still
 * never read, and a file with no embedded artwork is never read twice.
 *
 * Returns undefined when the answer cannot be known from the head, which is
 * always treated as "do not read more".
 */

/** FLAC metadata block type for an embedded picture. */
const FLAC_PICTURE_BLOCK = 6;

const startsWith = (bytes: Uint8Array, ascii: string): boolean => {
  if (bytes.byteLength < ascii.length) return false;
  for (let index = 0; index < ascii.length; index += 1) {
    if (bytes[index] !== ascii.charCodeAt(index)) return false;
  }
  return true;
};

/**
 * FLAC: a chain of `[1 byte flags][3 byte length][payload]` blocks after the
 * `fLaC` marker. Walking it is exact - each header states its own payload
 * length - and stops as soon as a block extends past what was read, because a
 * block that cannot be stepped over hides everything behind it.
 */
const flacArtworkRegion = (head: Uint8Array): number | undefined => {
  let offset = 4;
  for (;;) {
    if (offset + 4 > head.byteLength) return undefined;
    const flags = head[offset];
    const isLast = (flags & 0x80) !== 0;
    const type = flags & 0x7f;
    const length = (head[offset + 1] << 16) | (head[offset + 2] << 8) | head[offset + 3];
    const end = offset + 4 + length;
    if (type === FLAC_PICTURE_BLOCK) return end;
    if (isLast) return undefined;
    offset = end;
  }
};

/**
 * ID3v2: the ten-byte header states the size of the whole tag as a syncsafe
 * integer (seven bits per byte). Any embedded picture frame lives inside it, so
 * the tag's end is the region to read.
 */
const id3v2ArtworkRegion = (head: Uint8Array): number | undefined => {
  if (head.byteLength < 10) return undefined;
  const sizeBytes = head.subarray(6, 10);
  if (sizeBytes.some((byte) => (byte & 0x80) !== 0)) return undefined;
  const size = (sizeBytes[0] << 21) | (sizeBytes[1] << 14) | (sizeBytes[2] << 7) | sizeBytes[3];
  return 10 + size;
};

/**
 * Bytes needed to reach the embedded artwork, or undefined when the head does
 * not say. Callers must treat a return larger than their own ceiling as
 * "not worth it" rather than as an instruction.
 */
export const artworkRegionSize = (head: Uint8Array): number | undefined => {
  if (startsWith(head, 'fLaC')) return flacArtworkRegion(head);
  if (startsWith(head, 'ID3')) return id3v2ArtworkRegion(head);
  return undefined;
};

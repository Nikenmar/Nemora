/**
 * Applies an edit to a TagLib tag, whatever container it came from.
 *
 * The other writer in this app is node-id3, and node-id3 speaks ID3 - which is
 * to say MP3 and nothing else. That was fine while MP3 was the only format the
 * editor offered, and it is what kept FLAC out: the native Rust route (lofty)
 * has always written FLAC text fields correctly, but any edit carrying a cover
 * or lyrics is handed to the fallback, and the fallback would have written an
 * ID3 block into a FLAC container.
 *
 * TagLib addresses the tag a file actually has - Vorbis comments in a FLAC,
 * ID3 in an MP3 - so the same mutation serves both. MP3 keeps going through
 * node-id3 anyway: it is the route those edits have always taken, it handles
 * synchronised ID3 lyric frames specifically, and swapping it out would put a
 * working path at risk for no gain.
 *
 * Written against a structural type rather than TagLib's own so it can be
 * tested without a real audio file; the shapes are compatible by construction.
 */

import { ByteVector, Picture, PictureType } from 'node-taglib-sharp';

/**
 * Builds the cover TagLib will embed.
 *
 * `fromFullData` rather than `fromData`, because the short form guesses the
 * type and the description from the bytes, and a picture whose MIME type ends
 * up blank is precisely the defect this whole fork started from: WebView2
 * answers `DEMUXER_ERROR_COULD_NOT_OPEN` and playback dies.
 */
export const createTagLibPicture = (bytes: Uint8Array, mimeType: string): Picture =>
  Picture.fromFullData(
    ByteVector.fromByteArray(bytes),
    PictureType.FrontCover,
    mimeType,
    'artwork'
  );

/** Only the members this patch touches, so a fake can stand in for a real tag. */
export interface WritableTag {
  title: string;
  performers: string[];
  albumArtists: string[];
  composers: string[];
  album: string;
  genres: string[];
  year: number;
  track: number;
  lyrics: string;
  pictures: unknown[];
}

export interface WritableTagFile {
  tag: WritableTag;
}

export interface TagLibPatch {
  title?: string;
  artists?: string[];
  albumArtists?: string[];
  album?: string;
  genres?: string[];
  composer?: string;
  trackNumber?: number;
  year?: number;
  /** Lyrics as text; synchronised lyrics are stored as their LRC form. */
  lyrics?: string;
  /** `undefined` leaves the artwork alone, `null` removes it. */
  picture?: unknown | null;
}

/**
 * `has` decides between "leave this field alone" and "clear it", which the
 * value alone cannot: an empty title and an untouched title both arrive as
 * falsy, and the editor uses the first to mean "remove this tag".
 */
const has = (patch: TagLibPatch, key: keyof TagLibPatch): boolean => Object.hasOwn(patch, key);

export const applyTagLibPatch = (file: WritableTagFile, patch: TagLibPatch): void => {
  const { tag } = file;

  if (has(patch, 'title')) tag.title = patch.title ?? '';
  if (has(patch, 'artists')) tag.performers = patch.artists ?? [];
  if (has(patch, 'albumArtists')) tag.albumArtists = patch.albumArtists ?? [];
  if (has(patch, 'album')) tag.album = patch.album ?? '';
  if (has(patch, 'genres')) tag.genres = patch.genres ?? [];
  // TagLib models these as single numbers, and 0 is how it stores "absent".
  if (has(patch, 'year')) tag.year = patch.year ?? 0;
  if (has(patch, 'trackNumber')) tag.track = patch.trackNumber ?? 0;
  // One composer field in the editor, a list in the tag.
  if (has(patch, 'composer')) tag.composers = patch.composer ? [patch.composer] : [];
  if (has(patch, 'lyrics')) tag.lyrics = patch.lyrics ?? '';

  if (has(patch, 'picture')) {
    // Replacing rather than appending: a song has one cover as far as this app
    // is concerned, and leaving the old one behind would make the file grow by
    // a megabyte with every edit while players picked whichever came first.
    tag.pictures = patch.picture ? [patch.picture] : [];
  }
};

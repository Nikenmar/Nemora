import { convertFileSrc } from '@tauri-apps/api/core';

import type { ArtworkImageSource } from './imageTransform';

export type ArtworkSource =
  | { kind: 'path'; path: string }
  | { kind: 'url'; url: string }
  | { kind: 'blob'; blob: Blob; nativeAudioPath?: string }
  | { kind: 'audio'; path: string; mimeType?: string };

export const pathArtwork = (path: string): ArtworkSource => ({ kind: 'path', path });
export const urlArtwork = (url: string): ArtworkSource => ({ kind: 'url', url });

/**
 * A cover that is still inside an audio file, named rather than carried.
 *
 * This is what a native library scan produces: it reports that the file has a
 * picture and how big it is, and leaves the bytes where they are. The native
 * artwork route opens the same file, so nothing needs to be read twice; the
 * browser route has no bytes of its own and asks for them only if it is
 * actually used, which on a build with a native scan means almost never.
 */
export const audioArtwork = (path: string, mimeType?: string): ArtworkSource => ({
  kind: 'audio',
  path,
  mimeType
});

/**
 * Embedded metadata bytes stay inside the webview; they are not sent through invoke.
 *
 * `audioPath` is a hint, not a second source of truth: when the caller knows
 * which audio file these bytes came out of, the native pipeline can read the
 * picture from that file directly and the bytes never cross the boundary at
 * all. The Blob remains the input the browser route uses, so a missing or
 * unreadable path costs nothing.
 */
export const embeddedArtwork = (
  bytes: Uint8Array,
  mimeType: string,
  audioPath?: string
): ArtworkSource => ({
  kind: 'blob',
  blob: new Blob([bytes], { type: mimeType }),
  nativeAudioPath: audioPath
});

/**
 * Turns a source into something the browser image backend can decode.
 *
 * An `audio` source has no such form - the picture is inside a container the
 * canvas cannot open - so it answers `undefined` and the caller has to fetch
 * the bytes first. Making that impossible to overlook is the point of the
 * return type.
 */
export const resolveArtworkSource = (
  source: ArtworkSource,
  convertPath: (path: string, protocol: string) => string = convertFileSrc
): ArtworkImageSource | undefined => {
  if (source.kind === 'path') return convertPath(source.path, 'nemora');
  if (source.kind === 'url') return source.url;
  if (source.kind === 'audio') return undefined;
  return source.blob;
};

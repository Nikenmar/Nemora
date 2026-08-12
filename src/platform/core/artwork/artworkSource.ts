import { convertFileSrc } from '@tauri-apps/api/core';

import type { ArtworkImageSource } from './imageTransform';

export type ArtworkSource =
  | { kind: 'path'; path: string }
  | { kind: 'url'; url: string }
  | { kind: 'blob'; blob: Blob };

export const pathArtwork = (path: string): ArtworkSource => ({ kind: 'path', path });
export const urlArtwork = (url: string): ArtworkSource => ({ kind: 'url', url });

/** Embedded metadata bytes stay inside the webview; they are not sent through invoke. */
export const embeddedArtwork = (bytes: Uint8Array, mimeType: string): ArtworkSource => ({
  kind: 'blob',
  blob: new Blob([bytes], { type: mimeType })
});

export const resolveArtworkSource = (
  source: ArtworkSource,
  convertPath: (path: string, protocol: string) => string = convertFileSrc
): ArtworkImageSource => {
  if (source.kind === 'path') return convertPath(source.path, 'nemora');
  if (source.kind === 'url') return source.url;
  return source.blob;
};

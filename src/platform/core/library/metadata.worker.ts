import { parseBuffer } from 'music-metadata';

import type {
  MetadataParseFailure,
  MetadataParseRequest,
  MetadataParseResponse
} from './metadataProtocol';
import type { ParsedAudioMetadata, ParsedPicture } from './types';

interface WorkerScope {
  onmessage: ((event: MessageEvent<MetadataParseRequest>) => void) | null;
  postMessage(message: MetadataParseResponse, transfer?: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

const copyPicture = (
  picture: { format: string; data: Uint8Array; description?: string; type?: string; name?: string },
  includeArtwork: boolean,
  transfers: Transferable[]
): ParsedPicture => {
  const result: ParsedPicture = {
    format: picture.format,
    description: picture.description,
    type: picture.type,
    name: picture.name,
    byteLength: picture.data.byteLength
  };
  if (includeArtwork) {
    const data = new Uint8Array(picture.data.byteLength);
    data.set(picture.data);
    result.data = data.buffer;
    transfers.push(data.buffer);
  }
  return result;
};

scope.onmessage = (event): void => {
  const request = event.data;
  void parseBuffer(new Uint8Array(request.head), undefined, { duration: false })
    .then((metadata) => {
      const transfers: Transferable[] = [];
      const result: ParsedAudioMetadata = {
        common: {
          title: metadata.common.title,
          artist: metadata.common.artist,
          albumArtist: metadata.common.albumartist,
          album: metadata.common.album,
          genres: metadata.common.genre ?? [],
          year: metadata.common.year,
          trackNumber: metadata.common.track.no ?? undefined,
          discNumber: metadata.common.disk.no ?? undefined
        },
        format: {
          container: metadata.format.container,
          codec: metadata.format.codec,
          duration: metadata.format.duration,
          sampleRate: metadata.format.sampleRate,
          bitrate: metadata.format.bitrate,
          numberOfChannels: metadata.format.numberOfChannels,
          lossless: metadata.format.lossless
        },
        pictures: (metadata.common.picture ?? []).map((picture) =>
          copyPicture(picture, request.includeArtwork, transfers)
        ),
        metadataCompleteness: 'head'
      };
      scope.postMessage({ id: request.id, ok: true, metadata: result }, transfers);
    })
    .catch((error: unknown) => {
      const serialized =
        error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : { name: 'Error', message: String(error) };
      const failure: MetadataParseFailure = {
        id: request.id,
        ok: false,
        error: serialized
      };
      scope.postMessage(failure);
    });
};

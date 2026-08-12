import type { ParsedAudioMetadata } from './types';

export interface MetadataParseRequest {
  id: number;
  path: string;
  head: ArrayBuffer;
  includeArtwork: boolean;
}

export interface MetadataParseSuccess {
  id: number;
  ok: true;
  metadata: ParsedAudioMetadata;
}

export interface MetadataParseFailure {
  id: number;
  ok: false;
  error: {
    name: string;
    message: string;
    stack?: string;
  };
}

export type MetadataParseResponse = MetadataParseSuccess | MetadataParseFailure;

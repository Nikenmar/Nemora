import { File as TagLibFile, ReadStyle } from 'node-taglib-sharp';

import { TagIoError } from './errors';
import { MemoryFileAbstraction } from './memoryFileAbstraction';

export type CandidateValidator = (path: string, contents: Uint8Array) => Promise<void>;

const parseAudioBuffer = async (path: string, contents: Uint8Array): Promise<void> => {
  const { parseBuffer } = await import('music-metadata');
  await parseBuffer(contents, { path, size: contents.byteLength });
};

const assertTagLibReadable = (path: string, contents: Uint8Array): void => {
  const abstraction = new MemoryFileAbstraction(path, contents);
  let file: TagLibFile | undefined;
  try {
    file = TagLibFile.createFromAbstraction(abstraction, undefined, ReadStyle.None);
    if (file.isPossiblyCorrupt) {
      throw new Error(file.corruptionReasons.join('; ') || 'TagLib marked the file as corrupt');
    }
  } finally {
    file?.dispose();
  }
};

/** Validates both the tag structure and the underlying audio container. */
export const validateTagLibCandidate: CandidateValidator = async (path, contents) => {
  try {
    assertTagLibReadable(path, contents);
    await parseAudioBuffer(path, contents);
  } catch (cause) {
    throw new TagIoError(
      'validation-failed',
      path,
      'candidate buffer did not parse; original file was not changed',
      cause
    );
  }
};

/** Container validation shared by the NodeID3 buffer transaction. */
export const validateAudioCandidate: CandidateValidator = async (path, contents) => {
  try {
    await parseAudioBuffer(path, contents);
  } catch (cause) {
    throw new TagIoError(
      'validation-failed',
      path,
      'candidate buffer did not parse; original file was not changed',
      cause
    );
  }
};

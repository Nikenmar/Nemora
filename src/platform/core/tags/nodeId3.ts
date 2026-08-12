import { Buffer } from 'buffer/';
import type NodeID3 from 'node-id3';

import { TagIoError } from './errors';
import { emitTagFileWritten } from './events';
import { commitTagFile, readTagFile, type TagFileIo, tauriTagFileIo } from './io';
import { withTagPathLock } from './pathLock';
import { validateAudioCandidate, type CandidateValidator } from './validation';

export type NodeId3WriteOptions = {
  io?: TagFileIo;
  nodeId3Options?: object;
  validate?: CandidateValidator;
};

type BufferFactory = { from(contents: Uint8Array): Uint8Array };

const runtimeBuffer = (): BufferFactory => {
  const runtime = globalThis as { Buffer?: BufferFactory };
  return runtime.Buffer ?? Buffer;
};

const asBuffer = (contents: Uint8Array): Uint8Array => runtimeBuffer().from(contents);

type NodeId3Api = {
  read(filebuffer: Uint8Array, options: object): NodeID3.Tags;
  update(tags: NodeID3.Tags, filebuffer: Uint8Array, options: object): Uint8Array;
};

const loadNodeId3 = async (): Promise<NodeId3Api> => {
  // node-id3's Buffer APIs are browser-safe, but the CommonJS package expects
  // Buffer to exist globally while its module is evaluated.
  const runtime = globalThis as { Buffer?: BufferFactory };
  runtime.Buffer ??= Buffer;
  const module = await import('node-id3');
  return (
    'default' in module ? (module as unknown as { default: NodeId3Api }).default : module
  ) as NodeId3Api;
};

/** Reads ID3 tags from a whole-file memory buffer; no Node fs path API is used. */
export async function readNodeId3Tags(
  path: string,
  nodeId3Options: object = {},
  io: TagFileIo = tauriTagFileIo
): Promise<NodeID3.Tags> {
  const contents = await readTagFile(path, io);
  try {
    const nodeId3 = await loadNodeId3();
    return nodeId3.read(asBuffer(contents), nodeId3Options);
  } catch (cause) {
    throw new TagIoError('parse-failed', path, 'NodeID3 buffer parse failed', cause);
  }
}

/** Whole-file NodeID3 transaction with parse-back validation and atomic commit. */
export function updateNodeId3Tags(
  path: string,
  tags: NodeID3.Tags,
  options: NodeId3WriteOptions = {}
): Promise<void> {
  const io = options.io ?? tauriTagFileIo;
  const validate = options.validate ?? validateAudioCandidate;
  return withTagPathLock(path, async () => {
    const original = await readTagFile(path, io);
    let candidate: Uint8Array;
    const nodeId3Options = options.nodeId3Options ?? {};
    try {
      const nodeId3 = await loadNodeId3();
      candidate = nodeId3.update(tags, asBuffer(original), nodeId3Options);
      nodeId3.read(candidate, nodeId3Options);
    } catch (cause) {
      throw new TagIoError(
        'mutation-failed',
        path,
        'NodeID3 buffer mutation or parse-back failed',
        cause
      );
    }

    await validate(path, candidate);
    await commitTagFile(path, candidate, io);
    emitTagFileWritten({ path, reason: 'node-id3-edit' });
  });
}

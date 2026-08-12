export type TagWriteReason = 'flac-picture-mime-heal' | 'taglib-edit' | 'node-id3-edit';

export type TagFileWrittenEvent = {
  path: string;
  reason: TagWriteReason;
};

export type TagFileWrittenListener = (event: TagFileWrittenEvent) => void;

const listeners = new Set<TagFileWrittenListener>();

/** The scanner can subscribe and suppress the next watcher event for this path. */
export function onTagFileWritten(listener: TagFileWrittenListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitTagFileWritten(event: TagFileWrittenEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // A watcher-suppression observer must never turn a committed write into a failure.
    }
  }
}

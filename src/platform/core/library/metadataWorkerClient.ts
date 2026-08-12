import type { MetadataParseRequest, MetadataParseResponse } from './metadataProtocol';
import type { MetadataParserPort, ParsedAudioMetadata } from './types';

interface PendingParse {
  resolve(metadata: ParsedAudioMetadata): void;
  reject(error: Error): void;
}

interface WorkerPort {
  onmessage: ((event: MessageEvent<MetadataParseResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: MetadataParseRequest, transfer: Transferable[]): void;
  terminate(): void;
}

export class MetadataWorkerClient implements MetadataParserPort {
  private readonly worker: WorkerPort;
  private readonly pending: Map<number, PendingParse>;
  private nextId: number;
  private terminated: boolean;

  constructor(worker: WorkerPort) {
    this.worker = worker;
    this.pending = new Map<number, PendingParse>();
    this.nextId = 1;
    this.terminated = false;
    worker.onmessage = (event) => this.handleMessage(event.data);
    worker.onerror = (event) => this.failAll(new Error(event.message));
  }

  parse(path: string, head: ArrayBuffer, includeArtwork = false): Promise<ParsedAudioMetadata> {
    if (this.terminated) return Promise.reject(new Error('Metadata worker is terminated.'));
    const id = this.nextId;
    this.nextId += 1;
    return new Promise<ParsedAudioMetadata>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.worker.postMessage({ id, path, head, includeArtwork }, [head]);
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  terminate(): void {
    if (this.terminated) return;
    this.terminated = true;
    this.worker.terminate();
    this.failAll(new Error('Metadata worker was terminated.'));
  }

  private handleMessage(response: MetadataParseResponse): void {
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);
    if (response.ok) pending.resolve(response.metadata);
    else {
      const error = new Error(response.error.message);
      error.name = response.error.name;
      if (response.error.stack) error.stack = response.error.stack;
      pending.reject(error);
    }
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}

export const createMetadataWorkerClient = (): MetadataWorkerClient =>
  new MetadataWorkerClient(
    new Worker(new URL('./metadata.worker.ts', import.meta.url), { type: 'module' })
  );

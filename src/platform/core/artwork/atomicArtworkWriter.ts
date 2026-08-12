import { invoke } from '@tauri-apps/api/core';

export interface ArtworkWriter {
  writeGenerated(path: string, contents: Blob): Promise<void>;
  copyExisting(source: string, destination: string): Promise<void>;
}

export type InvokeCommand = <T>(command: string, args: Record<string, unknown>) => Promise<T>;

/**
 * Generated canvas bytes are the deliberate exception to the path-only read
 * rule. Existing local files use copy_file_atomic and never cross IPC as bytes.
 */
export class TauriAtomicArtworkWriter implements ArtworkWriter {
  private readonly invokeCommand: InvokeCommand;

  constructor(invokeCommand: InvokeCommand = invoke) {
    this.invokeCommand = invokeCommand;
  }

  async writeGenerated(path: string, contents: Blob): Promise<void> {
    const bytes = new Uint8Array(await contents.arrayBuffer());
    await this.invokeCommand<void>('write_file_atomic', {
      path,
      contents: Array.from(bytes)
    });
  }

  async copyExisting(source: string, destination: string): Promise<void> {
    await this.invokeCommand<void>('copy_file_atomic', { source, destination });
  }
}

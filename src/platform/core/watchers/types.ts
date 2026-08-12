export type WatchEventKind =
  | 'any'
  | 'other'
  | { access: unknown }
  | { create: unknown }
  | { modify: unknown }
  | { remove: unknown };

export interface WatchEvent {
  type: WatchEventKind;
  paths: string[];
  attrs: unknown;
}

export type Unwatch = () => void;

export interface WatchOptions {
  recursive?: boolean;
  delayMs?: number;
  immediate?: boolean;
}

export interface WatcherFileSystemPort {
  exists(path: string): Promise<boolean>;
  watch(
    paths: string | string[],
    callback: (event: WatchEvent) => void,
    options?: WatchOptions
  ): Promise<Unwatch>;
}

export interface LibraryWatcherRepository {
  getMusicFolders(): readonly FolderStructure[];
  getKnownSongPaths(): readonly string[];
  scanSong(path: string): Promise<void>;
  removeSongs(paths: readonly string[]): Promise<void>;
  reconcileFolder(path: string): Promise<void>;
  reportWatcherError(error: unknown, path?: string): void;
}

export interface DirectoryEntry {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
  isSymlink: boolean;
}

export interface FileStats {
  isFile: boolean;
  isDirectory: boolean;
  size: number;
  mtime: Date | null;
  birthtime: Date | null;
}

export interface LibraryFileSystemPort {
  readDir(path: string): Promise<DirectoryEntry[]>;
  stat(path: string): Promise<FileStats>;
  readHead(path: string, length: number): Promise<Uint8Array>;
}

export interface ParsedPicture {
  format: string;
  description?: string;
  type?: string;
  name?: string;
  byteLength: number;
  data?: ArrayBuffer;
}

export interface ParsedAudioMetadata {
  common: {
    title?: string;
    artist?: string;
    albumArtist?: string;
    album?: string;
    genres: string[];
    year?: number;
    trackNumber?: number;
    discNumber?: number;
  };
  format: {
    container?: string;
    codec?: string;
    duration?: number;
    sampleRate?: number;
    bitrate?: number;
    numberOfChannels?: number;
    lossless?: boolean;
  };
  pictures: ParsedPicture[];
  metadataCompleteness: 'head';
}

export interface MetadataParserPort {
  parse(path: string, head: ArrayBuffer, includeArtwork?: boolean): Promise<ParsedAudioMetadata>;
}

export interface ScannedLibraryTrack {
  path: string;
  size: number;
  createdDate?: number;
  modifiedDate?: number;
  metadata: ParsedAudioMetadata;
}

export interface ScanFailure {
  path: string;
  error: unknown;
}

export interface LibraryScanProgress {
  completed: number;
  total: number;
  failed: number;
}

export interface LibraryRepository {
  getKnownSongPaths(): readonly string[];
  commitFolderStructures(structures: FolderStructure[]): Promise<void> | void;
  commitScanBatch(tracks: readonly ScannedLibraryTrack[]): Promise<void> | void;
  reportScanProgress(progress: LibraryScanProgress): void;
}

export interface TraversalResult {
  structures: FolderStructure[];
  songPaths: string[];
  visitedDirectories: string[];
}

export interface LibraryScanResult extends TraversalResult {
  scanned: number;
  skipped: number;
  failures: ScanFailure[];
}

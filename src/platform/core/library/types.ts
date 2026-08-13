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
  /**
   * `head` was parsed from the first 256 KB; `file` came from a host that
   * opened the file itself and is not subject to that limit.
   */
  metadataCompleteness: 'head' | 'file';
}

/** One directory as the host found it, with its immediate children. */
export interface WalkedDirectory {
  path: string;
  /** Epoch milliseconds, absent when the platform does not report it. */
  modified?: number;
  created?: number;
  directories: string[];
  files: string[];
}

export interface NativeParsedFile {
  path: string;
  size: number;
  createdDate?: number;
  modifiedDate?: number;
  common: ParsedAudioMetadata['common'];
  format: ParsedAudioMetadata['format'];
  /** Never carries bytes: the cover is read from the audio file when needed. */
  pictures: { format: string; byteLength: number }[];
  /** Present instead of the rest when this one file could not be read. */
  error?: string;
}

/**
 * A host that can walk and parse the library itself.
 *
 * Entirely optional, and absent on every host without file access - the
 * TypeScript walk and the head parse remain complete and are what a browser or
 * the Android port uses. What it removes is per-file traffic across the bridge:
 * one `stat` and one 256 KB read each, replaced by one call per directory tree
 * and one per batch.
 */
export interface NativeLibraryPort {
  /**
   * Both methods answer `undefined` for "I cannot do this", which the caller
   * treats as a cue to use the TypeScript route rather than as a failure. That
   * is what keeps a build without these commands, or one that lost them
   * mid-scan, scanning normally instead of scanning nothing.
   */
  walk(
    roots: readonly string[],
    extensions: readonly string[]
  ): Promise<WalkedDirectory[] | undefined>;
  parse(paths: readonly string[]): Promise<NativeParsedFile[] | undefined>;
}

export interface AudioStreamProperties {
  duration?: number;
  sampleRate?: number;
  bitrate?: number;
  numberOfChannels?: number;
}

export interface MetadataParserPort {
  parse(path: string, head: ArrayBuffer, includeArtwork?: boolean): Promise<ParsedAudioMetadata>;
  /**
   * The stream's shape read from the file itself rather than from a head.
   *
   * Optional because only a host with file access can answer it; the scanner
   * asks only when a head parse came back with no duration, which happens when
   * the first audio frame lies past the head. Returning `undefined` means "no
   * better answer available" and leaves the parsed metadata as it was.
   */
  properties?(path: string): Promise<AudioStreamProperties | undefined>;
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

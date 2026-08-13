import type { ArtworkService } from '../core/artwork';
import type { PaletteGenerator } from '../core/artwork/palette';
import type {
  LibraryFileSystemPort,
  MetadataParserPort,
  NativeLibraryPort
} from '../core/library/types';
import type { NoraImportPort } from '../core/import/noraImportRepository';
import type { MetadataFilePort } from '../core/metadata';
import type { Tags } from 'node-id3';
import type {
  EmbeddedLyricsTags,
  EmbeddedLyricsWrite,
  UnsyncedLyricsHit
} from '../core/lyrics/repository';
import type { WatcherFileSystemPort } from '../core/watchers/types';
import type { SecondInstanceRoutes } from '../shell/singleInstance';

export interface RuntimeSingleInstanceController {
  markRendererReady(): Promise<void>;
  stop(): void;
}

export interface RuntimeSingleInstanceService {
  create(routes: SecondInstanceRoutes): Promise<RuntimeSingleInstanceController>;
}

export interface RuntimeFileServices {
  profilePath(...segments: string[]): Promise<string>;
  readTextFile(path: string): Promise<string>;
  readDir(path: string): Promise<{ name: string; isDirectory: boolean }[]>;
  writeTextFileAtomic(path: string, contents: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  makeDir(path: string, options?: { recursive?: boolean }): Promise<{ exist: boolean }>;
  copyFile(source: string, destination: string): Promise<void>;
  remove(path: string, options?: { recursive?: boolean }): Promise<void>;
}

export interface RuntimeDiscordActivity {
  details?: string;
  state?: string;
  largeImage?: string;
  largeText?: string;
  smallImage?: string;
  smallText?: string;
  startTimestamp?: number;
  endTimestamp?: number;
}

export interface RuntimeDiskCapacity {
  totalBytes: number;
  freeBytes: number;
}

/** Native operations used by the legacy application shell channels. */
export interface RuntimeSystemServices {
  revealSong(path: string): Promise<void>;
  revealFolder(path: string): Promise<void>;
  openLogFile(): Promise<void>;
  directorySize(path: string): Promise<number>;
  diskCapacity(path: string): Promise<RuntimeDiskCapacity>;
  pathsShareVolume(first: string, second: string): Promise<boolean>;
  applicationDirectory(): Promise<string>;
  toggleAutoLaunch(enabled: boolean): Promise<void>;
  openDevTools(): Promise<void>;
  setDisplaySleepInhibited(inhibited: boolean): Promise<void>;
}

export interface RuntimeServices {
  artwork?: ArtworkService;
  palette?: PaletteGenerator;
  files?: RuntimeFileServices;
  /**
   * Decrypts a stored service credential (Last.fm session key, Musixmatch
   * token) encrypted by `core/secrets`. Async: Web Crypto has no synchronous
   * decrypt.
   */
  decrypt?: (encrypted: string) => Promise<string>;
  getSongsOutsideLibrary?: () => AudioPlayerData[];
  readEmbeddedLyrics?: (path: string) => Promise<EmbeddedLyricsTags>;
  readSongTags?: (path: string) => Promise<Tags>;
  writeEmbeddedLyrics?: (path: string, tags: EmbeddedLyricsWrite) => Promise<void>;
  searchUnsyncedLyrics?: (query: string) => Promise<UnsyncedLyricsHit | undefined>;
  restartApp?: (reason: string, force?: boolean) => void;
  /**
   * Builds the I/O facade the Nora import runs on. A factory rather than a
   * ready-made port so the Tauri plugins it binds are only touched when an
   * import actually starts.
   */
  createNoraImportPort?: () => NoraImportPort;
  discordClientId?: string;
  setDiscordActivity?: (clientId: string, activity: RuntimeDiscordActivity) => Promise<void>;
  disconnectDiscord?: () => Promise<void>;
  libraryFileSystem?: LibraryFileSystemPort;
  /**
   * Backs the library folder watcher. Optional like the rest: without it the
   * watcher simply never starts, which is what every non-Tauri consumer of the
   * shared core wants.
   */
  watcherFileSystem?: WatcherFileSystemPort;
  metadataParser?: MetadataParserPort;
  /**
   * A host that walks and parses the library itself. Optional like everything
   * here: without it the scanner reads directories and file heads through
   * `libraryFileSystem`, which is what the shared core does everywhere else.
   */
  nativeLibrary?: NativeLibraryPort;
  metadata?: MetadataFilePort;
  selectMusicFolders?: () => Promise<string[]>;
  romanizeForSearch?: (value: string) => string | undefined;
  permanentlyDeleteFile?: (path: string) => Promise<void>;
  moveFileToTrash?: (path: string) => Promise<void>;
  removeDuelQueueReferences?: (songIds: readonly string[]) => void;
  singleInstance?: RuntimeSingleInstanceService;
  system?: RuntimeSystemServices;
}

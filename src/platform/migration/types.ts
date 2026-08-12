export const LOCAL_STORAGE_KEYS = ['version', 'localStorage', 'nora_song_guessr'] as const;

export type LocalStorageKey = (typeof LOCAL_STORAGE_KEYS)[number];

export type LocalStorageValues = Record<LocalStorageKey, string | null>;

export type MigrationSourceKind = 'bridge' | 'leveldb';

export interface MigrationMarker {
  formatVersion: 1;
  source: MigrationSourceKind;
  sourceHashes: Record<string, string>;
  destinationChecksums: Record<LocalStorageKey, string>;
  completedAt: string;
}

export type MigrationResult =
  | { status: 'new-install' }
  | { status: 'migrated'; marker: MigrationMarker }
  | { status: 'already-migrated'; marker: MigrationMarker };

export class LocalStorageMigrationError extends Error {
  readonly cause: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.cause = cause;
    this.name = 'LocalStorageMigrationError';
  }
}

export class LocalStorageRecoveryError extends LocalStorageMigrationError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'LocalStorageRecoveryError';
  }
}

export interface FileEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
}

export interface FileMetadata {
  size: number;
  mtimeMs: number | null;
}

export interface MigrationFileSystem {
  exists(path: string): Promise<boolean>;
  readText(path: string): Promise<string>;
  readBinary(path: string): Promise<Uint8Array>;
  readDirectory(path: string): Promise<FileEntry[]>;
  metadata(path: string): Promise<FileMetadata>;
  copyFile(source: string, destination: string): Promise<void>;
  createDirectory(path: string): Promise<void>;
  removeDirectory(path: string): Promise<void>;
  join(...parts: string[]): Promise<string>;
}

export interface MigrationStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface MigrationPaths {
  bridgeExport(): Promise<string>;
  marker(): Promise<string>;
  legacyLevelDb(): Promise<string>;
  createSnapshotDirectory(): Promise<string>;
}

export interface MigrationDependencies {
  fileSystem: MigrationFileSystem;
  paths: MigrationPaths;
  storage: MigrationStorage;
  atomicWrite(path: string, contents: Uint8Array): Promise<void>;
  sha256(contents: Uint8Array): Promise<string>;
  now(): Date;
}

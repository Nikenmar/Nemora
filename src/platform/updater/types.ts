export type UpdateDownloadEvent =
  | { event: 'Started'; data: { contentLength?: number } }
  | { event: 'Progress'; data: { chunkLength: number } }
  | { event: 'Finished' };

export interface AvailableUpdate {
  currentVersion: string;
  version: string;
  date?: string;
  body?: string;
  downloadAndInstall(onEvent?: (event: UpdateDownloadEvent) => void): Promise<void>;
  close(): Promise<void>;
}

export interface UpdaterLogger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

export interface UpdateProgress {
  downloadedBytes: number;
  totalBytes?: number;
  percent?: number;
  finished: boolean;
}

export interface UpdaterDependencies {
  check(): Promise<AvailableUpdate | null>;
  confirm(update: AvailableUpdate): Promise<boolean>;
  relaunch(): Promise<void>;
  logger: UpdaterLogger;
  onProgress?(progress: UpdateProgress): void;
}

export type UpdateCheckStatus =
  | 'skipped-development'
  | 'busy'
  | 'up-to-date'
  | 'declined'
  | 'installed'
  | 'failed';

export interface UpdateCheckResult {
  status: UpdateCheckStatus;
  version?: string;
  error?: unknown;
}

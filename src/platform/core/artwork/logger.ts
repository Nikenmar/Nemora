export interface ArtworkLogger {
  debug(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

export const silentArtworkLogger: ArtworkLogger = {
  debug: () => undefined,
  warn: () => undefined,
  error: () => undefined
};

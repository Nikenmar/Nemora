export interface SongGuessrLogger {
  error(message: string, data?: Record<string, unknown>): void;
}

const silentLogger: SongGuessrLogger = {
  error: () => undefined
};

let activeLogger: SongGuessrLogger = silentLogger;

/** Replaces the active logger. Passing undefined restores the silent default. */
export function configureLogger(logger: SongGuessrLogger | undefined): void {
  activeLogger = logger ?? silentLogger;
}

export const logger: SongGuessrLogger = {
  error: (message, data) => activeLogger.error(message, data)
};

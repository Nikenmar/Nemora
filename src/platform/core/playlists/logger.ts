/**
 * Minimal logger seam for the ported core.
 *
 * The Electron code logged through Winston in the main process; a renderer-owned
 * core must not import that. These functions stay callable in every environment
 * (tests, Tauri renderer) and are silent until the api-bridge wires a real
 * implementation through {@link configureLogger}.
 */

export interface CoreLogger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

const silentLogger: CoreLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
};

let activeLogger: CoreLogger = silentLogger;

/** Replaces the active logger. Passing undefined restores the silent default. */
export function configureLogger(logger: CoreLogger | undefined): void {
  activeLogger = logger ?? silentLogger;
}

export const logger: CoreLogger = {
  debug: (message, data) => activeLogger.debug(message, data),
  info: (message, data) => activeLogger.info(message, data),
  warn: (message, data) => activeLogger.warn(message, data),
  error: (message, data) => activeLogger.error(message, data)
};

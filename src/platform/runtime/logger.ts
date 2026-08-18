/**
 * The runtime's own logger seam.
 *
 * The runtime is where the library is scanned, where listening history and
 * rankings are reattached to a rebuilt library, and where a store write fails -
 * that is, where the answers live when someone asks "did it actually do it?".
 * All of it used to go to `console` alone: visible in devtools if you happened
 * to be watching, and absent from `Nemora.log` entirely.
 *
 * That gap cost real time. A folder was removed and re-added to check that duel
 * ratings and tierlist placements came back, and the log had nothing to say
 * either way - the lines announcing exactly that were written to a console
 * nobody was reading. The core modules got this seam on 2026-08-16
 * (`wireCoreLoggers`); the runtime was left out of it.
 *
 * The default keeps writing to the console, so tests and any host that never
 * calls {@link configureLogger} behave as before.
 */

export interface RuntimeLogger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

const consoleLogger: RuntimeLogger = {
  debug: (message, data) => console.debug(message, data),
  info: (message, data) => console.info(message, data),
  warn: (message, data) => console.warn(message, data),
  error: (message, data) => console.error(message, data)
};

let activeLogger: RuntimeLogger = consoleLogger;

/** Replaces the active logger. Passing undefined restores the console default. */
export function configureLogger(logger: RuntimeLogger | undefined): void {
  activeLogger = logger ?? consoleLogger;
}

export const logger: RuntimeLogger = {
  debug: (message, data) => activeLogger.debug(message, data),
  info: (message, data) => activeLogger.info(message, data),
  warn: (message, data) => activeLogger.warn(message, data),
  error: (message, data) => activeLogger.error(message, data)
};

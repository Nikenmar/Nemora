import { error as logError, info as logInfo, warn as logWarn } from '@tauri-apps/plugin-log';
import { relaunch } from '@tauri-apps/plugin-process';

import { getRuntime } from '../runtime';

const loggers: Record<Lowercase<LogMessageTypes>, (message: string) => Promise<void>> = {
  error: logError,
  info: logInfo,
  warn: logWarn
};

export const log = {
  sendLogs: async (
    message: string | Error,
    data?: Record<string, unknown>,
    logToConsoleType: LogMessageTypes = 'INFO',
    forceWindowRestart = false,
    forceMainRestart = false
  ): Promise<unknown> => {
    const text = typeof message === 'string' ? message : message.message;
    const details = data ? ` ${JSON.stringify(data)}` : '';
    await loggers[logToConsoleType.toLowerCase() as Lowercase<LogMessageTypes>](
      `${text}${details}`
    );
    if (forceWindowRestart) window.location.reload();
    if (forceMainRestart) await relaunch();
    return undefined;
  },
  openLogFile: (): void => {
    void getRuntime()
      .openLogFile()
      .catch((error: unknown) => console.error('Failed to open Nora log file.', error));
  }
};

import { ask } from '@tauri-apps/plugin-dialog';
import { relaunch } from '@tauri-apps/plugin-process';
import { check } from '@tauri-apps/plugin-updater';

import { persistSessionBeforeQuit } from '../api/window-controls';
import type { UpdateProgress, UpdaterLogger } from './types';
import { UpdaterClient } from './updaterClient';

const silentLogger: UpdaterLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
};

export interface TauriUpdaterOptions {
  isDevelopment: boolean;
  logger?: UpdaterLogger;
  onProgress?(progress: UpdateProgress): void;
}

/**
 * The update endpoint and the app version live in src-tauri/tauri.conf.json
 * (plugins.updater.endpoints and the top-level version) and are read by the
 * Tauri runtime, not duplicated here: `check` resolves the configured
 * endpoint and reports `currentVersion` from the installed app. Repointing
 * the feed or bumping the version only ever touches the Tauri config.
 */
export function createTauriUpdater(options: TauriUpdaterOptions): UpdaterClient {
  return new UpdaterClient(
    {
      check,
      confirm: (update) =>
        ask(
          `A new version of Nemora is available: v${update.version}\n\n` +
            `You are on v${update.currentVersion}. Nemora will download the update, close, ` +
            'install it, and reopen automatically.',
          {
            title: 'Update available',
            kind: 'info',
            okLabel: 'Update now',
            cancelLabel: 'Later'
          }
        ),
      // The installer closes the app and reopens it, and that route never passes
      // through the window, so the renderer would otherwise lose the playback
      // position and the repeat/shuffle state to an update the user accepted.
      relaunch: async () => {
        await persistSessionBeforeQuit();
        await relaunch();
      },
      logger: options.logger ?? silentLogger,
      onProgress: options.onProgress
    },
    { isDevelopment: options.isDevelopment }
  );
}

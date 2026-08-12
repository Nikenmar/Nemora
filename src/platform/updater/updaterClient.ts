import type {
  AvailableUpdate,
  UpdateCheckResult,
  UpdateDownloadEvent,
  UpdateProgress,
  UpdaterDependencies
} from './types';
import { compareVersions } from './version';

export interface UpdaterClientOptions {
  isDevelopment: boolean;
}

const progressFromEvent = (
  event: UpdateDownloadEvent,
  downloadedBytes: number,
  totalBytes?: number
): UpdateProgress => {
  const finished = event.event === 'Finished';
  const percent =
    totalBytes && totalBytes > 0
      ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100))
      : finished
        ? 100
        : undefined;
  return { downloadedBytes, totalBytes, percent, finished };
};

/** Consent-first updater policy, independent of any real Tauri runtime. */
export class UpdaterClient {
  private readonly dependencies: UpdaterDependencies;
  private readonly options: UpdaterClientOptions;
  private handlingUpdate = false;

  constructor(dependencies: UpdaterDependencies, options: UpdaterClientOptions) {
    this.dependencies = dependencies;
    this.options = options;
  }

  async checkForUpdates(): Promise<UpdateCheckResult> {
    const { logger } = this.dependencies;
    if (this.options.isDevelopment) {
      logger.info('Skipping update check in development.');
      return { status: 'skipped-development' };
    }
    if (this.handlingUpdate) return { status: 'busy' };

    this.handlingUpdate = true;
    let update: AvailableUpdate | null = null;
    let candidateVersion: string | undefined;
    try {
      update = await this.dependencies.check();
      if (!update) {
        logger.info('No updates available. App is up-to-date.');
        return { status: 'up-to-date' };
      }
      candidateVersion = update.version;

      const comparison = compareVersions(update.version, update.currentVersion);
      if (comparison === 'invalid') {
        logger.error('Updater returned a malformed version; reporting the check as failed.', {
          currentVersion: update.currentVersion,
          candidateVersion: update.version
        });
        return {
          status: 'failed',
          error: new Error(`Updater returned a malformed version: "${update.version}".`),
          version: update.version
        };
      }

      if (comparison !== 'newer') {
        logger.warn('Updater returned a version that is not newer; ignoring it.', {
          currentVersion: update.currentVersion,
          candidateVersion: update.version
        });
        return { status: 'up-to-date', version: update.version };
      }

      logger.info('Update available.', { version: update.version });
      const accepted = await this.dependencies.confirm(update);
      if (!accepted) {
        logger.info('Update postponed by the user.', { version: update.version });
        return { status: 'declined', version: update.version };
      }

      let downloadedBytes = 0;
      let totalBytes: number | undefined;
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          downloadedBytes = 0;
          totalBytes = event.data.contentLength;
        } else if (event.event === 'Progress') {
          downloadedBytes += event.data.chunkLength;
        } else if (totalBytes !== undefined) {
          downloadedBytes = totalBytes;
        }

        const progress = progressFromEvent(event, downloadedBytes, totalBytes);
        logger.debug('Downloading update.', {
          downloadedBytes: progress.downloadedBytes,
          totalBytes: progress.totalBytes,
          percent: progress.percent,
          finished: progress.finished
        });
        this.dependencies.onProgress?.(progress);
      });

      logger.info('Update installed. Relaunching Nemora.', { version: update.version });
      await this.closeUpdate(update);
      update = null;
      await this.dependencies.relaunch();
      return { status: 'installed', version: candidateVersion };
    } catch (error) {
      logger.error('Update failed.', { error });
      return { status: 'failed', error, version: candidateVersion };
    } finally {
      if (update) await this.closeUpdate(update);
      this.handlingUpdate = false;
    }
  }

  private async closeUpdate(update: AvailableUpdate): Promise<void> {
    try {
      await update.close();
    } catch (error) {
      this.dependencies.logger.warn('Failed to release updater resource.', { error });
    }
  }
}

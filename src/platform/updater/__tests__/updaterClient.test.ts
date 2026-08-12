import type {
  AvailableUpdate,
  UpdateDownloadEvent,
  UpdaterDependencies,
  UpdaterLogger
} from '../types';
import { UpdaterClient } from '../updaterClient';

const logger: UpdaterLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
};

const makeUpdate = (overrides: Partial<AvailableUpdate> = {}): AvailableUpdate => ({
  currentVersion: '1.0.0-stable',
  version: '1.0.1-stable',
  downloadAndInstall: jest.fn(async (onEvent?: (event: UpdateDownloadEvent) => void) => {
    onEvent?.({ event: 'Started', data: { contentLength: 100 } });
    onEvent?.({ event: 'Progress', data: { chunkLength: 40 } });
    onEvent?.({ event: 'Progress', data: { chunkLength: 60 } });
    onEvent?.({ event: 'Finished' });
  }),
  close: jest.fn(async () => undefined),
  ...overrides
});

const makeDependencies = (
  update: AvailableUpdate | null,
  accepted = true
): UpdaterDependencies => ({
  check: jest.fn(async () => update),
  confirm: jest.fn(async () => accepted),
  relaunch: jest.fn(async () => undefined),
  logger,
  onProgress: jest.fn()
});

beforeEach(() => jest.clearAllMocks());

describe('UpdaterClient consent policy', () => {
  test('skips development without contacting the updater', async () => {
    const dependencies = makeDependencies(makeUpdate());
    const client = new UpdaterClient(dependencies, { isDevelopment: true });

    await expect(client.checkForUpdates()).resolves.toEqual({ status: 'skipped-development' });
    expect(dependencies.check).not.toHaveBeenCalled();
  });

  test('reports up-to-date when check returns no update', async () => {
    const dependencies = makeDependencies(null);
    const client = new UpdaterClient(dependencies, { isDevelopment: false });

    await expect(client.checkForUpdates()).resolves.toEqual({ status: 'up-to-date' });
    expect(dependencies.confirm).not.toHaveBeenCalled();
  });

  test('never downloads before consent and asks again after a decline', async () => {
    const update = makeUpdate();
    const dependencies = makeDependencies(update, false);
    const client = new UpdaterClient(dependencies, { isDevelopment: false });

    await expect(client.checkForUpdates()).resolves.toEqual({
      status: 'declined',
      version: '1.0.1-stable'
    });
    await client.checkForUpdates();

    expect(dependencies.confirm).toHaveBeenCalledTimes(2);
    expect(update.downloadAndInstall).not.toHaveBeenCalled();
    expect(dependencies.relaunch).not.toHaveBeenCalled();
    expect(update.close).toHaveBeenCalledTimes(2);
  });

  test('downloads only after consent, reports progress, installs, then relaunches', async () => {
    const order: string[] = [];
    const update = makeUpdate({
      downloadAndInstall: jest.fn(async (onEvent?: (event: UpdateDownloadEvent) => void) => {
        order.push('download-and-install');
        onEvent?.({ event: 'Started', data: { contentLength: 100 } });
        onEvent?.({ event: 'Progress', data: { chunkLength: 25 } });
        onEvent?.({ event: 'Finished' });
      }),
      close: jest.fn(async () => {
        order.push('close');
      })
    });
    const dependencies = makeDependencies(update, true);
    dependencies.confirm = jest.fn(async () => {
      order.push('confirm');
      return true;
    });
    dependencies.relaunch = jest.fn(async () => {
      order.push('relaunch');
    });
    const client = new UpdaterClient(dependencies, { isDevelopment: false });

    await expect(client.checkForUpdates()).resolves.toEqual({
      status: 'installed',
      version: '1.0.1-stable'
    });

    expect(order).toEqual(['confirm', 'download-and-install', 'close', 'relaunch']);
    expect(dependencies.onProgress).toHaveBeenLastCalledWith({
      downloadedBytes: 100,
      totalBytes: 100,
      percent: 100,
      finished: true
    });
  });

  test('locks out concurrent checks and unlocks after failure', async () => {
    let releaseCheck = (): void => undefined;
    const blocked = new Promise<AvailableUpdate | null>((resolve) => {
      releaseCheck = () => resolve(null);
    });
    const dependencies = makeDependencies(null);
    dependencies.check = jest.fn(() => blocked);
    const client = new UpdaterClient(dependencies, { isDevelopment: false });

    const first = client.checkForUpdates();
    await expect(client.checkForUpdates()).resolves.toEqual({ status: 'busy' });
    releaseCheck();
    await expect(first).resolves.toEqual({ status: 'up-to-date' });

    dependencies.check = jest.fn(async () => {
      throw new Error('offline');
    });
    await expect(client.checkForUpdates()).resolves.toMatchObject({ status: 'failed' });
    await client.checkForUpdates();
    expect(dependencies.check).toHaveBeenCalledTimes(2);
  });

  test('ignores a non-newer update returned by a misconfigured endpoint', async () => {
    const update = makeUpdate({ version: '1.0.0-stable' });
    const dependencies = makeDependencies(update);
    const client = new UpdaterClient(dependencies, { isDevelopment: false });

    await expect(client.checkForUpdates()).resolves.toEqual({
      status: 'up-to-date',
      version: '1.0.0-stable'
    });
    expect(dependencies.confirm).not.toHaveBeenCalled();
    expect(update.close).toHaveBeenCalledTimes(1);
  });

  test('reports a malformed candidate version as a failed check, never up-to-date', async () => {
    const update = makeUpdate({ version: 'not-a-version' });
    const dependencies = makeDependencies(update);
    const client = new UpdaterClient(dependencies, { isDevelopment: false });

    const result = await client.checkForUpdates();

    expect(result.status).toBe('failed');
    expect(result.error).toBeInstanceOf(Error);
    expect(result.version).toBe('not-a-version');
    expect(dependencies.confirm).not.toHaveBeenCalled();
    expect(update.downloadAndInstall).not.toHaveBeenCalled();
    expect(update.close).toHaveBeenCalledTimes(1);
  });

  test('reports an unreachable server as a failed check, never up-to-date', async () => {
    const dependencies = makeDependencies(null);
    dependencies.check = jest.fn(async () => {
      throw new Error('network unreachable');
    });
    const client = new UpdaterClient(dependencies, { isDevelopment: false });

    const result = await client.checkForUpdates();

    expect(result.status).toBe('failed');
    expect(result.error).toBeInstanceOf(Error);
    expect(result.version).toBeUndefined();
    expect(dependencies.logger.error).toHaveBeenCalled();
  });
});

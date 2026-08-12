import { beforeEach, describe, expect, jest, test } from '@jest/globals';

const revealSong = jest.fn<(songId: string) => Promise<void>>();
const revealFolder = jest.fn<(path: string) => Promise<void>>();
const openLogFile = jest.fn<() => Promise<void>>();
const getStorageUsage = jest.fn<(force?: boolean) => Promise<StorageMetrics | undefined>>();
const stopScreenSleeping = jest.fn<() => Promise<void>>();
const allowScreenSleeping = jest.fn<() => Promise<void>>();

jest.mock('../../runtime', () => ({
  getRuntime: () => ({
    revealSongInFileExplorer: revealSong,
    revealFolderInFileExplorer: revealFolder,
    openLogFile,
    getStorageUsage,
    stopScreenSleeping,
    allowScreenSleeping
  })
}));

jest.mock('@tauri-apps/plugin-log', () => ({
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn()
}));
jest.mock('@tauri-apps/plugin-process', () => ({ relaunch: jest.fn() }));
jest.mock('@tauri-apps/plugin-dialog', () => ({ open: jest.fn() }));
jest.mock('@tauri-apps/plugin-shell', () => ({ open: jest.fn() }));

import { appControls } from '../app-controls';
import { folderData } from '../folder-data';
import { log } from '../log';
import { songUpdates } from '../song-updates';
import { storageData } from '../storage-data';

beforeEach(() => {
  jest.clearAllMocks();
  revealSong.mockResolvedValue();
  revealFolder.mockResolvedValue();
  openLogFile.mockResolvedValue();
  getStorageUsage.mockResolvedValue(undefined);
  stopScreenSleeping.mockResolvedValue();
  allowScreenSleeping.mockResolvedValue();
});

describe('native shell API wiring', () => {
  test('forwards both Explorer-selection channels without changing their void API', () => {
    expect(songUpdates.revealSongInFileExplorer('song-id')).toBeUndefined();
    expect(folderData.revealFolderInFileExplorer('E:\\Music')).toBeUndefined();
    expect(revealSong).toHaveBeenCalledWith('song-id');
    expect(revealFolder).toHaveBeenCalledWith('E:\\Music');
  });

  test('forwards log and screen-sleep fire-and-forget channels', () => {
    expect(log.openLogFile()).toBeUndefined();
    expect(appControls.stopScreenSleeping()).toBeUndefined();
    expect(appControls.allowScreenSleeping()).toBeUndefined();

    expect(openLogFile).toHaveBeenCalledTimes(1);
    expect(stopScreenSleeping).toHaveBeenCalledTimes(1);
    expect(allowScreenSleeping).toHaveBeenCalledTimes(1);
  });

  test('preserves the storage Promise result', async () => {
    const metrics = { totalSize: 42 } as StorageMetrics;
    getStorageUsage.mockResolvedValue(metrics);

    await expect(storageData.getStorageUsage(true)).resolves.toBe(metrics);
    expect(getStorageUsage).toHaveBeenCalledWith(true);
  });
});

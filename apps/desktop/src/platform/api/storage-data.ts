import { getRuntime } from '../runtime';

export const storageData = {
  getStorageUsage: (forceRefresh?: boolean): Promise<StorageMetrics | undefined> =>
    getRuntime().getStorageUsage(forceRefresh)
};

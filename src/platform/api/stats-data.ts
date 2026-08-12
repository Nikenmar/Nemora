import { getRuntime } from '../runtime';

export const statsData = {
  getStatsData: async (timeRange: StatsTimeRange): Promise<StatsData> =>
    getRuntime().getStats(timeRange),
  exportStatsData: (options?: {
    tierShuffleIntensity?: number;
  }): Promise<{ success: boolean; message?: string }> => getRuntime().exportStats(options),
  importStatsData: (
    mergeMode: StatsMergeMode,
    source: StatsImportSource
  ): Promise<StatsImportReport> => getRuntime().importStats(mergeMode, source)
};

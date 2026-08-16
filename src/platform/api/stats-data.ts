import { getRuntime } from '../runtime';
import type { RecapPeriod, RecapSlide } from '../core/stats/recap';

export const statsData = {
  getStatsData: async (timeRange: StatsTimeRange): Promise<StatsData> =>
    getRuntime().getStats(timeRange),
  exportStatsData: (options?: {
    tierShuffleIntensity?: number;
  }): Promise<{ success: boolean; message?: string }> => getRuntime().exportStats(options),
  /** Recap slides for one month or one year, ready to render. */
  getRecap: async (period: RecapPeriod): Promise<RecapSlide[]> => getRuntime().getRecap(period),
  importStatsData: (
    mergeMode: StatsMergeMode,
    source: StatsImportSource
  ): Promise<StatsImportReport> => getRuntime().importStats(mergeMode, source)
};

import { useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import useMeasuredWidth from '../../hooks/useMeasuredWidth';

type Bucket = { key: string; label: string; listens: number };

type PatternChartProps = {
  title: string;
  buckets: Bucket[];
  /** Bars never grow past this, so a seven-bucket chart does not turn into seven slabs. */
  maxBarWidth: number;
  footer?: string;
};

/** Rough width of one character at `text-xs`, used to decide how many labels fit. */
const LABEL_CHAR_PX = 7;
const LABEL_PADDING_PX = 10;
/** However wide the card gets, a bar stops being a bar past this. */
const WIDEST_BAR_PX = 64;

const PatternChart = ({ title, buckets, maxBarWidth, footer }: PatternChartProps) => {
  const { t } = useTranslation();
  const plotRef = useRef<HTMLDivElement>(null);
  const width = useMeasuredWidth(plotRef);

  const total = buckets.reduce((sum, bucket) => sum + bucket.listens, 0);
  /** Never reduce an empty array here: a malformed payload must not take the page down. */
  const peak = useMemo(
    () =>
      buckets.reduce(
        (best, bucket) => (bucket.listens > best.listens ? bucket : best),
        buckets[0] ?? { key: 'none', label: '', listens: 0 }
      ),
    [buckets]
  );

  /**
   * Every label, every second one, or every fourth: a truncated "12 A..." helps
   * nobody, so labels thin out instead of shrinking.
   */
  const labelEvery = useMemo(() => {
    const perBucket = width / buckets.length;
    if (!width) return 1;

    const longest = buckets.reduce((max, bucket) => Math.max(max, bucket.label.length), 0);
    const needed = longest * LABEL_CHAR_PX + LABEL_PADDING_PX;
    return [1, 2, 4].find((every) => perBucket * every >= needed) ?? 6;
  }, [width, buckets]);

  /** Seven buckets across a full row would leave the bars stranded, so they grow with the column. */
  const barWidth = useMemo(() => {
    if (!width) return maxBarWidth;
    return Math.min(WIDEST_BAR_PX, Math.max(maxBarWidth, (width / buckets.length) * 0.55));
  }, [width, buckets.length, maxBarWidth]);

  const columns = { gridTemplateColumns: `repeat(${buckets.length}, minmax(0, 1fr))` };

  return (
    <div className="appear-from-bottom flex w-full flex-col rounded-md bg-background-color-2/70 px-4 pb-3 pt-4 backdrop-blur-md dark:bg-dark-background-color-2/70">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="font-medium text-font-color-highlight dark:text-dark-font-color-highlight">
          {title}
        </h3>
        {total > 0 && (
          <span className="truncate text-xs opacity-60" title={peak.label}>
            {t('statsPage.chartPeak', { label: peak.label, count: peak.listens })}
          </span>
        )}
      </div>

      <div ref={plotRef} className="grid h-44 items-end gap-1" style={columns}>
        {buckets.map((bucket) => {
          const share = total > 0 ? bucket.listens / peak.listens : 0;
          return (
            <div
              key={bucket.key}
              className="group relative flex h-full min-w-0 justify-center"
              title={`${bucket.label} — ${t('songInfoPage.listensCount', { count: bucket.listens })}`}
            >
              <div
                className="relative flex h-full w-full items-end overflow-hidden rounded-lg bg-seekbar-track-background-color/20 dark:bg-dark-seekbar-track-background-color/60"
                style={{ maxWidth: `${barWidth}px` }}
              >
                <div
                  className="w-full rounded-lg bg-font-color-highlight transition-[height,opacity] duration-300 ease-in-out group-hover:!opacity-100 dark:bg-dark-font-color-highlight"
                  style={{
                    /* A played hour must never read as an empty one, hence the 4% floor. */
                    height: bucket.listens === 0 ? '3px' : `${Math.max(4, share * 100)}%`,
                    opacity: bucket.listens === 0 ? 0.25 : 0.5 + share * 0.5
                  }}
                />
              </div>
              <span className="pointer-events-none absolute -top-1 left-1/2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md bg-background-color-3 px-2 py-1 text-xs opacity-0 shadow-lg transition-opacity group-hover:opacity-100 dark:bg-dark-background-color-3">
                {bucket.listens}
              </span>
            </div>
          );
        })}
      </div>

      <div className="mt-2 grid gap-1 text-center text-xs opacity-70" style={columns}>
        {buckets.map((bucket, index) => (
          // No truncation: a thinned-out label may spill into the empty cells
          // beside it, which is exactly the room the density check reserved.
          <span key={bucket.key} className="whitespace-nowrap" title={bucket.label}>
            {index % labelEvery === 0 ? bucket.label : ''}
          </span>
        ))}
      </div>

      {footer && <p className="mt-2 text-xs opacity-50">{footer}</p>}
    </div>
  );
};

type Props = {
  hourHistogram: number[];
  weekdayHistogram: number[];
  hourDataSince: number | null;
};

const ListeningPatternCharts = ({ hourHistogram, weekdayHistogram, hourDataSince }: Props) => {
  const { t, i18n } = useTranslation();

  const hourBuckets = useMemo(() => {
    const format = new Intl.DateTimeFormat(i18n.language, { hour: 'numeric' });
    return hourHistogram.map((listens, hour) => ({
      key: `hour-${hour}`,
      label: format.format(new Date(2024, 0, 1, hour)),
      listens
    }));
  }, [hourHistogram, i18n.language]);

  const weekdayBuckets = useMemo(() => {
    const format = new Intl.DateTimeFormat(i18n.language, { weekday: 'short' });
    return weekdayHistogram.map((listens, day) => ({
      key: `weekday-${day}`,
      label: format.format(new Date(2024, 0, 1 + day)),
      listens
    }));
  }, [weekdayHistogram, i18n.language]);

  const recordedSince = useMemo(
    () =>
      hourDataSince === null
        ? ''
        : new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(
            new Date(hourDataSince)
          ),
    [hourDataSince, i18n.language]
  );

  return (
    // Breakpoints in this project are max-width, so the plain classes are the wide
    // layout and `md:` takes over below 900px, where the two charts stop fitting
    // side by side. Hours get the wide column: 24 buckets against 7.
    <div className="mt-3 grid grid-cols-[minmax(0,2.6fr)_minmax(0,1fr)] items-stretch gap-3 md:grid-cols-1">
      {hourDataSince === null ? (
        <div className="flex min-h-[16rem] flex-col items-center justify-center rounded-md bg-background-color-2/70 p-6 text-center backdrop-blur-md dark:bg-dark-background-color-2/70">
          <span className="material-icons-round mb-2 text-4xl opacity-60">schedule</span>
          <h3 className="font-medium text-font-color-highlight dark:text-dark-font-color-highlight">
            {t('statsPage.hourlyActivity')}
          </h3>
          <p className="mt-1 max-w-sm text-sm opacity-70">{t('statsPage.noHourlyData')}</p>
        </div>
      ) : (
        <PatternChart
          title={t('statsPage.hourlyActivity')}
          buckets={hourBuckets}
          maxBarWidth={26}
          footer={t('statsPage.hourlyDataRecordedSince', { date: recordedSince })}
        />
      )}
      <PatternChart
        title={t('statsPage.weekdayActivity')}
        buckets={weekdayBuckets}
        maxBarWidth={40}
      />
    </div>
  );
};

export default ListeningPatternCharts;

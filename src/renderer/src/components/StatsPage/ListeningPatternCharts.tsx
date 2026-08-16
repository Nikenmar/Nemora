import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

type PatternChartProps = {
  data: number[];
  labels: string[];
  title: string;
};

const PatternChart = ({ data, labels, title }: PatternChartProps) => {
  const { t } = useTranslation();
  const maxListens = Math.max(1, ...data);

  return (
    <div className="rounded-md bg-background-color-2/70 p-4 backdrop-blur-md dark:bg-dark-background-color-2/70">
      <h3 className="mb-3 font-medium text-font-color-highlight dark:text-dark-font-color-highlight">
        {title}
      </h3>
      <div className="overflow-x-auto pb-1">
        <div
          className="grid h-48 w-full items-end gap-1"
          style={{
            gridTemplateColumns: `repeat(${data.length}, minmax(28px, 1fr))`,
            minWidth: data.length > 7 ? '720px' : undefined
          }}
        >
          {data.map((listens, index) => (
            <div
              key={labels[index]}
              className="flex h-full min-w-0 flex-col items-center justify-end"
            >
              <div className="flex h-full w-full items-end justify-center rounded-2xl bg-seekbar-track-background-color/20 dark:bg-dark-seekbar-track-background-color">
                <div
                  className="w-[10px] rounded-2xl bg-font-color-highlight transition-[height] duration-300 ease-in-out dark:bg-dark-font-color-highlight"
                  style={{ height: listens === 0 ? '6px' : `${(listens / maxListens) * 90}%` }}
                  title={t('songInfoPage.listensCount', { count: listens })}
                />
              </div>
              <span className="mt-1 w-full truncate text-center text-xs" title={labels[index]}>
                {labels[index]}
              </span>
            </div>
          ))}
        </div>
      </div>
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

  const hourLabels = useMemo(
    () =>
      Array.from({ length: 24 }, (_, hour) =>
        new Intl.DateTimeFormat(i18n.language, { hour: 'numeric' }).format(
          new Date(2024, 0, 1, hour)
        )
      ),
    [i18n.language]
  );
  const weekdayLabels = useMemo(
    () =>
      Array.from({ length: 7 }, (_, day) =>
        new Intl.DateTimeFormat(i18n.language, { weekday: 'short' }).format(
          new Date(2024, 0, 1 + day)
        )
      ),
    [i18n.language]
  );

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
    <div className="mt-3 grid gap-3 lg:grid-cols-2">
      <div>
        {hourDataSince === null ? (
          <div className="flex h-full min-h-64 flex-col items-center justify-center rounded-md bg-background-color-2/70 p-6 text-center backdrop-blur-md dark:bg-dark-background-color-2/70">
            <span className="material-icons-round mb-2 text-4xl opacity-60">schedule</span>
            <h3 className="font-medium text-font-color-highlight dark:text-dark-font-color-highlight">
              {t('statsPage.hourlyActivity')}
            </h3>
            <p className="mt-1 max-w-sm text-sm opacity-70">{t('statsPage.noHourlyData')}</p>
          </div>
        ) : (
          <>
            <PatternChart
              data={hourHistogram}
              labels={hourLabels}
              title={t('statsPage.hourlyActivity')}
            />
            <p className="mt-1 text-xs opacity-60">
              {t('statsPage.hourlyDataRecordedSince', { date: recordedSince })}
            </p>
          </>
        )}
      </div>
      <PatternChart
        data={weekdayHistogram}
        labels={weekdayLabels}
        title={t('statsPage.weekdayActivity')}
      />
    </div>
  );
};

export default ListeningPatternCharts;

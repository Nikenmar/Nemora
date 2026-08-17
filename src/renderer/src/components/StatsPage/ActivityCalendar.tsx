import { useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import useMeasuredWidth from '../../hooks/useMeasuredWidth';

type CalendarDay = { date: string; listens: number };

type Props = {
  days: CalendarDay[];
  className?: string;
  note?: string;
};

const WEEK_DAYS = 7;
/** Cells breathe with the card, between these two sizes. */
const MIN_CELL_PX = 9;
const MAX_CELL_PX = 18;
const GAP_PX = 3;
/** Room for the Mon/Wed/Fri column; dropped when the card is too narrow to spare it. */
const WEEKDAY_GUTTER_PX = 30;
const WEEKDAY_GUTTER_MIN_WIDTH = 420;
/** Shading steps, also drawn in the legend. */
const OPACITY_STEPS = [0.25, 0.45, 0.7, 1];

const toLocalDate = (isoDate: string) => new Date(`${isoDate}T00:00:00`);

/**
 * GitHub-style activity heatmap: 7 weekday rows by N week columns.
 *
 * The grid is measured, not fixed: cells grow into whatever width the card has
 * and shrink back down to `MIN_CELL_PX`, and once even that stops fitting the
 * calendar drops its oldest weeks instead of scrolling sideways behind a hidden
 * scrollbar, which is how the earlier version silently hid half a year.
 */
const ActivityCalendar = (props: Props) => {
  const { days, className, note } = props;
  const { t, i18n } = useTranslation();
  const gridRef = useRef<HTMLDivElement>(null);
  const width = useMeasuredWidth(gridRef);

  // Format with the app language (i18next), not the OS locale.
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }),
    [i18n.language]
  );
  const monthFormatter = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { month: 'short' }),
    [i18n.language]
  );
  const weekdayFormatter = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { weekday: 'short' }),
    [i18n.language]
  );

  const maxListens = Math.max(1, ...days.map((day) => day.listens));

  // Pad the front so the first day lands on its real weekday row (Sunday-first,
  // GitHub-style). Null cells render as transparent placeholders.
  const allCells = useMemo(() => {
    if (days.length === 0) return [] as (CalendarDay | null)[];
    const leadingBlanks = toLocalDate(days[0].date).getDay();
    return [...Array<CalendarDay | null>(leadingBlanks).fill(null), ...days];
  }, [days]);

  const totalColumns = Math.ceil(allCells.length / WEEK_DAYS);
  const showWeekdays = width >= WEEKDAY_GUTTER_MIN_WIDTH;
  const gridWidth = Math.max(0, width - (showWeekdays ? WEEKDAY_GUTTER_PX : 0));

  /** How many weeks fit, and how big each cell can be, for the width we actually have. */
  const { columnCount, cellSize } = useMemo(() => {
    if (!gridWidth || totalColumns === 0) return { columnCount: totalColumns, cellSize: 12 };

    const fitted = Math.floor((gridWidth + GAP_PX) / (MIN_CELL_PX + GAP_PX));
    const columns = Math.max(1, Math.min(totalColumns, fitted));
    const size = Math.floor((gridWidth - GAP_PX * (columns - 1)) / columns);
    return { columnCount: columns, cellSize: Math.min(MAX_CELL_PX, Math.max(MIN_CELL_PX, size)) };
  }, [gridWidth, totalColumns]);

  /** Oldest weeks go first when there is not enough room: recent activity is the point. */
  const cells = useMemo(
    () => allCells.slice(Math.max(0, (totalColumns - columnCount) * WEEK_DAYS)),
    [allCells, columnCount, totalColumns]
  );

  const gridTemplateColumns = `repeat(${columnCount}, ${cellSize}px)`;

  // A month label sits over the column CONTAINING the 1st of that month
  // (GitHub-style) - labeling by the column's top cell drops months whose
  // 1st falls mid-week.
  const monthLabels = useMemo(
    () =>
      Array.from({ length: columnCount }, (_, columnIndex) => {
        const column = cells.slice(columnIndex * WEEK_DAYS, (columnIndex + 1) * WEEK_DAYS);
        const monthStart = column.find((day) => !!day && toLocalDate(day.date).getDate() === 1);
        return {
          key: column.find((day) => !!day)?.date ?? `blank-${columnIndex}`,
          label: monthStart ? monthFormatter.format(toLocalDate(monthStart.date)) : ''
        };
      }),
    [cells, columnCount, monthFormatter]
  );

  // Sunday-first rows, labelled on alternate rows so the names never collide.
  const weekdayLabels = useMemo(
    () =>
      Array.from({ length: WEEK_DAYS }, (_, row) =>
        row % 2 === 1 ? weekdayFormatter.format(new Date(2024, 0, 7 + row)) : ''
      ),
    [weekdayFormatter]
  );

  if (days.length === 0) return null;

  const cellOpacity = (listens: number) => {
    if (listens <= 0) return undefined;
    const ratio = listens / maxListens;
    if (ratio <= 0.25) return OPACITY_STEPS[0];
    if (ratio <= 0.5) return OPACITY_STEPS[1];
    if (ratio <= 0.75) return OPACITY_STEPS[2];
    return OPACITY_STEPS[3];
  };

  const rowHeight = cellSize + GAP_PX;

  return (
    <div
      className={`appear-from-bottom w-full max-w-full rounded-md bg-background-color-2/70 p-4 backdrop-blur-md dark:bg-dark-background-color-2/70 ${className ?? ''}`}
    >
      <div className="flex w-full gap-2">
        {showWeekdays && (
          <div
            className="shrink-0 pt-[18px] text-right text-[10px] leading-none text-font-color/50 dark:text-font-color-white/50"
            style={{ width: WEEKDAY_GUTTER_PX - 8 }}
          >
            {weekdayLabels.map((label, row) => (
              <div
                key={label || `row-${row}`}
                className="flex items-center justify-end"
                style={{ height: rowHeight }}
              >
                {label}
              </div>
            ))}
          </div>
        )}

        <div ref={gridRef} className="min-w-0 grow">
          <div
            className="grid text-[10px] leading-none text-font-color/60 dark:text-font-color-white/60"
            // Leftover width is split between both sides instead of piling up on the right.
            style={{ gridTemplateColumns, columnGap: GAP_PX, justifyContent: 'center' }}
          >
            {monthLabels.map((monthLabel) => (
              <span key={monthLabel.key} className="h-[18px] overflow-visible whitespace-nowrap">
                {monthLabel.label}
              </span>
            ))}
          </div>
          <div
            className="grid [grid-auto-flow:column]"
            style={{
              gridTemplateColumns,
              gridTemplateRows: `repeat(${WEEK_DAYS}, ${cellSize}px)`,
              gap: GAP_PX,
              justifyContent: 'center'
            }}
          >
            {cells.map((day, index) =>
              day === null ? (
                <span key={`blank-${index}`} style={{ width: cellSize, height: cellSize }} />
              ) : (
                <span
                  key={day.date}
                  className={`rounded-[3px] transition-transform duration-150 hover:scale-125 ${
                    day.listens === 0
                      ? 'bg-seekbar-track-background-color/30 dark:bg-dark-seekbar-track-background-color/40'
                      : 'bg-font-color-highlight dark:bg-dark-font-color-highlight'
                  }`}
                  style={{
                    width: cellSize,
                    height: cellSize,
                    opacity: cellOpacity(day.listens)
                  }}
                  title={`${dateFormatter.format(toLocalDate(day.date))} - ${t(
                    'songInfoPage.listensCount',
                    { count: day.listens }
                  )}`}
                />
              )
            )}
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 text-[10px] opacity-60">
        <span>{note ?? ''}</span>
        <span className="flex shrink-0 items-center gap-1">
          {t('statsPage.calendarLess')}
          <span
            className="rounded-[3px] bg-seekbar-track-background-color/30 dark:bg-dark-seekbar-track-background-color/40"
            style={{ width: 10, height: 10 }}
          />
          {OPACITY_STEPS.map((opacity) => (
            <span
              key={opacity}
              className="rounded-[3px] bg-font-color-highlight dark:bg-dark-font-color-highlight"
              style={{ width: 10, height: 10, opacity }}
            />
          ))}
          {t('statsPage.calendarMore')}
        </span>
      </div>
    </div>
  );
};

export default ActivityCalendar;

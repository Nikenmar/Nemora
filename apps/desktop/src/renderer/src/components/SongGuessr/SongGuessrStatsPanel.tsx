import { useTranslation } from 'react-i18next';

import { getWinPercentage } from '../../utils/songGuessr/stats';

type SongGuessrStatsPanelProps = {
  stats: SongGuessrStats;
  /** Highlights the bucket the round that just ended landed in. */
  highlightAttempt?: number;
};

const SongGuessrStatsPanel = ({ stats, highlightAttempt }: SongGuessrStatsPanelProps) => {
  const { t } = useTranslation();

  const summary = [
    { label: t('songGuessr.gamesPlayed'), value: stats.gamesPlayed },
    { label: t('songGuessr.winPercentage'), value: `${getWinPercentage(stats)}%` },
    { label: t('songGuessr.currentStreak'), value: stats.currentStreak },
    { label: t('songGuessr.maxStreak'), value: stats.maxStreak }
  ];

  const peak = Math.max(1, ...stats.distribution);

  return (
    <section
      className="rounded-panel border border-line px-5 py-4"
      aria-label={t('songGuessr.statsTitle')}
    >
      <div className="grid grid-cols-4 gap-2">
        {summary.map((item) => (
          <div key={item.label} className="flex flex-col items-center">
            <span className="text-section font-semibold leading-none tabular-nums text-ink">
              {item.value}
            </span>
            <span className="mt-1.5 text-center text-micro text-ink-faint">
              {item.label}
            </span>
          </div>
        ))}
      </div>

      {stats.gamesPlayed > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-micro font-semibold uppercase tracking-wide text-ink-faint">
            {t('songGuessr.distribution')}
          </p>
          <div className="space-y-1">
            {stats.distribution.map((count, index) => {
              const isHighlighted = highlightAttempt === index;
              return (
                <div
                  key={index}
                  className="flex items-center gap-2"
                  aria-label={t('songGuessr.distributionBar', { attempt: index + 1, count })}
                >
                  <span className="w-3 text-micro tabular-nums text-ink-faint">{index + 1}</span>
                  <div className="flex h-4 min-w-0 flex-1 items-center">
                    {count > 0 ? (
                      <div
                        /* The bucket the round just landed in takes the echo; the rest stay on
                           the track tone, so one bar answers "how did this round go". */
                        className={`flex h-full min-w-[1.5rem] items-center justify-end rounded-full px-2 text-micro font-semibold tabular-nums transition-all duration-500 ease-out motion-reduce:transition-none ${
                          isHighlighted ? 'bg-echo text-canvas' : 'bg-line text-ink-dim'
                        }`}
                        style={{ width: `${(count / peak) * 100}%` }}
                      >
                        {count}
                      </div>
                    ) : (
                      // An empty bucket gets a hairline, not a bar — a filled
                      // pill next to a 0 reads as data that is not there.
                      <div className="h-px w-full bg-line" />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
};

export default SongGuessrStatsPanel;

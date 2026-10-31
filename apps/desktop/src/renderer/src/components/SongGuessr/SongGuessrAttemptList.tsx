import { useTranslation } from 'react-i18next';

type SongGuessrAttemptListProps = {
  attempts: SongGuessrAttempt[];
  maxAttempts: number;
  /**
   * `dots` is the progress row that sits above the guess box; `log` is the
   * running list of what was already tried. They are drawn on opposite sides of
   * the input, so a single component would have to render one of them twice.
   */
  variant: 'dots' | 'log';
};

const getDotClassName = (attempt: SongGuessrAttempt | undefined) => {
  // An unused attempt is the track tone, a skipped one the faint ink: both read as "not a guess"
  // without looking like a result.
  if (!attempt) return 'bg-line';
  if (attempt.kind === 'correct') return 'bg-echo';
  if (attempt.kind === 'wrong') return 'bg-danger';
  return 'bg-ink-faint';
};

const getAttemptIcon = (attempt: SongGuessrAttempt) => {
  if (attempt.kind === 'correct') return 'check_circle';
  if (attempt.kind === 'wrong') return 'close';
  return 'skip_next';
};

const SongGuessrAttemptList = (props: SongGuessrAttemptListProps) => {
  const { attempts, maxAttempts, variant } = props;
  const { t } = useTranslation();

  const dots = Array.from({ length: maxAttempts }, (_, index) => attempts[index]);

  if (variant === 'log') {
    if (attempts.length === 0) return null;

    // Kept tight on purpose: all six attempts should fit the log area, so it
    // has nothing to scroll in the first place.
    return (
      <ul className="space-y-1.5" aria-label={t('songGuessr.attemptsLabel')}>
        {attempts.map((attempt, index) => {
          const isCorrect = attempt.kind === 'correct';
          const label =
            attempt.kind === 'skip'
              ? t('songGuessr.skipped')
              : (attempt.guessLabel ??
                (isCorrect ? t('songGuessr.correctGuess') : t('songGuessr.wrongGuess')));

          return (
            <li
              key={index}
              className={`flex items-center gap-2.5 rounded-xl px-3 py-1.5 text-small ${
                isCorrect ? 'bg-accent-soft text-ink' : 'bg-surface-2 text-ink-dim'
              }`}
            >
              <span
                className={`ms-icon text-base !leading-none ${
                  isCorrect
                    ? 'ms-icon-filled text-echo'
                    : attempt.kind === 'wrong'
                      ? 'text-danger'
                      : 'text-ink-faint'
                }`}
                aria-hidden="true"
              >
                {getAttemptIcon(attempt)}
              </span>
              <span
                className={`min-w-0 truncate ${
                  attempt.kind === 'wrong' ? 'line-through decoration-ink-faint' : ''
                } ${attempt.kind === 'skip' ? 'text-ink-faint' : ''}`}
                title={label}
              >
                {label}
              </span>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <section aria-label={t('songGuessr.attemptsLabel')}>
      <div className="flex items-center justify-center gap-1.5">
        {dots.map((attempt, index) => (
          <span
            key={index}
            className={`h-1.5 w-7 rounded-full transition-colors duration-200 motion-reduce:transition-none ${getDotClassName(
              attempt
            )}`}
            title={t('songGuessr.attemptRow', {
              number: index + 1,
              label: attempt
                ? attempt.kind === 'skip'
                  ? t('songGuessr.skipped')
                  : (attempt.guessLabel ??
                    (attempt.kind === 'correct'
                      ? t('songGuessr.correctGuess')
                      : t('songGuessr.wrongGuess')))
                : t('songGuessr.emptyAttempt')
            })}
          />
        ))}
      </div>
    </section>
  );
};

export default SongGuessrAttemptList;

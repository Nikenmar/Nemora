import { useTranslation } from 'react-i18next';

import Button from '../Button';
import Img from '../Img';
import Icon from '../ui/Icon';

type SongGuessrResultProps = {
  round: SongGuessrRound;
  attempts: SongGuessrAttempt[];
  won: boolean;
  copied: boolean;
  onCopy: () => void;
  onNextRound: () => void;
  onPlayInNora: () => void;
};

const getSquareClassName = (attempt: SongGuessrAttempt) => {
  if (attempt.kind === 'correct') return 'bg-echo';
  if (attempt.kind === 'wrong') return 'bg-danger';
  // Skips use the faint ink, so a skipped step never reads as brightly as a solved one.
  return 'bg-ink-faint';
};

const SongGuessrResult = (props: SongGuessrResultProps) => {
  const { round, attempts, won, copied, onCopy, onNextRound, onPlayInNora } = props;
  const { t } = useTranslation();
  const { answer } = round;

  return (
    <section className="relative isolate overflow-hidden rounded-panel border border-line">
      {/*
        The artwork was the one thing the round had to hide, so it arrives loudly: a glow behind an
        almost opaque surface (a translucent panel over a blurred image washes the text out).
      */}
      <div className="absolute inset-0 -z-10" aria-hidden="true">
        <Img
          src={answer.artworkPaths.artworkPath}
          alt=""
          enableImgFadeIns={false}
          className="h-full w-full scale-150 object-cover opacity-30 blur-3xl"
        />
      </div>

      {/*
        Artwork beside the text rather than above it. Stacked, the reveal plus the stats panel ran
        past the bottom of a fixed-height dialog; side by side the whole result fits.
      */}
      <div className="flex flex-col bg-surface-3/85 p-5">
        <div className="flex items-center gap-4">
          <Img
            src={answer.artworkPaths.artworkPath}
            alt={t('songGuessr.answerArtworkAlt', { title: answer.title })}
            className="h-28 w-28 flex-shrink-0 rounded-cover object-cover shadow-float"
          />

          <div className="flex min-w-0 flex-col">
            <span
              className={`mb-2 inline-flex w-fit items-center gap-1 rounded-full py-0.5 pl-1.5 pr-2.5 text-micro font-semibold ${
                won ? 'bg-accent-soft text-echo' : 'bg-danger-soft text-danger'
              }`}
            >
              <Icon name={won ? 'celebration' : 'sentiment_dissatisfied'} filled size={14} />
              {won
                ? t('songGuessr.resultWinIn', { count: attempts.length })
                : t('songGuessr.resultLoss')}
            </span>

            <h2
              className="truncate text-section font-semibold leading-tight text-ink"
              title={answer.title}
            >
              {answer.title}
            </h2>
            {answer.artists.length > 0 && (
              <p
                className="mt-0.5 truncate text-body text-ink-dim"
                title={answer.artists.join(', ')}
              >
                {answer.artists.join(', ')}
              </p>
            )}
            {answer.album && (
              <p className="mt-0.5 truncate text-small text-ink-faint" title={answer.album}>
                {answer.album}
              </p>
            )}

            <div className="mt-2.5 flex items-center gap-1" aria-hidden="true">
              {attempts.map((attempt, index) => (
                <span
                  key={index}
                  className={`h-1.5 w-5 rounded-full ${getSquareClassName(attempt)}`}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Button
            label={t('songGuessr.nextRound')}
            iconName="refresh"
            variant="primary"
            className="m-0"
            clickHandler={onNextRound}
          />
          <Button
            label={t('songGuessr.playInNora')}
            iconName="play_arrow"
            className="m-0"
            clickHandler={onPlayInNora}
          />
          <Button
            label={copied ? t('songGuessr.copied') : t('songGuessr.copyResult')}
            iconName={copied ? 'check' : 'content_copy'}
            isActive={copied}
            className="m-0"
            clickHandler={onCopy}
          />
        </div>
      </div>
    </section>
  );
};

export default SongGuessrResult;

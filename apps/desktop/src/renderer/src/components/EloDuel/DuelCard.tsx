import { type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn as twMerge } from '../ui/cn';

import Img from '../Img';
import Icon from '../ui/Icon';

type Props = {
  entry: DuelSongEntry;
  onVote: () => void;
  onPreviewToggle: () => void;
  isPreviewing: boolean;
  isDisabled: boolean;
  showResult: boolean;
  isWinner?: boolean;
  delta?: number;
};

/** Two cards with the VS mark between them, in equal columns: the duel and a tournament match. */
export const DuelVersus = ({ left, right }: { left: ReactNode; right: ReactNode }) => (
  <div className="duel-cards-container grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4">
    {left}
    <span
      className="flex h-11 w-11 items-center justify-center rounded-full border border-line bg-surface-2 text-small font-semibold text-ink-dim"
      aria-hidden
    >
      VS
    </span>
    {right}
  </div>
);

const DuelCard = (props: Props) => {
  const { entry, onVote, onPreviewToggle, isPreviewing, isDisabled, showResult, isWinner, delta } =
    props;
  const { t } = useTranslation();

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (isDisabled) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onVote();
    }
  };

  return (
    <div
      role="button"
      tabIndex={isDisabled ? -1 : 0}
      aria-disabled={isDisabled}
      className={twMerge(
        'duel-card group relative flex min-w-0 flex-col items-center rounded-panel p-4 text-center outline-none transition-[background-color,box-shadow,opacity] duration-150 focus-visible:ring-2 focus-visible:ring-echo',
        !isDisabled && 'cursor-pointer hover:bg-glass-hover',
        showResult && isWinner && 'bg-accent-soft ring-2 ring-echo hover:bg-accent-soft',
        showResult && !isWinner && 'opacity-45'
      )}
      onClick={() => {
        if (!isDisabled) onVote();
      }}
      onKeyDown={handleKeyDown}
    >
      <div className="relative aspect-square w-full max-w-[15rem]">
        <Img
          src={entry.artworkPaths.artworkPath}
          alt=""
          enableImgFadeIns={false}
          className="h-full w-full rounded-cover-lg object-cover shadow-float"
        />
        <button
          type="button"
          tabIndex={-1}
          disabled={isDisabled}
          className={twMerge(
            'preview-btn absolute bottom-3 right-3 flex h-10 w-10 cursor-pointer items-center justify-center rounded-full bg-shade/55 text-on-media opacity-0 backdrop-blur-md transition-[opacity,transform] duration-150 hover:scale-105 group-hover:opacity-100',
            isPreviewing && 'opacity-100'
          )}
          data-tooltip={t('eloDuels.preview')}
          aria-label={t('eloDuels.preview')}
          onClick={(e) => {
            e.stopPropagation();
            if (!isDisabled) onPreviewToggle();
          }}
        >
          <Icon name={isPreviewing ? 'pause' : 'play_arrow'} filled size={22} />
        </button>
      </div>

      <span className="mt-4 w-full truncate text-section font-semibold text-ink" title={entry.title}>
        {entry.title}
      </span>
      <span className="w-full truncate text-body text-ink-dim" title={entry.artists.join(', ')}>
        {entry.artists.join(', ')}
      </span>

      <div className="mt-3 flex h-7 items-center gap-2">
        <span className="rounded-full bg-surface-2 px-2.5 py-1 text-micro font-medium tabular-nums text-ink-dim">
          {t('eloDuels.ratingWithGames', { rating: Math.round(entry.rating), count: entry.games })}
        </span>
        {showResult && delta !== undefined && (
          <span
            className={`rounded-full px-2.5 py-1 text-small font-semibold tabular-nums ${
              delta >= 0 ? 'bg-success/15 text-success' : 'bg-danger/15 text-danger'
            }`}
          >
            {delta >= 0 ? `+${Math.round(delta)}` : Math.round(delta)}
          </span>
        )}
      </div>
    </div>
  );
};

export default DuelCard;

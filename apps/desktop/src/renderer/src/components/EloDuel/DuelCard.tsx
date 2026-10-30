import { type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import Img from '../Img';

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
      className={`duel-card group relative flex w-56 cursor-pointer flex-col items-center rounded-xl border-2 bg-surface-2/75 p-4 transition-colors hover:border-echo/60 ${
        isDisabled ? 'cursor-default' : ''
      } ${
        showResult && isWinner
          ? 'border-echo'
          : 'border-transparent'
      } ${showResult && !isWinner ? 'opacity-70' : ''}`}
      onClick={() => {
        if (!isDisabled) onVote();
      }}
      onKeyDown={handleKeyDown}
    >
      <div className="relative">
        <Img
          src={entry.artworkPaths.artworkPath}
          alt=""
          enableImgFadeIns={false}
          className="h-40 w-40 rounded-lg object-cover shadow-md"
        />
        <button
          type="button"
          tabIndex={-1}
          disabled={isDisabled}
          className="preview-btn absolute bottom-2 right-2 flex h-9 w-9 cursor-pointer items-center justify-center rounded-full bg-canvas/80 text-ink opacity-0 backdrop-blur-md transition-opacity hover:bg-canvas group-hover:opacity-100 "
          title={t('eloDuels.preview')}
          onClick={(e) => {
            e.stopPropagation();
            if (!isDisabled) onPreviewToggle();
          }}
        >
          <span className="ms-icon text-xl">
            {isPreviewing ? 'pause' : 'play_arrow'}
          </span>
        </button>
      </div>

      <span className="mt-3 w-full truncate text-center font-medium" title={entry.title}>
        {entry.title}
      </span>
      <span
        className="w-full truncate text-center text-sm opacity-60"
        title={entry.artists.join(', ')}
      >
        {entry.artists.join(', ')}
      </span>
      <span className="mt-1 text-xs opacity-60">
        {t('eloDuels.ratingWithGames', { rating: Math.round(entry.rating), count: entry.games })}
      </span>

      <div className="mt-2 flex h-7 items-center">
        {showResult && delta !== undefined && (
          <span
            className={`text-lg font-semibold ${
              delta >= 0 ? 'text-success' : 'text-danger'
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

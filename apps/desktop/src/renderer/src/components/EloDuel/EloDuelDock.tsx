import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@tanstack/react-store';
import { createPortal } from 'react-dom';

import { store } from '@renderer/store';
import { peekFirstAliveDuelPair } from '../../utils/duelQueue';
import EloDuelPrompt from './EloDuelPrompt';
import Icon from '../ui/Icon';
import { GameDialog } from '../ui/GameWindow';

const EloDuelDock = () => {
  const { t } = useTranslation();
  const pendingDuels = useStore(store, (state) => state.localStorage.duels?.pendingDuels ?? 0);

  const [activePair, setActivePair] = useState<DuelPair>();
  const [isExpanded, setIsExpanded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const dialogRef = useRef<HTMLDialogElement>(null);
  const loadingRef = useRef(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isExpanded && activePair && !dialog.open) dialog.showModal();
    else if (!isExpanded && dialog.open) dialog.close();
  }, [activePair, isExpanded]);

  const maximizeDuel = useCallback(() => {
    if (activePair) {
      setIsExpanded(true);
      return;
    }
    if (loadingRef.current) return;

    loadingRef.current = true;
    setIsLoading(true);
    // Earned (queued) duels first; a fresh random pair only when the backlog is empty.
    return peekFirstAliveDuelPair()
      .then((queuedPair) => queuedPair ?? window.api.eloDuels.getDuelPair())
      .then((pair) => {
        if (pair) {
          setActivePair(pair);
          setIsExpanded(true);
        }
        return undefined;
      })
      .catch((err) => console.error(err))
      .finally(() => {
        loadingRef.current = false;
        setIsLoading(false);
      });
  }, [activePair]);

  const minimizeDuel = useCallback(() => setIsExpanded(false), []);

  const closeDuel = useCallback(() => {
    setIsExpanded(false);
    setActivePair(undefined);
  }, []);

  const showDock = !isExpanded;
  const visibleCount = pendingDuels > 99 ? '99+' : pendingDuels;
  const dockLabel = activePair
    ? t('eloDuels.resumeDuel')
    : pendingDuels > 0
      ? t('eloDuels.maximize', { count: pendingDuels })
      : t('eloDuels.startDuel');

  return (
    <>
      <span className="flex">
        {showDock && (
          <button
            type="button"
            className="relative flex h-9 w-9 items-center justify-center rounded-full text-ink-dim outline-none transition-colors duration-150 hover:bg-glass-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-echo"
            data-shot="duel-dock"
            onClick={maximizeDuel}
            aria-label={dockLabel}
            aria-expanded="false"
            data-tooltip={dockLabel}
          >
            <Icon name={isLoading ? 'progress_activity' : 'swords'} size={20} className={isLoading ? 'animate-spin' : ''} />
            {pendingDuels > 0 && (
              <span
                className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-none text-on-accent"
                aria-live="polite"
              >
                {visibleCount}
              </span>
            )}
            {activePair && pendingDuels === 0 && (
              <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-echo" aria-hidden />
            )}
          </button>
        )}
      </span>

      {activePair &&
        createPortal(
          <GameDialog
            ref={dialogRef}
            label={t('eloDuels.promptTitle')}
            className="h-fit w-[min(50rem,94vw)]"
            onCancel={minimizeDuel}
          >
            <EloDuelPrompt
              initialPair={activePair}
              queuedDuels={pendingDuels}
              onClose={closeDuel}
              onMinimize={minimizeDuel}
            />
          </GameDialog>,
          document.body
        )}
    </>
  );
};

export default EloDuelDock;

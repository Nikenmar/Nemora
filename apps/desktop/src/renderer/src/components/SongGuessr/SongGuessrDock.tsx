import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from '../ui/Icon';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';

import {
  SONG_GUESSR_GUESS_INPUT_ID,
  SONG_GUESSR_PANEL_ATTRIBUTE
} from '../../utils/songGuessr/constants';
import SongGuessrPrompt from './SongGuessrPrompt';
import { GameDialog } from '../ui/GameWindow';

const SongGuessrDock = () => {
  const { t } = useTranslation();

  const [hasStarted, setHasStarted] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (hasStarted && isExpanded && !dialog.open) {
      dialog.showModal();

      /*
        `showModal()` hands focus to the first focusable descendant on its own,
        and that is the pool dropdown — which is why coming back from a
        minimize lit it up with a focus ring. The guess box is what the player
        actually wants; while a round is still loading there is none, so the
        panel takes the focus instead and nothing lights up.
      */
      const guessInput = dialog.querySelector<HTMLInputElement>(`#${SONG_GUESSR_GUESS_INPUT_ID}`);
      if (guessInput) guessInput.focus();
      else dialog.querySelector<HTMLElement>(`[${SONG_GUESSR_PANEL_ATTRIBUTE}]`)?.focus();
    } else if ((!hasStarted || !isExpanded) && dialog.open) dialog.close();
  }, [hasStarted, isExpanded]);

  const maximizeSongGuessr = useCallback(() => {
    setHasStarted(true);
    setIsExpanded(true);
  }, []);

  const minimizeSongGuessr = useCallback(() => setIsExpanded(false), []);

  const closeSongGuessr = useCallback(() => {
    setIsExpanded(false);
    setHasStarted(false);
  }, []);

  const dockLabel = t('songGuessr.dockName');

  return (
    <>
      {/* Stays in place while the game is open, so the footer's three icons keep their cells. */}
      <span className="flex">
        {!isExpanded && (
          <button
            type="button"
            className="relative flex h-9 w-9 items-center justify-center rounded-full text-ink-dim outline-none transition-colors duration-150 hover:bg-glass-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-echo"
            data-shot="songguessr-dock"
            onClick={maximizeSongGuessr}
            aria-label={dockLabel}
            aria-expanded={isExpanded}
            data-tooltip={dockLabel}
          >
            <Icon name="graphic_eq" size={20} />
            {hasStarted && (
              <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-echo" aria-hidden />
            )}
          </button>
        )}
      </span>

      {hasStarted &&
        createPortal(
          /*
            The height is fixed rather than content-driven: letting it grow moved the
            window and its buttons on every guess, skip and opened suggestion list. The
            panel holds still and only its inner regions scroll; 48rem holds all six
            attempts unscrolled.
          */
          <GameDialog
            ref={dialogRef}
            label={t('songGuessr.promptTitle')}
            className="h-[min(48rem,calc(100vh-3rem))] w-[min(34rem,94vw)]"
            onCancel={minimizeSongGuessr}
          >
            <SongGuessrPrompt onClose={closeSongGuessr} onMinimize={minimizeSongGuessr} />
          </GameDialog>,
          document.body
        )}
    </>
  );
};

export default SongGuessrDock;

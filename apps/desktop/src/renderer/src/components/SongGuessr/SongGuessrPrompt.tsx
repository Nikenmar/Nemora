import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AppUpdateContext } from '../../contexts/AppUpdateContext';
import { getTrackStartOffset } from '../../utils/songGuessr/audioAnalysis';
import {
  SONG_GUESSR_MAX_ATTEMPTS,
  SONG_GUESSR_PANEL_ATTRIBUTE,
  SONG_GUESSR_SNIPPETS
} from '../../utils/songGuessr/constants';
import { isCorrectGuess, formatCandidateLabel } from '../../utils/songGuessr/matching';
import {
  loadSongGuessrState,
  pushRecentSongId,
  saveSongGuessrState
} from '../../utils/songGuessr/persistence';
import { buildShareText } from '../../utils/songGuessr/share';
import { applyRoundResult, createEmptyStats } from '../../utils/songGuessr/stats';
import SongGuessrAttemptList from './SongGuessrAttemptList';
import SongGuessrGuessInput from './SongGuessrGuessInput';
import SongGuessrPlayer from './SongGuessrPlayer';
import SongGuessrPoolSelector, { type SongGuessrPoolSelection } from './SongGuessrPoolSelector';
import SongGuessrResult from './SongGuessrResult';
import SongGuessrStatsPanel from './SongGuessrStatsPanel';
import Button from '../Button';
import Icon from '../ui/Icon';
import { GameHeader } from '../ui/GameWindow';

type SongGuessrPromptProps = {
  onClose?: () => void;
  onMinimize?: () => void;
};

type SongGuessrPhase = 'loading' | 'playing' | 'won' | 'lost' | 'empty';

const COPIED_RESET_MS = 1800;

// Artist/album modes intentionally live for the renderer session, not in the
// durable SongGuessr save. Closing and reopening the dock keeps the source;
// restarting Nemora returns to the existing default/persisted library pools.
let sessionPoolSelection: SongGuessrPoolSelection | undefined;

const SongGuessrPrompt = ({ onClose, onMinimize }: SongGuessrPromptProps) => {
  const { changePromptMenuData, playSong } = useContext(AppUpdateContext);
  const { t } = useTranslation();

  const [persistedState, setPersistedState] = useState<SongGuessrPersistedState>(() => {
    try {
      return loadSongGuessrState();
    } catch {
      return { version: 1, stats: createEmptyStats(), poolType: 'library', recentSongIds: [] };
    }
  });
  const [poolSelection, setPoolSelection] = useState<SongGuessrPoolSelection>(() =>
    sessionPoolSelection
      ? { ...sessionPoolSelection }
      : {
          poolType: persistedState.poolType,
          ...(persistedState.poolId ? { poolId: persistedState.poolId } : {})
        }
  );
  const [pools, setPools] = useState<SongGuessrPoolOption[]>([]);
  const [round, setRound] = useState<SongGuessrRound>();
  const [phase, setPhase] = useState<SongGuessrPhase>('loading');
  const [attempts, setAttempts] = useState<SongGuessrAttempt[]>([]);
  const [startOffset, setStartOffset] = useState(0);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isActionLocked, setIsActionLocked] = useState(false);
  const [stopSignal, setStopSignal] = useState(0);
  const [playSignal, setPlaySignal] = useState(0);
  const [guessInputKey, setGuessInputKey] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const persistedStateRef = useRef(persistedState);
  const poolSelectionRef = useRef(poolSelection);
  /** Read inside the native key handler, which is bound once. */
  const phaseRef = useRef(phase);
  const requestIdRef = useRef(0);
  const committedRoundRef = useRef(false);
  const actionLockedRef = useRef(false);
  const copiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const updatePersistedState = useCallback((nextState: SongGuessrPersistedState) => {
    persistedStateRef.current = nextState;
    setPersistedState(nextState);
  }, []);

  const startRound = useCallback(
    async (state: SongGuessrPersistedState, selection = poolSelectionRef.current) => {
      const requestId = ++requestIdRef.current;
      actionLockedRef.current = true;
      setIsActionLocked(true);
      setPhase('loading');
      setRound(undefined);
      setAttempts([]);
      setCopied(false);
      setStartOffset(0);
      setGuessInputKey((key) => key + 1);

      try {
        const nextRound = await window.api.songGuessr.getRound({
          poolType: selection.poolType,
          poolId: selection.poolId,
          excludedSongIds: state.recentSongIds
        });

        if (requestId !== requestIdRef.current) return;
        if (!nextRound) {
          setPhase('empty');
          return;
        }

        committedRoundRef.current = false;
        setRound(nextRound);
        setPhase('playing');

        // Plenty of tracks open on room tone, a fade-in or a run of digital
        // silence, which would waste the whole 0.1 s rung. Finding the real start
        // needs a decode, so it runs alongside the round instead of delaying it.
        setIsAnalyzing(true);
        void getTrackStartOffset(nextRound.answer.songId, nextRound.answer.path)
          .then((offset) => {
            if (requestId !== requestIdRef.current) return;
            setStartOffset(offset);
          })
          .finally(() => {
            if (requestId === requestIdRef.current) setIsAnalyzing(false);
          });
      } catch {
        if (requestId === requestIdRef.current) setPhase('empty');
      } finally {
        if (requestId === requestIdRef.current) {
          actionLockedRef.current = false;
          setIsActionLocked(false);
        }
      }
    },
    []
  );

  useEffect(() => {
    let isActive = true;
    window.api.songGuessr
      .getPools()
      .then((availablePools) => {
        if (isActive) setPools(availablePools);
      })
      .catch(() => {
        if (isActive) setPools([]);
      });

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    void startRound(persistedStateRef.current);

    return () => {
      requestIdRef.current += 1;
      if (copiedTimeoutRef.current) clearTimeout(copiedTimeoutRef.current);
    };
  }, [startRound]);

  const commitRoundResult = useCallback(
    (won: boolean, attemptIndex: number, roundAttempts: SongGuessrAttempt[]) => {
      if (!round || committedRoundRef.current) return;
      committedRoundRef.current = true;

      const currentState = persistedStateRef.current;
      const nextStats = applyRoundResult(currentState.stats, {
        won,
        attemptIndex,
        at: Date.now(),
        skips: roundAttempts.filter((attempt) => attempt.kind === 'skip').length,
        answer: {
          songId: round.answer.songId,
          title: round.answer.title,
          artists: round.answer.artists
        }
      });
      const nextState = pushRecentSongId(
        { ...currentState, stats: nextStats },
        round.answer.songId
      );
      updatePersistedState(nextState);
      saveSongGuessrState(nextState);
      // Per song, for Smart Shuffle: a song not recognised is one to bring back (PLAN/15 M1).
      window.api.songGuessr
        .recordRound(round.answer.songId, won ? attemptIndex + 1 : null, currentState.poolType)
        .catch((error: unknown) => console.error('The Song Guessr round was not recorded.', error));
    },
    [round, updatePersistedState]
  );

  const recordAttempt = useCallback(
    (attempt: SongGuessrAttempt, won: boolean) => {
      if (!round || phase !== 'playing' || actionLockedRef.current) return;
      actionLockedRef.current = true;
      setIsActionLocked(true);

      const nextAttempts = [...attempts, attempt];
      setAttempts(nextAttempts);

      if (won || nextAttempts.length >= SONG_GUESSR_MAX_ATTEMPTS) {
        commitRoundResult(won, nextAttempts.length - 1, nextAttempts);
        setStopSignal((signal) => signal + 1);
        setPhase(won ? 'won' : 'lost');
        return;
      }

      setGuessInputKey((key) => key + 1);
      actionLockedRef.current = false;
      setIsActionLocked(false);
    },
    [attempts, commitRoundResult, phase, round]
  );

  const submitGuess = useCallback(
    (candidate: SongGuessrCandidate) => {
      if (!round) return;
      const correct = isCorrectGuess(round.answer, candidate);
      recordAttempt(
        {
          kind: correct ? 'correct' : 'wrong',
          guessSongId: candidate.songId,
          guessLabel: formatCandidateLabel(candidate)
        },
        correct
      );
    },
    [recordAttempt, round]
  );

  const skipGuess = useCallback(() => recordAttempt({ kind: 'skip' }, false), [recordAttempt]);

  const changePool = useCallback(
    (selection: SongGuessrPoolSelection) => {
      poolSelectionRef.current = selection;
      sessionPoolSelection = selection;
      setPoolSelection(selection);

      let currentState = persistedStateRef.current;
      if (selection.poolType !== 'artist' && selection.poolType !== 'album') {
        currentState = {
          ...currentState,
          poolType: selection.poolType,
          ...(selection.poolId ? { poolId: selection.poolId } : { poolId: undefined })
        };
        updatePersistedState(currentState);
        saveSongGuessrState(currentState);
      }

      void startRound(currentState, selection);
    },
    [startRound, updatePersistedState]
  );

  const closePrompt = useCallback(() => {
    setStopSignal((signal) => signal + 1);
    if (onClose) onClose();
    else changePromptMenuData(false);
  }, [changePromptMenuData, onClose]);

  const minimizePrompt = useCallback(() => {
    setStopSignal((signal) => signal + 1);
    onMinimize?.();
  }, [onMinimize]);

  const copyResult = useCallback(async () => {
    if (!round || (phase !== 'won' && phase !== 'lost')) return;

    const shareText = buildShareText(attempts, phase === 'won', t('songGuessr.roundLabel'));
    try {
      await navigator.clipboard.writeText(shareText);
      setCopied(true);
      if (copiedTimeoutRef.current) clearTimeout(copiedTimeoutRef.current);
      copiedTimeoutRef.current = setTimeout(() => {
        copiedTimeoutRef.current = null;
        setCopied(false);
      }, COPIED_RESET_MS);
    } catch {
      setCopied(false);
    }
  }, [attempts, phase, round, t]);

  const nextRound = useCallback(() => {
    if (phase !== 'won' && phase !== 'lost') return;
    void startRound(persistedStateRef.current);
  }, [phase, startRound]);

  const playAnswerInNora = useCallback(() => {
    if (round) playSong(round.answer.songId);
  }, [playSong, round]);

  /*
   * App.tsx binds the global shortcuts (Space = play/pause, Escape = clear
   * selection) on `window` with no guard for text fields, so typing a space in
   * the guess box was un-pausing the main player. Its listener is registered
   * first, so stopImmediatePropagation from another window listener cannot beat
   * it — the event has to die before it reaches window. This is a native
   * listener rather than a React one because the dialog is portalled outside
   * the React root, where synthetic delegation cannot be relied on.
   */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      event.stopPropagation();

      if (phaseRef.current !== 'playing') return;
      if (event.code !== 'Space' || event.ctrlKey || event.altKey || event.metaKey) return;

      const tagName = (event.target as HTMLElement | null)?.tagName;
      if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'BUTTON') return;

      event.preventDefault();
      setPlaySignal((signal) => signal + 1);
    };

    container.addEventListener('keydown', handleKeyDown);
    return () => container.removeEventListener('keydown', handleKeyDown);
  }, []);

  const unlockedSnippet =
    SONG_GUESSR_SNIPPETS[Math.min(attempts.length, SONG_GUESSR_SNIPPETS.length - 1)];
  const showResult = phase === 'won' || phase === 'lost';
  const stats = persistedState.stats;

  return (
    <div
      ref={containerRef}
      /* Focusable only from script, and with no ring of its own: the dock parks
         focus here when the panel opens before the guess box exists. */
      tabIndex={-1}
      {...{ [SONG_GUESSR_PANEL_ATTRIBUTE]: '' }}
      className="flex h-full min-h-0 w-full flex-col text-ink outline-none"
    >
      {/* The streak is a chip in the fixed-height header: nothing may change the header's height
          and shift the game below it mid-round. */}
      <GameHeader
        icon="graphic_eq"
        title={t('songGuessr.promptTitle')}
        onMinimize={onMinimize ? minimizePrompt : undefined}
        minimizeLabel={t('songGuessr.minimize')}
        onClose={closePrompt}
        closeLabel={t('songGuessr.close')}
      >
        {stats.currentStreak > 0 && (
          <span
            className="flex shrink-0 items-center gap-1 rounded-full bg-accent-soft py-1 pl-1.5 pr-2.5 text-small font-semibold tabular-nums text-echo"
            title={t('songGuessr.streakChip', { count: stats.currentStreak })}
          >
            <Icon name="local_fire_department" filled size={16} />
            {stats.currentStreak}
          </span>
        )}
      </GameHeader>

      <div className="flex min-h-0 flex-1 flex-col px-6 py-5">
        <SongGuessrPoolSelector
          pools={pools}
          selection={poolSelection}
          disabled={phase === 'loading'}
          onChange={changePool}
        />

        {phase === 'loading' && (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center text-center">
            <Icon
              name="progress_activity"
              size={30}
              className="mb-3 animate-spin text-echo motion-reduce:animate-none"
            />
            <p className="text-small text-ink-dim">{t('songGuessr.loading')}</p>
          </div>
        )}

        {phase === 'empty' && (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 text-center">
            <span
              className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-surface-2 text-ink-faint"
              aria-hidden="true"
            >
              <Icon name="library_music" size={30} />
            </span>
            <h2 className="text-section font-semibold text-ink">{t('songGuessr.noRound')}</h2>
            <p className="mt-2 max-w-sm text-body text-ink-dim">
              {poolSelection.poolType === 'artist'
                ? t('songGuessr.noArtistRoundHint')
                : poolSelection.poolType === 'album'
                  ? t('songGuessr.noAlbumRoundHint')
                  : t('songGuessr.noRoundHint')}
            </p>
            <Button
              label={t('songGuessr.tryAgain')}
              iconName="refresh"
              variant="secondary"
              className="m-0 mt-5"
              clickHandler={() => void startRound(persistedStateRef.current)}
            />
          </div>
        )}

        {round && phase === 'playing' && (
          <div className="flex min-h-0 flex-1 flex-col gap-5">
            <div className="flex-shrink-0">
              <SongGuessrPlayer
                round={round}
                snippetLength={unlockedSnippet}
                ladder={SONG_GUESSR_SNIPPETS}
                startOffset={startOffset}
                stopSignal={stopSignal}
                playSignal={playSignal}
                isAnalyzing={isAnalyzing}
              />
            </div>

            <div className="flex flex-shrink-0 justify-center">
              <SongGuessrAttemptList
                attempts={attempts}
                maxAttempts={SONG_GUESSR_MAX_ATTEMPTS}
                variant="dots"
              />
            </div>

            {/* The log is handed to the input so it can share one fixed area
                with the suggestion overlay and keep the buttons still. */}
            <SongGuessrGuessInput
              key={guessInputKey}
              disabled={isActionLocked}
              onSubmit={submitGuess}
              onSkip={skipGuess}
              attemptsLeft={SONG_GUESSR_MAX_ATTEMPTS - attempts.length}
            >
              <SongGuessrAttemptList
                attempts={attempts}
                maxAttempts={SONG_GUESSR_MAX_ATTEMPTS}
                variant="log"
              />
            </SongGuessrGuessInput>
          </div>
        )}

        {round && showResult && (
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <SongGuessrResult
              round={round}
              attempts={attempts}
              won={phase === 'won'}
              copied={copied}
              onCopy={() => void copyResult()}
              onNextRound={nextRound}
              onPlayInNora={playAnswerInNora}
            />
            <SongGuessrStatsPanel
              stats={stats}
              highlightAttempt={phase === 'won' ? attempts.length - 1 : undefined}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default SongGuessrPrompt;

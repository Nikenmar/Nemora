import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AppUpdateContext } from '../../contexts/AppUpdateContext';
import { store } from '@renderer/store';
import { getPerceptualGain } from '../../other/player';
import { getDuelTickets, peekFirstAliveDuelPair, setDuelTickets } from '../../utils/duelQueue';

import Button from '../Button';
import DuelCard, { DuelVersus } from './DuelCard';
import Segmented from '../ui/Segmented';
import { GameHeader } from '../ui/GameWindow';
import TournamentPanel from './Tournament/TournamentPanel';
import type { TournamentMatch, TournamentState } from '@platform/core/stats/tournaments';

type DuelPhase = 'voting' | 'submitting' | 'result';

/** Duels in a series (PLAN/20 D4). */
const SERIES = 10;

type EloDuelPromptProps = {
  initialPair: DuelPair;
  queuedDuels?: number;
  onClose?: () => void;
  onMinimize?: () => void;
};

const preloadArtwork = (src: string) =>
  new Promise<void>((resolve) => {
    let isSettled = false;
    const image = new Image();
    const finish = () => {
      if (isSettled) return;
      isSettled = true;
      clearTimeout(timeout);
      resolve();
    };
    const timeout = setTimeout(finish, 1500);
    image.addEventListener('load', finish, { once: true });
    image.addEventListener('error', finish, { once: true });
    image.src = src;
    if (image.complete) finish();
  });

const preloadPairArtwork = (pair: DuelPair) =>
  Promise.all([
    preloadArtwork(pair.songA.artworkPaths.artworkPath),
    preloadArtwork(pair.songB.artworkPaths.artworkPath)
  ]).then(() => pair);

const EloDuelPrompt = (props: EloDuelPromptProps) => {
  const { changePromptMenuData, toggleSongPlayback } = useContext(AppUpdateContext);
  const { t } = useTranslation();
  const { initialPair, queuedDuels, onClose, onMinimize } = props;

  const persistedQueuedDuels = Math.max(0, queuedDuels ?? 0);
  const [pair, setPair] = useState<DuelPair>(initialPair);
  const [phase, setPhase] = useState<DuelPhase>('voting');
  const [result, setResult] = useState<DuelResult>();
  const [winnerSongId, setWinnerSongId] = useState<string>();
  const [previewingSongId, setPreviewingSongId] = useState<string>();
  const [remainingQueuedDuels, setRemainingQueuedDuels] = useState(persistedQueuedDuels);
  const [showNextRetry, setShowNextRetry] = useState(false);
  // The tournament is a second face of the same duel: it votes through the same
  // path and writes the same ratings, so it lives beside the single duel rather
  // than on a page of its own.
  const [isTournamentOpen, setIsTournamentOpen] = useState(false);
  const [tournament, setTournament] = useState<TournamentState>();
  const [currentTournamentMatch, setCurrentTournamentMatch] = useState<TournamentMatch>();
  // The bracket is seeded from the whole library, not from the pair on screen, so
  // both the seedable count and the participants' card data come from core.
  const [tournamentSongs, setTournamentSongs] = useState<DuelSongEntry[]>([]);
  const [eligibleTrackCount, setEligibleTrackCount] = useState(0);
  // A series of ten (PLAN/20 D4): how many are done, or null when no series runs.
  const [series, setSeries] = useState<number | null>(null);
  // A tier move this duel earned (PLAN/15 T2's suggestion, offered at the moment it is earned).
  const [earnedMove, setEarnedMove] = useState<(TierSuggestion & { title: string }) | null>(null);
  const [moveDone, setMoveDone] = useState(false);
  const [announcement, setAnnouncement] = useState('');

  const refreshTournament = useCallback(async () => {
    const overview = await window.api.eloDuels.getTournamentOverview();
    setTournament(overview.state);
    setCurrentTournamentMatch(overview.currentMatch);
    setTournamentSongs(overview.songs);
    setEligibleTrackCount(overview.eligibleTrackCount);
    return overview;
  }, []);

  useEffect(() => {
    if (!isTournamentOpen) return;
    refreshTournament().catch((error: unknown) => console.error(error));
  }, [isTournamentOpen, refreshTournament]);

  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const remainingQueuedDuelsRef = useRef(persistedQueuedDuels);
  const actionLockedRef = useRef(false);
  const completionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopPreview = useCallback(() => {
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current.removeAttribute('src');
      previewAudioRef.current = null;
    }
    setPreviewingSongId(undefined);
  }, []);

  // Release the preview audio on unmount — it must never outlive the prompt.
  // Avoid calling setState from the cleanup path.
  useEffect(
    () => () => {
      if (completionTimeoutRef.current) clearTimeout(completionTimeoutRef.current);
      previewAudioRef.current?.pause();
      previewAudioRef.current?.removeAttribute('src');
      previewAudioRef.current = null;
    },
    []
  );

  // The dock can already hold a minimized manual session when a new automatic
  // duel arrives. Keep that existing prompt attached to the persisted backlog
  // instead of freezing the queue size from the session's first render.
  useEffect(() => {
    remainingQueuedDuelsRef.current = persistedQueuedDuels;
    setRemainingQueuedDuels(persistedQueuedDuels);
  }, [persistedQueuedDuels]);

  const togglePreview = useCallback(
    (entry: DuelSongEntry) => {
      if (previewingSongId === entry.songId) {
        stopPreview();
        return;
      }
      stopPreview();
      // Pause the main player while auditioning; do NOT auto-resume.
      if (store.state.player.isCurrentSongPlaying) toggleSongPlayback();

      // Isolated preview element — the main player/queue is never touched.
      const audio = new Audio();
      // Main already supplies a complete nemora:// URL, including its cache query.
      audio.src = entry.path;
      const { volume } = store.state.player;
      audio.volume = volume.isMuted ? 0 : getPerceptualGain(volume.value);
      audio.addEventListener('loadedmetadata', () => {
        // Start at ~33% — the recognizable part of the song.
        if (Number.isFinite(audio.duration) && audio.duration > 0)
          audio.currentTime = audio.duration * 0.33;
      });
      audio.addEventListener('ended', stopPreview);
      previewAudioRef.current = audio;
      setPreviewingSongId(entry.songId);
      audio.play().catch((err) => {
        console.error(err);
        stopPreview();
      });
    },
    [previewingSongId, stopPreview, toggleSongPlayback]
  );

  /**
   * An audition belongs to the pair on screen, so it ends when that pair does.
   *
   * The single duel stops it by hand in every branch that moves on - vote, skip,
   * minimize - and the tournament, which shares this same preview element, had
   * no such call in its submit path: picking a winner advanced the bracket while
   * the previous track kept playing underneath the next match, until something
   * else happened to start.
   *
   * Keyed on what is being auditioned rather than on the handlers that change
   * it, because the handlers are exactly what got forgotten. Switching between
   * the duel and the tournament counts too: the view changes, the pair on screen
   * changes with it, and the sound should not survive either.
   */
  useEffect(() => {
    stopPreview();
  }, [currentTournamentMatch?.id, isTournamentOpen, stopPreview]);

  const closePrompt = useCallback(
    () => (onClose ? onClose() : changePromptMenuData(false)),
    [changePromptMenuData, onClose]
  );

  const minimizePrompt = useCallback(() => {
    stopPreview();
    onMinimize?.();
  }, [onMinimize, stopPreview]);

  const consumeQueuedDuel = useCallback(() => {
    const tickets = getDuelTickets();
    if (tickets.length === 0 || !pair.ticketAnchorSongId) return;
    // Only consume when the CURRENT pair is the queued one — a manual duel
    // played while the backlog grew must not eat someone else's pair.
    if (tickets[0].anchorSongId !== pair.ticketAnchorSongId) return;
    const nextTickets = tickets.slice(1);
    setDuelTickets(nextTickets);
    remainingQueuedDuelsRef.current = nextTickets.length;
    setRemainingQueuedDuels(nextTickets.length);
  }, [pair.ticketAnchorSongId]);

  const fetchNextPair = useCallback(
    (fallbackPhase: DuelPhase) => {
      stopPreview();
      setShowNextRetry(false);
      // Keep the completed result visible while loading the next pair. Hiding
      // it first changes the centered dialog's height and causes a visible flash.
      if (fallbackPhase !== 'result') setPhase('submitting');
      // Next earned pair from the backlog first; fresh random pair when it's empty.
      peekFirstAliveDuelPair()
        .then((queuedPair) => queuedPair ??
            // PLAN/15 T1: some duels teach Smart Shuffle, when the user switched it on.
            window.api.eloDuels.getDuelPair(
              undefined,
              !store.state.localStorage.preferences.isTeachingDuelsDisabled
            ))
        .then((nextPair) => (nextPair ? preloadPairArtwork(nextPair) : nextPair))
        .then((nextPair) => {
          if (nextPair) {
            setPair(nextPair);
            setPhase('voting');
            setResult(undefined);
            setWinnerSongId(undefined);
            setEarnedMove(null);
            setMoveDone(false);
          } else closePrompt();
          actionLockedRef.current = false;
          return undefined;
        })
        .catch((err) => {
          console.error(err);
          actionLockedRef.current = false;
          setShowNextRetry(fallbackPhase === 'result');
          setPhase(fallbackPhase);
        });
    },
    [closePrompt, stopPreview]
  );

  const vote = useCallback(
    (selectedSongId: string) => {
      if (phase !== 'voting' || actionLockedRef.current) return;
      actionLockedRef.current = true;
      stopPreview();
      setPhase('submitting');
      window.api.eloDuels
        .submitDuelResult(pair.songA.songId, pair.songB.songId, selectedSongId)
        .then(async (duelResult) => {
          consumeQueuedDuel();
          setResult(duelResult);
          setWinnerSongId(selectedSongId);
          setPhase('result');
          setSeries((done) => (done === null ? null : done + 1));
          const winner = selectedSongId === pair.songA.songId ? pair.songA : pair.songB;
          setAnnouncement(t('eloDuels.picked', { title: winner.title }));
          // A tier move this duel earned holds the result until the user answers it.
          const moves = await window.api.tierlistsData.getTierSuggestions().catch(() => []);
          const move = moves.find((m) => m.songId === pair.songA.songId || m.songId === pair.songB.songId);
          actionLockedRef.current = false;
          if (move) {
            const title = move.songId === pair.songA.songId ? pair.songA.title : pair.songB.title;
            setEarnedMove({ ...move, title });
            setAnnouncement(t('eloDuels.moveOffer', { title, tier: move.toName }));
            return undefined;
          }
          completionTimeoutRef.current = setTimeout(() => {
            completionTimeoutRef.current = null;
            actionLockedRef.current = true;
            fetchNextPair('result');
          }, 1000);
          return undefined;
        })
        .catch((err) => {
          console.error(err);
          actionLockedRef.current = false;
          setPhase('voting');
        });
    },
    [consumeQueuedDuel, fetchNextPair, phase, pair, stopPreview, t]
  );

  const skipDuel = useCallback(
    (reason: DuelSkipReason) => {
      if (phase !== 'voting' || actionLockedRef.current) return;
      actionLockedRef.current = true;
      stopPreview();
      window.api.eloDuels
        .recordDuelSkip(pair.songA.songId, pair.songB.songId, reason)
        .finally(() => {
          consumeQueuedDuel();
          setSeries((done) => (done === null ? null : done + 1));
          setAnnouncement(t('eloDuels.skipped'));
          fetchNextPair('voting');
        })
        .catch((error) => console.error(error));
    },
    [consumeQueuedDuel, fetchNextPair, pair.songA.songId, pair.songB.songId, phase, stopPreview, t]
  );

  const advanceAfterResult = useCallback(() => {
    if (phase !== 'result' || actionLockedRef.current) return;
    if (completionTimeoutRef.current) {
      clearTimeout(completionTimeoutRef.current);
      completionTimeoutRef.current = null;
    }
    actionLockedRef.current = true;
    fetchNextPair('result');
  }, [fetchNextPair, phase]);

  const applyMove = useCallback(() => {
    if (!earnedMove) return;
    window.api.tierlistsData
      .applyTierSuggestion(earnedMove.tierlistId, earnedMove.songId, earnedMove.to)
      .then(() => {
        setMoveDone(true);
        setAnnouncement(t('eloDuels.moved', { title: earnedMove.title, tier: earnedMove.toName }));
        completionTimeoutRef.current = setTimeout(() => {
          completionTimeoutRef.current = null;
          advanceAfterResult();
        }, 900);
      })
      .catch((error: unknown) => console.error(error));
  }, [advanceAfterResult, earnedMove, t]);

  // A series ends after ten.
  useEffect(() => {
    if (series !== null && series >= SERIES) setAnnouncement(t('eloDuels.seriesDone', { count: SERIES }));
  }, [series, t]);

  /**
   * Duels without a mouse (PLAN/20 D4): Left / Right pick, Down skips ("Can't decide"), Space plays
   * a preview and, pressed again, the other song's; Enter goes on from a result. Esc minimises
   * (the game window's own key). Keys typed into a field or on a focused button stay theirs.
   */
  useEffect(() => {
    if (isTournamentOpen) return undefined;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, button, [contenteditable="true"]')) return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (phase === 'voting') {
        if (e.key === 'ArrowLeft') vote(pair.songA.songId);
        else if (e.key === 'ArrowRight') vote(pair.songB.songId);
        else if (e.key === 'ArrowDown') skipDuel('cantDecide');
        else if (e.key === ' ') togglePreview(previewingSongId === pair.songA.songId ? pair.songB : pair.songA);
        else return;
      } else if (phase === 'result' && e.key === 'Enter') {
        if (earnedMove && !moveDone) applyMove();
        else advanceAfterResult();
      } else if (phase === 'result' && e.key === 'ArrowRight' && earnedMove && !moveDone) {
        advanceAfterResult();
      } else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    advanceAfterResult,
    applyMove,
    earnedMove,
    isTournamentOpen,
    moveDone,
    pair,
    phase,
    previewingSongId,
    skipDuel,
    togglePreview,
    vote
  ]);

  return (
    <>
      <GameHeader
        icon={isTournamentOpen ? 'account_tree' : 'swords'}
        title={isTournamentOpen ? t('duels.tournament.title') : t('eloDuels.dockName')}
        subtitle={
          !isTournamentOpen && remainingQueuedDuels > 0
            ? t('eloDuels.queuedRemaining', { count: remainingQueuedDuels })
            : undefined
        }
        onMinimize={onMinimize ? minimizePrompt : undefined}
        minimizeLabel={t('eloDuels.minimize')}
        onClose={closePrompt}
        closeLabel={t('eloDuels.close')}
      >
        <Segmented
          size="sm"
          label={t('duels.tournament.open')}
          value={isTournamentOpen ? 'tournament' : 'duel'}
          onChange={(view) => setIsTournamentOpen(view === 'tournament')}
          options={[
            { value: 'duel', label: t('eloDuels.dockName'), iconName: 'swords' },
            { value: 'tournament', label: t('duels.tournament.open'), iconName: 'account_tree' }
          ]}
        />
      </GameHeader>

      <div className="min-h-0 overflow-y-auto px-8 pb-7 pt-6">
        {isTournamentOpen ? (
          <TournamentPanel
            tournament={tournament}
            currentMatch={currentTournamentMatch}
            songs={tournamentSongs}
            eligibleTrackCount={eligibleTrackCount}
            previewingSongId={previewingSongId}
            onStart={async (size) => {
              await window.api.eloDuels.startTournament(size);
              return refreshTournament();
            }}
            onSubmit={async (matchId, winnerId) => {
              await window.api.eloDuels.submitTournamentDuel(matchId, winnerId);
              return refreshTournament();
            }}
            onPreviewToggle={togglePreview}
          />
        ) : (
          <>
            <h2 className="mb-2 text-center text-title font-semibold text-ink">
              {t('eloDuels.promptTitle')}
            </h2>
            <div className="mb-5 flex items-center justify-center gap-3 text-micro text-ink-faint">
              <span className="duel-keys-hint">{t('eloDuels.keysHint')}</span>
              {series === null ? (
                <Button
                  label={t('eloDuels.seriesStart', { count: SERIES })}
                  iconName="format_list_numbered"
                  variant="ghost"
                  size="sm"
                  className="duel-series-btn !mr-0"
                  clickHandler={() => setSeries(0)}
                />
              ) : (
                <div className="duel-series flex items-center gap-2" aria-label={t('eloDuels.seriesProgress', { done: Math.min(series, SERIES), count: SERIES })}>
                  <div className="flex gap-1" aria-hidden>
                    {Array.from({ length: SERIES }, (_, i) => (
                      <span key={i} className={`h-1.5 w-5 rounded-full ${i < series ? 'bg-accent' : 'bg-surface-2'}`} />
                    ))}
                  </div>
                  <span className="tabular-nums">
                    {series >= SERIES ? t('eloDuels.seriesDone', { count: SERIES }) : `${series} / ${SERIES}`}
                  </span>
                  <Button
                    label={series >= SERIES ? t('eloDuels.seriesAgain') : t('eloDuels.seriesEnd')}
                    variant="ghost"
                    size="sm"
                    className="!mr-0"
                    clickHandler={() => setSeries(series >= SERIES ? 0 : null)}
                  />
                </div>
              )}
            </div>
            <p className="sr-only" aria-live="polite">
              {announcement}
            </p>
            <DuelVersus
              left={
                <DuelCard
                  entry={pair.songA}
                  onVote={() => vote(pair.songA.songId)}
                  onPreviewToggle={() => togglePreview(pair.songA)}
                  isPreviewing={previewingSongId === pair.songA.songId}
                  isDisabled={phase !== 'voting'}
                  showResult={phase === 'result'}
                  isWinner={winnerSongId === pair.songA.songId}
                  delta={result?.deltaA}
                />
              }
              right={
                <DuelCard
                  entry={pair.songB}
                  onVote={() => vote(pair.songB.songId)}
                  onPreviewToggle={() => togglePreview(pair.songB)}
                  isPreviewing={previewingSongId === pair.songB.songId}
                  isDisabled={phase !== 'voting'}
                  showResult={phase === 'result'}
                  isWinner={winnerSongId === pair.songB.songId}
                  delta={result?.deltaB}
                />
              }
            />

            {/* Same height in every phase, so the dialog does not jump when a vote lands. */}
            <div className="buttons-container mt-6 flex min-h-[4.25rem] flex-col items-center justify-center gap-2.5">
              {phase === 'result' && earnedMove ? (
                <div className="duel-move flex flex-col items-center gap-2">
                  <span className="text-small text-ink-dim">
                    {moveDone
                      ? t('eloDuels.moved', { title: earnedMove.title, tier: earnedMove.toName })
                      : t('eloDuels.moveOffer', { title: earnedMove.title, tier: earnedMove.toName })}
                  </span>
                  {!moveDone && (
                    <div className="flex gap-2">
                      <Button
                        label={t('eloDuels.moveTo', { tier: earnedMove.toName })}
                        iconName="move_up"
                        variant="primary"
                        className="duel-move-btn m-0"
                        clickHandler={applyMove}
                      />
                      <Button label={t('eloDuels.nextDuel')} iconName="bolt" className="m-0" clickHandler={advanceAfterResult} />
                    </div>
                  )}
                </div>
              ) : phase === 'result' && showNextRetry ? (
                <Button
                  label={t('eloDuels.nextDuel')}
                  iconName="bolt"
                  variant="primary"
                  size="lg"
                  className="next-duel-btn m-0"
                  clickHandler={advanceAfterResult}
                />
              ) : (
                <div
                  aria-hidden={phase === 'result'}
                  className={`flex flex-col items-center gap-2.5 transition-opacity duration-150 ${
                    phase === 'result'
                      ? 'pointer-events-none invisible'
                      : phase === 'submitting'
                        ? 'pointer-events-none opacity-50'
                        : ''
                  }`}
                >
                  <span
                    id="duel-skip-reason-label"
                    className="text-micro font-semibold uppercase tracking-wide text-ink-faint"
                  >
                    {t('eloDuels.skipReasonLabel')}
                  </span>
                  <div
                    role="group"
                    aria-labelledby="duel-skip-reason-label"
                    className="flex flex-wrap justify-center gap-2"
                  >
                    <Button
                      label={t('eloDuels.tooClose')}
                      iconName="balance"
                      tooltipLabel={t('eloDuels.tooCloseHint')}
                      isDisabled={phase !== 'voting'}
                      variant="outline"
                      className="skip-duel-btn m-0"
                      clickHandler={() => skipDuel('tooClose')}
                    />
                    <Button
                      label={t('eloDuels.tooDifferent')}
                      iconName="call_split"
                      tooltipLabel={t('eloDuels.tooDifferentHint')}
                      isDisabled={phase !== 'voting'}
                      variant="outline"
                      className="skip-duel-btn m-0"
                      clickHandler={() => skipDuel('tooDifferent')}
                    />
                    <Button
                      label={t('eloDuels.cantDecide')}
                      iconName="help"
                      tooltipLabel={t('eloDuels.cantDecideHint')}
                      isDisabled={phase !== 'voting'}
                      variant="outline"
                      className="skip-duel-btn m-0"
                      clickHandler={() => skipDuel('cantDecide')}
                    />
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
};

export default EloDuelPrompt;

import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type {
  TournamentMatch,
  TournamentSize,
  TournamentState
} from '@platform/core/stats/tournaments';

import TournamentBracket from './TournamentBracket';
import TournamentDuel from './TournamentDuel';
import TournamentSetup from './TournamentSetup';

interface TournamentPanelProps {
  tournament?: TournamentState;
  /** The match to play now, already reconciled against the library by core. */
  currentMatch?: TournamentMatch;
  /** Card data for the bracket's participants. */
  songs: readonly DuelSongEntry[];
  /** Tracks a bracket can be seeded from. Not `songs.length`: those are participants. */
  eligibleTrackCount: number;
  previewingSongId?: string;
  onStart: (size: TournamentSize) => Promise<unknown>;
  onSubmit: (matchId: string, winnerSongId: string) => Promise<unknown>;
  onPreviewToggle: (song: DuelSongEntry) => void;
}

/**
 * Presentational on purpose: the parent owns the tournament data and refreshes it
 * after every action. An earlier version refetched whenever the state object
 * changed identity, which is every refresh, and span forever.
 */
const TournamentPanel = ({
  tournament,
  currentMatch,
  songs,
  eligibleTrackCount,
  previewingSongId,
  onStart,
  onSubmit,
  onPreviewToggle
}: TournamentPanelProps) => {
  const { t } = useTranslation();
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string>();

  /** Takes the message already translated: the i18n types want literal keys at the call site. */
  const run = useCallback((action: () => Promise<unknown>, failureMessage: string) => {
    setIsBusy(true);
    setError(undefined);
    return action()
      .catch((reason: unknown) => {
        console.error(reason);
        setError(failureMessage);
      })
      .finally(() => setIsBusy(false));
  }, []);

  const start = useCallback(
    (size: TournamentSize) => run(() => onStart(size), t('duels.tournament.startFailed')),
    [onStart, run, t]
  );

  const vote = useCallback(
    (winnerSongId: string) => {
      if (!currentMatch || isBusy) return undefined;
      return run(() => onSubmit(currentMatch.id, winnerSongId), t('duels.tournament.submitFailed'));
    },
    [currentMatch, isBusy, onSubmit, run, t]
  );

  return (
    <div className="duel-tournament">
      <p className="mb-5 max-w-prose text-body text-ink-dim">{t('duels.tournament.subtitle')}</p>

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-panel bg-danger-soft px-4 py-3 text-small text-danger"
        >
          {error}
        </div>
      )}

      {(!tournament || tournament.status === 'completed') && (
        <TournamentSetup trackCount={eligibleTrackCount} isBusy={isBusy} onStart={start} />
      )}
      {tournament?.status === 'active' && currentMatch && (
        <TournamentDuel
          match={currentMatch}
          songs={songs}
          isBusy={isBusy}
          previewingSongId={previewingSongId}
          onVote={vote}
          onPreviewToggle={onPreviewToggle}
        />
      )}
      {tournament && <TournamentBracket tournament={tournament} songs={songs} />}
    </div>
  );
};

export default TournamentPanel;

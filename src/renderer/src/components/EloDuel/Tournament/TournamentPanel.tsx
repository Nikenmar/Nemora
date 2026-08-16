import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type {
  PreparedTournament,
  TournamentDuelSubmission,
  TournamentSize,
  TournamentState
} from '@platform/core/stats/tournaments';

import TournamentBracket from './TournamentBracket';
import TournamentDuel from './TournamentDuel';
import TournamentSetup from './TournamentSetup';

interface TournamentPanelProps {
  tournament?: TournamentState;
  songs: readonly DuelSongEntry[];
  previewingSongId?: string;
  onStart: (size: TournamentSize) => Promise<TournamentState>;
  onResume: () => Promise<PreparedTournament | undefined>;
  onSubmit: (matchId: string, winnerSongId: string) => Promise<TournamentDuelSubmission>;
  onPreviewToggle: (song: DuelSongEntry) => void;
}

const TournamentPanel = ({
  tournament,
  songs,
  previewingSongId,
  onStart,
  onResume,
  onSubmit,
  onPreviewToggle
}: TournamentPanelProps) => {
  const { t } = useTranslation();
  const [localTournament, setLocalTournament] = useState(tournament);
  const [currentMatch, setCurrentMatch] = useState<PreparedTournament['currentMatch']>();
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string>();
  const songIdsKey = useMemo(() => songs.map(({ songId }) => songId).join('\u0000'), [songs]);

  useEffect(() => setLocalTournament(tournament), [tournament]);

  const resume = useCallback(() => {
    setIsBusy(true);
    return onResume()
      .then((prepared) => {
        setLocalTournament(prepared?.state);
        setCurrentMatch(prepared?.currentMatch);
        setError(undefined);
        return undefined;
      })
      .catch((reason) => {
        console.error(reason);
        setError(t('duels.tournament.resumeFailed'));
      })
      .finally(() => setIsBusy(false));
  }, [onResume, t]);

  useEffect(() => {
    if (!tournament || tournament.status === 'completed') {
      setCurrentMatch(undefined);
      return;
    }
    void resume();
  }, [resume, songIdsKey, tournament]);

  const start = useCallback(
    (size: TournamentSize) => {
      setIsBusy(true);
      setError(undefined);
      return onStart(size)
        .then((state) => {
          setLocalTournament(state);
          return onResume();
        })
        .then((prepared) => {
          setLocalTournament(prepared?.state);
          setCurrentMatch(prepared?.currentMatch);
          return undefined;
        })
        .catch((reason) => {
          console.error(reason);
          setError(t('duels.tournament.startFailed'));
        })
        .finally(() => setIsBusy(false));
    },
    [onResume, onStart, t]
  );

  const vote = useCallback(
    (winnerSongId: string) => {
      if (!currentMatch || isBusy) return;
      setIsBusy(true);
      setError(undefined);
      return onSubmit(currentMatch.id, winnerSongId)
        .then(({ tournament: nextTournament }) => {
          setLocalTournament(nextTournament);
          return onResume();
        })
        .then((prepared) => {
          setLocalTournament(prepared?.state);
          setCurrentMatch(prepared?.currentMatch);
          return undefined;
        })
        .catch((reason) => {
          console.error(reason);
          setError(t('duels.tournament.submitFailed'));
        })
        .finally(() => setIsBusy(false));
    },
    [currentMatch, isBusy, onResume, onSubmit, t]
  );

  return (
    <div className="duel-tournament">
      <div className="mb-5 flex items-center gap-3">
        <span className="material-icons-round text-3xl text-font-color-highlight dark:text-dark-font-color-highlight">
          account_tree
        </span>
        <div>
          <h2 className="text-2xl font-medium">{t('duels.tournament.title')}</h2>
          <p className="text-sm opacity-65">{t('duels.tournament.subtitle')}</p>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300"
        >
          {error}
        </div>
      )}

      {(!localTournament || localTournament.status === 'completed') && (
        <TournamentSetup trackCount={songs.length} isBusy={isBusy} onStart={start} />
      )}
      {localTournament?.status === 'active' && currentMatch && (
        <TournamentDuel
          match={currentMatch}
          songs={songs}
          isBusy={isBusy}
          previewingSongId={previewingSongId}
          onVote={vote}
          onPreviewToggle={onPreviewToggle}
        />
      )}
      {localTournament && <TournamentBracket tournament={localTournament} songs={songs} />}
    </div>
  );
};

export default TournamentPanel;

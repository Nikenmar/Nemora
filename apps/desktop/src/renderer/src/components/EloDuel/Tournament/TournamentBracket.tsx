import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { TournamentMatch, TournamentState } from '@platform/core/stats/tournaments';

interface TournamentBracketProps {
  tournament: TournamentState;
  songs: readonly DuelSongEntry[];
}

const TournamentBracket = ({ tournament, songs }: TournamentBracketProps) => {
  const { t } = useTranslation();
  const songById = useMemo(() => new Map(songs.map((song) => [song.songId, song])), [songs]);
  const rounds = useMemo(() => {
    const grouped = new Map<number, TournamentMatch[]>();
    for (const match of tournament.matches) {
      const round = grouped.get(match.round) ?? [];
      round.push(match);
      grouped.set(match.round, round);
    }
    return [...grouped.entries()].sort(([left], [right]) => left - right);
  }, [tournament.matches]);

  const labelFor = (songId?: string) => {
    if (!songId) return t('duels.tournament.pendingSlot');
    return songById.get(songId)?.title ?? t('duels.tournament.missingTrack');
  };

  return (
    <section className="mt-5 rounded-xl bg-background-color-2/60 p-5 dark:bg-dark-background-color-2/60">
      <div className="flex items-center justify-between gap-4">
        <h3 className="text-lg font-medium">{t('duels.tournament.bracket')}</h3>
        {tournament.status === 'completed' && tournament.championSongId && (
          <span className="flex items-center gap-2 text-sm font-medium text-font-color-highlight dark:text-dark-font-color-highlight">
            <span className="material-icons-round text-lg">emoji_events</span>
            {t('duels.tournament.champion', {
              title: labelFor(tournament.championSongId)
            })}
          </span>
        )}
      </div>

      <div className="mt-4 flex gap-4 overflow-x-auto pb-2">
        {rounds.map(([round, matches]) => (
          <div key={round} className="w-56 shrink-0">
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide opacity-60">
              {round === rounds.length - 1
                ? t('duels.tournament.final')
                : t('duels.tournament.round', { count: round + 1 })}
            </h4>
            <div className="flex flex-col gap-3">
              {matches.map((match) => (
                <div
                  key={match.id}
                  className="rounded-lg border border-background-color-3 bg-background-color-1/50 p-3 text-sm dark:border-dark-background-color-3 dark:bg-dark-background-color-1/50"
                >
                  {[match.songAId, match.songBId].map((songId, index) => {
                    const isWinner = songId !== undefined && songId === match.winnerSongId;
                    return (
                      <div
                        key={`${match.id}-${index}`}
                        className={`flex items-center justify-between gap-2 py-1 ${
                          isWinner
                            ? 'font-semibold text-font-color-highlight dark:text-dark-font-color-highlight'
                            : match.resolution
                              ? 'opacity-55'
                              : ''
                        }`}
                      >
                        <span className="truncate" title={labelFor(songId)}>
                          {labelFor(songId)}
                        </span>
                        {isWinner && (
                          <span className="material-icons-round text-base">arrow_forward</span>
                        )}
                      </div>
                    );
                  })}
                  {match.resolution && (
                    <div className="mt-1 border-t border-background-color-3 pt-2 text-xs opacity-60 dark:border-dark-background-color-3">
                      {t(`duels.tournament.resolution.${match.resolution}`)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};

export default TournamentBracket;

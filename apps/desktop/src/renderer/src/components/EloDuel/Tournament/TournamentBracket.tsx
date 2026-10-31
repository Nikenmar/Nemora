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
    <section className="mt-7 border-t border-line pt-5">
      <div className="flex items-center justify-between gap-4">
        <h3 className="text-body font-semibold text-ink">{t('duels.tournament.bracket')}</h3>
        {tournament.status === 'completed' && tournament.championSongId && (
          <span className="flex min-w-0 items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1 text-small font-semibold text-echo">
            <span className="ms-icon ms-icon-filled text-base">emoji_events</span>
            {t('duels.tournament.champion', {
              title: labelFor(tournament.championSongId)
            })}
          </span>
        )}
      </div>

      <div className="mt-4 flex gap-4 overflow-x-auto pb-2">
        {rounds.map(([round, matches]) => (
          <div key={round} className="w-52 shrink-0">
            <h4 className="mb-2 text-micro font-semibold uppercase tracking-wide text-ink-faint">
              {round === rounds.length - 1
                ? t('duels.tournament.final')
                : t('duels.tournament.round', { count: round + 1 })}
            </h4>
            <div className="flex flex-col gap-2">
              {matches.map((match) => (
                <div
                  key={match.id}
                  className="rounded-xl border border-line bg-surface-2 px-3 py-2 text-small"
                >
                  {[match.songAId, match.songBId].map((songId, index) => {
                    const isWinner = songId !== undefined && songId === match.winnerSongId;
                    return (
                      <div
                        key={`${match.id}-${index}`}
                        className={`flex items-center justify-between gap-2 py-1 ${
                          isWinner
                            ? 'font-semibold text-ink'
                            : match.resolution
                              ? 'text-ink-faint'
                              : songId
                                ? 'text-ink-dim'
                                : 'italic text-ink-faint'
                        }`}
                      >
                        <span className="truncate" title={labelFor(songId)}>
                          {labelFor(songId)}
                        </span>
                        {isWinner && (
                          <span className="ms-icon shrink-0 text-base text-echo">arrow_forward</span>
                        )}
                      </div>
                    );
                  })}
                  {match.resolution && (
                    <div className="mt-1 border-t border-line pt-1.5 text-micro text-ink-faint">
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

import { useTranslation } from 'react-i18next';

import type { TournamentMatch } from '@platform/core/stats/tournaments';

import DuelCard from '../DuelCard';

interface TournamentDuelProps {
  match: TournamentMatch;
  songs: readonly DuelSongEntry[];
  isBusy: boolean;
  previewingSongId?: string;
  onVote: (winnerSongId: string) => void;
  onPreviewToggle: (song: DuelSongEntry) => void;
}

const TournamentDuel = ({
  match,
  songs,
  isBusy,
  previewingSongId,
  onVote,
  onPreviewToggle
}: TournamentDuelProps) => {
  const { t } = useTranslation();
  const songA = songs.find(({ songId }) => songId === match.songAId);
  const songB = songs.find(({ songId }) => songId === match.songBId);
  if (!songA || !songB) return null;

  return (
    <section className="rounded-xl bg-surface-2/60 p-5">
      <h3 className="mb-5 text-center text-section font-semibold text-ink">
        {t('duels.tournament.currentMatch', {
          round: match.round + 1,
          match: match.position + 1
        })}
      </h3>
      <div className="flex items-center justify-center gap-6">
        <DuelCard
          entry={songA}
          onVote={() => onVote(songA.songId)}
          onPreviewToggle={() => onPreviewToggle(songA)}
          isPreviewing={previewingSongId === songA.songId}
          isDisabled={isBusy}
          showResult={false}
        />
        <span className="text-2xl font-semibold opacity-60">VS</span>
        <DuelCard
          entry={songB}
          onVote={() => onVote(songB.songId)}
          onPreviewToggle={() => onPreviewToggle(songB)}
          isPreviewing={previewingSongId === songB.songId}
          isDisabled={isBusy}
          showResult={false}
        />
      </div>
    </section>
  );
};

export default TournamentDuel;

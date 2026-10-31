import { useTranslation } from "react-i18next";

import type { TournamentMatch } from "@platform/core/stats/tournaments";

import DuelCard, { DuelVersus } from "../DuelCard";

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
  onPreviewToggle,
}: TournamentDuelProps) => {
  const { t } = useTranslation();
  const songA = songs.find(({ songId }) => songId === match.songAId);
  const songB = songs.find(({ songId }) => songId === match.songBId);
  if (!songA || !songB) return null;

  return (
    <section>
      <h3 className="mb-4 text-center text-micro font-semibold uppercase tracking-wide text-ink-faint">
        {t("duels.tournament.currentMatch", {
          round: match.round + 1,
          match: match.position + 1,
        })}
      </h3>
      <DuelVersus
        left={
          <DuelCard
            entry={songA}
            onVote={() => onVote(songA.songId)}
            onPreviewToggle={() => onPreviewToggle(songA)}
            isPreviewing={previewingSongId === songA.songId}
            isDisabled={isBusy}
            showResult={false}
          />
        }
        right={
          <DuelCard
            entry={songB}
            onVote={() => onVote(songB.songId)}
            onPreviewToggle={() => onPreviewToggle(songB)}
            isPreviewing={previewingSongId === songB.songId}
            isDisabled={isBusy}
            showResult={false}
          />
        }
      />
    </section>
  );
};

export default TournamentDuel;

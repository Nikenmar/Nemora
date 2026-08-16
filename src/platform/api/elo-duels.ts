import { getRuntime } from '../runtime';
import type {
  PreparedTournament,
  TournamentDuelSubmission,
  TournamentSize,
  TournamentState
} from '../core/stats/tournaments';

export const eloDuels = {
  getDuelPair: async (pinnedSongId?: string): Promise<DuelPair | null> =>
    getRuntime().getDuelPair(pinnedSongId),
  selectDuelAnchor: async (
    candidates: DuelAnchorCandidate[],
    excludedSongIds?: string[]
  ): Promise<string | null> => getRuntime().selectDuelAnchor(candidates, excludedSongIds),
  getDuelPairByIds: async (songAId: string, songBId: string): Promise<DuelPair | null> =>
    getRuntime().getDuelPairByIds(songAId, songBId),
  recordDuelSkip: async (
    songAId: string,
    songBId: string,
    reason?: DuelSkipReason
  ): Promise<void> => getRuntime().recordDuelSkip(songAId, songBId, reason),
  submitDuelResult: async (
    songAId: string,
    songBId: string,
    winnerSongId: string
  ): Promise<DuelResult> => getRuntime().submitDuelResult(songAId, songBId, winnerSongId),
  /** Seeds a fresh bracket by current rating and persists it. */
  startTournament: async (size: TournamentSize): Promise<TournamentState> =>
    getRuntime().startTournament(size),
  /** The bracket in progress, already reconciled against the current library. */
  resumeTournament: async (): Promise<PreparedTournament | undefined> =>
    getRuntime().resumeTournament(),
  submitTournamentDuel: async (
    matchId: string,
    winnerSongId: string
  ): Promise<TournamentDuelSubmission> => getRuntime().submitTournamentDuel(matchId, winnerSongId)
};

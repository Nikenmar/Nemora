import { getRuntime } from '../runtime';

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
  ): Promise<DuelResult> => getRuntime().submitDuelResult(songAId, songBId, winnerSongId)
};

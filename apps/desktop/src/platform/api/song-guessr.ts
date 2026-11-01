import { getRuntime } from '../runtime';

export const songGuessr = {
  getRound: async (options: SongGuessrRoundOptions): Promise<SongGuessrRound | null> =>
    getRuntime().getSongGuessrRound(options),
  searchCandidates: async (
    query: string,
    limit?: number,
    offset?: number
  ): Promise<SongGuessrSearchResult> =>
    getRuntime().searchSongGuessrCandidates(query, limit, offset),
  getPools: async (): Promise<SongGuessrPoolOption[]> => getRuntime().getSongGuessrPools(),
  getMoments: async (songId: string): Promise<[number, number][]> => getRuntime().getSongMoments(songId),
  recordRound: async (songId: string, attempts: number | null, poolKind?: string): Promise<void> =>
    getRuntime().recordSongGuessrRound(songId, attempts, poolKind)
};

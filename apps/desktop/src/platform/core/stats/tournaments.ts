// The view's contract for tournaments; brackets are computed by nemora-core (tournament.rs).

export const TOURNAMENT_SIZES = [8, 16, 32] as const;

export type TournamentSize = (typeof TOURNAMENT_SIZES)[number];
export type TournamentResolution = 'played' | 'forfeit' | 'bye' | 'vacant';

export interface TournamentParticipant {
  songId: string;
  seed: number;
}

export interface TournamentMatch {
  id: string;
  /** Zero-based: round 0 is the opening round. */
  round: number;
  /** Zero-based position inside the round. */
  position: number;
  songAId?: string;
  songBId?: string;
  winnerSongId?: string;
  resolution?: TournamentResolution;
}

export interface TournamentState {
  version: 1;
  size: TournamentSize;
  createdAt: number;
  status: 'active' | 'completed';
  participants: TournamentParticipant[];
  matches: TournamentMatch[];
  championSongId?: string;
}

export interface PreparedTournament {
  state: TournamentState;
  currentMatch?: TournamentMatch;
}

/** Everything the tournament screen needs in one read: what can be seeded, and what is running. */
export interface TournamentOverview {
  /** Tracks a bracket can be seeded from, which is what the size buttons are gated on. */
  eligibleTrackCount: number;
  state?: TournamentState;
  currentMatch?: TournamentMatch;
  /** Card data for the participants of the running bracket; empty when there is none. */
  songs: DuelSongEntry[];
}

export interface TournamentDuelSubmission {
  tournament: TournamentState;
  result: DuelResult;
}

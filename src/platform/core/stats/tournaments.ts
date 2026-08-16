import { getEffectiveEloRating, getEloRating } from './duelMatchmaker';
import { submitDuelResult, type EloDuelsRepo } from './eloDuels';

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

export interface TournamentDuelSubmission {
  tournament: TournamentState;
  result: DuelResult;
}

export type TournamentRepo = EloDuelsRepo;

type CmrStatsWithTournament = CmrStatsData & { tournament?: TournamentState };

const matchId = (round: number, position: number) => `r${round + 1}m${position + 1}`;

const seedOrder = (size: TournamentSize): number[] => {
  let order = [1, 2];
  for (let bracketSize = 4; bracketSize <= size; bracketSize *= 2) {
    order = order.flatMap((seed) => [seed, bracketSize + 1 - seed]);
  }
  return order;
};

const compareSeedCandidates = (elo: EloData, songAId: string, songBId: string) => {
  const ratingA = getEloRating(elo, songAId);
  const ratingB = getEloRating(elo, songBId);
  return (
    getEffectiveEloRating(ratingB) - getEffectiveEloRating(ratingA) ||
    ratingB.rating - ratingA.rating ||
    ratingB.games - ratingA.games ||
    songAId.localeCompare(songBId)
  );
};

const buildMatches = (size: TournamentSize, participants: TournamentParticipant[]) => {
  const bySeed = new Map(participants.map((participant) => [participant.seed, participant.songId]));
  const openingOrder = seedOrder(size);
  const matches: TournamentMatch[] = [];
  const roundCount = Math.log2(size);

  for (let round = 0; round < roundCount; round += 1) {
    const matchesInRound = size / 2 ** (round + 1);
    for (let position = 0; position < matchesInRound; position += 1) {
      const openingIndex = position * 2;
      matches.push({
        id: matchId(round, position),
        round,
        position,
        ...(round === 0
          ? {
              songAId: bySeed.get(openingOrder[openingIndex]),
              songBId: bySeed.get(openingOrder[openingIndex + 1])
            }
          : {})
      });
    }
  }
  return matches;
};

/** Creates a deterministic, conventionally seeded single-elimination bracket. */
export const createTournament = (
  songIds: readonly string[],
  elo: EloData,
  size: TournamentSize,
  createdAt: number
): TournamentState => {
  if (!TOURNAMENT_SIZES.includes(size)) throw new Error('Unsupported tournament size.');
  if (!Number.isFinite(createdAt)) throw new Error('Invalid tournament creation time.');

  const uniqueSongIds = [...new Set(songIds.filter((songId) => typeof songId === 'string'))];
  if (uniqueSongIds.length < size) {
    throw new Error(`A ${size}-track tournament needs at least ${size} tracks.`);
  }

  const participants = uniqueSongIds
    .sort((songAId, songBId) => compareSeedCandidates(elo, songAId, songBId))
    .slice(0, size)
    .map((songId, index) => ({ songId, seed: index + 1 }));

  return {
    version: 1,
    size,
    createdAt,
    status: 'active',
    participants,
    matches: buildMatches(size, participants)
  };
};

const matchesInRound = (state: TournamentState, round: number) =>
  state.matches
    .filter((match) => match.round === round)
    .sort((left, right) => left.position - right.position);

export const isTournamentMatchReady = (state: TournamentState, match: TournamentMatch) => {
  if (match.resolution) return false;
  if (match.round === 0) return true;
  const parents = matchesInRound(state, match.round - 1).slice(
    match.position * 2,
    match.position * 2 + 2
  );
  return parents.length === 2 && parents.every((parent) => parent.resolution !== undefined);
};

const slotsForMatch = (state: TournamentState, match: TournamentMatch) => {
  if (match.round === 0) return [match.songAId, match.songBId] as const;
  const parents = matchesInRound(state, match.round - 1).slice(
    match.position * 2,
    match.position * 2 + 2
  );
  return [parents[0]?.winnerSongId, parents[1]?.winnerSongId] as const;
};

const resolveMatch = (
  state: TournamentState,
  match: TournamentMatch,
  winnerSongId: string | undefined,
  resolution: TournamentResolution
): TournamentState => {
  const [songAId, songBId] = slotsForMatch(state, match);
  const resolved: TournamentMatch = {
    ...match,
    ...(songAId ? { songAId } : {}),
    ...(songBId ? { songBId } : {}),
    ...(winnerSongId ? { winnerSongId } : {}),
    resolution
  };
  const matches = state.matches.map((candidate) =>
    candidate.id === match.id ? resolved : candidate
  );
  const isFinal = match.round === Math.log2(state.size) - 1;
  return {
    ...state,
    matches,
    ...(isFinal
      ? {
          status: 'completed' as const,
          ...(winnerSongId ? { championSongId: winnerSongId } : {})
        }
      : {})
  };
};

/**
 * Resolves every missing-track forfeit and resulting bye. This is intentionally
 * idempotent so loading the same persisted state after a restart is harmless.
 */
export const reconcileTournament = (
  state: TournamentState,
  availableSongIds: ReadonlySet<string>
): TournamentState => {
  let current = state;
  let changed = true;

  while (changed && current.status === 'active') {
    changed = false;
    for (const originalMatch of current.matches) {
      let match = current.matches.find((candidate) => candidate.id === originalMatch.id);
      if (!match || !isTournamentMatchReady(current, match)) continue;
      const [songAId, songBId] = slotsForMatch(current, match);
      if (match.songAId !== songAId || match.songBId !== songBId) {
        const syncedMatch: TournamentMatch = { ...match };
        if (songAId === undefined) delete syncedMatch.songAId;
        else syncedMatch.songAId = songAId;
        if (songBId === undefined) delete syncedMatch.songBId;
        else syncedMatch.songBId = songBId;
        current = {
          ...current,
          matches: current.matches.map((candidate) =>
            candidate.id === match?.id ? syncedMatch : candidate
          )
        };
        match = syncedMatch;
        changed = true;
      }
      const songAAvailable = songAId !== undefined && availableSongIds.has(songAId);
      const songBAvailable = songBId !== undefined && availableSongIds.has(songBId);

      if (songAAvailable && songBAvailable) continue;

      let winnerSongId: string | undefined;
      let resolution: TournamentResolution;
      if (songAAvailable || songBAvailable) {
        winnerSongId = songAAvailable ? songAId : songBId;
        resolution = songAId !== undefined && songBId !== undefined ? 'forfeit' : 'bye';
      } else {
        resolution = 'vacant';
      }
      current = resolveMatch(current, match, winnerSongId, resolution);
      changed = true;
    }
  }

  return current;
};

export const getCurrentTournamentMatch = (state: TournamentState): TournamentMatch | undefined =>
  state.status === 'active'
    ? state.matches.find(
        (match) =>
          isTournamentMatchReady(state, match) &&
          match.songAId !== undefined &&
          match.songBId !== undefined
      )
    : undefined;

export const prepareTournament = (
  state: TournamentState,
  availableSongIds: ReadonlySet<string>
): PreparedTournament => {
  const reconciled = reconcileTournament(state, availableSongIds);
  return { state: reconciled, currentMatch: getCurrentTournamentMatch(reconciled) };
};

/** Records only the bracket result. ELO is updated by submitTournamentDuel below. */
export const recordTournamentWinner = (
  state: TournamentState,
  matchIdToResolve: string,
  winnerSongId: string,
  availableSongIds: ReadonlySet<string>
): TournamentState => {
  const prepared = prepareTournament(state, availableSongIds);
  const currentMatch = prepared.currentMatch;
  if (!currentMatch || currentMatch.id !== matchIdToResolve) {
    throw new Error('Only the current tournament match can be resolved.');
  }
  if (winnerSongId !== currentMatch.songAId && winnerSongId !== currentMatch.songBId) {
    throw new Error('Tournament winner is not part of the current match.');
  }
  return reconcileTournament(
    resolveMatch(prepared.state, currentMatch, winnerSongId, 'played'),
    availableSongIds
  );
};

const getStoredTournament = (cmrStats: CmrStatsData) =>
  (cmrStats as CmrStatsWithTournament).tournament;

const tournamentSongIds = (repo: TournamentRepo) =>
  repo
    .getSongsData()
    .filter((song) => !repo.isSongBlacklisted(song.songId, song.path))
    .map(({ songId }) => songId);

const persistTournament = (repo: TournamentRepo, tournament: TournamentState) => {
  repo.setCmrStatsData({ ...repo.getCmrStatsData(), tournament } as CmrStatsWithTournament);
  repo.emitDataUpdate('eloDuels');
};

export const startTournament = (
  repo: TournamentRepo,
  size: TournamentSize,
  createdAt: number
): TournamentState => {
  const cmrStats = repo.getCmrStatsData();
  const tournament = createTournament(tournamentSongIds(repo), cmrStats.elo, size, createdAt);
  persistTournament(repo, tournament);
  return tournament;
};

export const resumeTournament = (repo: TournamentRepo): PreparedTournament | undefined => {
  const stored = getStoredTournament(repo.getCmrStatsData());
  if (!stored) return undefined;
  const prepared = prepareTournament(stored, new Set(tournamentSongIds(repo)));
  if (prepared.state !== stored) persistTournament(repo, prepared.state);
  return prepared;
};

/** Uses the normal duel submission path, then persists the advanced bracket beside ELO. */
export const submitTournamentDuel = (
  repo: TournamentRepo,
  matchIdToResolve: string,
  winnerSongId: string
): TournamentDuelSubmission => {
  const prepared = resumeTournament(repo);
  const currentMatch = prepared?.currentMatch;
  if (!prepared || !currentMatch || currentMatch.id !== matchIdToResolve) {
    throw new Error('Tournament match is no longer current.');
  }

  const result = submitDuelResult(
    repo,
    currentMatch.songAId as string,
    currentMatch.songBId as string,
    winnerSongId
  );
  const tournament = recordTournamentWinner(
    prepared.state,
    matchIdToResolve,
    winnerSongId,
    new Set(tournamentSongIds(repo))
  );
  persistTournament(repo, tournament);
  return { tournament, result };
};

export const removeSongReferencesFromDuels = (
  source: DuelsLocalStorage,
  removedSongIds: ReadonlySet<string>
): DuelsLocalStorage => {
  const pendingDuelTickets = source.pendingDuelTickets.filter(
    (ticket) => !removedSongIds.has(ticket.anchorSongId)
  );
  return {
    ...source,
    pendingDuels: pendingDuelTickets.length,
    pendingDuelTickets,
    duelAnchorCandidates: source.duelAnchorCandidates.filter(
      (candidate) => !removedSongIds.has(candidate.songId)
    ),
    pendingDuelPairs: source.pendingDuelPairs.filter(
      ([songAId, songBId]) =>
        !removedSongIds.has(songAId) && !removedSongIds.has(songBId)
    )
  };
};


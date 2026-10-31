const pairKey = (songAId: string, songBId: string) =>
  songAId < songBId ? `${songAId}\u0000${songBId}` : `${songBId}\u0000${songAId}`;

/**
 * Weighted version of shuffleQueueRandomly. Per-song weights choose the broad
 * order; Too different feedback then prevents known-incompatible pairs from
 * becoming neighbors whenever another candidate exists.
 */
const megaShuffleQueue = (
  songIds: string[],
  data: MegaShuffleData,
  currentSongIndex?: number,
  random: () => number = Math.random
) => {
  const positions: number[] = [];
  const initialQueue = songIds.slice(0);
  const working = songIds.slice(0);
  const currentSongId =
    typeof currentSongIndex === 'number' ? working.splice(currentSongIndex, 1)[0] : undefined;
  const tooDifferentPairs = new Set(
    data.pairFeedback
      .filter(({ reason }) => reason === 'tooDifferent')
      .map(({ songAId, songBId }) => pairKey(songAId, songBId))
  );
  // A duplicate row (`songId:variant`) shares its song's weight; songs the session filters hold
  // back (PLAN/14 C4) come after every other one.
  const held = new Set(data.held ?? []);
  const isHeld = (id: string) => held.has(id) || held.has(id.split(':')[0]);
  const remaining = working.map((id) => {
    const weight = data.weights[id] ?? data.weights[id.split(':')[0]] ?? 0.4;
    return { id, key: random() ** (1 / weight) - (isHeld(id) ? 4 : 0) };
  });
  const shuffledQueue = currentSongId ? [currentSongId] : [];

  while (remaining.length > 0) {
    const previousSongId = shuffledQueue.at(-1);
    remaining.sort((left, right) => {
      const score = ({ id, key }: (typeof remaining)[number]) =>
        key - (previousSongId && tooDifferentPairs.has(pairKey(previousSongId, id)) ? 2 : 0);
      return score(right) - score(left);
    });
    shuffledQueue.push(remaining.shift()!.id);
  }

  for (let index = 0; index < initialQueue.length; index += 1)
    positions.push(shuffledQueue.indexOf(initialQueue[index]));

  return { shuffledQueue, positions };
};

export default megaShuffleQueue;

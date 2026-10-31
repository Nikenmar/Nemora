/**
 * Weighted version of shuffleQueueRandomly. Per-song weights choose the broad
 * order; Too different feedback then prevents known-incompatible pairs from
 * becoming neighbors whenever another candidate exists.
 *
 * The keys are sorted once and each next song is the best key that is not a too-different
 * neighbour of the one before (the core's `shuffle::weighted_order`). It used to re-sort the whole
 * remainder for every song taken, building a pair key string on every comparison: 441 ms for 1778
 * songs on the stand (PLAN/15 trace), the delay the user saw turning Smart Shuffle on.
 */
const megaShuffleQueue = (
  songIds: string[],
  data: MegaShuffleData,
  currentSongIndex?: number,
  random: () => number = Math.random
) => {
  const working = songIds.slice(0);
  const currentSongId =
    typeof currentSongIndex === 'number' ? working.splice(currentSongIndex, 1)[0] : undefined;

  const partners = new Map<string, Set<string>>();
  const pair = (a: string, b: string) => {
    if (!partners.has(a)) partners.set(a, new Set());
    partners.get(a)!.add(b);
  };
  for (const { reason, songAId, songBId } of data.pairFeedback)
    if (reason === 'tooDifferent') {
      pair(songAId, songBId);
      pair(songBId, songAId);
    }

  // A duplicate row (`songId:variant`) shares its song's weight; songs the session filters hold
  // back (PLAN/14 C4) come after every other one.
  const held = new Set(data.held ?? []);
  const isHeld = (id: string) => held.has(id) || held.has(id.split(':')[0]);
  const keyed = working.map((id) => {
    const weight = data.weights[id] ?? data.weights[id.split(':')[0]] ?? 0.4;
    return { id, key: random() ** (1 / weight), held: isHeld(id) };
  });
  // Best key first, held songs after every other one; equal keys keep queue order.
  keyed.sort((left, right) => Number(left.held) - Number(right.held) || right.key - left.key);
  const firstHeld = keyed.findIndex((entry) => entry.held);
  const heldFrom = firstHeld === -1 ? keyed.length : firstHeld;

  const taken = new Array<boolean>(keyed.length).fill(false);
  const shuffledQueue = currentSongId ? [currentSongId] : [];
  let head = 0;
  for (let n = 0; n < keyed.length; n += 1) {
    while (taken[head]) head += 1;
    const previous = shuffledQueue.at(-1);
    const avoid = previous ? partners.get(previous) : undefined;
    let pick = head;
    if (avoid) {
      // The best key in the head's group (not held / held) that is not a too-different neighbour;
      // if every one is, the head itself.
      const end = head < heldFrom ? heldFrom : keyed.length;
      for (let k = head; k < end; k += 1)
        if (!taken[k] && !avoid.has(keyed[k].id)) {
          pick = k;
          break;
        }
    }
    taken[pick] = true;
    shuffledQueue.push(keyed[pick].id);
  }

  // Where each original position went; duplicates are matched in order.
  const at = new Map<string, number[]>();
  shuffledQueue.forEach((id, index) => {
    if (!at.has(id)) at.set(id, []);
    at.get(id)!.push(index);
  });
  const positions = songIds.map((id) => at.get(id)?.shift() ?? -1);

  return { shuffledQueue, positions };
};

export default megaShuffleQueue;

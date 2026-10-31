/** How far past the best key the order looks for a song by another artist. */
const ARTIST_SEARCH = 300;

/**
 * Weighted version of shuffleQueueRandomly. Per-song weights choose the broad
 * order; Too different feedback then prevents known-incompatible pairs from
 * becoming neighbors whenever another candidate exists.
 *
 * The keys are sorted once and each next song is the best key that is not a too-different
 * neighbour of the one before (the core's `shuffle::weighted_order`) and, while another can come,
 * does not share an artist with it (PLAN/15 F2). It used to re-sort the whole remainder for every
 * song taken, building a pair key string on every comparison: 441 ms for 1778 songs on the stand
 * (PLAN/15 trace), the delay the user saw turning Smart Shuffle on.
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
  const artistsOf = (id: string) => data.artists?.[id] ?? data.artists?.[id.split(':')[0]];
  const keyed = working.map((id) => {
    const weight = data.weights[id] ?? data.weights[id.split(':')[0]] ?? 0.4;
    return { id, key: random() ** (1 / weight), held: isHeld(id), artists: artistsOf(id) };
  });
  // Best key first, held songs after every other one; equal keys keep queue order.
  keyed.sort((left, right) => Number(left.held) - Number(right.held) || right.key - left.key);
  const firstHeld = keyed.findIndex((entry) => entry.held);
  const heldFrom = firstHeld === -1 ? keyed.length : firstHeld;

  const taken = new Array<boolean>(keyed.length).fill(false);
  const shuffledQueue = currentSongId ? [currentSongId] : [];
  let head = 0;
  let previousArtists = currentSongId ? artistsOf(currentSongId) : undefined;
  for (let n = 0; n < keyed.length; n += 1) {
    while (taken[head]) head += 1;
    const previous = shuffledQueue.at(-1);
    const avoid = previous ? partners.get(previous) : undefined;
    const sameArtist = (k: number) =>
      !!previousArtists && !!keyed[k].artists?.some((artist) => previousArtists!.includes(artist));
    let pick = head;
    if (avoid || previousArtists) {
      // The best key in the head's group (not held / held) that is neither a too-different neighbour
      // nor by the same artist; else the best that is not too different; else the head itself. The
      // artist search stops after a few hundred keys: a queue of one artist stays as it is.
      const groupEnd = head < heldFrom ? heldFrom : keyed.length;
      const artistEnd = Math.min(groupEnd, head + ARTIST_SEARCH);
      let notTooDifferent = -1;
      for (let k = head; k < groupEnd; k += 1) {
        if (taken[k] || avoid?.has(keyed[k].id)) continue;
        if (notTooDifferent === -1) notTooDifferent = k;
        if (k >= artistEnd) break;
        if (!sameArtist(k)) {
          pick = k;
          break;
        }
      }
      if (pick === head && notTooDifferent !== -1 && sameArtist(head)) pick = notTooDifferent;
      else if (pick === head && avoid?.has(keyed[head].id) && notTooDifferent !== -1) pick = notTooDifferent;
    }
    taken[pick] = true;
    shuffledQueue.push(keyed[pick].id);
    previousArtists = keyed[pick].artists;
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

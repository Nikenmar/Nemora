/** How far past the best key the order looks for a song by another artist. */
const ARTIST_SEARCH = 300;
/** Energy flow (PLAN/15 C2): a jump larger than this between neighbours is avoided while it can be. */
const ENERGY_JUMP = 0.35;
/** Follow the taste map (PLAN/15 C3): the current song's map neighbours weigh this much more... */
const FOLLOW_LIFT = 1.5;
/** ...among the best this many candidates. */
const FOLLOW_WINDOW = 50;

/**
 * Weighted version of shuffleQueueRandomly. Per-song weights choose the broad
 * order; Too different feedback then prevents known-incompatible pairs from
 * becoming neighbors whenever another candidate exists.
 *
 * The keys are sorted once and each next song is the best key that is not a too-different
 * neighbour of the one before (the core's `shuffle::weighted_order`) and, while another can come,
 * does not share an artist with it (PLAN/15 F2) nor jump in energy (C2); the current song's taste-map
 * neighbours lean ahead (C3). It used to re-sort the whole remainder for every
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
  const energyOf = (id: string) => data.energy?.[id] ?? data.energy?.[id.split(':')[0]];
  const nearOf = (id: string) => {
    const near = data.neighbours?.[id] ?? data.neighbours?.[id.split(':')[0]];
    return near && near.length > 0 ? new Set(near) : undefined;
  };
  const keyed = working.map((id) => {
    const weight = data.weights[id] ?? data.weights[id.split(':')[0]] ?? 0.4;
    return { id, key: random() ** (1 / weight), held: isHeld(id), artists: artistsOf(id), energy: energyOf(id) };
  });
  // Best key first, held songs after every other one; equal keys keep queue order.
  keyed.sort((left, right) => Number(left.held) - Number(right.held) || right.key - left.key);
  const firstHeld = keyed.findIndex((entry) => entry.held);
  const heldFrom = firstHeld === -1 ? keyed.length : firstHeld;

  const taken = new Array<boolean>(keyed.length).fill(false);
  const shuffledQueue = currentSongId ? [currentSongId] : [];
  let head = 0;
  let previousArtists = currentSongId ? artistsOf(currentSongId) : undefined;
  let previousEnergy = currentSongId ? energyOf(currentSongId) : undefined;
  let previousNear = currentSongId ? nearOf(currentSongId) : undefined;
  for (let n = 0; n < keyed.length; n += 1) {
    while (taken[head]) head += 1;
    const previous = shuffledQueue.at(-1);
    const avoid = previous ? partners.get(previous) : undefined;
    const sameArtist = (k: number) =>
      !!previousArtists && !!keyed[k].artists?.some((artist) => previousArtists!.includes(artist));
    const energyJump = (k: number) =>
      previousEnergy !== undefined &&
      keyed[k].energy !== undefined &&
      Math.abs((keyed[k].energy ?? previousEnergy) - previousEnergy) > ENERGY_JUMP;
    let pick = head;
    if (avoid || previousArtists || previousEnergy !== undefined || previousNear) {
      // In the head's group (not held / held): the best candidate that is neither a too-different
      // neighbour nor by the same artist nor a jump in energy, a map neighbour's key lifted; else the
      // best that is not too different; else the head itself. The soft search stops after a few
      // hundred keys: a queue of one artist stays as it is.
      const groupEnd = head < heldFrom ? heldFrom : keyed.length;
      const softEnd = Math.min(groupEnd, head + ARTIST_SEARCH);
      let notTooDifferent = -1;
      let best = -1;
      let bestKey = -Infinity;
      let good = 0;
      for (let k = head; k < groupEnd; k += 1) {
        if (taken[k] || avoid?.has(keyed[k].id)) continue;
        if (notTooDifferent === -1) notTooDifferent = k;
        if (k >= softEnd) break;
        if (sameArtist(k) || energyJump(k)) continue;
        const lifted = previousNear?.has(keyed[k].id) ? keyed[k].key ** (1 / FOLLOW_LIFT) : keyed[k].key;
        if (lifted > bestKey) {
          bestKey = lifted;
          best = k;
        }
        good += 1;
        if (!previousNear || good >= FOLLOW_WINDOW) break;
      }
      if (best !== -1) pick = best;
      else if (notTooDifferent !== -1) pick = notTooDifferent;
    }
    taken[pick] = true;
    shuffledQueue.push(keyed[pick].id);
    previousArtists = keyed[pick].artists;
    previousEnergy = keyed[pick].energy;
    previousNear = nearOf(keyed[pick].id);
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

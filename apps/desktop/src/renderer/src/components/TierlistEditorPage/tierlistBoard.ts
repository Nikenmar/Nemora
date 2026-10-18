/**
 * The drag board: what sits in each tier and what is left in the pool.
 *
 * Extracted from the page so the rule that cost a tierlist twice can be
 * tested without a DOM. That rule is the difference between the two sets
 * these functions take: `songMap` is every song the editor can DRAW, and
 * `liveSongIds` is what the current source OFFERS. A placement lives or dies
 * by the first; only the pool is built from the second.
 */
export type Item = { id: string };
export type Board = { pool: Item[]; tiers: Record<string, Item[]> };

export const sameIds = (a: Item[], b: Item[]) =>
  a.length === b.length && a.every((x, i) => x.id === b[i].id);

/**
 * Initial seed of the drag board from the PERSISTED placements (`tier.items`).
 * Run once, only after the song map is ready, so saved placements are never lost
 * to a premature reconcile against an empty song map.
 */
export const seedBoard = (
  tierlist: SavableTierlist,
  liveSongIds: string[],
  songMap: Record<string, SongData>,
  remap: Record<string, string> = {}
): Board => {
  const isVisible = (id: string) => !!songMap[id];
  const placed = new Set<string>();
  const tiers: Record<string, Item[]> = {};

  for (const tier of tierlist.tiers) {
    const seen = new Set<string>();
    // Map each placed song to its canonical (folder-authoritative) id first, so a
    // ranking made via a playlist migrates onto the folder's duplicate cleanly.
    const ids = tier.items
      .map((id) => remap[id] ?? id)
      .filter((id) => {
        if (!isVisible(id) || seen.has(id) || placed.has(id)) return false;
        seen.add(id);
        placed.add(id);
        return true;
      });
    tiers[tier.tierId] = ids.map((id) => ({ id }));
  }

  const pool = liveSongIds.filter((id) => isVisible(id) && !placed.has(id)).map((id) => ({ id }));

  return { pool, tiers };
};

/**
 * Incremental update once seeded: the BOARD is the source of truth for ordering.
 * We only drop songs that left the live pool, append newly added songs, add new
 * tiers and remove deleted ones — never resetting placements from `tier.items`.
 */
export const incrementalBoard = (
  prev: Board,
  tierlist: SavableTierlist,
  liveSongIds: string[],
  songMap: Record<string, SongData>,
  remap: Record<string, string> = {}
): Board => {
  const isVisible = (id: string) => !!songMap[id];
  const liveVisible = new Set(liveSongIds.filter(isVisible));
  const placed = new Set<string>();
  const tiers: Record<string, Item[]> = {};

  for (const tier of tierlist.tiers) {
    const seen = new Set<string>();
    const prevItems = (prev.tiers[tier.tierId] ?? [])
      .map((i) => remap[i.id] ?? i.id) // a newly-added folder may dup a placed song
      .filter((id) => {
        // A PLACED card survives on `isVisible` - the song still exists - and
        // not on membership of the live pool. The two differ exactly when the
        // source changes or the library is rebuilt, and treating "outside the
        // source" as "delete the ranking" is what erased a tierlist twice.
        // Only the pool below is the source's business.
        if (!isVisible(id) || placed.has(id) || seen.has(id)) return false;
        seen.add(id);
        placed.add(id);
        return true;
      });
    tiers[tier.tierId] = prevItems.map((id) => ({ id }));
  }

  const prevPool = prev.pool
    .map((i) => i.id)
    .filter((id) => liveVisible.has(id) && !placed.has(id));
  const prevPoolSet = new Set(prevPool);
  const appended = liveSongIds.filter(
    (id) => isVisible(id) && !placed.has(id) && !prevPoolSet.has(id)
  );
  const pool = [...prevPool, ...appended].map((id) => ({ id }));

  return { pool, tiers };
};


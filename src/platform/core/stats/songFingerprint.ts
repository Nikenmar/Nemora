import { basename } from '../playlists/pathUtils';

/**
 * Track identity that does NOT depend on `songId`.
 *
 * Every songId in this app is a random 10-character string handed out when a
 * track enters the library (`generateRandomId`). Rebuild the library - remove
 * and re-add a folder, move the files, reset the catalog - and the very same
 * files come back with different ids, while listening history, ELO ratings and
 * everything else keyed by songId still points at the old ones.
 *
 * That is not hypothetical. One profile lost a year of history that way: 1260
 * of its 1280 listening rows referred to ids that no longer existed, and there
 * was nothing left on disk to reattach them by, because a row stored an id and
 * nothing else. A row that carries this fingerprint can always be reattached.
 *
 * The matcher is the one the stats import already used to move history between
 * two installs; both callers must agree, or a track could reattach one way and
 * not the other.
 */

const norm = (value: string) => value.trim().toLowerCase();

/** The fingerprint of a song currently in the library. */
export const fingerprintOfSong = (song: SavableSongData): SongFingerprint => ({
  songId: song.songId,
  title: song.title,
  artists: (song.artists ?? []).map((artist) => artist.name),
  duration: song.duration,
  fileName: basename(song.path)
});

/**
 * Maps each fingerprint's `songId` to the local song it identifies.
 *
 * Three tiers, each used only when it answers unambiguously, most specific
 * first. An ambiguous fingerprint is SKIPPED rather than guessed: attaching a
 * year of listening history to the wrong track is worse than leaving it
 * detached, because the mistake is invisible and permanent.
 */
export const matchFingerprints = (
  fingerprints: readonly SongFingerprint[],
  localSongs: readonly SavableSongData[]
): Map<string, string> => {
  const byFileName = new Map<string, SavableSongData[]>();
  const byTitleAndArtists = new Map<string, SavableSongData[]>();
  const byTitle = new Map<string, SavableSongData[]>();

  const pushTo = (map: Map<string, SavableSongData[]>, key: string, song: SavableSongData) => {
    const list = map.get(key);
    if (list) list.push(song);
    else map.set(key, [song]);
  };

  for (const song of localSongs) {
    pushTo(byFileName, norm(basename(song.path)), song);
    pushTo(byTitle, norm(song.title), song);
    const artistsKey = (song.artists ?? [])
      .map((artist) => norm(artist.name))
      .sort()
      .join('|');
    pushTo(byTitleAndArtists, `${norm(song.title)}|${artistsKey}`, song);
  }

  const matches = new Map<string, string>();

  for (const foreign of fingerprints) {
    if (!foreign || typeof foreign.songId !== 'string') continue;
    const duration = Number(foreign.duration) || 0;

    // 1. file name + duration (±2s)
    const fileNameCandidates = (byFileName.get(norm(`${foreign.fileName ?? ''}`)) ?? []).filter(
      (song) => Math.abs(song.duration - duration) <= 2
    );
    if (fileNameCandidates.length === 1) {
      matches.set(foreign.songId, fileNameCandidates[0].songId);
      continue;
    }
    if (fileNameCandidates.length > 1) continue; // ambiguous — skip

    // 2. title + sorted artists + duration (±2s)
    const artistsKey = (foreign.artists ?? [])
      .map((artist) => norm(`${artist}`))
      .sort()
      .join('|');
    const titleArtistCandidates = (
      byTitleAndArtists.get(`${norm(`${foreign.title ?? ''}`)}|${artistsKey}`) ?? []
    ).filter((song) => Math.abs(song.duration - duration) <= 2);
    if (titleArtistCandidates.length === 1) {
      matches.set(foreign.songId, titleArtistCandidates[0].songId);
      continue;
    }
    if (titleArtistCandidates.length > 1) continue; // ambiguous — skip

    // 3. title + duration (±1s), only when unambiguous
    const titleCandidates = (byTitle.get(norm(`${foreign.title ?? ''}`)) ?? []).filter(
      (song) => Math.abs(song.duration - duration) <= 1
    );
    if (titleCandidates.length === 1) matches.set(foreign.songId, titleCandidates[0].songId);
  }

  return matches;
};

/**
 * Listening rows whose song is gone from the library, reattached to the songs
 * that now carry the same files.
 *
 * Rows written before fingerprints existed cannot take part - there is nothing
 * to match them by - so they stay detached instead of being guessed at.
 */
export const relinkOrphanedListeningRows = (
  listeningData: readonly SongListeningData[],
  librarySongs: readonly SavableSongData[]
): { rows: SongListeningData[]; relinked: number } => {
  const liveIds = new Set(librarySongs.map((song) => song.songId));
  const orphans = listeningData.filter(
    (row) => !liveIds.has(row.songId) && row.fingerprint !== undefined
  );
  if (orphans.length === 0) return { rows: [...listeningData], relinked: 0 };

  const matches = matchFingerprints(
    orphans.map((row) => ({ ...(row.fingerprint as SongFingerprint), songId: row.songId })),
    librarySongs
  );
  if (matches.size === 0) return { rows: [...listeningData], relinked: 0 };

  // A row may already exist for the new id (the track was played after the
  // re-add, before the history came back). Merging the two here would duplicate
  // the ids' shared history, so the reattached row is dropped in favour of the
  // live one, which is the only one the app has been writing to.
  const takenIds = new Set(
    listeningData.filter((row) => liveIds.has(row.songId)).map((row) => row.songId)
  );

  let relinked = 0;
  const rows = listeningData.map((row) => {
    const newId = matches.get(row.songId);
    if (!newId || liveIds.has(row.songId) || takenIds.has(newId)) return row;
    takenIds.add(newId);
    relinked += 1;
    const song = librarySongs.find((candidate) => candidate.songId === newId);
    return {
      ...row,
      songId: newId,
      fingerprint: song ? fingerprintOfSong(song) : row.fingerprint
    };
  });

  return { rows, relinked };
};

/**
 * Reattaches detached ELO ratings and every durable duel reference that uses
 * the same old song id. Ratings that cannot be matched unambiguously, or whose
 * destination already has a rating, remain detached instead of overwriting
 * newer data.
 */
export const relinkOrphanedRatings = (
  cmrStats: CmrStatsData,
  librarySongs: readonly SavableSongData[]
): { cmrStats: CmrStatsData; relinked: number } => {
  const liveIds = new Set(librarySongs.map((song) => song.songId));
  const ratings = cmrStats.elo.ratings;
  const orphanedRatings = Object.entries(ratings).filter(
    ([songId, rating]) => !liveIds.has(songId) && rating.fingerprint !== undefined
  );
  if (orphanedRatings.length === 0) return { cmrStats, relinked: 0 };

  const matches = matchFingerprints(
    orphanedRatings.map(([songId, rating]) => ({
      ...(rating.fingerprint as SongFingerprint),
      songId
    })),
    librarySongs
  );

  const remappedIds = new Map<string, string>();
  const nextRatings: Record<string, EloSongRating> = { ...ratings };
  for (const [oldId, rating] of orphanedRatings) {
    const newId = matches.get(oldId);
    if (!newId || nextRatings[newId] !== undefined) continue;
    const song = librarySongs.find((candidate) => candidate.songId === newId);
    if (!song) continue;
    delete nextRatings[oldId];
    nextRatings[newId] = { ...rating, fingerprint: fingerprintOfSong(song) };
    remappedIds.set(oldId, newId);
  }
  if (remappedIds.size === 0) return { cmrStats, relinked: 0 };

  const remap = (songId: string) => remappedIds.get(songId) ?? songId;
  return {
    cmrStats: {
      ...cmrStats,
      elo: {
        ...cmrStats.elo,
        ratings: nextRatings,
        history: cmrStats.elo.history.map((record) => ({
          ...record,
          songAId: remap(record.songAId),
          songBId: remap(record.songBId)
        }))
      },
      ...(cmrStats.duelMatchmaking
        ? {
            duelMatchmaking: {
              ...cmrStats.duelMatchmaking,
              skippedPairs: cmrStats.duelMatchmaking.skippedPairs.map((record) => ({
                ...record,
                songAId: remap(record.songAId),
                songBId: remap(record.songBId)
              }))
            }
          }
        : {})
    },
    relinked: remappedIds.size
  };
};

/**
 * Reattaches tierlist cards that were kept outside the visible placement list
 * while their songs were absent. The stored index restores their relative
 * position without exposing dead song ids to existing tierlist consumers.
 */
export const relinkOrphanedTierlistItems = (
  tierlists: readonly SavableTierlist[],
  librarySongs: readonly SavableSongData[]
): { tierlists: SavableTierlist[]; relinked: number } => {
  const orphanedItems = tierlists.flatMap((tierlist) =>
    tierlist.tiers.flatMap((tier) => tier.orphanedItems ?? [])
  );
  if (orphanedItems.length === 0) return { tierlists: [...tierlists], relinked: 0 };

  const fingerprintByOldId = new Map<string, SongFingerprint>();
  for (const item of orphanedItems) {
    if (!fingerprintByOldId.has(item.songId)) fingerprintByOldId.set(item.songId, item.fingerprint);
  }
  const matches = matchFingerprints(
    [...fingerprintByOldId].map(([songId, fingerprint]) => ({ ...fingerprint, songId })),
    librarySongs
  );
  if (matches.size === 0) return { tierlists: [...tierlists], relinked: 0 };

  let relinked = 0;
  const nextTierlists = tierlists.map((tierlist) => {
    const placedIds = new Set(tierlist.tiers.flatMap((tier) => tier.items));
    const tiers = tierlist.tiers.map((tier) => {
      const detached = tier.orphanedItems ?? [];
      if (detached.length === 0) return tier;

      const items = [...tier.items];
      const remaining: TierlistOrphanedItem[] = [];
      for (const orphan of [...detached].sort((a, b) => a.index - b.index)) {
        const newId = matches.get(orphan.songId);
        if (!newId || placedIds.has(newId)) {
          remaining.push(orphan);
          continue;
        }
        items.splice(Math.max(0, Math.min(orphan.index, items.length)), 0, newId);
        placedIds.add(newId);
        relinked += 1;
      }

      const nextTier: TierRow = { ...tier, items };
      if (remaining.length > 0) nextTier.orphanedItems = remaining;
      else delete nextTier.orphanedItems;
      return nextTier;
    });
    return { ...tierlist, tiers };
  });

  return { tierlists: nextTierlists, relinked };
};

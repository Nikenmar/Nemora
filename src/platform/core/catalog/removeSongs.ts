import { canonicalPathKey } from '../library/path';
import { fingerprintOfSong } from '../stats/songFingerprint';
import type { CatalogRepository, CatalogState } from './repository';

export interface CatalogRemovalResult {
  removedSongs: SavableSongData[];
  state: CatalogState;
}

const clone = <Value>(value: Value): Value => JSON.parse(JSON.stringify(value)) as Value;

const replacementArtworkName = (
  songs: readonly { songId: string }[],
  remainingSongs: readonly SavableSongData[]
): string | undefined => {
  for (const relation of songs) {
    const song = remainingSongs.find((candidate) => candidate.songId === relation.songId);
    if (song?.isArtworkAvailable) return `${song.songId}.webp`;
  }
  return undefined;
};

const repairArtworkName = <Entity extends { songs: { songId: string }[]; artworkName?: string }>(
  entity: Entity,
  removedIds: ReadonlySet<string>,
  remainingSongs: readonly SavableSongData[]
): Entity => {
  const artworkSongId = entity.artworkName?.replace(/\.webp$/iu, '');
  if (!artworkSongId || !removedIds.has(artworkSongId)) return entity;
  const replacement = replacementArtworkName(entity.songs, remainingSongs);
  if (replacement) entity.artworkName = replacement;
  else delete entity.artworkName;
  return entity;
};

export const removeSongsFromCatalogState = (
  source: CatalogState,
  songPaths: readonly string[]
): CatalogRemovalResult => {
  const state = clone(source);
  const targetPaths = new Set(songPaths.map(canonicalPathKey));
  const removedSongs = state.songs.filter((song) => targetPaths.has(canonicalPathKey(song.path)));
  if (removedSongs.length === 0) return { removedSongs: [], state };

  const removedIds = new Set(removedSongs.map((song) => song.songId));
  const removedFingerprints = new Map(
    removedSongs.map((song) => [song.songId, fingerprintOfSong(song)] as const)
  );
  state.songs = state.songs.filter((song) => !removedIds.has(song.songId));

  state.albums = state.albums
    .map((album) => ({
      ...album,
      songs: album.songs.filter((song) => !removedIds.has(song.songId))
    }))
    .filter((album) => album.songs.length > 0)
    .map((album) => repairArtworkName(album, removedIds, state.songs));
  const remainingAlbumIds = new Set(state.albums.map((album) => album.albumId));

  state.artists = state.artists
    .map((artist) => ({
      ...artist,
      songs: artist.songs.filter((song) => !removedIds.has(song.songId)),
      albums: artist.albums?.filter((album) => remainingAlbumIds.has(album.albumId))
    }))
    .filter((artist) => artist.songs.length > 0 || (artist.albums?.length ?? 0) > 0)
    .map((artist) => repairArtworkName(artist, removedIds, state.songs));
  const remainingArtistIds = new Set(state.artists.map((artist) => artist.artistId));
  state.albums = state.albums.map((album) => ({
    ...album,
    artists: album.artists?.filter((artist) => remainingArtistIds.has(artist.artistId))
  }));

  state.genres = state.genres
    .map((genre) => ({
      ...genre,
      songs: genre.songs.filter((song) => !removedIds.has(song.songId))
    }))
    .filter((genre) => genre.songs.length > 0)
    .map((genre) => repairArtworkName(genre, removedIds, state.songs));

  state.playlists = state.playlists.map((playlist) => ({
    ...playlist,
    songs: playlist.songs.filter((songId) => !removedIds.has(songId))
  }));
  // Listening history OUTLIVES the library entry, as long as the row knows
  // which track it belonged to.
  //
  // Removing a folder and adding it back is an ordinary thing to do - after a
  // move, a rename, a rebuild - and it used to destroy every listen recorded
  // for those tracks, permanently and silently. A kept row costs a few dozen
  // bytes, contributes to no figure on the statistics page (which counts only
  // tracks in the library), and is reattached by fingerprint the moment the
  // same music is scanned again. A row without a fingerprint has nothing to be
  // reattached by, so keeping it would only be dead weight.
  state.listeningData = state.listeningData.filter(
    (entry) => !removedIds.has(entry.songId) || entry.fingerprint !== undefined
  );
  state.blacklist.songBlacklist = state.blacklist.songBlacklist.filter(
    (songId) => !removedIds.has(songId)
  );
  state.tierlists = state.tierlists.map((tierlist) => ({
    ...tierlist,
    tiers: tierlist.tiers.map((tier) => {
      const existingOrphans = [...(tier.orphanedItems ?? [])];
      const orphanedIds = new Set(existingOrphans.map((item) => item.songId));
      const items: string[] = [];

      tier.items.forEach((songId, index) => {
        if (!removedIds.has(songId)) {
          items.push(songId);
          return;
        }
        const fingerprint = removedFingerprints.get(songId);
        if (fingerprint && !orphanedIds.has(songId)) {
          existingOrphans.push({ songId, index, fingerprint });
          orphanedIds.add(songId);
        }
      });

      const nextTier: TierRow = { ...tier, items };
      if (existingOrphans.length > 0) nextTier.orphanedItems = existingOrphans;
      return nextTier;
    })
  }));

  for (const [songId, fingerprint] of removedFingerprints) {
    const rating = state.cmrStats.elo.ratings[songId];
    if (rating) state.cmrStats.elo.ratings[songId] = { ...rating, fingerprint };
  }

  return { removedSongs, state };
};

export const removeSongsFromLibrary = async (
  repository: CatalogRepository,
  songPaths: readonly string[],
  abortSignal?: AbortSignal
): Promise<{ success: boolean; message: string; removedCount: number }> => {
  if (abortSignal?.aborted) {
    const error = new Error('Song removal was aborted before catalog mutation.');
    error.name = 'CatalogRemovalAbortedError';
    throw error;
  }

  const result = removeSongsFromCatalogState(repository.getCatalogState(), songPaths);
  if (result.removedSongs.length === 0) {
    return {
      success: true,
      message: 'No matching songs were present in the library.',
      removedCount: 0
    };
  }

  repository.commitCatalogState(result.state);
  repository.removeDuelQueueReferences(result.removedSongs.map((song) => song.songId));
  await Promise.all(
    result.removedSongs.map(async (song) => {
      try {
        await repository.removeSongArtwork(song.songId);
      } catch (error) {
        repository.reportError(error, `remove artwork for ${song.songId}`);
      }
    })
  );

  const removedIds = result.removedSongs.map((song) => song.songId);
  repository.emitDataUpdate('songs/deletedSong', removedIds);
  repository.emitDataUpdate('artists');
  repository.emitDataUpdate('albums');
  repository.emitDataUpdate('playlists');
  repository.emitDataUpdate('genres');
  repository.emitDataUpdate('tierlists');
  repository.emitDataUpdate('blacklist/songBlacklist', removedIds);

  return {
    success: true,
    message: `${result.removedSongs.length} songs removed and all catalog references updated.`,
    removedCount: result.removedSongs.length
  };
};

import { canonicalPathKey } from '../library/path';
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
  state.listeningData = state.listeningData.filter((entry) => !removedIds.has(entry.songId));
  state.blacklist.songBlacklist = state.blacklist.songBlacklist.filter(
    (songId) => !removedIds.has(songId)
  );
  state.tierlists = state.tierlists.map((tierlist) => ({
    ...tierlist,
    tiers: tierlist.tiers.map((tier) => ({
      ...tier,
      items: tier.items.filter((songId) => !removedIds.has(songId))
    }))
  }));

  const removedHistoryCount = state.cmrStats.elo.history.filter(
    (record) => removedIds.has(record.songAId) || removedIds.has(record.songBId)
  ).length;
  state.cmrStats.elo.history = state.cmrStats.elo.history.filter(
    (record) => !removedIds.has(record.songAId) && !removedIds.has(record.songBId)
  );
  for (const songId of removedIds) delete state.cmrStats.elo.ratings[songId];
  state.cmrStats.elo.totalDuels = Math.max(
    state.cmrStats.elo.history.length,
    state.cmrStats.elo.totalDuels - removedHistoryCount
  );
  if (state.cmrStats.duelMatchmaking) {
    state.cmrStats.duelMatchmaking.skippedPairs =
      state.cmrStats.duelMatchmaking.skippedPairs.filter(
        (record) => !removedIds.has(record.songAId) && !removedIds.has(record.songBId)
      );
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
    return { success: true, message: 'No matching songs were present in the library.', removedCount: 0 };
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

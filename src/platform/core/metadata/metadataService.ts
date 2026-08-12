import { canonicalPathKey } from '../library/path';
import { removeDefaultAppProtocolFromFilePath } from '../lyrics/pathUtils';
import {
  planArtistDuplicateMerge,
  planFeaturingArtists,
  planSeparateArtist,
  planSongRelink
} from './reconciliation';
import type {
  CatalogBatchPlan,
  CatalogSongPatch,
  MetadataArtworkSource,
  MetadataRepository,
  MetadataTagPatch,
  MetadataUpdateResult
} from './types';

const fileNameWithoutExtension = (path: string): string => {
  const fileName = path.split(/[\\/]/u).at(-1) ?? '';
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(0, dot) : fileName;
};

const artworkNameFromPaths = (paths: ArtworkPaths): string | undefined => {
  if (paths.isDefaultArtwork) return undefined;
  const decoded = decodeURIComponent(paths.artworkPath).split(/[?#]/u)[0];
  return decoded.split(/[\\/]/u).at(-1);
};

const comparableArtworkPath = (path?: string): string | undefined =>
  path ? path.split(/[?#]/u)[0] : undefined;

const cacheBusted = (path: string | undefined, token: string): string | undefined => {
  if (!path) return undefined;
  return `${path}${path.includes('?') ? '&' : '?'}metadata=${encodeURIComponent(token)}`;
};

const songTagsPatch = (tags: SongTags, artwork: MetadataTagPatch['artwork']): MetadataTagPatch => ({
  title: tags.title,
  artists: (tags.artists ?? []).map((artist) => artist.name.trim()).filter(Boolean),
  albumArtists: (tags.albumArtists ?? []).map((artist) => artist.name.trim()).filter(Boolean),
  album: tags.album?.title.trim() || undefined,
  genres: (tags.genres ?? []).map((genre) => genre.name.trim()).filter(Boolean),
  composer: tags.composer,
  trackNumber: tags.trackNumber,
  year: tags.releasedYear,
  synchronizedLyrics: tags.synchronizedLyrics,
  unsynchronizedLyrics: tags.unsynchronizedLyrics,
  artwork
});

const catalogPatchFromTags = (tags: SongTags): CatalogSongPatch => ({
  title: tags.title,
  artists: tags.artists ?? [],
  albumArtists: tags.albumArtists ?? [],
  album: tags.album ? { albumId: tags.album.albumId, title: tags.album.title } : undefined,
  genres: tags.genres ?? [],
  year: tags.releasedYear,
  trackNumber: tags.trackNumber
});

export class MetadataService {
  private readonly repository: MetadataRepository;
  private readonly pendingPaths = new Map<string, number>();
  private operationQueue: Promise<void> = Promise.resolve();

  constructor(repository: MetadataRepository) {
    this.repository = repository;
  }

  private pathKey(path: string): string {
    return canonicalPathKey(removeDefaultAppProtocolFromFilePath(path));
  }

  private markPending(paths: readonly string[]): () => void {
    const keys = paths.map((path) => this.pathKey(path));
    for (const key of keys) this.pendingPaths.set(key, (this.pendingPaths.get(key) ?? 0) + 1);
    return () => {
      for (const key of keys) {
        const count = this.pendingPaths.get(key) ?? 0;
        if (count <= 1) this.pendingPaths.delete(key);
        else this.pendingPaths.set(key, count - 1);
      }
    };
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationQueue.then(operation, operation);
    this.operationQueue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  isMetadataUpdatesPending(path: string): boolean {
    return this.pendingPaths.has(this.pathKey(path));
  }

  private emitCatalogUpdates(songIds: readonly string[], artworkChanged = false): void {
    if (artworkChanged) this.repository.emitDataUpdate('songs/artworks', [...songIds]);
    this.repository.emitDataUpdate('songs/updatedSong', [...songIds]);
    this.repository.emitDataUpdate('artists/updatedArtist');
    this.repository.emitDataUpdate('albums/updatedAlbum');
    this.repository.emitDataUpdate('genres/updatedGenre');
  }

  async updateSongId3Tags(
    songIdOrPath: string,
    tags: SongTags,
    sendUpdatedData = false,
    isKnownSource = true
  ): Promise<MetadataUpdateResult> {
    const initialCatalog = this.repository.getCatalog();
    const initialKnownSong = isKnownSource
      ? initialCatalog.songs.find((song) => song.songId === songIdOrPath)
      : undefined;
    const diskPath = initialKnownSong?.path ?? removeDefaultAppProtocolFromFilePath(songIdOrPath);
    const clearPending = this.markPending([diskPath]);

    try {
      return await this.exclusive(async () => {
        if (!isKnownSource)
          return this.updateUnknownSong(songIdOrPath, diskPath, tags, sendUpdatedData);
        const catalog = this.repository.getCatalog();
        const knownSong = catalog.songs.find((song) => song.songId === songIdOrPath);
        if (!knownSong) return { success: false, reason: 'SONG_NOT_FOUND' };

        const currentArtwork = this.repository.getSongArtwork(knownSong);
        const requestedArtwork = tags.artworkPath;
        const artworkChanged =
          comparableArtworkPath(requestedArtwork) !==
          comparableArtworkPath(currentArtwork.artworkPath);
        const preflight = planSongRelink(
          catalog,
          knownSong.songId,
          catalogPatchFromTags(tags),
          () => this.repository.createId()
        );
        let artworkPaths = currentArtwork;
        let artworkUpdate: MetadataTagPatch['artwork'] = { kind: 'keep' };
        if (artworkChanged) {
          artworkPaths = await this.repository.replaceSongArtwork(
            knownSong.songId,
            requestedArtwork ? { kind: 'path', path: requestedArtwork } : undefined
          );
          artworkUpdate = requestedArtwork
            ? { kind: 'replace', path: requestedArtwork }
            : { kind: 'remove' };
        }

        const plan = planSongRelink(
          preflight.catalog,
          knownSong.songId,
          {
            artworkAvailable: !artworkPaths.isDefaultArtwork,
            artworkName: artworkNameFromPaths(artworkPaths)
          },
          () => this.repository.createId()
        );
        await this.repository.file.write(knownSong.path, songTagsPatch(tags, artworkUpdate));
        this.repository.commitCatalog(plan.catalog);
        this.emitCatalogUpdates([knownSong.songId], artworkChanged);

        const result: MetadataUpdateResult = { success: true };
        if (sendUpdatedData) {
          const token = `${Date.now()}`;
          result.updatedData = this.repository.createPlayerData(plan.song, token);
          const artworkPath = cacheBusted(artworkPaths.artworkPath, token);
          result.updatedData.artwork = artworkPath;
          result.updatedData.artworkPath = artworkPath;
        }
        return result;
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.repository.sendMessage('METADATA_UPDATE_FAILED', { message: reason });
      return { success: false, reason };
    } finally {
      clearPending();
    }
  }

  private async updateUnknownSong(
    originalPath: string,
    diskPath: string,
    tags: SongTags,
    sendUpdatedData: boolean
  ): Promise<MetadataUpdateResult> {
    const previous = this.repository.getUnknownSong(originalPath);
    const previousArtwork = previous?.artworkPath;
    const artworkChanged =
      comparableArtworkPath(tags.artworkPath) !== comparableArtworkPath(previousArtwork);
    let artworkPath = tags.artworkPath;
    let artworkUpdate: MetadataTagPatch['artwork'] = { kind: 'keep' };
    if (artworkChanged) {
      artworkPath = tags.artworkPath
        ? await this.repository.createTemporaryArtwork(tags.artworkPath)
        : undefined;
      artworkUpdate = tags.artworkPath
        ? { kind: 'replace', path: tags.artworkPath }
        : { kind: 'remove' };
    }

    await this.repository.file.write(diskPath, songTagsPatch(tags, artworkUpdate));
    const token = `${Date.now()}`;
    const updated: NonNullable<MetadataUpdateResult['updatedData']> = {
      songId: previous?.songId ?? originalPath,
      title: tags.title,
      artists: tags.artists?.map((artist) => ({
        artistId: artist.artistId ?? '',
        name: artist.name
      })),
      album: tags.album ? { albumId: tags.album.albumId ?? '', name: tags.album.title } : undefined,
      duration: tags.duration,
      artwork: cacheBusted(artworkPath, token),
      artworkPath: cacheBusted(artworkPath, token),
      path: previous?.path ?? originalPath,
      isAFavorite: previous?.isAFavorite ?? false,
      isKnownSource: false,
      isBlacklisted: previous?.isBlacklisted ?? false
    };
    if (previous) this.repository.updateUnknownSong(previous.songId, updated);
    return { success: true, updatedData: sendUpdatedData ? updated : undefined };
  }

  async reParseSong(filePath: string): Promise<SavableSongData | undefined> {
    const diskPath = removeDefaultAppProtocolFromFilePath(filePath);
    return this.exclusive(async () => {
      const catalog = this.repository.getCatalog();
      const song = catalog.songs.find(
        (entry) => this.pathKey(entry.path) === this.pathKey(diskPath)
      );
      if (!song) return undefined;

      try {
        await this.repository.file.healBlankPictureMime(diskPath).catch(() => undefined);
        const metadata = await this.repository.file.read(diskPath);
        const title =
          metadata.title?.trim() || fileNameWithoutExtension(diskPath) || 'Unknown Title';
        const catalogPatch: CatalogSongPatch = {
          title,
          artists: metadata.artists.map((name) => ({ name })),
          albumArtists: metadata.albumArtists.map((name) => ({ name })),
          album: metadata.album ? { title: metadata.album } : undefined,
          genres: metadata.genres.map((name) => ({ name })),
          year: metadata.year,
          trackNumber: metadata.trackNumber,
          discNumber: metadata.discNumber,
          duration: metadata.duration,
          bitrate: metadata.bitrate,
          sampleRate: metadata.sampleRate,
          numberOfChannels: metadata.numberOfChannels,
          createdDate: metadata.createdDate,
          modifiedDate: metadata.modifiedDate
        };
        const preflight = planSongRelink(catalog, song.songId, catalogPatch, () =>
          this.repository.createId()
        );
        const artworkSource: MetadataArtworkSource | undefined = metadata.picture
          ? { kind: 'embedded', picture: metadata.picture }
          : undefined;
        const artworkPaths = await this.repository.replaceSongArtwork(song.songId, artworkSource);
        const plan = planSongRelink(
          preflight.catalog,
          song.songId,
          {
            artworkAvailable: !artworkPaths.isDefaultArtwork,
            artworkName: artworkNameFromPaths(artworkPaths)
          },
          () => this.repository.createId()
        );
        this.repository.commitCatalog(plan.catalog);
        this.emitCatalogUpdates([song.songId], true);
        this.repository.sendMessage('SONG_REPARSE_SUCCESS', { title: plan.song.title });
        return plan.song;
      } catch (error) {
        // The bare `catch {}` this replaces threw the reason away, so a failed
        // re-parse produced a toast saying only that something went wrong and
        // left nothing behind to say what - not in the log, not in the console.
        console.error(`Failed to re-parse the song: ${diskPath}`, error);
        this.repository.sendMessage('SONG_REPARSE_FAILED');
        return undefined;
      }
    });
  }

  private async applyArtistPlan(plan: CatalogBatchPlan): Promise<MetadataUpdateResult | undefined> {
    const songById = new Map(plan.catalog.songs.map((song) => [song.songId, song]));
    const current = this.repository.getCatalog();
    const currentById = new Map(current.songs.map((song) => [song.songId, song]));
    const paths = plan.songIds.map((songId) => {
      const song = currentById.get(songId);
      if (!song) throw new Error(`Song does not exist: ${songId}`);
      return song.path;
    });
    const clearPending = this.markPending(paths);
    try {
      for (const songId of plan.songIds) {
        const song = currentById.get(songId);
        const patch = plan.tagPatches.get(songId);
        if (!song || !patch) throw new Error(`Incomplete artist merge plan for song ${songId}.`);
        await this.repository.file.write(song.path, patch);
      }
      this.repository.commitCatalog(plan.catalog);
      this.emitCatalogUpdates(plan.songIds);
      const lastSongId = plan.songIds.at(-1);
      const lastSong = lastSongId ? songById.get(lastSongId) : undefined;
      return lastSong
        ? {
            success: true,
            updatedData: this.repository.createPlayerData(lastSong, `${Date.now()}`)
          }
        : undefined;
    } finally {
      clearPending();
    }
  }

  resolveArtistDuplicates(
    selectedArtistId: string,
    duplicateIds: string[]
  ): Promise<MetadataUpdateResult | undefined> {
    return this.exclusive(async () => {
      const plan = planArtistDuplicateMerge(
        this.repository.getCatalog(),
        selectedArtistId,
        duplicateIds
      );
      return this.applyArtistPlan(plan);
    });
  }

  resolveSeparateArtists(
    separateArtistId: string,
    separateArtistNames: string[]
  ): Promise<MetadataUpdateResult | undefined> {
    return this.exclusive(async () => {
      const plan = planSeparateArtist(
        this.repository.getCatalog(),
        separateArtistId,
        separateArtistNames,
        () => this.repository.createId()
      );
      return this.applyArtistPlan(plan);
    });
  }

  resolveFeaturingArtists(
    songId: string,
    featArtistNames: string[],
    removeFeatInfoInTitle = false
  ): Promise<MetadataUpdateResult | undefined> {
    return this.exclusive(async () => {
      const plan = planFeaturingArtists(
        this.repository.getCatalog(),
        songId,
        featArtistNames,
        removeFeatInfoInTitle,
        () => this.repository.createId()
      );
      return this.applyArtistPlan(plan);
    });
  }
}

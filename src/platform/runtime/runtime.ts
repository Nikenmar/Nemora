import blacklistFolders from '../core/blacklist/blacklistFolders';
import blacklistSongs from '../core/blacklist/blacklistSongs';
import { isFolderBlacklisted, isSongBlacklisted } from '../core/blacklist/isBlacklisted';
import restoreBlacklistedFolders from '../core/blacklist/restoreBlacklistedFolder';
import restoreBlacklistedSongs from '../core/blacklist/restoreBlacklistedSongs';
import toggleBlacklistFolders from '../core/blacklist/toggleBlacklistFolders';
import filterArtists from '../core/filters/filterArtists';
import filterSongs from '../core/filters/filterSongs';
import addSongsToPlaylist from '../core/playlists/addSongsToPlaylist';
import { addToSongsHistory } from '../core/playlists/addToSongsHistory';
import addArtworkToAPlaylist from '../core/playlists/addArtworkToAPlaylist';
import addNewPlaylist from '../core/playlists/addNewPlaylist';
import clearSongHistory from '../core/playlists/clearSongHistory';
import exportPlaylist from '../core/playlists/exportPlaylist';
import importPlaylist from '../core/playlists/importPlaylist';
import { generateRandomId } from '../core/playlists/randomId';
import removePlaylists from '../core/playlists/removePlaylists';
import removeSongFromPlaylist from '../core/playlists/removeSongFromPlaylist';
import renameAPlaylist from '../core/playlists/renameAPlaylist';
import sendPlaylistData from '../core/playlists/sendPlaylistData';
import { REDISCOVER_PLAYLIST_TEMPLATE } from '../core/playlists/playlistTemplates';
import type { PlaylistsRepository } from '../core/playlists/playlistRepository';
import toggleLikeSongs from '../core/playlists/toggleLikeSongs';
import type { NetworkRepository } from '../core/net/repository';
import type { LyricsRepository } from '../core/lyrics/repository';
import { removeDefaultAppProtocolFromFilePath } from '../core/lyrics/pathUtils';
import exportAppData from '../core/appdata/exportAppData';
import importAppData from '../core/appdata/importAppData';
import resetAppData from '../core/appdata/resetAppData';
import type { AppDataRepository } from '../core/appdata/appDataRepository';
import exportStatsData from '../core/transfer/exportStats';
import importStatsData from '../core/transfer/importStats';
import type { StatsTransferRepository } from '../core/transfer/statsTransferRepository';
import {
  audioArtwork,
  embeddedArtwork,
  pathArtwork,
  urlArtwork,
  type ArtworkSource
} from '../core/artwork';
import {
  deleteSongsFromSystem as deleteCatalogSongsFromSystem,
  getSongFromUnknownSource as getCatalogSongFromUnknownSource,
  isPathWithin,
  reconcileCatalog,
  removeMusicFolder as removeCatalogMusicFolder,
  removeSongsFromLibrary,
  type CatalogRepository,
  type CatalogState,
  type PathBackedAudioData
} from '../core/catalog';
import { SUPPORTED_MUSIC_EXTENSIONS } from '../core/library/constants';
import { canonicalPathKey, parentPath } from '../core/library/path';
import { scanTraversal } from '../core/library/scanner';
import { walkMusicTrees } from '../core/library/traversal';
import type {
  LibraryFileSystemPort,
  LibraryRepository,
  MetadataParserPort,
  ScannedLibraryTrack,
  TraversalResult
} from '../core/library/types';
import {
  MetadataService,
  type MetadataArtworkSource,
  type MetadataFileData,
  type MetadataRepository,
  type MetadataUpdateResult
} from '../core/metadata';
// Leaf imports rather than the `../core/watchers` barrel: the barrel also
// re-exports tauriWatcher.ts, which pulls the Tauri fs plugin into this
// module's graph and therefore into every runtime unit test.
import { LibraryWatcherManager } from '../core/watchers/watcherManager';
import { internalWriteSuppression } from '../core/watchers/suppression';
import type { LibraryWatcherRepository } from '../core/watchers/types';
import refreshRediscover, { type RediscoverRepo } from '../core/rediscover/rediscover';
import { dedupeListeningRows } from '../core/stats/mergeListeningData';
import {
  absorbLegacySurplus,
  countersFromLegacyRows,
  deriveListeningRows,
  legacyRowsDigest,
  recordListening,
  type ListeningCounterFile,
  type ListeningKind
} from '../core/stats/listeningEvents';
import {
  fingerprintOfSong,
  relinkOrphanedListeningRows,
  relinkOrphanedRatings,
  relinkOrphanedTierlistItems
} from '../core/stats/songFingerprint';
import clearSearchHistoryResults from '../core/search/clearSearchHistoryResults';
import type { SearchRepository } from '../core/search/repository';
import runSearch from '../core/search/search';
import {
  getSongGuessrPools,
  getSongGuessrRound,
  searchSongGuessrCandidates,
  type SongGuessrRepository
} from '../core/songGuessr';
import getMegaShuffleWeights, {
  getMegaShuffleData,
  type MegaShuffleRepo
} from '../core/shuffle/megaShuffle';
import sortAlbums from '../core/sort/sortAlbums';
import sortArtists from '../core/sort/sortArtists';
import sortFolders from '../core/sort/sortFolders';
import sortGenres from '../core/sort/sortGenres';
import sortSongs from '../core/sort/sortSongs';
import toggleLikeArtists from '../core/playlists/toggleLikeArtists';
import {
  getDuelPair,
  getDuelPairByIds,
  recordDuelSkip,
  selectDuelAnchorFromCandidates,
  submitDuelResult,
  type EloDuelsRepo
} from '../core/stats/eloDuels';
import {
  getTournamentOverview,
  resumeTournament,
  startTournament,
  submitTournamentDuel,
  type PreparedTournament,
  type TournamentDuelSubmission,
  type TournamentOverview,
  type TournamentSize,
  type TournamentState
} from '../core/stats/tournaments';
import collectStatsData, { type StatsDataRepo } from '../core/stats/getStatsData';
import { buildRecap, type RecapPeriod, type RecapSlide } from '../core/stats/recap';
import {
  addTierlist,
  removeTierlists,
  saveTierlist,
  sendTierlistData,
  type TierlistsRepo
} from '../core/tierlists/tierlists';
// Imported leaf-first, not through `../core/import`: the barrel re-exports the
// port factory, which pulls the Tauri plugins into this module's graph and
// would drag them into every runtime unit test. These two modules are pure —
// they take the port as an argument.
import { detectNoraSource, type NoraSourceInventory } from '../core/import/detectNoraSource';
import { importNoraProfile, type NoraImportReport } from '../core/import/importNora';
import type { NoraImportPort } from '../core/import/noraImportRepository';
import { CachedStores, createDefaultStoreFiles, type StoreDefaults } from '../stores';
import type { StorePort } from '../contracts/store';
import { NotPortedYetError } from '../api/errors';
import type { RuntimeArtworkPaths } from './artwork';
import type { RuntimeEventSink } from './events';
import { logger } from './logger';
import { RuntimeNotHydratedError } from './errors';
import { generateStorageMetrics } from './storage';
import type {
  RuntimeDiscordActivity,
  RuntimeFileServices,
  RuntimeServices,
  RuntimeSingleInstanceController,
  RuntimeSystemServices
} from './services';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * How many covers to produce at once.
 *
 * Capped below the core count so a scan started in the background cannot take
 * the whole machine away from playback, and floored at two so a host that
 * reports nothing still overlaps its work.
 */
/**
 * How many finished covers to announce at once.
 *
 * Small enough that a cover shows up while the scan is still running, large
 * enough that a three-hundred-track scan is a dozen updates and not three
 * hundred.
 */
const ARTWORK_ANNOUNCE_GROUP = 12;

const artworkConcurrency = (): number => {
  const cores = globalThis.navigator?.hardwareConcurrency ?? 0;
  return Math.max(2, Math.min(8, cores > 0 ? cores - 1 : 4));
};


interface RuntimeSnapshots {
  songs: SavableSongData[];
  artists: SavableArtist[];
  albums: SavableAlbum[];
  genres: SavableGenre[];
  playlists: SavablePlaylist[];
  userData: UserData;
  listeningData: SongListeningData[];
  listeningEvents: ListeningCounterFile;
  blacklist: Blacklist;
  tierlists: SavableTierlist[];
  cmrStats: CmrStatsData;
  palettes: PaletteData[];
}

interface NativeReparseData {
  metadata: MetadataFileData;
  audioPath: string;
  pictureMimeType?: string;
}

export interface NoraRuntimeOptions {
  version: string;
  artwork: RuntimeArtworkPaths;
  events: RuntimeEventSink;
  defaults?: StoreDefaults;
  services?: RuntimeServices;
}

export class NoraRuntime {
  private readonly cache: CachedStores;
  private readonly storePort: StorePort;
  private readonly artwork: RuntimeArtworkPaths;
  private readonly events: RuntimeEventSink;
  private readonly version: string;
  private readonly services: RuntimeServices;
  private snapshots: RuntimeSnapshots | undefined;
  private retainedTraversal: TraversalResult | undefined;
  private metadataController: MetadataService | undefined;
  private songGuessrRepo: SongGuessrRepository | undefined;
  private singleInstanceController: RuntimeSingleInstanceController | undefined;
  private libraryWatcher: LibraryWatcherManager | undefined;
  /** Serialises background cover generation so two batches cannot interleave. */
  private artworkQueue: Promise<void> = Promise.resolve();
  /**
   * Progress across the WHOLE scan, not the current batch.
   *
   * A scan enqueues one batch per commit, so counting per batch would restart
   * the bar at zero every hundred songs. The total grows as batches arrive and
   * both counters reset once the queue has drained.
   */
  private artworkTotal = 0;
  private artworkDone = 0;
  /** Sorted and filtered song orders, keyed by the pair that produced them. */
  private readonly orderedSongsCache = new Map<string, readonly SavableSongData[]>();
  private startupSongCaptureActive = false;
  private startupSong: PathBackedAudioData | undefined;
  private readonly outsideLibrarySongs: PathBackedAudioData[] = [];
  private readonly nativeReparseData = new Map<string, NativeReparseData>();
  private listeningEventsReady = false;

  constructor(port: StorePort, options: NoraRuntimeOptions) {
    this.storePort = port;
    this.cache = new CachedStores(
      port,
      options.defaults ?? createDefaultStoreFiles(options.version)
    );
    this.artwork = options.artwork;
    this.events = options.events;
    this.version = options.version;
    this.services = options.services ?? {};
  }

  async hydrate(): Promise<void> {
    const [listeningEventsExisted, listeningDataExisted] = await Promise.all([
      this.storePort.exists('listeningEvents'),
      this.storePort.exists('listeningData')
    ]);
    await this.cache.hydrate();
    this.snapshots = {
      songs: this.cache.get('songs'),
      artists: this.cache.get('artists'),
      albums: this.cache.get('albums'),
      genres: this.cache.get('genres'),
      playlists: this.cache.get('playlists'),
      userData: this.cache.get('userData'),
      // Deduped on every read, matching Electron's getListeningData
      // (src/main/filesystem.ts:516). Profiles from builds before 3.3.0 hold
      // several rows per song, and summing them inflated the statistics page
      // more than sevenfold. This is the single read point, so fixing it here
      // fixes every consumer.
      listeningData: dedupeListeningRows(this.cache.get('listeningData')),
      listeningEvents: this.cache.get('listeningEvents'),
      blacklist: this.cache.get('blacklist'),
      tierlists: this.cache.get('tierlists'),
      cmrStats: this.cache.get('cmrStats'),
      palettes: this.cache.get('palettes')
    };
    this.healListeningIdentity();
    // Covers the profile whose library was rebuilt by a build that kept these
    // but had nothing to bring them back; a scan alone would never reach them.
    this.reattachRankings(this.state().songs);
    await this.hydrateListeningEvents(listeningEventsExisted, listeningDataExisted);
    if (this.services.singleInstance && !this.singleInstanceController) {
      this.singleInstanceController = await this.services.singleInstance.create({
        openAuthUri: (uri) => this.events.openAuthUri?.(uri),
        openAudioFile: (path) => this.routeOpenedAudioFile(path)
      });
    }
  }

  /**
   * Creates the merge-safe counter store once, without risking the only legacy
   * copy of listening history. The old file is flushed and backed up before
   * the first listening-events write can enter the store queue.
   */
  private async hydrateListeningEvents(
    listeningEventsExisted: boolean,
    listeningDataExisted: boolean
  ): Promise<void> {
    if (listeningEventsExisted) {
      this.listeningEventsReady = true;
    } else {
      const files = this.services.files;
      if (!files) {
        logger.error('Could not migrate listening history: runtime file services are unavailable.');
        return;
      }

      try {
        // A genuinely fresh profile has no listening_data.json yet. Materialize
        // its empty legacy view so the same backup rule applies to fresh and old
        // profiles and every successful migration has a recovery file.
        if (!listeningDataExisted) this.cache.set('listeningData', this.state().listeningData);
        await this.cache.flush('listeningData');

        const sourcePath = await files.profilePath('listening_data.json');
        const backupPath = await files.profilePath(
          'backups',
          `listening_data.json.pre-events-${Date.now()}.json`
        );
        await files.copyFileAtomic(sourcePath, backupPath);

        const installId = generateRandomId();
        const migrationSourceId = `migrated:${legacyRowsDigest(this.state().listeningData)}`;
        const migration = countersFromLegacyRows(
          this.state().listeningData,
          migrationSourceId,
          installId
        );
        this.setSnapshot('listeningEvents', 'listeningEvents', migration.file, true);
        await this.cache.flush('listeningEvents');
        this.listeningEventsReady = true;

        logger.info('Migrated listening history to merge-safe counters.', {
          migrated: migration.migrated,
          skipped: migration.skipped
        });
        if (migration.skipped > 0)
          logger.warn('Kept listening rows without track identity in the legacy store.', {
            count: migration.skipped
          });
      } catch (error) {
        logger.error(
          'Could not back up listening history; migration was aborted for this launch.',
          { error }
        );
        return;
      }
    }

    const reconciliation = absorbLegacySurplus(
      this.state().listeningEvents,
      this.state().listeningData,
      'legacy-drift'
    );
    if (reconciliation.rowsAbsorbed > 0) {
      this.setSnapshot('listeningEvents', 'listeningEvents', reconciliation.file, true);
      logger.info('Absorbed listening history written by an older Nemora build.', {
        rows: reconciliation.rowsAbsorbed,
        listens: reconciliation.listensAbsorbed
      });
    }
    const legacyView = deriveListeningRows(
      reconciliation.file,
      this.state().songs,
      this.state().listeningData
    );
    this.setSnapshot('listeningData', 'listeningData', legacyView, true);
  }

  /**
   * Keeps listening history attached to the music rather than to an id.
   *
   * Two passes, both cheap and both idempotent:
   *
   * 1. Stamp the fingerprint on rows that still resolve. This is what buys the
   *    protection - a row can only be reattached later if it recorded what it
   *    belonged to WHILE the song was still there. Rows written before this
   *    existed get their fingerprint on the first launch after the update.
   * 2. Reattach rows whose song is gone to the songs that now carry the same
   *    files, which is what a rebuilt library looks like from here.
   *
   * The alternative - doing this only after a scan - would miss every profile
   * where the library was rebuilt by an older build.
   */
  private healListeningIdentity(): void {
    const songs = this.state().songs;
    const songById = new Map(songs.map((song) => [song.songId, song]));

    let changed = false;
    let stamped = 0;
    const withFingerprints = this.state().listeningData.map((row) => {
      if (row.fingerprint) return row;
      const song = songById.get(row.songId);
      if (!song) return row;
      changed = true;
      stamped += 1;
      return { ...row, fingerprint: fingerprintOfSong(song) };
    });

    const { rows, relinked } = relinkOrphanedListeningRows(withFingerprints, songs);
    if (relinked > 0) changed = true;
    if (!changed) return;

    if (stamped > 0) logger.info('Recorded track identity on listening rows.', { count: stamped });
    if (relinked > 0)
      logger.info('Reattached listening history to rebuilt library entries.', { count: relinked });
    this.setSnapshot('listeningData', 'listeningData', rows, true);
    if (relinked > 0) this.events.dataUpdated('songs/listeningData');
  }

  /**
   * Brings back the two rankings that outlive a song: its duel rating and its
   * place in every tierlist.
   *
   * Removal already keeps them - `removeSongsFromCatalogState` stamps the
   * fingerprint on the rating and moves the tier card into `orphanedItems`
   * rather than deleting it - and both relinkers were written and tested with
   * that. Neither was ever called, so the data survived removal and then sat
   * there: a rebuilt library got its listening history back while the rating
   * and the tier placement stayed detached forever. Half a mechanism looks
   * exactly like a whole one until someone re-adds a folder.
   *
   * Matching is the shared three-level fingerprint matcher, and it SKIPS an
   * ambiguous match rather than guessing: attaching a year of duel history to
   * the wrong track is invisible and irreversible, while leaving it detached
   * stays fixable.
   */
  private reattachRankings(songs: readonly SavableSongData[]): void {
    const ratings = relinkOrphanedRatings(this.state().cmrStats, songs);
    if (ratings.relinked > 0) {
      logger.info('Reattached duel ratings to rebuilt library entries.', {
        count: ratings.relinked
      });
      this.setSnapshot('cmrStats', 'cmrStats', ratings.cmrStats, true);
      this.events.dataUpdated('eloDuels');
    }

    const tiers = relinkOrphanedTierlistItems(this.state().tierlists, songs);
    if (tiers.relinked > 0) {
      logger.info('Reattached tierlist placements to rebuilt library entries.', {
        count: tiers.relinked
      });
      this.setSnapshot('tierlists', 'tierlists', tiers.tierlists, true);
      this.events.dataUpdated('tierlists');
    }
  }

  /** The scan-time half of {@link healListeningIdentity}, for a batch just committed. */
  private reattachListeningHistory(songs: readonly SavableSongData[]): void {
    if (this.listeningEventsReady) {
      const rows = deriveListeningRows(
        this.state().listeningEvents,
        songs,
        this.state().listeningData
      );
      this.setSnapshot('listeningData', 'listeningData', rows, true);
      this.events.dataUpdated('songs/listeningData');
      return;
    }

    const { rows, relinked } = relinkOrphanedListeningRows(this.state().listeningData, songs);
    if (relinked === 0) return;
    logger.info('Reattached listening history to newly scanned tracks.', { count: relinked });
    this.setSnapshot('listeningData', 'listeningData', rows, true);
    this.events.dataUpdated('songs/listeningData');
  }

  isHydrated(): boolean {
    return this.snapshots !== undefined;
  }

  private state(): RuntimeSnapshots {
    if (!this.snapshots) throw new RuntimeNotHydratedError();
    return this.snapshots;
  }

  private songsOutsideLibrary(): AudioPlayerData[] {
    return [...(this.services.getSongsOutsideLibrary?.() ?? []), ...this.outsideLibrarySongs];
  }

  private setSnapshot<Key extends keyof RuntimeSnapshots>(
    key: Key,
    store: Key,
    value: RuntimeSnapshots[Key],
    /**
     * True when the caller built this value itself and keeps no reference to
     * it, which lets the copy be skipped.
     *
     * `clone` here is `JSON.parse(JSON.stringify(...))` over the WHOLE store.
     * A library scan commits a batch at a time, and each commit was paying
     * that round trip twice per store - once to take a working copy, once
     * again on the way in - on a catalog that grows with every batch. That
     * cost is what made the scan stall for longer and longer as it went.
     */
    owned = false
  ): void {
    const next = owned ? value : clone(value);
    this.state()[key] = next;
    this.cache.set(store, next);
    // Every mutation reaches the stores through here, which makes this the one
    // honest place to drop a derived order. Clearing all of it rather than the
    // affected keys is deliberate: a sort can depend on songs, on listening
    // data and on the blacklist at once, and a cache that is right only for the
    // combinations someone remembered to enumerate is worse than none.
    this.orderedSongsCache.clear();
  }

  async flush(): Promise<void> {
    this.state();
    await this.cache.flush();
  }

  private selectedPalette(paletteId?: string): PaletteData | undefined {
    return paletteId
      ? this.state().palettes.find((palette) => palette.paletteId === paletteId)
      : undefined;
  }

  private isSongBlacklisted(songId: string, songPath: string): boolean {
    return isSongBlacklisted(this.blacklistRepository(), songId, songPath);
  }

  private artworkSource(value: string): ArtworkSource {
    const localPath = this.artwork.localPath?.(value);
    if (localPath) return pathArtwork(localPath);
    return /^(?:https?|nora|asset):/iu.test(value) ? urlArtwork(value) : pathArtwork(value);
  }

  private requireArtworkService() {
    const service = this.services.artwork;
    if (!service) throw new NotPortedYetError('artwork service');
    return service;
  }

  private requireMetadataFile() {
    const service = this.services.metadata;
    if (!service) throw new NotPortedYetError('metadata file service');
    return service;
  }

  private metadataRepository(): MetadataRepository {
    return {
      getCatalog: () =>
        clone({
          songs: this.state().songs,
          artists: this.state().artists,
          albums: this.state().albums,
          genres: this.state().genres
        }),
      commitCatalog: (catalog) => {
        this.setSnapshot('songs', 'songs', catalog.songs);
        this.setSnapshot('artists', 'artists', catalog.artists);
        this.setSnapshot('albums', 'albums', catalog.albums);
        this.setSnapshot('genres', 'genres', catalog.genres);
      },
      createId: generateRandomId,
      file: {
        read: (path) => {
          const native = this.nativeReparseData.get(canonicalPathKey(path));
          return native ? Promise.resolve(native.metadata) : this.requireMetadataFile().read(path);
        },
        write: (path, patch) => this.requireMetadataFile().write(path, patch),
        healBlankPictureMime: (path) => this.requireMetadataFile().healBlankPictureMime(path)
      },
      getSongArtwork: (song) => this.artwork.song(song.songId, song.isArtworkAvailable),
      replaceSongArtwork: async (songId, source?: MetadataArtworkSource) => {
        const service = this.requireArtworkService();
        if (!source) {
          await service.removeStoredArtwork(songId);
          return this.artwork.song(songId, false);
        }
        const song = this.state().songs.find((candidate) => candidate.songId === songId);
        const native = song ? this.nativeReparseData.get(canonicalPathKey(song.path)) : undefined;
        const artworkSource =
          source.kind === 'path'
            ? this.artworkSource(source.path)
            : native
              ? audioArtwork(native.audioPath, native.pictureMimeType)
              : embeddedArtwork(source.picture.bytes, source.picture.mimeType);
        const paths = await service.storeArtworks(songId, 'songs', artworkSource);
        if (paths.isDefaultArtwork) throw new Error(`Failed to store artwork for song ${songId}.`);
        return paths;
      },
      createTemporaryArtwork: async (path) => {
        const localPath = await this.requireArtworkService().createTempArtwork(
          this.artworkSource(path)
        );
        return localPath ? this.artwork.songFile(localPath) : undefined;
      },
      getUnknownSong: (path) =>
        this.songsOutsideLibrary().find(
          (song) =>
            canonicalPathKey(removeDefaultAppProtocolFromFilePath(song.path)) ===
            canonicalPathKey(removeDefaultAppProtocolFromFilePath(path))
        ),
      updateUnknownSong: (songId, value) => {
        const song = this.songsOutsideLibrary().find((entry) => entry.songId === songId);
        if (song) Object.assign(song, clone(value));
      },
      createPlayerData: (song) => {
        const artists = (song.artists ?? []).map((reference) => {
          const artist = this.state().artists.find(
            (candidate) => candidate.artistId === reference.artistId
          );
          return {
            artistId: reference.artistId,
            name: artist?.name ?? reference.name,
            artworkPath: this.artwork.artist(artist?.artworkName).artworkPath,
            onlineArtworkPaths: artist?.onlineArtworkPaths
          };
        });
        const artworkPath = this.artwork.song(song.songId, song.isArtworkAvailable).artworkPath;
        return {
          songId: song.songId,
          title: song.title,
          artists,
          duration: song.duration,
          artwork: artworkPath,
          artworkPath,
          path: this.artwork.songFile(song.path),
          isAFavorite: song.isAFavorite,
          album: song.album,
          paletteData: this.selectedPalette(song.paletteId),
          isKnownSource: true,
          isBlacklisted: this.isSongBlacklisted(song.songId, song.path)
        };
      },
      emitDataUpdate: (type, ids) => this.events.dataUpdated(type, ids),
      sendMessage: (messageCode, data) => this.events.message(messageCode, data)
    };
  }

  private metadataService(): MetadataService {
    this.metadataController ??= new MetadataService(this.metadataRepository());
    return this.metadataController;
  }

  private playlistArtworkId(paths: ArtworkPaths): string {
    const decoded = decodeURIComponent(paths.artworkPath);
    const match = /([^/\\]+)\.webp(?:[?#].*)?$/iu.exec(decoded);
    if (!match) throw new Error(`Unable to identify stored playlist artwork: ${paths.artworkPath}`);
    return match[1];
  }

  private playlistRepository(): PlaylistsRepository {
    return {
      getPlaylists: (ids) => {
        const playlists = this.state().playlists;
        return ids && ids.length > 0
          ? playlists.filter((playlist) => ids.includes(playlist.playlistId))
          : playlists;
      },
      setPlaylists: (value) => this.setSnapshot('playlists', 'playlists', value),
      getSongs: () => this.state().songs,
      setSongs: (value) => this.setSnapshot('songs', 'songs', value),
      getArtists: () => this.state().artists,
      setArtists: (value) => this.setSnapshot('artists', 'artists', value),
      getBlacklist: () => this.state().blacklist,
      setBlacklist: (value) => this.setSnapshot('blacklist', 'blacklist', value),
      storePlaylistArtwork: (id, artworkPath) =>
        this.requireArtworkService().storeArtworks(
          id,
          'playlist',
          artworkPath ? this.artworkSource(artworkPath) : undefined
        ),
      removePlaylistArtwork: (paths) =>
        this.requireArtworkService().removeStoredArtwork(this.playlistArtworkId(paths)),
      getPlaylistArtworkPath: (id, available) => this.artwork.playlist(id, available),
      getSongArtworkPath: (id, available) => this.artwork.song(id, available),
      getArtistArtworkPath: (name) => this.artwork.artist(name),
      resetArtworkCache: () => undefined,
      addAFavoriteToLastFM: (title, artists) => {
        void import('../core/net/lastFm/sendFavoritesDataToLastFM')
          .then(({ addAFavoriteToLastFM }) =>
            addAFavoriteToLastFM(this.networkRepository(), title, artists)
          )
          .catch((error: unknown) => logger.warn('Failed to mirror a favorite to Last.fm.', { error }));
      },
      removeAFavoriteFromLastFM: (title, artists) => {
        void import('../core/net/lastFm/sendFavoritesDataToLastFM')
          .then(({ removeAFavoriteFromLastFM }) =>
            removeAFavoriteFromLastFM(this.networkRepository(), title, artists)
          )
          .catch((error: unknown) =>
            logger.warn('Failed to remove a favorite from Last.fm.', { error })
          );
      },
      emitDataUpdate: (type, data, message) => this.events.dataUpdated(type, data, message),
      sendMessage: (code, data) => this.events.message(code, data)
    };
  }

  private blacklistRepository() {
    return {
      getBlacklist: () => this.state().blacklist,
      setBlacklist: (value: Blacklist) => this.setSnapshot('blacklist', 'blacklist', value),
      getSongInfo: (ids: string[]) => Promise.resolve(this.getSongInfo(ids)),
      emitDataUpdate: (type: DataUpdateEventTypes, data?: string[], message?: string) =>
        this.events.dataUpdated(type, data, message),
      sendMessage: (code: MessageCodes, data?: MessageToRendererData) =>
        this.events.message(code, data)
    };
  }

  private searchRepository(): SearchRepository {
    return {
      getSongs: () => this.state().songs,
      getArtists: () => this.state().artists,
      getAlbums: () => this.state().albums,
      getGenres: () => this.state().genres,
      getPlaylists: () => this.state().playlists,
      getListeningData: () => this.state().listeningData,
      getSongBlacklist: () => this.state().blacklist.songBlacklist,
      getRecentSearches: () => this.state().userData.recentSearches,
      setRecentSearches: (recentSearches) => this.saveUserData('recentSearches', recentSearches),
      getSongArtworkPaths: (id, available) => this.artwork.song(id, available),
      getArtistArtworkPaths: (name) => this.artwork.artist(name),
      getAlbumArtworkPaths: (name) => this.artwork.album(name),
      getPlaylistArtworkPaths: (id, available) => this.artwork.playlist(id, available),
      notifyDataUpdated: (channel) => this.events.dataUpdated(channel as DataUpdateEventTypes),
      log: logger
    };
  }

  private networkRepository(): NetworkRepository {
    return {
      getSongs: () => this.state().songs,
      getAlbums: () => this.state().albums,
      getArtists: () => this.state().artists,
      setArtists: (value) => this.setSnapshot('artists', 'artists', value),
      getUserData: () => this.state().userData,
      getSongsOutsideLibrary: () => this.songsOutsideLibrary(),
      getBlacklist: () => this.state().blacklist,
      getSongArtworkPath: (id, available) => this.artwork.song(id, available),
      getArtistArtworkPath: (name) => this.artwork.artist(name),
      getAlbumArtworkPath: (name) => this.artwork.album(name),
      getSelectedPaletteData: (id) => this.selectedPalette(id),
      generatePalette: async (imageUrl) => {
        const palette = await this.services.palette?.generate(urlArtwork(imageUrl));
        if (!palette) throw new Error('Failed to generate an artwork palette.');
        return palette;
      },
      decrypt: async (encrypted) => {
        if (!this.services.decrypt) {
          throw new NotPortedYetError('Electron safeStorage decryption');
        }
        return this.services.decrypt(encrypted);
      },
      emitDataUpdate: (type, data) => this.events.dataUpdated(type, data)
    };
  }

  private lyricsRepository(): LyricsRepository {
    return {
      getUserData: () => this.state().userData,
      readEmbeddedLyrics: async (path) => {
        if (!this.services.readEmbeddedLyrics) {
          throw new NotPortedYetError('embedded lyrics reader');
        }
        return this.services.readEmbeddedLyrics(path);
      },
      writeEmbeddedLyrics: async (path, tags) => {
        if (!this.services.writeEmbeddedLyrics) {
          throw new NotPortedYetError('embedded lyrics writer');
        }
        await this.services.writeEmbeddedLyrics(path, tags);
      },
      decrypt: async (encrypted) => {
        if (!this.services.decrypt) {
          throw new NotPortedYetError('Electron safeStorage decryption');
        }
        return this.services.decrypt(encrypted);
      },
      searchUnsyncedLyrics: (query) =>
        this.services.searchUnsyncedLyrics?.(query) ?? Promise.resolve(undefined),
      sendMessage: ({ messageCode, data }) => this.events.message(messageCode, data),
      emitDataUpdate: (type, data) => this.events.dataUpdated(type, data)
    };
  }

  private requireFiles(): RuntimeFileServices {
    const files = this.services.files;
    if (!files) throw new NotPortedYetError('runtime file services');
    return files;
  }

  private requireSystem(): RuntimeSystemServices {
    const system = this.services.system;
    if (!system) throw new NotPortedYetError('runtime system services');
    return system;
  }

  private appDataRepository(): AppDataRepository {
    const files = this.requireFiles();
    return {
      getSongsData: () => this.state().songs,
      setSongsData: (value) => this.setSnapshot('songs', 'songs', value),
      getPaletteData: () => this.state().palettes,
      setPaletteData: (value) => this.setSnapshot('palettes', 'palettes', value),
      getArtistsData: () => this.state().artists,
      setArtistsData: (value) => this.setSnapshot('artists', 'artists', value),
      getAlbumsData: () => this.state().albums,
      setAlbumsData: (value) => this.setSnapshot('albums', 'albums', value),
      getGenresData: () => this.state().genres,
      setGenresData: (value) => this.setSnapshot('genres', 'genres', value),
      getPlaylistData: (ids) =>
        ids && ids.length > 0
          ? this.state().playlists.filter((playlist) => ids.includes(playlist.playlistId))
          : this.state().playlists,
      setPlaylistData: (value) => this.setSnapshot('playlists', 'playlists', value),
      getUserData: () => this.state().userData,
      saveUserData: (value) => this.setSnapshot('userData', 'userData', value),
      getBlacklistData: () => this.state().blacklist,
      setBlacklist: (value) => this.setSnapshot('blacklist', 'blacklist', value),
      getListeningData: () => this.state().listeningData,
      saveListeningData: (value) => this.setSnapshot('listeningData', 'listeningData', value),
      // A full-profile operation that knows only the legacy view would be
      // overwritten by the first play afterwards, because the counters are what
      // the derived view is rebuilt from.
      getListeningCounters: () => this.state().listeningEvents,
      saveListeningCounters: (value) =>
        this.setSnapshot('listeningEvents', 'listeningEvents', value),
      getCmrStatsData: () => this.state().cmrStats,
      setCmrStatsData: (value) => this.setSnapshot('cmrStats', 'cmrStats', value),
      profilePath: (...segments) => files.profilePath(...segments),
      readTextFile: (path) => files.readTextFile(path),
      readDir: (path) => files.readDir(path),
      writeTextFileAtomic: (path, contents) => files.writeTextFileAtomic(path, contents),
      makeDir: (path, options) => files.makeDir(path, options),
      copyFile: (source, destination) => files.copyFile(source, destination),
      remove: (path, options) => files.remove(path, options),
      sendMessage: (code, data) => this.events.message(code, data),
      restartApp: (reason, force) => this.services.restartApp?.(reason, force),
      logger
    };
  }

  private statsTransferRepository(): StatsTransferRepository {
    const files = this.requireFiles();
    return {
      getSongsData: () => this.state().songs,
      getListeningData: () => this.state().listeningData,
      saveListeningData: (value) => this.setSnapshot('listeningData', 'listeningData', value),
      getListeningCounters: () => this.state().listeningEvents,
      saveListeningCounters: (value) => {
        this.setSnapshot('listeningEvents', 'listeningEvents', value);
        this.listeningEventsReady = true;
      },
      getPlaylistData: (ids) =>
        ids && ids.length > 0
          ? this.state().playlists.filter((playlist) => ids.includes(playlist.playlistId))
          : this.state().playlists,
      setPlaylistData: (value) => this.setSnapshot('playlists', 'playlists', value),
      getTierlistData: () => this.state().tierlists,
      setTierlistData: (value) => this.setSnapshot('tierlists', 'tierlists', value),
      getCmrStatsData: () => this.state().cmrStats,
      setCmrStatsData: (value) => this.setSnapshot('cmrStats', 'cmrStats', value),
      profilePath: (...segments) => files.profilePath(...segments),
      readTextFile: (path) => files.readTextFile(path),
      writeTextFileAtomic: (path, contents) => files.writeTextFileAtomic(path, contents),
      exists: (path) => files.exists(path),
      makeDir: (path, options) => files.makeDir(path, options),
      copyFileAtomic: (source, destination) => files.copyFileAtomic(source, destination),
      emitDataUpdate: (type, data, message) => this.events.dataUpdated(type, data, message),
      appVersion: this.version,
      logger
    };
  }

  private mergeFolderStructures(incoming: FolderStructure[]): FolderStructure[] {
    const current = clone(this.state().userData.musicFolders);
    const mergeOne = (target: FolderStructure[], structure: FolderStructure): boolean => {
      const key = canonicalPathKey(structure.path);
      const existing = target.find((entry) => canonicalPathKey(entry.path) === key);
      if (existing) {
        existing.stats = structure.stats;
        existing.noOfSongs = structure.noOfSongs;
        for (const child of structure.subFolders) mergeOne(existing.subFolders, child);
        return true;
      }
      for (const parent of target) {
        const parentKey = canonicalPathKey(parent.path);
        if (key.startsWith(`${parentKey}/`) && mergeOne(parent.subFolders, structure)) return true;
      }
      target.push(clone(structure));
      return true;
    };
    for (const structure of incoming) mergeOne(current, structure);
    return current;
  }

  private async commitScannedTracks(tracks: readonly ScannedLibraryTrack[]): Promise<string[]> {
    const songs = clone(this.state().songs);
    const artists = clone(this.state().artists);
    const albums = clone(this.state().albums);
    const genres = clone(this.state().genres);
    const knownPaths = new Set(songs.map((song) => canonicalPathKey(song.path)));
    const addedSongIds: string[] = [];
    const newArtistIds: string[] = [];
    const changedArtistIds: string[] = [];
    const newAlbumIds: string[] = [];
    const changedAlbumIds: string[] = [];
    const newGenreIds: string[] = [];
    const changedGenreIds: string[] = [];

    // Each track's cover source is prepared here; the covers themselves are
    // produced after the commit (see generateArtworkInBackground). The catalog
    // mutation below stays sequential because it assigns ids and edits shared
    // arrays.
    const pending = tracks
      .filter((track) => !knownPaths.has(canonicalPathKey(track.path)))
      .map((track) => {
        // A picture the scanner CARRIED, or one it merely found.
        //
        // The head parser returns the bytes it decoded; a native scan reports
        // that a cover exists and how big it is, and leaves it in the file. Both
        // are usable, and neither route below cares which one it got: the native
        // artwork pipeline opens the audio file either way, and the browser
        // route uses the bytes when it has them and asks for them when it does
        // not.
        const picture =
          track.metadata.pictures.find((entry) => entry.data) ??
          track.metadata.pictures.find((entry) => entry.byteLength > 0);
        const pictureFormat = picture?.format.toLocaleLowerCase('en-US');
        const pictureMimeType = pictureFormat?.includes('/')
          ? pictureFormat
          : pictureFormat === 'jpg'
            ? 'image/jpeg'
            : pictureFormat
              ? `image/${pictureFormat}`
              : 'application/octet-stream';
        return {
          track,
          songId: generateRandomId(),
          source: picture?.data
            ? embeddedArtwork(new Uint8Array(picture.data), pictureMimeType, track.path)
            : picture
              ? audioArtwork(track.path, pictureMimeType)
              : undefined
        };
      });

    for (const entry of pending) {
      const track = entry.track;
      const pathKey = canonicalPathKey(track.path);
      if (knownPaths.has(pathKey)) continue;

      const songId = entry.songId;
      // Covers are produced AFTER these songs are in the library, not before.
      //
      // Generating them here is what made a scan look broken: reading and
      // parsing 300 tracks takes about three seconds, generating their covers
      // about ten, and with both in one step the list stayed empty for the whole
      // time and then filled in a single jump. A song is useful the moment it
      // exists; its cover can arrive a second later.
      const hasArtwork = entry.source !== undefined;
      const artworkName = hasArtwork ? `${songId}.webp` : undefined;
      const fileName = track.path.slice(
        Math.max(track.path.lastIndexOf('/'), track.path.lastIndexOf('\\')) + 1
      );
      const extensionIndex = fileName.lastIndexOf('.');
      const title =
        track.metadata.common.title?.trim() ||
        (extensionIndex > 0 ? fileName.slice(0, extensionIndex) : fileName) ||
        'Unknown Title';
      const artistNames = track.metadata.common.artist
        ?.split(',')
        .map((name) => name.trim())
        .filter(Boolean);
      const albumArtistNames = track.metadata.common.albumArtist
        ?.split(',')
        .map((name) => name.trim())
        .filter(Boolean);
      const genreNames = track.metadata.common.genres.map((name) => name.trim()).filter(Boolean);
      const albumTitle = track.metadata.common.album?.trim();
      const rawArtists = artistNames?.map((name) => ({ name, artistId: '' }));
      const rawAlbumArtists = albumArtistNames?.map((name) => ({ name, artistId: '' }));

      const song: SavableSongData = {
        songId,
        title,
        artists: rawArtists,
        albumArtists: rawAlbumArtists,
        duration: Number((track.metadata.format.duration ?? 0).toFixed(2)),
        album: albumTitle ? { name: albumTitle, albumId: '' } : undefined,
        genres: genreNames.map((name) => ({ name, genreId: '' })),
        year: track.metadata.common.year,
        isAFavorite: false,
        isArtworkAvailable: hasArtwork,
        path: track.path,
        sampleRate: track.metadata.format.sampleRate,
        bitrate: track.metadata.format.bitrate,
        noOfChannels: track.metadata.format.numberOfChannels,
        discNo: track.metadata.common.discNumber,
        trackNo: track.metadata.common.trackNumber,
        addedDate: Date.now(),
        createdDate: track.createdDate,
        modifiedDate: track.modifiedDate
      };

      const albumPeople = rawAlbumArtists?.length ? rawAlbumArtists : (rawArtists ?? []);
      let album = albumTitle ? albums.find((entry) => entry.title === albumTitle) : undefined;
      if (albumTitle) {
        if (album) {
          album.songs.push({ songId, title });
          changedAlbumIds.push(album.albumId);
        } else {
          album = {
            albumId: generateRandomId(),
            title: albumTitle,
            artists: clone(albumPeople),
            songs: [{ songId, title }],
            year: song.year,
            artworkName
          };
          albums.push(album);
          newAlbumIds.push(album.albumId);
        }
        song.album = { albumId: album.albumId, name: album.title };
      }

      const resolveArtists = (names: string[] | undefined, albumOnly: boolean): SavableArtist[] =>
        (names ?? []).map((name) => {
          let artist = artists.find((entry) => entry.name === name);
          if (!artist) {
            artist = {
              artistId: generateRandomId(),
              name,
              songs: [{ songId, title }],
              albums: albumOnly && album ? [{ albumId: album.albumId, title: album.title }] : [],
              artworkName,
              isAFavorite: false
            };
            artists.push(artist);
            newArtistIds.push(artist.artistId);
          } else {
            if (!albumOnly) artist.songs.push({ songId, title });
            if (
              albumOnly &&
              album &&
              !artist.albums?.some((entry) => entry.albumId === album?.albumId)
            ) {
              artist.albums ??= [];
              artist.albums.push({ albumId: album.albumId, title: album.title });
            }
            changedArtistIds.push(artist.artistId);
          }
          return artist;
        });

      const songArtists = resolveArtists(artistNames, false);
      const albumArtists = resolveArtists(albumArtistNames, true);
      if (songArtists.length > 0) {
        song.artists = songArtists.map(({ artistId, name }) => ({ artistId, name }));
      }
      if (albumArtists.length > 0) {
        song.albumArtists = albumArtists.map(({ artistId, name }) => ({ artistId, name }));
      }
      if (album?.artists) {
        for (const person of [...songArtists, ...albumArtists]) {
          const unresolved = album.artists.find(
            (entry) => entry.name === person.name && entry.artistId.length === 0
          );
          if (unresolved) unresolved.artistId = person.artistId;
        }
      }

      const songGenres = genreNames.map((name) => {
        let genre = genres.find((entry) => entry.name === name);
        if (genre) {
          genre.songs.push({ songId, title });
          if (artworkName) genre.artworkName = artworkName;
          changedGenreIds.push(genre.genreId);
        } else {
          genre = {
            genreId: generateRandomId(),
            name,
            songs: [{ songId, title }],
            artworkName
          };
          genres.push(genre);
          newGenreIds.push(genre.genreId);
        }
        return genre;
      });
      song.genres = songGenres.map(({ genreId, name }) => ({ genreId, name }));

      songs.push(song);
      knownPaths.add(pathKey);
      addedSongIds.push(songId);
    }

    if (addedSongIds.length === 0) return [];
    this.generateArtworkInBackground(pending);
    // These four are the working copies taken at the top of this method and
    // nothing below reads them again, so they can be handed over rather than
    // copied a second time.
    this.setSnapshot('songs', 'songs', songs, true);
    this.setSnapshot('artists', 'artists', artists, true);
    this.setSnapshot('albums', 'albums', albums, true);
    this.setSnapshot('genres', 'genres', genres, true);
    // A re-added folder is the case this protects: the files are the same, the
    // ids are new, and the listening history is sitting there pointing at ids
    // that no longer exist. Done per batch, so history comes back with the
    // tracks rather than at the next launch.
    this.reattachListeningHistory(songs);
    this.reattachRankings(songs);
    this.events.dataUpdated('songs/newSong', addedSongIds);
    if (newArtistIds.length > 0) this.events.dataUpdated('artists/newArtist', newArtistIds);
    if (changedArtistIds.length > 0) this.events.dataUpdated('artists', changedArtistIds);
    if (newAlbumIds.length > 0) this.events.dataUpdated('albums/newAlbum', newAlbumIds);
    if (changedAlbumIds.length > 0) this.events.dataUpdated('albums', changedAlbumIds);
    if (newGenreIds.length > 0) this.events.dataUpdated('genres/newGenre', newGenreIds);
    if (changedGenreIds.length > 0) this.events.dataUpdated('genres', changedGenreIds);
    return addedSongIds;
  }

  /**
   * Produces the covers for a batch that is already in the library.
   *
   * Every committed song already points at `<songId>.webp`, and the pipeline
   * writes exactly that file, so a cover shows up as soon as it is encoded
   * without a second catalog write. Only the tracks whose cover could NOT be
   * produced need correcting, and they are corrected in one pass rather than
   * one store rewrite per failure.
   *
   * Deliberately not awaited: a scan must not wait on image encoding, and a
   * failure here must not fail a scan that already succeeded.
   */
  private generateArtworkInBackground(
    entries: readonly { songId: string; source?: ArtworkSource }[]
  ): void {
    const withArtwork = entries.filter((entry) => entry.source !== undefined);
    if (withArtwork.length === 0) return;

    const service = this.services.artwork;
    if (!service) return;

    this.artworkTotal += withArtwork.length;
    this.artworkQueue = this.artworkQueue
      .then(async () => {
        const failed: string[] = [];
        // Each cover is a decode plus two encodes, and the native route runs
        // them on a blocking thread - so this is bound by cores, not by IO.
        // Four was a guess made when this ran inside the commit and had to stay
        // polite; off the critical path it can use the machine it is on.
        const inFlight = Math.min(artworkConcurrency(), withArtwork.length);
        let next = 0;

        // Covers are announced AS THEY LAND, not once the batch is done.
        //
        // A cover takes noticeably longer to produce than the song row it
        // belongs to, and the row is already pointing at a file that does not
        // exist yet - so the interface shows a placeholder and, without being
        // told, keeps showing it until the view is rebuilt. Announcing in small
        // groups rather than per cover keeps that from becoming three hundred
        // separate refreshes.
        let announcePending: string[] = [];
        const announce = (force = false): void => {
          if (announcePending.length === 0) return;
          if (!force && announcePending.length < ARTWORK_ANNOUNCE_GROUP) return;
          const ready = announcePending;
          announcePending = [];
          this.events.dataUpdated('songs/artworks', ready);
        };

        await Promise.all(
          Array.from({ length: inFlight }, async () => {
            for (let index = next++; index < withArtwork.length; index = next++) {
              const entry = withArtwork[index];
              const paths = await service
                .storeArtworks(entry.songId, 'songs', entry.source)
                .catch((error: unknown) => {
                  logger.error('Failed to generate artwork for a scanned song.', {
                    songId: entry.songId,
                    error
                  });
                  return undefined;
                });
              if (!paths || paths.isDefaultArtwork) failed.push(entry.songId);
              else announcePending.push(entry.songId);
              announce();
              this.artworkDone += 1;
              this.events.message('ARTWORK_GENERATING_PROCESS_UPDATE', {
                total: this.artworkTotal,
                value: this.artworkDone
              });
            }
          })
        );
        announce(true);

        if (failed.length > 0) {
          const missing = new Set(failed);
          const songs = clone(this.state().songs);
          for (const song of songs) {
            if (!missing.has(song.songId)) continue;
            song.isArtworkAvailable = false;
          }
          this.setSnapshot('songs', 'songs', songs, true);
        }

        // Reset only once nothing is left queued: an intermediate batch that
        // reset here would drop the bar back to zero mid-scan.
        if (this.artworkDone >= this.artworkTotal) {
          this.artworkDone = 0;
          this.artworkTotal = 0;
        }
      })
      .catch((error: unknown) => {
        logger.error('Background artwork generation failed.', { error });
      });
  }

  private libraryRepository(
    addedSongIds: string[],
    replaceFolderStructures = false
  ): LibraryRepository {
    return {
      getKnownSongPaths: () => this.state().songs.map((song) => song.path),
      commitFolderStructures: (structures) => {
        const nextUserData = clone(this.state().userData);
        nextUserData.musicFolders = replaceFolderStructures
          ? clone(structures)
          : this.mergeFolderStructures(structures);
        this.setSnapshot('userData', 'userData', nextUserData);
        this.events.dataUpdated('userData/musicFolder');
      },
      commitScanBatch: async (tracks) => {
        addedSongIds.push(...(await this.commitScannedTracks(tracks)));
      },
      reportScanProgress: ({ completed, total }) =>
        this.events.message('AUDIO_PARSING_PROCESS_UPDATE', { total, value: completed })
    };
  }

  private catalogRepository(): CatalogRepository {
    return {
      getCatalogState: (): CatalogState => {
        const state = this.state();
        return clone({
          songs: state.songs,
          artists: state.artists,
          albums: state.albums,
          genres: state.genres,
          playlists: state.playlists,
          userData: state.userData,
          listeningData: state.listeningData,
          blacklist: state.blacklist,
          tierlists: state.tierlists,
          cmrStats: state.cmrStats
        });
      },
      commitCatalogState: (next) => {
        this.setSnapshot('songs', 'songs', next.songs);
        this.setSnapshot('artists', 'artists', next.artists);
        this.setSnapshot('albums', 'albums', next.albums);
        this.setSnapshot('genres', 'genres', next.genres);
        this.setSnapshot('playlists', 'playlists', next.playlists);
        this.setSnapshot('userData', 'userData', next.userData);
        this.setSnapshot('listeningData', 'listeningData', next.listeningData);
        this.setSnapshot('blacklist', 'blacklist', next.blacklist);
        this.setSnapshot('tierlists', 'tierlists', next.tierlists);
        this.setSnapshot('cmrStats', 'cmrStats', next.cmrStats);
      },
      removeSongArtwork: async (songId) => {
        await this.services.artwork?.removeStoredArtwork(songId);
      },
      removeDuelQueueReferences: (songIds) => this.services.removeDuelQueueReferences?.(songIds),
      emitDataUpdate: (type, data, message) => this.events.dataUpdated(type, data, message),
      sendMessage: (code, data) => this.events.message(code, data),
      reportError: (error, context) =>
        logger.error(`Catalog operation failed: ${context}`, { error })
    };
  }

  private songGuessrRepository(): SongGuessrRepository {
    if (this.songGuessrRepo) return this.songGuessrRepo;

    let catalogSource: SavableSongData[] | undefined;
    let availablePaths = new Set<string>();
    const refreshAvailability = (): void => {
      const songs = this.state().songs;
      if (songs === catalogSource) return;
      catalogSource = songs;
      availablePaths = new Set(songs.map((song) => canonicalPathKey(song.path)));
    };

    this.songGuessrRepo = {
      getSongs: () => this.state().songs,
      getBlacklist: () => this.state().blacklist,
      getPlaylists: () => this.state().playlists,
      getGenres: () => this.state().genres,
      isSongAvailable: (_songId, path) => {
        // Watcher reconciliation removes missing paths from the catalog. This
        // identity-cached set keeps autocomplete synchronous and avoids an
        // expensive plugin-fs `exists` invoke for every indexed song.
        refreshAvailability();
        return availablePaths.has(canonicalPathKey(path));
      },
      resolveSongFilePath: (path) => this.artwork.songFile(path),
      getSongArtworkPath: (id, available) => this.artwork.song(id, available),
      romanizeForSearch: (value) => this.services.romanizeForSearch?.(value),
      random: () => Math.random()
    };
    return this.songGuessrRepo;
  }

  private featureRepository(): MegaShuffleRepo & StatsDataRepo & EloDuelsRepo & RediscoverRepo {
    return {
      getSongsData: () => this.state().songs,
      getTierlistData: () => this.state().tierlists,
      getListeningData: () => this.state().listeningData,
      // Hour-of-day exists only in the counters: the legacy rows carry days.
      getListeningCounters: () => this.state().listeningEvents,
      getPlaylistData: (ids) => {
        const playlists = this.state().playlists;
        return ids && ids.length > 0
          ? playlists.filter((playlist) => ids.includes(playlist.playlistId))
          : playlists;
      },
      setPlaylistData: (value) => this.setSnapshot('playlists', 'playlists', value),
      getGenresData: () => this.state().genres,
      getCmrStatsData: () => this.state().cmrStats,
      setCmrStatsData: (value) => this.setSnapshot('cmrStats', 'cmrStats', value),
      getSongArtworkPath: (id, available) => this.artwork.song(id, available),
      resolveSongFilePath: (path) => this.artwork.songFile(path),
      isSongBlacklisted: (id, path) => this.isSongBlacklisted(id, path),
      rediscoverPlaylistTemplate: REDISCOVER_PLAYLIST_TEMPLATE,
      emitDataUpdate: (type, data, message) => this.events.dataUpdated(type, data, message),
      logger
    };
  }

  getUserData(): UserData {
    return clone(this.state().userData);
  }

  async revealSongInFileExplorer(songId: string): Promise<void> {
    const song = this.state().songs.find((candidate) => candidate.songId === songId);
    if (!song) {
      logger.warn("Revealing song failed because it is not in Nora's library.", { songId });
      this.events.message('OPEN_SONG_IN_EXPLORER_FAILED');
      return;
    }
    await this.requireSystem().revealSong(song.path);
  }

  async revealFolderInFileExplorer(folderPath: string): Promise<void> {
    await this.requireSystem().revealFolder(folderPath);
  }

  async openLogFile(): Promise<void> {
    await this.requireSystem().openLogFile();
  }

  async getStorageUsage(forceRefresh = false): Promise<StorageMetrics | undefined> {
    const cached = this.state().userData.storageMetrics;
    if (!forceRefresh) return cached ? clone(cached) : undefined;

    const system = this.requireSystem();
    const files = this.requireFiles();
    const metrics = await generateStorageMetrics({
      applicationDirectory: system.applicationDirectory,
      profilePath: files.profilePath,
      directorySize: system.directorySize,
      diskCapacity: system.diskCapacity,
      pathsShareVolume: system.pathsShareVolume
    });
    this.saveUserData('storageMetrics', metrics);
    return clone(metrics);
  }

  async toggleAutoLaunch(enabled: boolean): Promise<void> {
    await this.requireSystem().toggleAutoLaunch(enabled);
    this.saveUserData('preferences.autoLaunchApp', enabled);
  }

  async openDevTools(): Promise<void> {
    await this.requireSystem().openDevTools();
  }

  async stopScreenSleeping(): Promise<void> {
    await this.requireSystem().setDisplaySleepInhibited(true);
  }

  async allowScreenSleeping(): Promise<void> {
    await this.requireSystem().setDisplaySleepInhibited(false);
  }

  getDiscordClientId(): string | undefined {
    return this.services.discordClientId;
  }

  async setDiscordActivity(activity: RuntimeDiscordActivity): Promise<void> {
    const clientId = this.services.discordClientId;
    if (!clientId) throw new Error('Discord Client ID not found.');
    if (!this.services.setDiscordActivity) throw new NotPortedYetError('Discord IPC transport');
    await this.services.setDiscordActivity(clientId, activity);
  }

  async disconnectDiscord(): Promise<void> {
    await this.services.disconnectDiscord?.();
  }

  saveUserData(dataType: UserDataTypes, data: unknown): void {
    // The api layer encrypts `customMusixmatchUserToken` before it reaches the
    // runtime, so the value stored here is already ciphertext — same shape as
    // the Electron build, where `filesystem.setUserData` encrypted on save.
    const next = clone(this.state().userData) as UserData & Record<string, unknown>;
    const segments = dataType.split('.');
    let target: Record<string, unknown> = next;
    for (const segment of segments.slice(0, -1)) {
      const child = target[segment];
      if (typeof child !== 'object' || child === null || Array.isArray(child)) return;
      target = child as Record<string, unknown>;
    }
    target[segments.at(-1) ?? dataType] = data;
    this.setSnapshot('userData', 'userData', next);

    if (dataType === 'preferences.enableDiscordRPC' && data === false) {
      void this.disconnectDiscord().catch((error: unknown) =>
        logger.warn('Failed to disconnect Discord Rich Presence.', { error })
      );
    }

    if (dataType === 'musicFolders') this.events.dataUpdated('userData/musicFolder');
    else if (dataType.startsWith('windowDiamensions.'))
      this.events.dataUpdated('userData/windowDiamension');
    else if (dataType.startsWith('windowPositions.'))
      this.events.dataUpdated('userData/windowPosition');
    else if (dataType.includes('sortingStates')) this.events.dataUpdated('userData/sortingStates');
    else if (dataType.startsWith('preferences.')) this.events.dataUpdated('settings/preferences');
    else if (dataType === 'recentSearches') this.events.dataUpdated('userData/recentSearches');
    else this.events.dataUpdated('userData');
  }

  getListeningData(songIds: string[]): SongListeningData[] {
    const rows = [
      ...new Map(this.state().listeningData.map((entry) => [entry.songId, entry] as const)).values()
    ];
    const found = rows.filter((row) => songIds.includes(row.songId));
    if (found.length > 0) return clone(found);
    const year = new Date().getFullYear();
    return clone(
      songIds.map(
        (songId): SongListeningData => ({
          songId,
          skips: 0,
          fullListens: 0,
          inNoOfPlaylists: 0,
          listens: [{ year, listens: [] }],
          seeks: []
        })
      )
    );
  }

  getAllSongs(
    sortType: SongSortTypes = 'aToZ',
    filterType?: SongFilterTypes,
    pagination?: PaginatingData
  ): PaginatedResult<AudioInfo, SongSortTypes> {
    const ordered = this.orderedSongs(sortType, filterType);
    // Only the requested rows become AudioInfo.
    //
    // This used to convert the WHOLE catalog and then throw away everything but
    // the page - 3400 conversions to show fifty rows, measured at 582 KB of
    // garbage per read, which a scrolling list turns into tens of megabytes a
    // second through the collector. The order itself is cached above, so a page
    // now costs the page.
    const page = pagination ? ordered.slice(pagination.start, pagination.end) : ordered;
    const data = page.map(
      (song): AudioInfo => ({
        title: song.title,
        artists: song.artists,
        album: song.album,
        duration: song.duration,
        artworkPaths: this.artwork.song(song.songId, song.isArtworkAvailable),
        path: song.path,
        year: song.year,
        songId: song.songId,
        paletteData: this.selectedPalette(song.paletteId),
        addedDate: song.addedDate,
        isAFavorite: song.isAFavorite,
        isBlacklisted: this.isSongBlacklisted(song.songId, song.path)
      })
    );

    return clone({
      data,
      total: ordered.length,
      sortType,
      start: pagination?.start ?? 0,
      end: pagination?.end ?? ordered.length
    });
  }

  /**
   * The catalog in one order, kept until the catalog changes.
   *
   * Sorting 3400 songs took 4 to 8 ms and happened on every read, including
   * every page of a list the user is scrolling - the same answer, recomputed.
   * The cache holds REFERENCES to the live song objects, so an edit to a song
   * is visible immediately; only the ORDER could go stale, and `setSnapshot`
   * drops the whole cache on any store write, which is the single point every
   * mutation passes through.
   */
  private orderedSongs(
    sortType: SongSortTypes,
    filterType?: SongFilterTypes
  ): readonly SavableSongData[] {
    const key = `${sortType}\u0000${filterType ?? ''}`;
    const cached = this.orderedSongsCache.get(key);
    if (cached) return cached;

    const repository = {
      isSongBlacklisted: (id: string, path: string) => this.isSongBlacklisted(id, path),
      getFolderBlacklist: () => this.state().blacklist.folderBlacklist
    };
    const ordered = sortSongs(
      repository,
      filterSongs(repository, [...this.state().songs], filterType),
      sortType,
      this.state().listeningData
    );
    this.orderedSongsCache.set(key, ordered);
    return ordered;
  }

  getSongInfo(
    songIds: string[],
    sortType?: SongSortTypes,
    filterType?: SongFilterTypes,
    limit = songIds.length,
    preserveIdOrder = false
  ): SongData[] {
    const songs = preserveIdOrder
      ? songIds.flatMap((id) => this.state().songs.filter((song) => song.songId === id))
      : this.state().songs.filter((song) => songIds.includes(song.songId));
    const decorated = songs.map(
      (song): SongData => ({
        ...song,
        artworkPaths: this.artwork.song(song.songId, song.isArtworkAvailable),
        paletteData: this.selectedPalette(song.paletteId),
        isBlacklisted: this.isSongBlacklisted(song.songId, song.path)
      })
    );
    const repository = {
      isSongBlacklisted: (id: string, path: string) => this.isSongBlacklisted(id, path),
      getFolderBlacklist: () => this.state().blacklist.folderBlacklist
    };
    const output =
      sortType || filterType
        ? sortSongs(
            repository,
            filterSongs(repository, decorated, filterType),
            sortType,
            this.state().listeningData
          )
        : decorated;
    return clone(limit ? output.slice(0, limit) : output);
  }

  getArtists(
    idsOrNames: string[] = [],
    sortType?: ArtistSortTypes,
    filterType?: ArtistFilterTypes,
    limit = 0
  ): Artist[] {
    let results =
      idsOrNames.length === 0
        ? [...this.state().artists]
        : idsOrNames.flatMap((id) =>
            this.state().artists.filter((artist) => artist.artistId === id || artist.name === id)
          );
    if (sortType || filterType) results = sortArtists(filterArtists(results, filterType), sortType);
    return clone(
      results
        .slice(0, limit || results.length)
        .map((artist) => ({ ...artist, artworkPaths: this.artwork.artist(artist.artworkName) }))
    );
  }

  toggleLikeArtists(artistIds: string[], likeArtist?: boolean): Promise<ToggleLikeSongReturnValue> {
    return toggleLikeArtists(this.playlistRepository(), artistIds, likeArtist);
  }

  getAlbums(idsOrTitles: string[] = [], sortType?: AlbumSortTypes): Album[] {
    const selected =
      idsOrTitles.length === 0
        ? [...this.state().albums]
        : this.state().albums.filter(
            (album) => idsOrTitles.includes(album.albumId) || idsOrTitles.includes(album.title)
          );
    const output = selected.map(
      (album): Album => ({ ...album, artworkPaths: this.artwork.album(album.artworkName) })
    );
    return clone(sortType ? sortAlbums(output, sortType) : output);
  }

  getGenres(idsOrNames: string[] = [], sortType?: GenreSortTypes): Genre[] {
    const selected =
      idsOrNames.length === 0
        ? [...this.state().genres]
        : this.state().genres.filter(
            (genre) => idsOrNames.includes(genre.genreId) || idsOrNames.includes(genre.name)
          );
    const output = selected.map(
      (genre): Genre => ({
        ...genre,
        artworkPaths: this.artwork.genre(genre.artworkName),
        paletteData: this.selectedPalette(genre.paletteId)
      })
    );
    return clone(sortType ? sortGenres(output, sortType) : output);
  }

  getFolders(folderPaths: string[] = [], sortType?: FolderSortTypes): MusicFolder[] {
    const select = (folders: FolderStructure[]): FolderStructure[] =>
      folders.flatMap((folder) =>
        folderPaths.includes(folder.path) ? [folder] : select(folder.subFolders)
      );
    const source =
      folderPaths.length === 0
        ? this.state().userData.musicFolders
        : select(this.state().userData.musicFolders);
    const decorate = (folders: FolderStructure[]): MusicFolder[] =>
      folders.map((folder) => ({
        ...folder,
        subFolders: decorate(folder.subFolders),
        songIds: this.state()
          .songs.filter((song) => song.path.includes(folder.path))
          .map((song) => song.songId),
        isBlacklisted: isFolderBlacklisted(this.blacklistRepository(), folder.path)
      }));
    const output = decorate(source);
    return clone(
      sortType
        ? sortFolders(
            {
              isSongBlacklisted: (id, path) => this.isSongBlacklisted(id, path),
              getFolderBlacklist: () => this.state().blacklist.folderBlacklist
            },
            output,
            sortType
          )
        : output
    );
  }

  async getFolderStructures(): Promise<FolderStructure[]> {
    const fileSystem = this.services.libraryFileSystem;
    const selectFolders = this.services.selectMusicFolders;
    if (!fileSystem || !selectFolders) throw new NotPortedYetError('library folder traversal');
    const roots = await selectFolders();
    if (roots.length === 0) {
      this.retainedTraversal = undefined;
      return [];
    }
    const traversal = await walkMusicTrees(fileSystem, roots, {
      native: this.services.nativeLibrary
    });
    this.retainedTraversal = traversal;
    const folderCount = traversal.visitedDirectories.length;
    this.events.message('FOLDER_PARSED_FOR_DIRECTORIES', {
      count: folderCount,
      folderCount: traversal.structures.length
    });
    return clone(traversal.structures);
  }

  async addSongsFromFolderStructures(
    structures: FolderStructure[],
    sortType?: SongSortTypes
  ): Promise<SongData[]> {
    const fileSystem = this.services.libraryFileSystem;
    const parser = this.services.metadataParser;
    if (!fileSystem || !parser) throw new NotPortedYetError('library metadata scanner');

    const selectedFolderKeys = new Set<string>();
    const collectSelectedFolders = (folders: FolderStructure[]): void => {
      for (const folder of folders) {
        selectedFolderKeys.add(canonicalPathKey(folder.path));
        collectSelectedFolders(folder.subFolders);
      }
    };
    collectSelectedFolders(structures);
    const rootKeys = structures.map((structure) => canonicalPathKey(structure.path));
    const isSelectedFolder = (path: string): boolean =>
      selectedFolderKeys.has(canonicalPathKey(path));
    const isSongInSelectedFolder = (path: string): boolean => isSelectedFolder(parentPath(path));
    const retained = this.retainedTraversal;
    const canReuseRetained =
      retained !== undefined &&
      rootKeys.every((root) =>
        retained.visitedDirectories.some((path) => canonicalPathKey(path) === root)
      );
    const sourceTraversal = canReuseRetained
      ? retained
      : await walkMusicTrees(
          fileSystem,
          structures.map((structure) => structure.path),
          { native: this.services.nativeLibrary }
        );
    const traversal = {
      structures: clone(structures),
      songPaths: sourceTraversal.songPaths.filter(isSongInSelectedFolder),
      visitedDirectories: sourceTraversal.visitedDirectories.filter(isSelectedFolder)
    };
    this.retainedTraversal = undefined;

    const addedSongIds: string[] = [];
    await scanTraversal(this.libraryRepository(addedSongIds), fileSystem, parser, traversal, {
      includeArtwork: true,
      native: this.services.nativeLibrary
    });
    // New roots mean new things to watch, and the reconciliation pass is worth
    // paying for here: it closes the gap between the traversal above and the
    // moment the listeners are actually installed.
    void this.startLibraryWatcher({ reconcile: true }).catch((error: unknown) =>
      logger.error('Could not arm the library watcher after a scan.', { error })
    );
    return this.getSongInfo(addedSongIds, sortType, undefined, 0, true);
  }

  async resyncSongsLibrary(): Promise<true> {
    const fileSystem = this.services.libraryFileSystem;
    const parser = this.services.metadataParser;
    if (!fileSystem || !parser) throw new NotPortedYetError('library catalog reconciliation');
    const roots = this.state().userData.musicFolders.map((folder) => folder.path);
    if (roots.length > 0) {
      const addedSongIds: string[] = [];
      const traversal = await walkMusicTrees(fileSystem, roots, {
        native: this.services.nativeLibrary
      });
      const diskPaths = new Set(traversal.songPaths.map(canonicalPathKey));
      const deletedPaths = this.state()
        .songs.filter(
          (song) =>
            roots.some((root) => isPathWithin(song.path, root)) &&
            !diskPaths.has(canonicalPathKey(song.path))
        )
        .map((song) => song.path);
      await removeSongsFromLibrary(this.catalogRepository(), deletedPaths);
      await scanTraversal(
        this.libraryRepository(addedSongIds, true),
        fileSystem,
        parser,
        traversal,
        { includeArtwork: true, native: this.services.nativeLibrary }
      );
    }
    await this.repairMissingDurations(parser);
    this.events.message('RESYNC_SUCCESSFUL');
    await this.flush();
    this.restartLibraryWatcher();
    return true;
  }

  /**
   * Fills in durations for songs that were scanned before the host could read
   * them from the file.
   *
   * A library scanned by an earlier build holds these as 00:00, and nothing
   * would ever correct them: a resync reconciles which songs exist, not what is
   * already known about them, so the only other cure was removing and re-adding
   * the track. Only the broken rows are touched, and a host with no native
   * route leaves them exactly as they are.
   */
  private async repairMissingDurations(parser: MetadataParserPort): Promise<void> {
    if (!parser.properties) return;
    const songs = clone(this.state().songs);
    const broken = songs.filter((song) => !(song.duration > 0));
    if (broken.length === 0) return;

    const repaired: string[] = [];
    const inFlight = Math.min(artworkConcurrency(), broken.length);
    let next = 0;
    await Promise.all(
      Array.from({ length: inFlight }, async () => {
        for (let index = next++; index < broken.length; index = next++) {
          const song = broken[index];
          const properties = await parser.properties?.(song.path).catch(() => undefined);
          if (!properties?.duration) continue;
          song.duration = Number(properties.duration.toFixed(2));
          song.sampleRate ??= properties.sampleRate;
          song.bitrate ??= properties.bitrate;
          song.noOfChannels ??= properties.numberOfChannels;
          repaired.push(song.songId);
        }
      })
    );

    if (repaired.length === 0) return;
    logger.info('Repaired songs that had no duration.', { count: repaired.length });
    this.setSnapshot('songs', 'songs', songs, true);
    this.events.dataUpdated('songs/updatedSong', repaired);
  }

  /**
   * The library folder watcher: picks up music added, changed or deleted
   * outside the app.
   *
   * `LibraryWatcherManager` and its Tauri file-system port were written, tested
   * and left unconstructed, and `tauri-plugin-fs` even carries the `watch`
   * feature and the `fs:allow-watch` capability for them. Until this was
   * connected, a track dropped into a music folder stayed invisible until the
   * user ran a manual resync.
   *
   * The initial reconciliation pass is what covers the time the app was NOT
   * running: a watcher reports only what changes while it is installed, so
   * music added with the player closed was invisible until a manual resync.
   * It was once skipped on startup to avoid a re-index this project had
   * measured and rejected, but that measurement predates the native walker:
   * the pass now lists the roots in Rust and parses only the paths the catalog
   * does not already hold. The caller is expected not to await it, so the cost
   * that remains is paid behind the window rather than in front of it.
   */
  async startLibraryWatcher(options: { reconcile?: boolean } = {}): Promise<void> {
    const fileSystem = this.services.watcherFileSystem;
    if (!fileSystem) return;
    this.libraryWatcher ??= new LibraryWatcherManager(
      this.watcherRepository(),
      fileSystem,
      internalWriteSuppression
    );
    await this.libraryWatcher.start(undefined, { reconcile: options.reconcile ?? false });
  }

  stopLibraryWatcher(): void {
    this.libraryWatcher?.stop();
  }

  /**
   * Deletes temporary covers left behind by earlier runs.
   *
   * Playing a song from outside the library writes its embedded cover to
   * `temp_artworks` so the interface has something to show. Electron emptied
   * that directory on quit (src/main/other/artworks.ts:157, called from the
   * before-quit handler); the port carried the implementation over and never
   * called it, so the directory only ever grew.
   *
   * Startup rather than quit, deliberately: a quit hook is the least reliable
   * moment in this app - the tray, the updater and the OS can all end the
   * process without it - while startup is the one moment the previous session's
   * files are provably nobody's. `startedAt` keeps the sweep off anything this
   * run created, which matters because "Open with" can create a temp cover
   * while the app is still starting.
   */
  async clearStaleTempArtwork(startedAt: Date): Promise<void> {
    await this.services.artwork?.clearTempArtworkFolder(startedAt);
  }

  /** Re-arms the watcher over the current roots after the library changed. */
  private restartLibraryWatcher(): void {
    if (!this.libraryWatcher) return;
    void this.startLibraryWatcher({ reconcile: false }).catch((error: unknown) =>
      logger.error('Could not re-arm the library watcher.', { error })
    );
  }

  private watcherRepository(): LibraryWatcherRepository {
    const scanner = ():
      | { fileSystem: LibraryFileSystemPort; parser: MetadataParserPort }
      | undefined => {
      const fileSystem = this.services.libraryFileSystem;
      const parser = this.services.metadataParser;
      return fileSystem && parser ? { fileSystem, parser } : undefined;
    };

    return {
      getMusicFolders: () => this.state().userData.musicFolders,
      getKnownSongPaths: () => this.state().songs.map((song) => song.path),
      scanSong: async (path) => {
        const services = scanner();
        if (!services) return;
        const addedSongIds: string[] = [];
        await scanTraversal(
          {
            getKnownSongPaths: () => this.state().songs.map((song) => song.path),
            // One file, so the folder tree is not being re-derived here.
            // Committing an empty structure list would rewrite userData and
            // emit a UI update on every single watcher event.
            commitFolderStructures: () => undefined,
            commitScanBatch: async (tracks) => {
              addedSongIds.push(...(await this.commitScannedTracks(tracks)));
            },
            reportScanProgress: () => undefined
          },
          services.fileSystem,
          services.parser,
          { structures: [], songPaths: [path], visitedDirectories: [parentPath(path)] },
          { includeArtwork: true, native: this.services.nativeLibrary }
        );
        if (addedSongIds.length > 0) await this.flush();
      },
      removeSongs: async (paths) => {
        if (paths.length === 0) return;
        await removeSongsFromLibrary(this.catalogRepository(), [...paths]);
        await this.flush();
      },
      reconcileFolder: async (path, options = {}) => {
        const services = scanner();
        if (!services) return;
        // Events arrive for files as well as directories, and for a path that
        // has just been deleted. A file resolves to its parent; a vanished
        // directory does too, which is what discovers the removal.
        const isDirectory = await services.fileSystem
          .stat(path)
          .then((stats) => !stats.isFile)
          .catch(() => false);
        const directory = isDirectory ? path : parentPath(path);
        if (!directory) return;

        // Scope guard. The manager also watches the PARENT of every root, so it
        // can notice the root itself being renamed away - which means an event
        // can name a directory that owns nothing of ours. Reconciling that
        // would find no songs on disk and delete every song recorded under it.
        const roots = this.state().userData.musicFolders.map((folder) => folder.path);
        if (!roots.some((root) => isPathWithin(directory, root))) return;

        const addedSongIds: string[] = [];
        const result = await reconcileCatalog(
          this.catalogRepository(),
          this.libraryRepository(addedSongIds),
          services.fileSystem,
          services.parser,
          [directory],
          {
            // The whole point of the startup pass is that it walks the entire
            // root, which is the one place where the native walker earns its
            // keep. Watcher events reach here too and cost the same call.
            native: this.services.nativeLibrary,
            keepCatalogWhenEmpty: options.initial === true
          }
        );
        // A pass that changed nothing has nothing to write. The usual case for
        // the startup pass is exactly that, and it runs on every launch.
        if (result.scanned > 0 || result.removed > 0) await this.flush();
      },
      reportWatcherError: (error, path) => logger.error('Library watcher failed.', { error, path })
    };
  }

  async deleteSongsFromSystem(
    absoluteFilePaths: string[],
    isPermanentDelete: boolean
  ): Promise<{ success: boolean; message?: string }> {
    const result = await deleteCatalogSongsFromSystem(
      this.catalogRepository(),
      {
        permanentlyDelete: async (path) => {
          if (!this.services.permanentlyDeleteFile) {
            const error = new Error('Permanent file deletion service is unavailable.');
            error.name = 'PermanentFileDeletionUnavailableError';
            throw error;
          }
          await this.services.permanentlyDeleteFile(path);
        },
        moveToTrash: async (path) => {
          if (!this.services.moveFileToTrash) {
            const error = new Error('Native recycle-bin service is unavailable.');
            error.name = 'NativeTrashCommandUnavailableError';
            throw error;
          }
          await this.services.moveFileToTrash(path);
        }
      },
      absoluteFilePaths,
      isPermanentDelete
    );
    await this.flush();
    return result;
  }

  async removeMusicFolder(folderPath: string): Promise<void> {
    await removeCatalogMusicFolder(this.catalogRepository(), folderPath);
    await this.flush();
    // One root fewer: stop watching it, or its files keep re-appearing.
    this.restartLibraryWatcher();
  }

  async getSongFromUnknownSource(songPath: string): Promise<PathBackedAudioData> {
    const fileSystem = this.services.libraryFileSystem;
    const parser = this.services.metadataParser;
    if (!fileSystem || !parser) throw new NotPortedYetError('outside-library metadata parser');
    return getCatalogSongFromUnknownSource(
      {
        findKnownSongId: (path) =>
          this.state().songs.find((song) => canonicalPathKey(song.path) === canonicalPathKey(path))
            ?.songId,
        getKnownSong: (songId) => this.getSong(songId),
        createTempArtwork: (source) => this.requireArtworkService().createTempArtwork(source),
        resolveFilePath: (path) => this.artwork.songFile(path),
        defaultSongArtwork: () => this.artwork.song('', false).artworkPath,
        rememberOutsideSong: (song) => {
          const existing = this.outsideLibrarySongs.findIndex(
            (candidate) => canonicalPathKey(candidate.path) === canonicalPathKey(song.path)
          );
          if (existing >= 0) this.outsideLibrarySongs.splice(existing, 1, clone(song));
          else this.outsideLibrarySongs.push(clone(song));
        },
        sendMessage: (code, data) => this.events.message(code, data)
      },
      fileSystem,
      parser,
      songPath
    );
  }

  async checkForStartUpSongs(): Promise<PathBackedAudioData | undefined> {
    if (!this.singleInstanceController) return undefined;
    this.startupSong = undefined;
    this.startupSongCaptureActive = true;
    try {
      await this.singleInstanceController.markRendererReady();
      return this.startupSong ? clone(this.startupSong) : undefined;
    } finally {
      this.startupSongCaptureActive = false;
    }
  }

  private async routeOpenedAudioFile(path: string): Promise<void> {
    try {
      const data = await this.getSongFromUnknownSource(path);
      if (this.startupSongCaptureActive && !this.startupSong) this.startupSong = data;
      else this.events.playSongFromUnknownSource?.(data);
    } catch (error) {
      logger.error('Failed to open audio supplied by the single-instance service.', {
        error,
        path
      });
    }
  }

  search(filter: SearchFilters, value: string, updateHistory = true): SearchResult {
    return clone(runSearch(this.searchRepository(), filter, value, updateHistory));
  }

  clearSearchHistory(searchText?: string[]): boolean {
    return clearSearchHistoryResults(this.searchRepository(), searchText);
  }

  getPlaylists(ids?: string[], sortType?: PlaylistSortTypes, mutableOnly?: boolean): Playlist[] {
    return clone(sendPlaylistData(this.playlistRepository(), ids, sortType, mutableOnly));
  }

  private updateListeningCounter(
    songId: string,
    kind: ListeningKind,
    amount: number,
    atMs: number
  ): boolean {
    if (!this.listeningEventsReady || !Number.isInteger(amount) || amount <= 0) return false;
    const song = this.state().songs.find((candidate) => candidate.songId === songId);
    if (!song) return false;

    let next = this.state().listeningEvents;
    const fingerprint = fingerprintOfSong(song);
    for (let count = 0; count < amount; count += 1)
      next = recordListening(next, fingerprint, kind, atMs, next.installId);

    this.setSnapshot('listeningEvents', 'listeningEvents', next, true);
    const rows = deriveListeningRows(next, this.state().songs, this.state().listeningData);
    this.setSnapshot('listeningData', 'listeningData', rows, true);
    return true;
  }

  updateSongListeningData<DataType extends keyof ListeningDataTypes>(
    songId: string,
    dataType: DataType,
    value: ListeningDataTypes[DataType]
  ): void {
    const counterKind: ListeningKind | undefined =
      dataType === 'listens'
        ? 'listen'
        : dataType === 'fullListens'
          ? 'fullListen'
          : dataType === 'skips'
            ? 'skip'
            : undefined;
    if (
      counterKind &&
      typeof value === 'number' &&
      this.updateListeningCounter(songId, counterKind, value, Date.now())
    ) {
      const eventType =
        dataType === 'listens'
          ? 'songs/listeningData/listens'
          : dataType === 'fullListens'
            ? 'songs/listeningData/fullSongListens'
            : 'songs/listeningData/skips';
      this.events.dataUpdated(eventType, [songId]);
      return;
    }

    const rows = clone(this.state().listeningData);
    let row = rows.find((entry) => entry.songId === songId);
    if (!row) {
      row = { songId, listens: [] };
      rows.push(row);
    }

    // Stamp the track's identity on every write. A row that knows only its
    // songId is lost for good the next time the library is rebuilt, because the
    // id it names stops existing and nothing on disk says which file it meant.
    if (!row.fingerprint) {
      const song = this.state().songs.find((candidate) => candidate.songId === songId);
      if (song) row.fingerprint = fingerprintOfSong(song);
    }

    if (dataType === 'listens' && typeof value === 'number') {
      const now = new Date();
      let yearly = row.listens.find((entry) => entry.year === now.getFullYear());
      if (!yearly) {
        yearly = { year: now.getFullYear(), listens: [] };
        row.listens.push(yearly);
      }
      const today = yearly.listens.find(([timestamp]) => {
        const date = new Date(timestamp);
        return date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
      });
      if (today) {
        if (today[1] > 0) today[1] += value;
      } else yearly.listens.push([now.getTime(), value]);
    } else if (dataType === 'fullListens' && typeof value === 'number') {
      row.fullListens = Math.max(0, (row.fullListens ?? 0) + value);
    } else if (dataType === 'skips' && typeof value === 'number') {
      row.skips = Math.max(0, (row.skips ?? 0) + value);
    } else if (dataType === 'inNoOfPlaylists' && typeof value === 'number') {
      row.inNoOfPlaylists = Math.max(0, (row.inNoOfPlaylists ?? 0) + value);
    } else if (dataType === 'seeks' && Array.isArray(value)) {
      const seeks = row.seeks ?? [];
      for (const newSeek of value as SongSeek[]) {
        const available = seeks.find(
          (seek) => newSeek.position < seek.position + 5 && newSeek.position > seek.position - 5
        );
        if (available) available.seeks += newSeek.seeks;
        seeks.push({ ...newSeek });
      }
      row.seeks = seeks;
    } else throw new Error(`Unknown listening data type: ${String(dataType)}`);

    this.setSnapshot('listeningData', 'listeningData', rows);
    const eventType =
      dataType === 'listens'
        ? 'songs/listeningData/listens'
        : dataType === 'fullListens'
          ? 'songs/listeningData/fullSongListens'
          : dataType === 'skips'
            ? 'songs/listeningData/skips'
            : 'songs/listeningData/inNoOfPlaylists';
    this.events.dataUpdated(eventType, [songId]);
  }

  async getSong(songId: string) {
    const song = this.state().songs.find((entry) => entry.songId === songId);
    if (!song) throw new Error('SONG_NOT_FOUND' as ErrorCodes);
    addToSongsHistory(this.playlistRepository(), songId);
    this.updateSongListeningData(songId, 'listens', 1);

    const artists = song.artists?.map((entry) => {
      const artist = this.state().artists.find(
        (candidate) => candidate.artistId === entry.artistId
      );
      if (!artist) return entry;
      if (!artist.onlineArtworkPaths) {
        void this.getArtistArtwork(artist.artistId).catch((error: unknown) =>
          logger.warn('Failed to fetch artist information.', { error, artistId: artist.artistId })
        );
      }
      return {
        artistId: artist.artistId,
        name: artist.name,
        artworkPath: this.artwork.artist(artist.artworkName).artworkPath,
        onlineArtworkPaths: artist.onlineArtworkPaths
      };
    });
    const artworkPath = this.artwork.song(song.songId, song.isArtworkAvailable).artworkPath;
    return {
      songId: song.songId,
      title: song.title,
      artists,
      duration: song.duration,
      artwork: artworkPath,
      artworkPath,
      path: this.artwork.songFile(song.path),
      isAFavorite: song.isAFavorite,
      album: song.album,
      paletteData: this.selectedPalette(song.paletteId),
      isKnownSource: true,
      isBlacklisted: this.isSongBlacklisted(song.songId, song.path)
    };
  }

  addNewPlaylist(name: string, songIds?: string[], artworkPath?: string) {
    return addNewPlaylist(this.playlistRepository(), name, songIds, artworkPath);
  }

  addSongsToPlaylist(playlistId: string, songIds: string[]): void {
    addSongsToPlaylist(this.playlistRepository(), playlistId, songIds);
  }

  addPlaylistArtwork(playlistId: string, artworkPath: string): Promise<ArtworkPaths | undefined> {
    return addArtworkToAPlaylist(this.playlistRepository(), playlistId, artworkPath);
  }

  renamePlaylist(playlistId: string, newName: string): void {
    renameAPlaylist(this.playlistRepository(), playlistId, newName);
  }

  removePlaylists(ids: string[]): true {
    return removePlaylists(this.playlistRepository(), ids);
  }

  removeSongFromPlaylist(playlistId: string, songId: string) {
    return removeSongFromPlaylist(this.playlistRepository(), playlistId, songId);
  }

  toggleLikeSongs(songIds: string[], like?: boolean): Promise<ToggleLikeSongReturnValue> {
    return toggleLikeSongs(this.playlistRepository(), songIds, like);
  }

  importPlaylist(): Promise<void> {
    return Promise.resolve(
      importPlaylist(this.playlistRepository(), [...SUPPORTED_MUSIC_EXTENSIONS])
    ).then(() => undefined);
  }

  getMultipleArtworkPaths(songIds: string[]): string[] {
    // Full artwork, not the optimized one. These covers are composed into the
    // multi-artwork card on the Playlists and Tierlists pages, where the
    // optimized variant - a 50x50 thumbnail - is stretched several times over
    // and looks visibly mushy. src/main/core/getArtworksForMultipleArtworksCover.ts
    // used artworkPath for the same reason.
    return this.getSongInfo(songIds, undefined, undefined, 0, true).map(
      (song) => song.artworkPaths.artworkPath
    );
  }

  getArtistDuplicates(artistName: string): Artist[] {
    const normalized = artistName
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .trim();
    return this.getArtists().filter(
      (artist) =>
        artist.name
          .normalize('NFD')
          .replace(/\p{Diacritic}/gu, '')
          .toLowerCase()
          .trim() === normalized
    );
  }

  exportPlaylist(id: string): Promise<void> {
    return Promise.resolve(exportPlaylist(this.playlistRepository(), id)).then(() => undefined);
  }

  clearHistory(): true | undefined {
    return clearSongHistory(this.playlistRepository());
  }

  /**
   * Thumbnails for the tierlist grid, a few at a time.
   *
   * This used to be one `Promise.all` over every song in the tierlist's source,
   * which on a first visit means decoding and re-encoding a cover per track with
   * nothing holding the line: three hundred at once on a bench, seventeen
   * hundred on a real library. The machine felt it - not the app, the machine,
   * with the whole desktop stuttering while the GPU worked through the pile.
   *
   * The scan already learned this lesson and uses the same small pool
   * (`artworkConcurrency`, two to eight workers). A cached thumbnail costs one
   * `exists` check, so the pool is nearly free on every later visit; it is the
   * first one that has to be paced.
   */
  async createTierlistArtworks(songIds: string[]): Promise<Record<string, string>> {
    const service = this.requireArtworkService();
    const ids = [...new Set(songIds)];
    const thumbnails: Record<string, string> = {};
    if (ids.length === 0) return thumbnails;

    let next = 0;
    const workers = Math.min(artworkConcurrency(), ids.length);
    await Promise.all(
      Array.from({ length: workers }, async () => {
        for (let index = next++; index < ids.length; index = next++) {
          const id = ids[index];
          const thumbnail = await service.createTierlistThumbnail(id).catch((error: unknown) => {
            logger.warn('Failed to build a tierlist thumbnail.', { error, id });
            return undefined;
          });
          if (thumbnail) thumbnails[id] = thumbnail;
        }
      })
    );
    return thumbnails;
  }

  async saveArtwork(source: string, destination: string): Promise<void> {
    await this.requireArtworkService().saveArtwork(this.artworkSource(source), destination);
  }

  async generatePalettes(): Promise<void> {
    const generator = this.services.palette;
    if (!generator) throw new NotPortedYetError('palette generator');

    const songs = clone(this.state().songs);
    const palettes = clone(this.state().palettes);
    const pendingSongs = songs.filter((song) => !song.paletteId);
    let completed = 0;
    for (const song of pendingSongs) {
      const source = song.isArtworkAvailable
        ? urlArtwork(this.artwork.song(song.songId, true).optimizedArtworkPath)
        : undefined;
      const palette = await generator.generate(source);
      if (palette) {
        song.paletteId = palette.paletteId;
        palettes.push(palette);
      }
      completed += 1;
      this.events.message('SONG_PALETTE_GENERATING_PROCESS_UPDATE', {
        total: pendingSongs.length,
        value: completed
      });
    }
    if (pendingSongs.length === 0) this.events.message('NO_MORE_SONG_PALETTES');

    const genres = clone(this.state().genres);
    const pendingGenres = genres.filter((genre) => !genre.paletteId);
    completed = 0;
    for (const genre of pendingGenres) {
      const sourceSongId = genre.artworkName?.replace(/\.webp$/iu, '');
      const sourceSong = sourceSongId
        ? songs.find((song) => song.songId === sourceSongId)
        : undefined;
      if (sourceSong) genre.paletteId = sourceSong.paletteId;
      else if (!genre.artworkName) {
        const palette = await generator.generate();
        if (palette) genre.paletteId = palette.paletteId;
      }
      completed += 1;
      this.events.message('SONG_PALETTE_GENERATING_PROCESS_UPDATE', {
        total: pendingGenres.length,
        value: completed
      });
    }

    this.setSnapshot('songs', 'songs', songs);
    this.setSnapshot('genres', 'genres', genres);
    this.setSnapshot('palettes', 'palettes', palettes);
    this.events.dataUpdated('songs/palette');
    this.events.dataUpdated('genres/backgroundColor');
    if (pendingGenres.length === 0) this.events.message('NO_MORE_SONG_PALETTES');
  }

  getBlacklist(): Blacklist {
    return clone(this.state().blacklist);
  }

  blacklistSongs(ids: string[]): void {
    blacklistSongs(this.blacklistRepository(), ids);
  }

  restoreBlacklistedSongs(ids: string[]): Promise<void> {
    return restoreBlacklistedSongs(this.blacklistRepository(), ids);
  }

  blacklistFolders(paths: string[]): void {
    blacklistFolders(this.blacklistRepository(), paths);
  }

  restoreBlacklistedFolders(paths: string[]): Promise<void> {
    return restoreBlacklistedFolders(this.blacklistRepository(), paths);
  }

  toggleBlacklistedFolders(paths: string[], value?: boolean) {
    return toggleBlacklistFolders(this.blacklistRepository(), paths, value);
  }

  async getAlbumInfoFromLastFM(albumId: string) {
    const { default: getAlbumInfoFromLastFM } = await import(
      '../core/net/lastFm/getAlbumInfoFromLastFM'
    );
    return getAlbumInfoFromLastFM(this.networkRepository(), albumId);
  }

  async getSimilarTracks(songId: string) {
    const { default: getSimilarTracks } = await import('../core/net/lastFm/getSimilarTracks');
    return getSimilarTracks(this.networkRepository(), songId);
  }

  async scrobbleSong(songId: string, startTimeInSecs: number): Promise<void> {
    const { default: scrobbleSong } = await import('../core/net/lastFm/scrobbleSong');
    return Promise.resolve(scrobbleSong(this.networkRepository(), songId, startTimeInSecs)).then(
      () => undefined
    );
  }

  async sendNowPlayingSong(songId: string): Promise<void> {
    const { default: sendNowPlayingSongDataToLastFM } = await import(
      '../core/net/lastFm/sendNowPlayingSongDataToLastFM'
    );
    return Promise.resolve(sendNowPlayingSongDataToLastFM(this.networkRepository(), songId)).then(
      () => undefined
    );
  }

  async getArtistArtwork(artistId: string) {
    const { default: getArtistInfoFromNet } = await import('../core/net/getArtistInfoFromNet');
    return getArtistInfoFromNet(this.networkRepository(), artistId);
  }

  async searchSongMetadata(songTitle: string, songArtists: string[]) {
    const { searchSongMetadataResultsInInternet } = await import(
      '../core/net/fetchSongMetadataFromInternet'
    );
    return searchSongMetadataResultsInInternet(songTitle, songArtists);
  }

  async fetchSongMetadata(songTitle: string, songArtists: string[]) {
    const { fetchSongMetadataFromInternet } = await import(
      '../core/net/fetchSongMetadataFromInternet'
    );
    return fetchSongMetadataFromInternet(
      songTitle as SongMetadataSource,
      songArtists as unknown as string
    );
  }

  async fetchSongInfo(songTitle: string, songArtists: string[]) {
    const { default: fetchSongInfoFromLastFM } = await import(
      '../core/net/fetchSongInfoFromLastFM'
    );
    return fetchSongInfoFromLastFM(songTitle, songArtists);
  }

  async getSongLyrics(
    track: LyricsRequestTrackInfo,
    lyricsType?: LyricsTypes,
    requestType?: LyricsRequestTypes,
    saveAutomatically?: AutomaticallySaveLyricsTypes
  ) {
    const { default: getSongLyrics } = await import('../core/lyrics/getSongLyrics');
    return getSongLyrics(
      this.lyricsRepository(),
      track,
      lyricsType,
      requestType,
      saveAutomatically
    );
  }

  async getTranslatedLyrics(languageCode: LanguageCodes) {
    const { default: getTranslatedLyrics } = await import('../core/lyrics/getTranslatedLyrics');
    return getTranslatedLyrics(this.lyricsRepository(), String(languageCode));
  }

  async romanizeLyrics() {
    const { default: romanizeLyrics } = await import('../core/lyrics/romanizeLyrics');
    return romanizeLyrics(this.lyricsRepository());
  }

  async convertLyricsToPinyin() {
    const { default: convertLyricsToPinyin } = await import('../core/lyrics/convertToPinyin');
    return convertLyricsToPinyin(this.lyricsRepository());
  }

  async convertLyricsToRomaja() {
    const { default: convertLyricsToRomaja } = await import('../core/lyrics/convertToRomaja');
    return convertLyricsToRomaja(this.lyricsRepository());
  }

  async resetLyrics() {
    const { default: resetLyrics } = await import('../core/lyrics/resetLyrics');
    return resetLyrics(this.lyricsRepository());
  }

  async saveLyrics(songPath: string, text: SongLyrics) {
    const { default: saveLyricsToSong } = await import('../core/lyrics/saveLyricsToSong');
    return saveLyricsToSong(this.lyricsRepository(), songPath, text);
  }

  updateSongId3Tags(
    songIdOrPath: string,
    tags: SongTags,
    sendUpdatedData: boolean,
    isKnownSource: boolean
  ): Promise<MetadataUpdateResult> {
    return this.metadataService().updateSongId3Tags(
      songIdOrPath,
      tags,
      sendUpdatedData,
      isKnownSource
    );
  }

  async reParseSong(songPath: string): Promise<SavableSongData | undefined> {
    const diskPath = removeDefaultAppProtocolFromFilePath(songPath);
    const native = this.services.nativeLibrary;
    if (!native) return this.metadataService().reParseSong(diskPath);

    const parsed = await native.parse([diskPath]).catch((error: unknown) => {
      logger.error('Native song reparse failed; using the metadata-file route.', {
        error,
        path: diskPath
      });
      return undefined;
    });
    const track = parsed?.find(
      (entry) => canonicalPathKey(entry.path) === canonicalPathKey(diskPath)
    );
    if (!track || track.error) return this.metadataService().reParseSong(diskPath);

    const names = (value?: string): string[] =>
      value
        ?.split(',')
        .map((name) => name.trim())
        .filter(Boolean) ?? [];
    const picture = track.pictures.find((entry) => entry.byteLength > 0);
    const pictureFormat = picture?.format.toLocaleLowerCase('en-US');
    const pictureMimeType = pictureFormat?.includes('/')
      ? pictureFormat
      : pictureFormat === 'jpg'
        ? 'image/jpeg'
        : pictureFormat
          ? `image/${pictureFormat}`
          : picture
            ? 'image/jpeg'
            : undefined;
    const reparseData: NativeReparseData = {
      audioPath: track.path,
      pictureMimeType,
      metadata: {
        title: track.common.title,
        artists: names(track.common.artist),
        albumArtists: names(track.common.albumArtist),
        album: track.common.album,
        genres: track.common.genres,
        year: track.common.year ?? null,
        trackNumber: track.common.trackNumber ?? null,
        discNumber: track.common.discNumber ?? null,
        duration: track.format.duration ?? 0,
        bitrate: track.format.bitrate ?? null,
        sampleRate: track.format.sampleRate ?? null,
        numberOfChannels: track.format.numberOfChannels ?? null,
        createdDate: track.createdDate ?? null,
        modifiedDate: track.modifiedDate ?? null,
        picture: picture
          ? { bytes: new Uint8Array(), mimeType: pictureMimeType ?? 'image/jpeg' }
          : undefined
      }
    };
    const key = canonicalPathKey(diskPath);
    this.nativeReparseData.set(key, reparseData);
    try {
      return await this.metadataService().reParseSong(diskPath);
    } finally {
      if (this.nativeReparseData.get(key) === reparseData) this.nativeReparseData.delete(key);
    }
  }

  /**
   * Last resort before a playback failure becomes an error dialog: repair the
   * one defect known to make WebView2 refuse a perfectly good file.
   *
   * A picture embedded with a blank MIME type makes Chromium answer
   * `DEMUXER_ERROR_COULD_NOT_OPEN` and stop, which is the bug this whole fork
   * started from. The repair existed but was only reachable by right-clicking
   * the track and choosing to re-parse it - so a user whose library carried a
   * few such files just met the error dialog over and over with no idea that
   * one menu item away sat the fix.
   *
   * Reports whether anything was actually repaired: a file that had nothing
   * wrong with it must not be retried forever, because then the failure is
   * something else and retrying only hides it.
   */
  async healSongForPlayback(songId: string): Promise<boolean> {
    // The renderer holds `convertFileSrc(path, 'nemora')`, not a path, so the
    // song is resolved by id here rather than passing a URL to a file API and
    // watching it not find the file. A track played from outside the library
    // has no catalog entry, and for it the argument is the path.
    const song = this.state().songs.find((entry) => entry.songId === songId);
    const path = song?.path ?? removeDefaultAppProtocolFromFilePath(songId);
    try {
      const healed = await this.metadataService().healBlankPictureMime(path);
      if (healed > 0) logger.info('Repaired a file that the player refused to open.', { path });
      return healed > 0;
    } catch (error) {
      logger.error('Could not repair a file the player refused to open.', { error, path });
      return false;
    }
  }

  isMetadataUpdatesPending(songPath: string): boolean {
    return this.metadataService().isMetadataUpdatesPending(songPath);
  }

  resolveArtistDuplicates(
    selectedArtistId: string,
    duplicateIds: string[]
  ): Promise<MetadataUpdateResult | undefined> {
    return this.metadataService().resolveArtistDuplicates(selectedArtistId, duplicateIds);
  }

  resolveSeparateArtists(
    separateArtistId: string,
    separateArtistNames: string[]
  ): Promise<MetadataUpdateResult | undefined> {
    return this.metadataService().resolveSeparateArtists(separateArtistId, separateArtistNames);
  }

  resolveFeaturingArtists(
    songId: string,
    featArtistNames: string[],
    removeFeatInfoInTitle?: boolean
  ): Promise<MetadataUpdateResult | undefined> {
    return this.metadataService().resolveFeaturingArtists(
      songId,
      featArtistNames,
      removeFeatInfoInTitle
    );
  }

  async getSongTags(songIdOrPath: string, isKnownSource: boolean): Promise<SongTags> {
    if (!this.services.readSongTags) throw new NotPortedYetError('song tag reader');
    const [{ parseLyricsFromID3Format }, { isLyricsSavePending }] = await Promise.all([
      import('../core/lyrics/getSongLyrics'),
      import('../core/lyrics/saveLyricsToSong')
    ]);

    if (isKnownSource) {
      const song = this.state().songs.find((entry) => entry.songId === songIdOrPath);
      if (!song) throw new Error('SONG_NOT_FOUND' as MessageCodes);
      const raw = await this.services.readSongTags(song.path);
      const album = song.album
        ? this.state().albums.find((entry) => entry.albumId === song.album?.albumId)
        : undefined;
      const artists = song.artists
        ? this.state().artists.filter((artist) =>
            song.artists?.some((entry) => entry.artistId === artist.artistId)
          )
        : undefined;
      const albumArtists = song.albumArtists
        ? this.state().artists.filter((artist) =>
            song.albumArtists?.some((entry) => entry.artistId === artist.artistId)
          )
        : undefined;
      const genres = song.genres
        ? this.state().genres.filter((genre) =>
            song.genres?.some((entry) => entry.genreId === genre.genreId)
          )
        : undefined;
      const parsedLyrics = parseLyricsFromID3Format(
        raw.synchronisedLyrics,
        raw.unsynchronisedLyrics
      );
      return {
        title: song.title ?? raw.title ?? 'Unknown Title',
        artists:
          artists ??
          raw.artist?.split(',').map((name) => ({ name: name.trim(), artistId: undefined })),
        albumArtists:
          albumArtists ??
          raw.performerInfo?.split(',').map((name) => ({ name: name.trim(), artistId: undefined })),
        album: album
          ? {
              ...album,
              noOfSongs: album.songs.length,
              artists: album.artists?.map((artist) => artist.name),
              artworkPath: this.artwork.album(album.artworkName).artworkPath
            }
          : raw.album
            ? { title: raw.album, albumId: undefined }
            : undefined,
        genres:
          genres ??
          raw.genre?.split(',').map((name) => ({ name: name.trim(), genreId: undefined })),
        releasedYear: Number(raw.year) || undefined,
        composer: raw.composer,
        synchronizedLyrics: parsedLyrics?.isSynced ? parsedLyrics.unparsedLyrics : undefined,
        unsynchronizedLyrics: raw.unsynchronisedLyrics?.text,
        artworkPath: this.artwork.song(song.songId, song.isArtworkAvailable).artworkPath,
        duration: song.duration,
        trackNumber: song.trackNo ?? (Number(raw.trackNumber?.split('/').at(0)) || undefined),
        isLyricsSavePending: isLyricsSavePending(song.path),
        isMetadataSavePending: this.metadataService().isMetadataUpdatesPending(song.path)
      };
    }

    const outside = this.songsOutsideLibrary().find((song) => song.path === songIdOrPath);
    if (!outside) throw new Error("Song couldn't be found outside the library.");
    const raw = await this.services.readSongTags(
      removeDefaultAppProtocolFromFilePath(songIdOrPath)
    );
    const parsedLyrics = parseLyricsFromID3Format(raw.synchronisedLyrics, raw.unsynchronisedLyrics);
    return {
      title: raw.title || '',
      artists: raw.artist ? [{ name: raw.artist }] : undefined,
      album: raw.album ? { title: raw.album } : undefined,
      genres: raw.genre ? [{ name: raw.genre }] : undefined,
      releasedYear: Number(raw.year) || undefined,
      composer: raw.composer,
      synchronizedLyrics: parsedLyrics?.isSynced ? parsedLyrics.unparsedLyrics : undefined,
      unsynchronizedLyrics: raw.unsynchronisedLyrics?.text,
      artworkPath: outside.artworkPath,
      duration: outside.duration
    };
  }

  exportAppData(localStorageData: string): Promise<void> {
    return Promise.resolve(exportAppData(this.appDataRepository(), localStorageData)).then(
      () => undefined
    );
  }

  importAppData(): Promise<void | LocalStorage> {
    return importAppData(this.appDataRepository());
  }

  async resetApplicationData(): Promise<void> {
    await resetAppData(this.appDataRepository());
    this.services.restartApp?.('Resetting app data', true);
  }

  private requireNoraImportPort(): NoraImportPort {
    const createPort = this.services.createNoraImportPort;
    if (!createPort) throw new Error('The Nora import port is not available in this runtime.');
    return createPort();
  }

  /**
   * Replaces this profile with the one in `%APPDATA%\Nora`.
   *
   * The ordering here is the whole safety of the operation. The import rewrites
   * every store file underneath a live app, so the cache is flushed first (the
   * backup the importer takes must capture the true current state, not a
   * half-written one) and then sealed, which stops ordinary playback from
   * draining pre-import state over the imported files.
   *
   * The seal is lifted only when the import failed before taking its backup,
   * which is the one case where the profile is provably untouched. Once a
   * backup exists, writes may have begun, so the cache stays sealed and the
   * caller must relaunch — the in-memory state no longer describes the disk.
   */
  async importNoraProfileData(): Promise<NoraImportReport> {
    await this.flush();
    this.cache.seal();

    let report: NoraImportReport;
    try {
      report = await importNoraProfile(this.requireNoraImportPort());
    } catch (error) {
      this.cache.unseal();
      throw error;
    }

    if (!report.success && report.backupPath === undefined) this.cache.unseal();
    return report;
  }

  detectNoraImportSource(): Promise<NoraSourceInventory> {
    return detectNoraSource(this.requireNoraImportPort());
  }

  exportStats(options?: { tierShuffleIntensity?: number }) {
    return exportStatsData(this.statsTransferRepository(), options);
  }

  importStats(mergeMode: StatsMergeMode, source: StatsImportSource) {
    return importStatsData(this.statsTransferRepository(), mergeMode, source);
  }

  private tierlistsRepository(): TierlistsRepo {
    return {
      getTierlistData: (ids) =>
        ids && ids.length > 0
          ? this.state().tierlists.filter((tierlist) => ids.includes(tierlist.tierlistId))
          : this.state().tierlists,
      setTierlistData: (value) => this.setSnapshot('tierlists', 'tierlists', value),
      generateRandomId,
      emitDataUpdate: (type, data, message) => this.events.dataUpdated(type, data, message),
      logger
    };
  }

  getTierlists(ids?: string[], sortType?: TierlistSortTypes): SavableTierlist[] {
    return clone(sendTierlistData(this.tierlistsRepository(), ids, sortType));
  }

  addTierlist(
    name: string,
    playlistIds?: string[],
    labelMode?: TierlistLabelMode,
    folderPaths?: string[]
  ) {
    return addTierlist(this.tierlistsRepository(), name, playlistIds, labelMode, folderPaths);
  }

  saveTierlist(value: SavableTierlist) {
    return saveTierlist(this.tierlistsRepository(), value);
  }

  removeTierlists(ids: string[]) {
    return removeTierlists(this.tierlistsRepository(), ids);
  }

  getMegaShuffleWeights(ids: string[], intensity?: number): Record<string, number> {
    return clone(getMegaShuffleWeights(this.featureRepository(), ids, intensity));
  }

  getMegaShuffleData(ids: string[], intensity?: number): MegaShuffleData {
    return clone(getMegaShuffleData(this.featureRepository(), ids, intensity));
  }

  getStats(timeRange: StatsTimeRange): StatsData {
    return clone(collectStatsData(this.featureRepository(), timeRange));
  }

  getDuelPair(pinnedSongId?: string): DuelPair | null {
    return clone(getDuelPair(this.featureRepository(), pinnedSongId));
  }

  selectDuelAnchor(candidates: DuelAnchorCandidate[], excluded?: string[]): string | null {
    return selectDuelAnchorFromCandidates(this.featureRepository(), candidates, excluded);
  }

  getDuelPairByIds(songAId: string, songBId: string): DuelPair | null {
    return clone(getDuelPairByIds(this.featureRepository(), songAId, songBId));
  }

  recordDuelSkip(songAId: string, songBId: string, reason?: DuelSkipReason): void {
    recordDuelSkip(this.featureRepository(), songAId, songBId, reason);
  }

  submitDuelResult(songAId: string, songBId: string, winnerId: string): DuelResult {
    return submitDuelResult(this.featureRepository(), songAId, songBId, winnerId);
  }

  // A tournament is a bracket over the ordinary duel path, not a second rating
  // system: every match it resolves goes through `submitDuelResult` above, so
  // the ELO a tournament produces is the same ELO everything else reads.
  startTournament(size: TournamentSize, createdAt = Date.now()): TournamentState {
    return startTournament(this.featureRepository(), size, createdAt);
  }

  resumeTournament(): PreparedTournament | undefined {
    return resumeTournament(this.featureRepository());
  }

  getTournamentOverview(): TournamentOverview {
    return clone(getTournamentOverview(this.featureRepository()));
  }

  submitTournamentDuel(matchId: string, winnerSongId: string): TournamentDuelSubmission {
    return submitTournamentDuel(this.featureRepository(), matchId, winnerSongId);
  }

  /**
   * The slides of a recap for one month or one year. Pure data: the renderer
   * only paints what this returns, so the same numbers are testable without a
   * screen.
   */
  getRecap(period: RecapPeriod): RecapSlide[] {
    const state = this.state();
    return buildRecap(
      {
        songs: state.songs,
        listeningData: state.listeningData,
        tierlists: state.tierlists,
        cmrStats: state.cmrStats
      },
      period
    );
  }

  refreshRediscover(thresholdDays?: number): { count: number } {
    return refreshRediscover(this.featureRepository(), thresholdDays);
  }

  getSongGuessrRound(options: SongGuessrRoundOptions): SongGuessrRound | null {
    return clone(getSongGuessrRound(this.songGuessrRepository(), options));
  }

  searchSongGuessrCandidates(
    query: string,
    limit?: number,
    offset?: number
  ): SongGuessrSearchResult {
    return clone(searchSongGuessrCandidates(this.songGuessrRepository(), query, limit, offset));
  }

  getSongGuessrPools(): SongGuessrPoolOption[] {
    return clone(getSongGuessrPools(this.songGuessrRepository()));
  }
}

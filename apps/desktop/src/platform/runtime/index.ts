/**
 * The 1.1.9 runtime surface over the Rust core.
 *
 * The api wrappers in `../api` were written against an in-process TypeScript runtime and call it as
 * `getRuntime().method(...)`. In 2.0 every method is a Tauri command answering in the 1.x shape
 * (`src-tauri/src/commands.rs`), so this class only forwards. The user data is the one thing kept
 * here: several wrappers read it synchronously.
 *
 * Methods whose command does not exist yet reject with `NotPortedYetError`, naming the method.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

import albumCover from '../../renderer/src/assets/images/webp/album_cover_default.webp';
import artistCover from '../../renderer/src/assets/images/webp/artist_cover_default.webp';
import favoritesCover from '../../renderer/src/assets/images/webp/favorites-playlist-icon.webp';
import genreCover from '../../renderer/src/assets/images/webp/genre-cover-default.webp';
import historyCover from '../../renderer/src/assets/images/webp/history-playlist-icon.webp';
import playlistCover from '../../renderer/src/assets/images/webp/playlist_cover_default.webp';
import rediscoverCover from '../../renderer/src/assets/images/webp/rediscover-playlist-icon.webp';
import songCover from '../../renderer/src/assets/images/webp/song_cover_default.webp';
import { NotPortedYetError } from '../api/errors';
import { emitLocal } from '../api/events';
import type { PathBackedAudioPlayerData, PathBackedUpdateSongDataResult } from '../api/binary';
import { getBuildEnvVariable } from '../core/net/buildEnv';
import type { RecapPeriod, RecapSlide } from '../core/stats/recap';
import type {
  PreparedTournament,
  TournamentDuelSubmission,
  TournamentOverview,
  TournamentSize,
  TournamentState
} from '../core/stats/tournaments';
import type { LastFMAlbumInfo } from '../../types/last_fm_album_info_api';
import type { LastFMTrackInfoApi } from '../../types/last_fm_api';
import type { SimilarTracksOutput } from '../../types/last_fm_similar_tracks_api';

export class RuntimeNotHydratedError extends Error {
  constructor() {
    super('Nemora runtime was read before hydrateRuntime() completed');
    this.name = 'RuntimeNotHydratedError';
  }
}

export interface RuntimeDiscordActivity {
  details?: string;
  state?: string;
  largeImage?: string;
  largeText?: string;
  smallImage?: string;
  smallText?: string;
  startTimestamp?: number;
  endTimestamp?: number;
  buttons?: { label: string; url: string }[];
}

type Result = { success: boolean; message?: string };

const later = (method: string): Promise<never> => Promise.reject(new NotPortedYetError(method));

/** A command call. Commands reject with a string; the view reads `error.message`, as 1.x threw. */
const call = <T>(command: string, args?: Record<string, unknown>): Promise<T> =>
  invoke<T>(command, args).catch((error: unknown) => {
    throw error instanceof Error ? error : new Error(String(error));
  });

/** The local calendar day, which day-based statistics are counted in. */
const today = (): string => {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * 1.x kept the queue, the current song and the duel session in the webview's local storage, by
 * 1.x song id; 2.0 shares that storage (same app identifier) but not the ids. On the first start
 * the core's import maps every old id, and the stored state is rewritten through that map once.
 * While the import is still running the old state is set aside, so the view starts clean instead
 * of failing on ids nothing knows, and the rewritten state comes back with one reload.
 */
const LOCAL_STORAGE_KEY = 'localStorage';
const SET_ASIDE_KEY = 'nemora2:legacyLocalStorage';
const MIGRATED_KEY = 'nemora2:localStorageMigrated';

type LegacyImportState = { running: boolean; songIds: Record<string, string | null> | null };

/** Every string that is an old id becomes the new one; ids with no song left are dropped. */
const remapIds = (value: unknown, ids: Record<string, string | null>): unknown => {
  if (typeof value === 'string') return value in ids ? ids[value] : value;
  if (Array.isArray(value)) {
    return value
      .filter((item) => !(typeof item === 'string' && item in ids && ids[item] === null))
      .map((item) => remapIds(item, ids));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, remapIds(v, ids)]));
  }
  return value;
};

const migrateLegacyLocalStorage = async (): Promise<void> => {
  try {
    if (localStorage.getItem(MIGRATED_KEY)) return;
    const state = await call<LegacyImportState>('legacy_import_state');
    const stored = localStorage.getItem(SET_ASIDE_KEY) ?? localStorage.getItem(LOCAL_STORAGE_KEY);
    if (state.running) {
      if (stored) localStorage.setItem(SET_ASIDE_KEY, stored);
      localStorage.removeItem(LOCAL_STORAGE_KEY);
      await listen('nemora://legacy-imported', () => {
        void migrateLegacyLocalStorage().then(() => window.location.reload());
      });
      return;
    }
    if (stored && state.songIds) {
      const migrated = remapIds(JSON.parse(stored), state.songIds) as Partial<LocalStorage>;
      // The queue and the current song are only kept where they name a song 2.0 has: state left
      // by another profile names ids no import knows.
      const known = new Set(Object.values(state.songIds).filter((id): id is string => id !== null));
      if (migrated.queue) {
        const { queue, currentSongIndex } = migrated.queue;
        const current = currentSongIndex === null ? undefined : queue[currentSongIndex];
        const kept = queue.filter((id) => known.has(id));
        const index = current ? kept.indexOf(current) : -1;
        // The pre-shuffle order is kept as indexes into the old queue, which no longer line up.
        migrated.queue = {
          ...migrated.queue,
          queue: kept,
          currentSongIndex: index >= 0 ? index : null,
          queueBeforeShuffle: undefined
        };
      }
      const currentSong = migrated.playback?.currentSong;
      if (migrated.playback && currentSong && !known.has(currentSong.songId ?? '')) {
        migrated.playback = { ...migrated.playback, currentSong: { songId: null, stoppedPosition: 0 } };
      }
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(migrated));
    }
    localStorage.removeItem(SET_ASIDE_KEY);
    localStorage.setItem(MIGRATED_KEY, new Date().toISOString());
  } catch (error) {
    console.error('The 1.x local storage could not be migrated.', error);
  }
};

export class NemoraRuntime {
  private userData: UserData | undefined;

  async hydrate(): Promise<void> {
    await migrateLegacyLocalStorage();
    this.userData = await call<UserData>('app_hydrate', {
      defaults: {
        song: songCover,
        artist: artistCover,
        album: albumCover,
        genre: genreCover,
        playlist: playlistCover,
        favorites: favoritesCover,
        history: historyCover,
        rediscover: rediscoverCover
      }
    });
    // The core says what changed; the view expects 1.x's batched data events.
    await listen<DataUpdateEventTypes[]>('nemora://data-updated', ({ payload }) => {
      if (payload.includes('userData')) void this.refreshUserData();
      emitLocal(
        'app/dataUpdateEvent',
        payload.map((dataType): DataUpdateEvent => ({ dataType, eventData: [] }))
      );
    });
  }

  isHydrated(): boolean {
    return this.userData !== undefined;
  }

  private async refreshUserData(): Promise<void> {
    this.userData = await call<UserData>('user_data_get');
  }

  /** Writes reach the core as they happen; there is nothing buffered to flush. */
  async flush(): Promise<void> {}

  // ----- user data -------------------------------------------------------------------------------

  getUserData(): UserData {
    if (!this.userData) throw new RuntimeNotHydratedError();
    return clone(this.userData);
  }

  /** Sets a dotted path (`preferences.autoLaunchApp`) and stores its top-level key. */
  saveUserData(dataType: UserDataTypes, data: unknown): void {
    if (!this.userData) throw new RuntimeNotHydratedError();
    const next = clone(this.userData) as UserData & Record<string, unknown>;
    const segments = dataType.split('.');
    let target: Record<string, unknown> = next;
    for (const segment of segments.slice(0, -1)) {
      const child = target[segment] ?? {};
      if (typeof child !== 'object' || Array.isArray(child)) return;
      target[segment] = child;
      target = child as Record<string, unknown>;
    }
    target[segments.at(-1) ?? dataType] = data;
    this.userData = next;

    const key = segments[0];
    void call('user_data_set', { key, value: next[key] }).catch((error: unknown) =>
      console.error(`Saving the user data "${key}" failed.`, error)
    );
    if (dataType === 'preferences.enableDiscordRPC' && data === false) {
      void this.disconnectDiscord().catch(() => undefined);
    }

    const event: DataUpdateEventTypes = dataType.startsWith('windowDiamensions.')
      ? 'userData/windowDiamension'
      : dataType.startsWith('windowPositions.')
        ? 'userData/windowPosition'
        : dataType.startsWith('preferences.')
          ? 'settings/preferences'
          : dataType === 'recentSearches'
            ? 'userData/recentSearches'
            : 'userData';
    emitLocal('app/dataUpdateEvent', [{ dataType: event, eventData: [] }]);
  }

  // ----- songs -----------------------------------------------------------------------------------

  getAllSongs(
    sortType: SongSortTypes = 'aToZ',
    filterType?: SongFilterTypes,
    pagination?: PaginatingData
  ): Promise<PaginatedResult<AudioInfo, SongSortTypes>> {
    return call('library_songs', {
      sortType,
      filterType,
      start: pagination?.start,
      end: pagination?.end,
      today: today()
    });
  }

  getSongInfo(
    songIds: string[],
    sortType?: SongSortTypes,
    filterType?: SongFilterTypes,
    limit?: number,
    preserveIdOrder = false
  ): Promise<SongData[]> {
    return call('library_song_info', {
      songIds,
      sortType,
      filterType,
      limit,
      preserveIdOrder,
      today: today()
    });
  }

  getSong(songId: string): Promise<PathBackedAudioPlayerData> {
    return call('library_song_for_playback', { songId });
  }

  getListeningData(songIds: string[]): Promise<SongListeningData[]> {
    return call('library_listening', { songIds });
  }

  /**
   * 1.x counted listens, skips and seeks in the renderer. 2.0 judges a play from the player's facts
   * in the core; until the player reports them, these counters are ignored.
   */
  updateSongListeningData<DataType extends keyof ListeningDataTypes>(
    _songId: string,
    _dataType: DataType,
    _value: ListeningDataTypes[DataType]
  ): void {}

  toggleLikeSongs(songIds: string[], like?: boolean): Promise<ToggleLikeSongReturnValue> {
    return call('favorites_toggle', { songIds, like });
  }

  getBlacklist(): Promise<Blacklist> {
    return call('library_blacklist');
  }

  blacklistSongs(_ids: string[]): Promise<void> {
    return later('blacklistSongs');
  }

  restoreBlacklistedSongs(_ids: string[]): Promise<void> {
    return later('restoreBlacklistedSongs');
  }

  deleteSongsFromSystem(_paths: string[], _permanent: boolean): Promise<Result> {
    return later('deleteSongsFromSystem');
  }

  getSongFromUnknownSource(_songPath: string): Promise<PathBackedAudioPlayerData> {
    return later('getSongFromUnknownSource');
  }

  async checkForStartUpSongs(): Promise<PathBackedAudioPlayerData | undefined> {
    return undefined;
  }

  // ----- library groups --------------------------------------------------------------------------

  getArtists(
    idsOrNames: string[] = [],
    sortType?: ArtistSortTypes,
    _filterType?: ArtistFilterTypes,
    limit = 0
  ): Promise<Artist[]> {
    return call('library_artists', { idsOrNames, sortType, limit });
  }

  getAlbums(idsOrTitles: string[] = [], sortType?: AlbumSortTypes): Promise<Album[]> {
    return call('library_albums', { idsOrTitles, sortType });
  }

  getGenres(idsOrNames: string[] = [], sortType?: GenreSortTypes): Promise<Genre[]> {
    return call('library_genres', { idsOrNames, sortType });
  }

  getFolders(_folderPaths: string[] = [], _sortType?: FolderSortTypes): Promise<MusicFolder[]> {
    return later('getFolders');
  }

  getFolderStructures(): Promise<FolderStructure[]> {
    return call('library_folder_structures');
  }

  addSongsFromFolderStructures(
    _structures: FolderStructure[],
    _sortType?: SongSortTypes
  ): Promise<SongData[]> {
    return later('addSongsFromFolderStructures');
  }

  async resyncSongsLibrary(): Promise<true> {
    await call('library_rescan');
    return true;
  }

  /** 2.0 rescans on start and on demand; watching the folders live comes later. */
  async startLibraryWatcher(options: { reconcile?: boolean } = {}): Promise<void> {
    if (options.reconcile) await call('library_rescan');
  }

  async clearStaleTempArtwork(_startedAt: Date): Promise<void> {}

  removeMusicFolder(_folderPath: string): Promise<void> {
    return later('removeMusicFolder');
  }

  blacklistFolders(_paths: string[]): Promise<void> {
    return later('blacklistFolders');
  }

  restoreBlacklistedFolders(_paths: string[]): Promise<void> {
    return later('restoreBlacklistedFolders');
  }

  toggleBlacklistedFolders(_paths: string[], _value?: boolean): Promise<void> {
    return later('toggleBlacklistedFolders');
  }

  toggleLikeArtists(_artistIds: string[], _like?: boolean): Promise<ToggleLikeSongReturnValue> {
    return later('toggleLikeArtists');
  }

  getArtistDuplicates(_artistName: string): Promise<Artist[]> {
    return later('getArtistDuplicates');
  }

  resolveArtistDuplicates(
    _selectedArtistId: string,
    _duplicateIds: string[]
  ): Promise<PathBackedUpdateSongDataResult | undefined> {
    return later('resolveArtistDuplicates');
  }

  resolveSeparateArtists(
    _separateArtistId: string,
    _names: string[]
  ): Promise<PathBackedUpdateSongDataResult | undefined> {
    return later('resolveSeparateArtists');
  }

  resolveFeaturingArtists(
    _songId: string,
    _names: string[],
    _removeFeatInfoInTitle?: boolean
  ): Promise<PathBackedUpdateSongDataResult | undefined> {
    return later('resolveFeaturingArtists');
  }

  // ----- search ----------------------------------------------------------------------------------

  search(_filter: SearchFilters, _value: string, _updateHistory = true): Promise<SearchResult> {
    return later('search');
  }

  clearSearchHistory(_searchText?: string[]): Promise<boolean> {
    return later('clearSearchHistory');
  }

  // ----- playlists -------------------------------------------------------------------------------

  getPlaylists(ids?: string[], sortType?: PlaylistSortTypes, mutableOnly?: boolean): Promise<Playlist[]> {
    return call('library_playlists', { ids, sortType, mutableOnly });
  }

  addNewPlaylist(
    _name: string,
    _songIds?: string[],
    _artworkPath?: string
  ): Promise<{ success: boolean; message?: string; playlist?: Playlist }> {
    return later('addNewPlaylist');
  }

  addSongsToPlaylist(_playlistId: string, _songIds: string[]): Promise<void> {
    return later('addSongsToPlaylist');
  }

  addPlaylistArtwork(_playlistId: string, _artworkPath: string): Promise<ArtworkPaths | undefined> {
    return later('addPlaylistArtwork');
  }

  renamePlaylist(_playlistId: string, _newName: string): Promise<void> {
    return later('renamePlaylist');
  }

  removePlaylists(_ids: string[]): Promise<true> {
    return later('removePlaylists');
  }

  removeSongFromPlaylist(_playlistId: string, _songId: string): Promise<Result> {
    return later('removeSongFromPlaylist');
  }

  importPlaylist(): Promise<void> {
    return later('importPlaylist');
  }

  exportPlaylist(_id: string): Promise<void> {
    return later('exportPlaylist');
  }

  getMultipleArtworkPaths(_songIds: string[]): Promise<string[]> {
    return later('getMultipleArtworkPaths');
  }

  clearHistory(): Promise<Result> {
    return later('clearHistory');
  }

  refreshRediscover(_thresholdDays?: number): Promise<{ count: number }> {
    return later('refreshRediscover');
  }

  // ----- tierlists and shuffle -------------------------------------------------------------------

  getTierlists(_ids?: string[], _sortType?: TierlistSortTypes): Promise<SavableTierlist[]> {
    return later('getTierlists');
  }

  addTierlist(
    _name: string,
    _sourcePlaylistIds?: string[],
    _labelMode?: TierlistLabelMode,
    _sourceFolderPaths?: string[]
  ): Promise<{ success: boolean; message?: string; tierlist?: SavableTierlist }> {
    return later('addTierlist');
  }

  saveTierlist(_value: SavableTierlist): Promise<Result> {
    return later('saveTierlist');
  }

  removeTierlists(_ids: string[]): Promise<Result> {
    return later('removeTierlists');
  }

  createTierlistArtworks(_songIds: string[]): Promise<Record<string, string>> {
    return later('createTierlistArtworks');
  }

  getMegaShuffleWeights(_ids: string[], _intensity?: number): Promise<Record<string, number>> {
    return later('getMegaShuffleWeights');
  }

  getMegaShuffleData(_ids: string[], _intensity?: number): Promise<MegaShuffleData> {
    return later('getMegaShuffleData');
  }

  // ----- statistics, ELO, Song Guessr ------------------------------------------------------------

  getStats(_timeRange: StatsTimeRange): Promise<StatsData> {
    return later('getStats');
  }

  getRecap(_period: RecapPeriod): Promise<RecapSlide[]> {
    return later('getRecap');
  }

  exportStats(_options?: { tierShuffleIntensity?: number }): Promise<Result> {
    return later('exportStats');
  }

  importStats(_mergeMode: StatsMergeMode, _source: StatsImportSource): Promise<StatsImportReport> {
    return later('importStats');
  }

  getDuelPair(_pinnedSongId?: string): Promise<DuelPair | null> {
    return later('getDuelPair');
  }

  selectDuelAnchor(_candidates: DuelAnchorCandidate[], _excluded?: string[]): Promise<string | null> {
    return later('selectDuelAnchor');
  }

  getDuelPairByIds(_songAId: string, _songBId: string): Promise<DuelPair | null> {
    return later('getDuelPairByIds');
  }

  recordDuelSkip(_songAId: string, _songBId: string, _reason?: DuelSkipReason): Promise<void> {
    return later('recordDuelSkip');
  }

  submitDuelResult(_songAId: string, _songBId: string, _winnerId: string): Promise<DuelResult> {
    return later('submitDuelResult');
  }

  startTournament(_size: TournamentSize): Promise<TournamentState> {
    return later('startTournament');
  }

  resumeTournament(): Promise<PreparedTournament | undefined> {
    return later('resumeTournament');
  }

  getTournamentOverview(): Promise<TournamentOverview> {
    return later('getTournamentOverview');
  }

  submitTournamentDuel(_matchId: string, _winnerSongId: string): Promise<TournamentDuelSubmission> {
    return later('submitTournamentDuel');
  }

  getSongGuessrRound(_options: SongGuessrRoundOptions): Promise<SongGuessrRound | null> {
    return later('getSongGuessrRound');
  }

  searchSongGuessrCandidates(
    _query: string,
    _limit?: number,
    _offset?: number
  ): Promise<SongGuessrSearchResult> {
    return later('searchSongGuessrCandidates');
  }

  getSongGuessrPools(): Promise<SongGuessrPoolOption[]> {
    return later('getSongGuessrPools');
  }

  // ----- lyrics ----------------------------------------------------------------------------------

  getSongLyrics(
    _songInfo: LyricsRequestTrackInfo,
    _lyricsType?: LyricsTypes,
    _lyricsRequestType?: LyricsRequestTypes,
    _saveLyricsAutomatically?: AutomaticallySaveLyricsTypes
  ): Promise<SongLyrics | undefined> {
    return later('getSongLyrics');
  }

  getTranslatedLyrics(_languageCode: LanguageCodes): Promise<SongLyrics | undefined> {
    return later('getTranslatedLyrics');
  }

  romanizeLyrics(): Promise<SongLyrics | undefined> {
    return later('romanizeLyrics');
  }

  convertLyricsToPinyin(): Promise<SongLyrics | undefined> {
    return later('convertLyricsToPinyin');
  }

  convertLyricsToRomaja(): Promise<SongLyrics | undefined> {
    return later('convertLyricsToRomaja');
  }

  resetLyrics(): Promise<SongLyrics | undefined> {
    return later('resetLyrics');
  }

  saveLyrics(_songPath: string, _text: SongLyrics): Promise<unknown> {
    return later('saveLyrics');
  }

  // ----- tags and artwork ------------------------------------------------------------------------

  getSongTags(_songIdOrPath: string, _isKnownSource: boolean): Promise<SongTags> {
    return later('getSongTags');
  }

  updateSongId3Tags(
    _songIdOrPath: string,
    _tags: SongTags,
    _sendUpdatedData: boolean,
    _isKnownSource: boolean
  ): Promise<PathBackedUpdateSongDataResult> {
    return later('updateSongId3Tags');
  }

  reParseSong(_songPath: string): Promise<SavableSongData | undefined> {
    return later('reParseSong');
  }

  async healSongForPlayback(_songId: string): Promise<boolean> {
    return false;
  }

  async isMetadataUpdatesPending(_songPath: string): Promise<boolean> {
    return false;
  }

  saveArtwork(_source: string, _destination: string): Promise<void> {
    return later('saveArtwork');
  }

  /** Covers are thumbnailed and coloured by the scan. */
  async generatePalettes(): Promise<void> {}

  // ----- network ---------------------------------------------------------------------------------

  getAlbumInfoFromLastFM(_albumId: string): Promise<LastFMAlbumInfo | undefined> {
    return later('getAlbumInfoFromLastFM');
  }

  getSimilarTracks(_songId: string): Promise<SimilarTracksOutput> {
    return later('getSimilarTracks');
  }

  async scrobbleSong(_songId: string, _startTimeInSecs: number): Promise<void> {}

  async sendNowPlayingSong(_songId: string): Promise<void> {}

  getArtistArtwork(_artistId: string): Promise<ArtistInfoFromNet | undefined> {
    return later('getArtistArtwork');
  }

  searchSongMetadata(_title: string, _artists: string[]): Promise<SongMetadataResultFromInternet[]> {
    return later('searchSongMetadata');
  }

  fetchSongMetadata(_title: string, _artists: string[]): Promise<SongMetadataResultFromInternet[]> {
    return later('fetchSongMetadata');
  }

  fetchSongInfo(_title: string, _artists: string[]): Promise<LastFMTrackInfoApi | undefined> {
    return later('fetchSongInfo');
  }

  // ----- app and system --------------------------------------------------------------------------

  async revealSongInFileExplorer(songId: string): Promise<void> {
    const [song] = await this.getSongInfo([songId]);
    if (!song?.path) {
      emitLocal('app/sendMessageToRendererEvent', 'OPEN_SONG_IN_EXPLORER_FAILED');
      return;
    }
    await call('reveal_song_in_file_explorer', { path: song.path });
  }

  revealFolderInFileExplorer(path: string): Promise<void> {
    return call('reveal_folder_in_file_explorer', { path });
  }

  openLogFile(): Promise<void> {
    return call('open_log_file');
  }

  getStorageUsage(_forceRefresh = false): Promise<StorageMetrics | undefined> {
    return later('getStorageUsage');
  }

  async toggleAutoLaunch(enabled: boolean): Promise<void> {
    await call('toggle_auto_launch', { enabled });
    this.saveUserData('preferences.autoLaunchApp', enabled);
  }

  openDevTools(): Promise<void> {
    return call('open_devtools');
  }

  stopScreenSleeping(): Promise<void> {
    return call('stop_screen_sleeping');
  }

  allowScreenSleeping(): Promise<void> {
    return call('allow_screen_sleeping');
  }

  getDiscordClientId(): string | undefined {
    return getBuildEnvVariable('MAIN_VITE_DISCORD_CLIENT_ID');
  }

  async setDiscordActivity(activity: RuntimeDiscordActivity): Promise<void> {
    const clientId = this.getDiscordClientId();
    if (!clientId) throw new Error('Discord Client ID not found.');
    await call('discord_connect', { clientId });
    await call('discord_set_activity', { activity });
  }

  disconnectDiscord(): Promise<void> {
    return call('discord_disconnect');
  }

  exportAppData(_localStorageData: string): Promise<void> {
    return later('exportAppData');
  }

  importAppData(): Promise<void | LocalStorage> {
    return later('importAppData');
  }

  resetApplicationData(): Promise<void> {
    return later('resetApplicationData');
  }
}

let runtime: NemoraRuntime | undefined;
let hydration: Promise<NemoraRuntime> | undefined;

export async function hydrateRuntime(): Promise<NemoraRuntime> {
  if (runtime?.isHydrated()) return runtime;
  hydration ??= (async () => {
    const created = new NemoraRuntime();
    await created.hydrate();
    runtime = created;
    return created;
  })().catch((error: unknown) => {
    hydration = undefined;
    throw error;
  });
  return hydration;
}

export function getRuntime(): NemoraRuntime {
  if (!runtime?.isHydrated()) throw new RuntimeNotHydratedError();
  return runtime;
}

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
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';

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
import type { LyricsRepository } from '../core/lyrics/repository';
import type { PlaySession } from '../../renderer/src/other/listeningDataSession';
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

/** What the core made of a play session. */
export interface PlayEvaluation {
  isPlay: boolean;
  isFull: boolean;
  isSkip: boolean;
  heardMs: number;
  scrobble: boolean;
}

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
    // Notifications the core raises for the user, as 1.x's sendMessage.
    await listen<{ code: MessageCodes; data?: MessageToRendererData }>(
      'nemora://message',
      ({ payload }) => emitLocal('app/sendMessageToRendererEvent', payload.code, payload.data)
    );
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

  /** One finished session of the player; the core decides what it counts as. */
  recordPlaySession(session: PlaySession): Promise<PlayEvaluation> {
    return call('play_record', { session });
  }

  toggleLikeSongs(songIds: string[], like?: boolean): Promise<ToggleLikeSongReturnValue> {
    return call('favorites_toggle', { songIds, like });
  }

  getBlacklist(): Promise<Blacklist> {
    return call('library_blacklist');
  }

  blacklistSongs(ids: string[]): Promise<void> {
    return call('blacklist_songs', { songIds: ids, value: true });
  }

  restoreBlacklistedSongs(ids: string[]): Promise<void> {
    return call('blacklist_songs', { songIds: ids, value: false });
  }

  deleteSongsFromSystem(paths: string[], permanent: boolean): Promise<Result> {
    return call('songs_delete_files', { paths, permanent });
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

  getFolders(folderPaths: string[] = [], sortType?: FolderSortTypes): Promise<MusicFolder[]> {
    return call('library_folders', { folderPaths, sortType });
  }

  getFolderStructures(): Promise<FolderStructure[]> {
    return call('library_folder_structures');
  }

  /** The chosen folders become music folders; subfolder choices are 1.x's and not kept. */
  addSongsFromFolderStructures(
    structures: FolderStructure[],
    _sortType?: SongSortTypes
  ): Promise<SongData[]> {
    return call('folders_add', { paths: structures.map((structure) => structure.path) });
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

  removeMusicFolder(folderPath: string): Promise<void> {
    return call('folders_remove', { path: folderPath });
  }

  blacklistFolders(paths: string[]): Promise<void> {
    return call('blacklist_folders', { folderPaths: paths, value: true });
  }

  restoreBlacklistedFolders(paths: string[]): Promise<void> {
    return call('blacklist_folders', { folderPaths: paths, value: false });
  }

  toggleBlacklistedFolders(paths: string[], value?: boolean): Promise<void> {
    return call('blacklist_folders', { folderPaths: paths, value });
  }

  toggleLikeArtists(_artistIds: string[], _like?: boolean): Promise<ToggleLikeSongReturnValue> {
    return later('toggleLikeArtists');
  }

  getArtistDuplicates(artistName: string): Promise<Artist[]> {
    return call('artist_duplicates', { artistName });
  }

  resolveArtistDuplicates(
    selectedArtistId: string,
    duplicateIds: string[]
  ): Promise<PathBackedUpdateSongDataResult | undefined> {
    return call('artist_resolve_duplicates', { selectedArtistId, duplicateIds });
  }

  resolveSeparateArtists(
    separateArtistId: string,
    names: string[]
  ): Promise<PathBackedUpdateSongDataResult | undefined> {
    return call('artist_resolve_separate', {
      separateArtistId,
      separateArtistNames: names
    });
  }

  resolveFeaturingArtists(
    songId: string,
    names: string[],
    removeFeatInfoInTitle?: boolean
  ): Promise<PathBackedUpdateSongDataResult | undefined> {
    return call('artist_resolve_featuring', {
      songId,
      featArtistNames: names,
      removeFeatInfoInTitle
    });
  }

  // ----- search ----------------------------------------------------------------------------------

  private historyTimer: ReturnType<typeof setTimeout> | undefined;

  async search(filter: SearchFilters, value: string, updateHistory = true): Promise<SearchResult> {
    const result = await call<SearchResult>('library_search', { filter, value });
    // As 1.x: a query that stays put for two seconds goes to the top of the recent searches.
    if (updateHistory) {
      clearTimeout(this.historyTimer);
      this.historyTimer = setTimeout(() => {
        const recent = this.getUserData().recentSearches.filter((entry) => entry !== value);
        this.saveUserData('recentSearches', [value, ...recent].slice(0, 11));
      }, 2000);
    }
    return result;
  }

  async clearSearchHistory(searchText: string[] = []): Promise<boolean> {
    const recent = this.getUserData().recentSearches;
    this.saveUserData(
      'recentSearches',
      searchText.length === 0 ? [] : recent.filter((entry) => !searchText.includes(entry))
    );
    return true;
  }

  // ----- playlists -------------------------------------------------------------------------------

  getPlaylists(ids?: string[], sortType?: PlaylistSortTypes, mutableOnly?: boolean): Promise<Playlist[]> {
    return call('library_playlists', { ids, sortType, mutableOnly });
  }

  addNewPlaylist(
    name: string,
    songIds?: string[],
    artworkPath?: string
  ): Promise<{ success: boolean; message?: string; playlist?: Playlist }> {
    return call('playlist_create', { name, songIds, artworkPath });
  }

  addSongsToPlaylist(playlistId: string, songIds: string[]): Promise<void> {
    return call('playlist_add_songs', { playlistId, songIds });
  }

  addPlaylistArtwork(playlistId: string, artworkPath: string): Promise<ArtworkPaths | undefined> {
    return call('playlist_set_artwork', { playlistId, path: artworkPath });
  }

  renamePlaylist(playlistId: string, newName: string): Promise<void> {
    return call('playlist_rename', { playlistId, name: newName });
  }

  removePlaylists(ids: string[]): Promise<true> {
    return call('playlist_remove', { playlistIds: ids });
  }

  removeSongFromPlaylist(playlistId: string, songId: string): Promise<Result> {
    return call('playlist_remove_song', { playlistId, songId });
  }

  async importPlaylist(): Promise<void> {
    const path = await openDialog({
      title: 'Select a Destination where your M3U8 file is',
      filters: [
        { name: 'M3U8 Files', extensions: ['m3u8', 'm3u'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });
    if (typeof path !== 'string') {
      emitLocal('app/sendMessageToRendererEvent', 'DESTINATION_NOT_SELECTED');
      return;
    }
    await call('playlist_import', { path });
  }

  async exportPlaylist(id: string): Promise<void> {
    const [playlist] = await this.getPlaylists([id]);
    const name = playlist?.name ?? 'playlist';
    const path = await saveDialog({
      title: `Select the destination to save '${name}' playlist`,
      defaultPath: `${name}.m3u8`,
      filters: [{ name: 'M3U8 Files', extensions: ['m3u8'] }]
    });
    if (typeof path !== 'string') {
      emitLocal('app/sendMessageToRendererEvent', 'DESTINATION_NOT_SELECTED');
      return;
    }
    await call('playlist_export', { playlistId: id, path });
  }

  /** Full-size covers: they are composed into the large multi-cover cards. */
  async getMultipleArtworkPaths(songIds: string[]): Promise<string[]> {
    const songs = await this.getSongInfo(songIds, undefined, undefined, 0, true);
    return songs.map((song) => song.artworkPaths.artworkPath);
  }

  clearHistory(): Promise<Result> {
    return call('history_clear', { now: Date.now() });
  }

  refreshRediscover(thresholdDays?: number): Promise<{ count: number }> {
    return call('rediscover_refresh', { thresholdDays, today: today() });
  }

  // ----- tierlists and shuffle -------------------------------------------------------------------

  getTierlists(ids?: string[], sortType?: TierlistSortTypes): Promise<SavableTierlist[]> {
    return call('tierlists_list', { ids, sortType });
  }

  addTierlist(
    name: string,
    sourcePlaylistIds?: string[],
    labelMode?: TierlistLabelMode,
    sourceFolderPaths?: string[]
  ): Promise<{ success: boolean; message?: string; tierlist?: SavableTierlist }> {
    return call('tierlist_add', { name, sourcePlaylistIds, labelMode, sourceFolderPaths });
  }

  saveTierlist(value: SavableTierlist): Promise<Result> {
    return call('tierlist_save', { tierlist: value });
  }

  removeTierlists(ids: string[]): Promise<Result> {
    return call('tierlists_remove', { ids });
  }

  createTierlistArtworks(songIds: string[]): Promise<Record<string, string>> {
    return call('tierlist_artworks', { songIds });
  }

  async getMegaShuffleWeights(ids: string[], intensity?: number): Promise<Record<string, number>> {
    return (await this.getMegaShuffleData(ids, intensity)).weights;
  }

  getMegaShuffleData(ids: string[], intensity?: number): Promise<MegaShuffleData> {
    return call('shuffle_data', { songIds: ids, intensity });
  }

  // ----- statistics, ELO, Song Guessr ------------------------------------------------------------

  getStats(timeRange: StatsTimeRange): Promise<StatsData> {
    return call('stats_dashboard', { timeRange, today: today() });
  }

  getRecap(period: RecapPeriod): Promise<RecapSlide[]> {
    return call('stats_recap', { period, utcOffsetMin: -new Date().getTimezoneOffset() });
  }

  async exportStats(options?: { tierShuffleIntensity?: number }): Promise<Result> {
    const path = await saveDialog({
      title: 'Export Stats',
      defaultPath: `Nemora Stats Export - ${today()}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (typeof path !== 'string') return { success: false };
    return call('stats_export', {
      path,
      tierShuffleIntensity: options?.tierShuffleIntensity,
      now: Date.now()
    });
  }

  /** Exports merge by maximum per device and day, so the merge mode has nothing left to choose. */
  async importStats(_mergeMode: StatsMergeMode, source: StatsImportSource): Promise<StatsImportReport> {
    const empty = { matchedSongs: 0, unmatchedSongs: 0, mergedListens: 0, eloMerged: false };
    if (source === 'folder') {
      return { ...empty, success: false, message: 'Nora export folders are not imported by Nemora 2.0.' };
    }
    const path = await openDialog({
      title: 'Import Stats',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (typeof path !== 'string') return { ...empty, success: false };
    return call('stats_import', { path });
  }

  getDuelPair(pinnedSongId?: string): Promise<DuelPair | null> {
    return call('duel_pair', { pinnedSongId });
  }

  selectDuelAnchor(candidates: DuelAnchorCandidate[], excluded?: string[]): Promise<string | null> {
    return call('duel_select_anchor', { candidates, excluded });
  }

  getDuelPairByIds(songAId: string, songBId: string): Promise<DuelPair | null> {
    return call('duel_pair_by_ids', { songAId, songBId });
  }

  recordDuelSkip(songAId: string, songBId: string, reason?: DuelSkipReason): Promise<void> {
    return call('duel_skip', { songAId, songBId, reason });
  }

  submitDuelResult(songAId: string, songBId: string, winnerId: string): Promise<DuelResult> {
    return call('duel_submit', { songAId, songBId, winnerId });
  }

  startTournament(size: TournamentSize): Promise<TournamentState> {
    return call('tournament_start', { size });
  }

  async resumeTournament(): Promise<PreparedTournament | undefined> {
    return (await call<PreparedTournament | null>('tournament_resume')) ?? undefined;
  }

  getTournamentOverview(): Promise<TournamentOverview> {
    return call('tournament_overview');
  }

  submitTournamentDuel(matchId: string, winnerSongId: string): Promise<TournamentDuelSubmission> {
    return call('tournament_submit', { matchId, winnerSongId });
  }

  getSongGuessrRound(options: SongGuessrRoundOptions): Promise<SongGuessrRound | null> {
    return call('guessr_round', { options });
  }

  searchSongGuessrCandidates(
    query: string,
    limit?: number,
    offset?: number
  ): Promise<SongGuessrSearchResult> {
    return call('guessr_search', { query, limit, offset });
  }

  getSongGuessrPools(): Promise<SongGuessrPoolOption[]> {
    return call('guessr_pools');
  }

  // ----- lyrics ----------------------------------------------------------------------------------

  /**
   * Found lyrics are always kept in the library by the core, so 1.x's "save automatically"
   * choice has nothing left to decide.
   */
  async getSongLyrics(
    songInfo: LyricsRequestTrackInfo,
    lyricsType?: LyricsTypes,
    lyricsRequestType?: LyricsRequestTypes,
    _saveLyricsAutomatically?: AutomaticallySaveLyricsTypes
  ): Promise<SongLyrics | undefined> {
    const { default: getSongLyrics } = await import('../core/lyrics/getSongLyrics');
    return getSongLyrics(songInfo, lyricsType, lyricsRequestType);
  }

  /** What the 1.x lyrics helpers (translation, romanisation) need from the app. */
  private lyricsRepository(): LyricsRepository {
    const unused = (name: string) => () => Promise.reject(new NotPortedYetError(name));
    return {
      getUserData: () => this.getUserData(),
      sendMessage: ({ messageCode, data }) =>
        emitLocal('app/sendMessageToRendererEvent', messageCode, data),
      emitDataUpdate: (dataType) =>
        emitLocal('app/dataUpdateEvent', [{ dataType, eventData: [] }]),
      readEmbeddedLyrics: unused('readEmbeddedLyrics'),
      writeEmbeddedLyrics: unused('writeEmbeddedLyrics'),
      decrypt: unused('decrypt'),
      searchUnsyncedLyrics: unused('searchUnsyncedLyrics')
    };
  }

  async getTranslatedLyrics(languageCode: LanguageCodes): Promise<SongLyrics | undefined> {
    const { default: translate } = await import('../core/lyrics/getTranslatedLyrics');
    return translate(this.lyricsRepository(), String(languageCode));
  }

  async romanizeLyrics(): Promise<SongLyrics | undefined> {
    const { default: romanize } = await import('../core/lyrics/romanizeLyrics');
    return romanize(this.lyricsRepository());
  }

  async convertLyricsToPinyin(): Promise<SongLyrics | undefined> {
    const { default: toPinyin } = await import('../core/lyrics/convertToPinyin');
    return toPinyin(this.lyricsRepository());
  }

  async convertLyricsToRomaja(): Promise<SongLyrics | undefined> {
    const { default: toRomaja } = await import('../core/lyrics/convertToRomaja');
    return toRomaja(this.lyricsRepository());
  }

  async resetLyrics(): Promise<SongLyrics | undefined> {
    const { default: reset } = await import('../core/lyrics/resetLyrics');
    return reset(this.lyricsRepository());
  }

  /** The user's lyrics go into the library, not into the file, and sync from there. */
  async saveLyrics(songPath: string, text: SongLyrics): Promise<unknown> {
    const { toLrc, updateCachedLyrics } = await import('../core/lyrics/getSongLyrics');
    const saved = await call<boolean>('lyrics_save', { path: songPath, text: toLrc(text) });
    if (saved) await updateCachedLyrics(() => text);
    return saved;
  }

  // ----- tags and artwork ------------------------------------------------------------------------

  getSongTags(songIdOrPath: string, isKnownSource: boolean): Promise<SongTags> {
    return call('tags_get', { songIdOrPath, isKnownSource });
  }

  /** The audio is never rewritten, so the song keeps its id and statistics. */
  updateSongId3Tags(
    songIdOrPath: string,
    tags: SongTags,
    _sendUpdatedData: boolean,
    isKnownSource: boolean
  ): Promise<PathBackedUpdateSongDataResult> {
    return call('tags_update', { songIdOrPath, tags, isKnownSource });
  }

  async reParseSong(songPath: string): Promise<SavableSongData | undefined> {
    return (await call<SavableSongData | null>('song_reparse', { path: songPath })) ?? undefined;
  }

  async healSongForPlayback(_songId: string): Promise<boolean> {
    return false;
  }

  async isMetadataUpdatesPending(_songPath: string): Promise<boolean> {
    return false;
  }

  saveArtwork(source: string, destination: string): Promise<void> {
    return call('artwork_save', { source, destination });
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

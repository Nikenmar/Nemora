import { encodeUtf8 } from './bytes';
import {
  LOCAL_STORAGE_KEYS,
  LocalStorageMigrationError,
  type LocalStorageKey,
  type LocalStorageValues,
  type MigrationMarker
} from './types';

type JsonObject = Record<string, unknown>;
type PrimitiveKind = 'string' | 'number' | 'boolean';

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const requireObject = (value: unknown, path: string): JsonObject => {
  if (!isObject(value)) throw new LocalStorageMigrationError(`${path} must be an object`);
  return value;
};

const requireKind = (object: JsonObject, key: string, kind: PrimitiveKind, path: string): void => {
  if (typeof object[key] !== kind)
    throw new LocalStorageMigrationError(`${path}.${key} must be a ${kind}`);
  if (kind === 'number' && !Number.isFinite(object[key]))
    throw new LocalStorageMigrationError(`${path}.${key} must be finite`);
};

const optionalKind = (object: JsonObject, key: string, kind: PrimitiveKind, path: string): void => {
  if (key in object && object[key] !== undefined) requireKind(object, key, kind, path);
};

const requireOneOf = (
  object: JsonObject,
  key: string,
  allowed: readonly string[],
  path: string
): void => {
  requireKind(object, key, 'string', path);
  if (!allowed.includes(object[key] as string))
    throw new LocalStorageMigrationError(`${path}.${key} has an unsupported value`);
};

const requireStringArray = (value: unknown, path: string): void => {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string'))
    throw new LocalStorageMigrationError(`${path} must be an array of strings`);
};

const validatePreferences = (value: unknown): void => {
  const object = requireObject(value, 'localStorage.preferences');
  const booleans = [
    'isSongIndexingEnabled',
    'disableBackgroundArtworks',
    'doNotShowBlacklistSongConfirm',
    'doNotVerifyWhenOpeningLinks',
    'isReducedMotion',
    'showArtistArtworkNearSongControls',
    'showSongRemainingTime',
    'enableArtworkFromSongCovers',
    'shuffleArtworkFromSongCovers',
    'removeAnimationsOnBatteryPower',
    'showTrackNumberAsSongIndex',
    'allowToPreventScreenSleeping',
    'enableImageBasedDynamicThemes',
    'doNotShowHelpPageOnLyricsEditorStartUp',
    'autoTranslateLyrics',
    'autoConvertLyrics'
  ];
  for (const key of booleans) requireKind(object, key, 'boolean', 'localStorage.preferences');
  requireKind(object, 'seekbarScrollInterval', 'number', 'localStorage.preferences');
  requireKind(object, 'noUpdateNotificationForNewUpdate', 'string', 'localStorage.preferences');
  requireOneOf(
    object,
    'defaultPageOnStartUp',
    ['Songs', 'Home', 'Artists', 'Albums', 'Playlists', 'Folders', 'Search', 'Genres'],
    'localStorage.preferences'
  );
  requireOneOf(
    object,
    'lyricsAutomaticallySaveState',
    ['SYNCED', 'SYNCED_OR_UN_SYNCED', 'NONE'],
    'localStorage.preferences'
  );
  optionalKind(object, 'tierShuffleIntensity', 'number', 'localStorage.preferences');
  if (
    typeof object.tierShuffleIntensity === 'number' &&
    (object.tierShuffleIntensity < 0 || object.tierShuffleIntensity > 1)
  )
    throw new LocalStorageMigrationError(
      'localStorage.preferences.tierShuffleIntensity must be 0..1'
    );
  // Historical isPredictiveSearchEnabled is intentionally accepted as unknown
  // compatibility data. The normal renderer migration removes it later.
};

const validatePlayback = (value: unknown): void => {
  const object = requireObject(value, 'localStorage.playback');
  requireKind(object, 'isShuffling', 'boolean', 'localStorage.playback');
  optionalKind(object, 'isTierShuffling', 'boolean', 'localStorage.playback');
  requireOneOf(object, 'isRepeating', ['false', 'repeat', 'repeat-1'], 'localStorage.playback');
  requireKind(object, 'playbackRate', 'number', 'localStorage.playback');
  const currentSong = requireObject(object.currentSong, 'localStorage.playback.currentSong');
  if (currentSong.songId !== null && typeof currentSong.songId !== 'string')
    throw new LocalStorageMigrationError(
      'localStorage.playback.currentSong.songId must be string|null'
    );
  requireKind(currentSong, 'stoppedPosition', 'number', 'localStorage.playback.currentSong');
  optionalKind(currentSong, 'playlistId', 'string', 'localStorage.playback.currentSong');
  const volume = requireObject(object.volume, 'localStorage.playback.volume');
  requireKind(volume, 'isMuted', 'boolean', 'localStorage.playback.volume');
  requireKind(volume, 'value', 'number', 'localStorage.playback.volume');
};

const validateQueue = (value: unknown): void => {
  const object = requireObject(value, 'localStorage.queue');
  if (object.currentSongIndex !== null && typeof object.currentSongIndex !== 'number')
    throw new LocalStorageMigrationError('localStorage.queue.currentSongIndex must be number|null');
  if (typeof object.currentSongIndex === 'number' && !Number.isInteger(object.currentSongIndex))
    throw new LocalStorageMigrationError('localStorage.queue.currentSongIndex must be an integer');
  requireStringArray(object.queue, 'localStorage.queue.queue');
  if (
    'queueBeforeShuffle' in object &&
    (!Array.isArray(object.queueBeforeShuffle) ||
      object.queueBeforeShuffle.some(
        (entry) => typeof entry !== 'number' || !Number.isFinite(entry)
      ))
  )
    throw new LocalStorageMigrationError('localStorage.queue.queueBeforeShuffle must be number[]');
  optionalKind(object, 'queueId', 'string', 'localStorage.queue');
  requireOneOf(
    object,
    'queueType',
    ['album', 'playlist', 'artist', 'songs', 'genre', 'folder'],
    'localStorage.queue'
  );
};

const validateIgnoredDuplicates = (value: unknown): void => {
  const object = requireObject(value, 'localStorage.ignoredDuplicates');
  for (const key of ['artists', 'albums', 'genres'])
    requireStringArray(object[key], `localStorage.ignoredDuplicates.${key}`);
};

const validateSortingStates = (value: unknown): void => {
  const object = requireObject(value, 'localStorage.sortingStates');
  const common = ['aToZ', 'zToA', 'noOfSongsAscending', 'noOfSongsDescending'];
  const allowedByKey: Record<string, string[]> = {
    songsPage: [
      'aToZ',
      'zToA',
      'addedOrder',
      'dateAddedAscending',
      'dateAddedDescending',
      'releasedYearAscending',
      'releasedYearDescending',
      'trackNoAscending',
      'trackNoDescending',
      'artistNameAscending',
      'artistNameDescending',
      'allTimeMostListened',
      'allTimeLeastListened',
      'monthlyMostListened',
      'monthlyLeastListened',
      'albumNameAscending',
      'albumNameDescending',
      'blacklistedSongs',
      'whitelistedSongs'
    ],
    artistsPage: [...common, 'mostLovedAscending', 'mostLovedDescending'],
    playlistsPage: common,
    albumsPage: common,
    genresPage: common,
    musicFoldersPage: [...common, 'blacklistedFolders', 'whitelistedFolders'],
    tierlistsPage: ['aToZ', 'zToA', 'dateAddedAscending', 'dateAddedDescending']
  };
  for (const [key, allowed] of Object.entries(allowedByKey)) {
    if (!(key in object) || object[key] === undefined) continue;
    requireOneOf(object, key, allowed, 'localStorage.sortingStates');
  }
};

const validateEqualizer = (value: unknown): void => {
  const object = requireObject(value, 'localStorage.equalizerPreset');
  for (const key of [
    'thirtyTwoHertzFilter',
    'sixtyFourHertzFilter',
    'hundredTwentyFiveHertzFilter',
    'twoHundredFiftyHertzFilter',
    'fiveHundredHertzFilter',
    'thousandHertzFilter',
    'twoThousandHertzFilter',
    'fourThousandHertzFilter',
    'eightThousandHertzFilter',
    'sixteenThousandHertzFilter'
  ])
    requireKind(object, key, 'number', 'localStorage.equalizerPreset');
};

const validateLyricsEditor = (value: unknown): void => {
  const object = requireObject(value, 'localStorage.lyricsEditorSettings');
  requireKind(object, 'offset', 'number', 'localStorage.lyricsEditorSettings');
  requireKind(
    object,
    'editNextAndCurrentStartAndEndTagsAutomatically',
    'boolean',
    'localStorage.lyricsEditorSettings'
  );
};

const validateDuels = (value: unknown): void => {
  const object = requireObject(value, 'localStorage.duels');
  requireOneOf(object, 'frequency', ['off', 'rare', 'normal', 'frequent'], 'localStorage.duels');
  for (const key of ['lastInviteAt', 'listensSinceInvite', 'pendingDuels'])
    requireKind(object, key, 'number', 'localStorage.duels');
  if (!Array.isArray(object.pendingDuelTickets))
    throw new LocalStorageMigrationError('localStorage.duels.pendingDuelTickets must be an array');
  for (const [index, ticketValue] of object.pendingDuelTickets.entries()) {
    const ticket = requireObject(ticketValue, `localStorage.duels.pendingDuelTickets[${index}]`);
    requireKind(
      ticket,
      'anchorSongId',
      'string',
      `localStorage.duels.pendingDuelTickets[${index}]`
    );
    requireKind(ticket, 'earnedAt', 'number', `localStorage.duels.pendingDuelTickets[${index}]`);
  }
  if (!Array.isArray(object.duelAnchorCandidates))
    throw new LocalStorageMigrationError(
      'localStorage.duels.duelAnchorCandidates must be an array'
    );
  for (const [index, candidateValue] of object.duelAnchorCandidates.entries()) {
    const candidate = requireObject(
      candidateValue,
      `localStorage.duels.duelAnchorCandidates[${index}]`
    );
    requireKind(candidate, 'songId', 'string', `localStorage.duels.duelAnchorCandidates[${index}]`);
    requireKind(
      candidate,
      'listenedAt',
      'number',
      `localStorage.duels.duelAnchorCandidates[${index}]`
    );
  }
  if (
    !Array.isArray(object.pendingDuelPairs) ||
    object.pendingDuelPairs.some(
      (pair) =>
        !Array.isArray(pair) ||
        pair.length !== 2 ||
        typeof pair[0] !== 'string' ||
        typeof pair[1] !== 'string'
    )
  )
    throw new LocalStorageMigrationError(
      'localStorage.duels.pendingDuelPairs must be [string,string][]'
    );
};

const validateCompositeLocalStorage = (serialized: string): void => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch (error) {
    throw new LocalStorageMigrationError('localStorage is not valid JSON', error);
  }
  const object = requireObject(parsed, 'localStorage');
  validatePreferences(object.preferences);
  validatePlayback(object.playback);
  validateQueue(object.queue);
  requireStringArray(object.ignoredSeparateArtists, 'localStorage.ignoredSeparateArtists');
  requireStringArray(
    object.ignoredSongsWithFeatArtists,
    'localStorage.ignoredSongsWithFeatArtists'
  );
  validateIgnoredDuplicates(object.ignoredDuplicates);
  validateSortingStates(object.sortingStates);
  validateEqualizer(object.equalizerPreset);
  validateLyricsEditor(object.lyricsEditorSettings);
  validateDuels(object.duels);
};

const requireNonNegativeInteger = (object: JsonObject, key: string, path: string): void => {
  const value = object[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0)
    throw new LocalStorageMigrationError(`${path}.${key} must be a non-negative integer`);
};

const validateSongGuessr = (serialized: string): void => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch (error) {
    throw new LocalStorageMigrationError('nora_song_guessr is not valid JSON', error);
  }
  const object = requireObject(parsed, 'nora_song_guessr');
  if (object.version !== 1)
    throw new LocalStorageMigrationError('nora_song_guessr.version must be 1');
  if (!['library', 'playlist', 'genre'].includes(String(object.poolType)))
    throw new LocalStorageMigrationError('nora_song_guessr.poolType is invalid');
  optionalKind(object, 'poolId', 'string', 'nora_song_guessr');
  requireStringArray(object.recentSongIds, 'nora_song_guessr.recentSongIds');
  const stats = requireObject(object.stats, 'nora_song_guessr.stats');
  for (const key of ['gamesPlayed', 'wins', 'losses', 'currentStreak', 'maxStreak'])
    requireNonNegativeInteger(stats, key, 'nora_song_guessr.stats');
  requireKind(stats, 'lastPlayedAt', 'number', 'nora_song_guessr.stats');
  if (
    !Array.isArray(stats.distribution) ||
    stats.distribution.length !== 6 ||
    stats.distribution.some(
      (value) => typeof value !== 'number' || !Number.isInteger(value) || value < 0
    )
  )
    throw new LocalStorageMigrationError(
      'nora_song_guessr.stats.distribution must contain 6 counts'
    );
  if ('skips' in stats) requireNonNegativeInteger(stats, 'skips', 'nora_song_guessr.stats');
  optionalKind(stats, 'firstPlayedAt', 'number', 'nora_song_guessr.stats');
  if ('recentRounds' in stats) {
    if (!Array.isArray(stats.recentRounds))
      throw new LocalStorageMigrationError('nora_song_guessr.stats.recentRounds must be an array');
    for (const [index, roundValue] of stats.recentRounds.entries()) {
      const round = requireObject(roundValue, `nora_song_guessr.stats.recentRounds[${index}]`);
      requireKind(round, 'at', 'number', `nora_song_guessr.stats.recentRounds[${index}]`);
      requireKind(round, 'won', 'boolean', `nora_song_guessr.stats.recentRounds[${index}]`);
      requireNonNegativeInteger(round, 'attempts', `nora_song_guessr.stats.recentRounds[${index}]`);
      if ((round.attempts as number) < 1 || (round.attempts as number) > 6)
        throw new LocalStorageMigrationError(
          `nora_song_guessr.stats.recentRounds[${index}].attempts must be 1..6`
        );
      requireKind(round, 'songId', 'string', `nora_song_guessr.stats.recentRounds[${index}]`);
      requireKind(round, 'title', 'string', `nora_song_guessr.stats.recentRounds[${index}]`);
      requireStringArray(round.artists, `nora_song_guessr.stats.recentRounds[${index}].artists`);
    }
  }
};

export const validateLocalStorageValues = (values: LocalStorageValues): void => {
  for (const key of LOCAL_STORAGE_KEYS) {
    const value = values[key];
    if (value !== null && typeof value !== 'string')
      throw new LocalStorageMigrationError(`${key} must be a string or null`);
  }
  if (values.version !== null && values.version.length === 0)
    throw new LocalStorageMigrationError('version must not be empty');
  if (values.localStorage !== null) validateCompositeLocalStorage(values.localStorage);
  if (values.nora_song_guessr !== null) validateSongGuessr(values.nora_song_guessr);
};

export interface BridgeExport {
  formatVersion: 1;
  sourceAppVersion: string;
  exportedAt: string;
  values: LocalStorageValues;
  checksum: string;
}

export const canonicalValuesBytes = (values: LocalStorageValues): Uint8Array =>
  encodeUtf8(
    JSON.stringify({
      version: values.version,
      localStorage: values.localStorage,
      nora_song_guessr: values.nora_song_guessr
    })
  );

const isSha256 = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);

export const parseBridgeExport = (serialized: string): BridgeExport => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch (error) {
    throw new LocalStorageMigrationError('bridge export is not valid JSON', error);
  }
  const object = requireObject(parsed, 'bridge export');
  if (object.formatVersion !== 1)
    throw new LocalStorageMigrationError('bridge export formatVersion must be 1');
  requireKind(object, 'sourceAppVersion', 'string', 'bridge export');
  requireKind(object, 'exportedAt', 'string', 'bridge export');
  if (!Number.isFinite(Date.parse(object.exportedAt as string)))
    throw new LocalStorageMigrationError('bridge export exportedAt is invalid');
  if (!isSha256(object.checksum))
    throw new LocalStorageMigrationError('bridge export checksum is invalid');
  const valuesObject = requireObject(object.values, 'bridge export.values');
  const values = {} as LocalStorageValues;
  for (const key of LOCAL_STORAGE_KEYS) {
    const value = valuesObject[key];
    if (value !== null && typeof value !== 'string')
      throw new LocalStorageMigrationError(`bridge export values.${key} must be string|null`);
    values[key] = value as string | null;
  }
  validateLocalStorageValues(values);
  return {
    formatVersion: 1,
    sourceAppVersion: object.sourceAppVersion as string,
    exportedAt: object.exportedAt as string,
    values,
    checksum: (object.checksum as string).toLowerCase()
  };
};

export const parseMarker = (serialized: string): MigrationMarker => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch (error) {
    throw new LocalStorageMigrationError('migration marker is not valid JSON', error);
  }
  const object = requireObject(parsed, 'migration marker');
  if (object.formatVersion !== 1)
    throw new LocalStorageMigrationError('migration marker formatVersion must be 1');
  if (object.source !== 'bridge' && object.source !== 'leveldb')
    throw new LocalStorageMigrationError('migration marker source is invalid');
  const sourceHashes = requireObject(object.sourceHashes, 'migration marker.sourceHashes');
  if (
    Object.keys(sourceHashes).length === 0 ||
    Object.values(sourceHashes).some((hash) => !isSha256(hash))
  )
    throw new LocalStorageMigrationError('migration marker sourceHashes are invalid');
  const destination = requireObject(
    object.destinationChecksums,
    'migration marker.destinationChecksums'
  );
  const destinationChecksums = {} as Record<LocalStorageKey, string>;
  for (const key of LOCAL_STORAGE_KEYS) {
    if (!isSha256(destination[key]))
      throw new LocalStorageMigrationError(`migration marker checksum ${key} is invalid`);
    destinationChecksums[key] = (destination[key] as string).toLowerCase();
  }
  requireKind(object, 'completedAt', 'string', 'migration marker');
  if (!Number.isFinite(Date.parse(object.completedAt as string)))
    throw new LocalStorageMigrationError('migration marker completedAt is invalid');
  return {
    formatVersion: 1,
    source: object.source,
    sourceHashes: Object.fromEntries(
      Object.entries(sourceHashes).map(([name, hash]) => [name, (hash as string).toLowerCase()])
    ),
    destinationChecksums,
    completedAt: object.completedAt as string
  };
};

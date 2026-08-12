import type { StoreName } from '../../contracts/store';

/**
 * Shape validation for the stores found in the Nora profile.
 *
 * The importer copies store bytes verbatim — a verified copy, not a
 * transformation — so this layer validates just enough to guarantee the
 * destination app can boot on the data: the envelope (root object, payload
 * key, array-vs-object payload shape) is checked by `parseStoreText`, and the
 * element checks below verify the core fields the renderer hydrators rely on.
 *
 * Tolerance is deliberate: upstream Nora 3.1.0 stores carry OLDER schemas
 * (missing fork-era fields, older migration versions) and must not be
 * rejected. Unknown and extra fields never matter — they travel with the raw
 * bytes. The destination's own hydration runs its normal migrations against
 * the imported `__internal__.migrations.version`, exactly as it would for a
 * user who upgraded.
 */

type JsonObject = Record<string, unknown>;

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isString = (value: unknown): value is string => typeof value === 'string';

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isNonNegativeNumber = (value: unknown): value is number =>
  isFiniteNumber(value) && value >= 0;

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(isString);

const everyObject = (value: unknown): value is JsonObject[] =>
  Array.isArray(value) && value.every(isObject);

const hasStringField = (object: JsonObject, key: string): boolean =>
  typeof object[key] === 'string' && (object[key] as string).length > 0;

const optionalNonNegativeNumber = (object: JsonObject, key: string): boolean =>
  object[key] === undefined || isNonNegativeNumber(object[key]);

// ---------------------------------------------------------------------------

const isValidSong = (value: JsonObject): boolean =>
  hasStringField(value, 'songId') &&
  hasStringField(value, 'title') &&
  isFiniteNumber(value.duration) &&
  isString(value.path);

const isValidArtist = (value: JsonObject): boolean =>
  hasStringField(value, 'artistId') && hasStringField(value, 'name');

const isValidAlbum = (value: JsonObject): boolean =>
  hasStringField(value, 'albumId') && hasStringField(value, 'title');

const isValidGenre = (value: JsonObject): boolean =>
  hasStringField(value, 'genreId') && hasStringField(value, 'name');

const isValidPlaylist = (value: JsonObject): boolean =>
  hasStringField(value, 'playlistId') &&
  hasStringField(value, 'name') &&
  isStringArray(value.songs);

const isValidYearlyListeningRate = (value: unknown): boolean =>
  isObject(value) &&
  Number.isInteger(value.year) &&
  Array.isArray(value.listens) &&
  (value.listens as unknown[]).every(
    (pair) =>
      Array.isArray(pair) &&
      pair.length === 2 &&
      isFiniteNumber(pair[0]) &&
      isNonNegativeNumber(pair[1])
  );

const isValidListeningEntry = (value: JsonObject): boolean =>
  hasStringField(value, 'songId') &&
  optionalNonNegativeNumber(value, 'skips') &&
  optionalNonNegativeNumber(value, 'fullListens') &&
  optionalNonNegativeNumber(value, 'inNoOfPlaylists') &&
  Array.isArray(value.listens) &&
  (value.listens as unknown[]).every(isValidYearlyListeningRate) &&
  (value.seeks === undefined ||
    (Array.isArray(value.seeks) &&
      (value.seeks as unknown[]).every(
        (seek) =>
          isObject(seek) && isNonNegativeNumber(seek.position) && isNonNegativeNumber(seek.seeks)
      )));

const isValidBlacklist = (value: JsonObject): boolean =>
  isStringArray(value.songBlacklist) && isStringArray(value.folderBlacklist);

const isValidTierRow = (value: unknown): boolean => isObject(value) && isStringArray(value.items);

const isValidTierlist = (value: JsonObject): boolean =>
  hasStringField(value, 'tierlistId') &&
  hasStringField(value, 'name') &&
  isStringArray(value.sourcePlaylistIds) &&
  Array.isArray(value.tiers) &&
  (value.tiers as unknown[]).every(isValidTierRow) &&
  isString(value.labelMode);

const isValidEloData = (value: JsonObject): boolean =>
  isObject(value.elo) &&
  isObject(value.elo.ratings) &&
  !Array.isArray(value.elo.ratings) &&
  Array.isArray(value.elo.history) &&
  isNonNegativeNumber(value.elo.totalDuels);

const isValidCmrStats = (value: JsonObject): boolean =>
  isValidEloData(value) && isStringArray(value.importedStatsExportIds);

const isValidPalette = (value: JsonObject): boolean => hasStringField(value, 'paletteId');

const ARRAY_VALIDATORS: Partial<Record<StoreName, (value: JsonObject[]) => boolean>> = {
  songs: (value) => value.every(isValidSong),
  artists: (value) => value.every(isValidArtist),
  albums: (value) => value.every(isValidAlbum),
  genres: (value) => value.every(isValidGenre),
  playlists: (value) => value.every(isValidPlaylist),
  listeningData: (value) => value.every(isValidListeningEntry),
  tierlists: (value) => value.every(isValidTierlist),
  palettes: (value) => value.every(isValidPalette)
};

const OBJECT_VALIDATORS: Partial<Record<StoreName, (value: JsonObject) => boolean>> = {
  userData: () => true,
  blacklist: isValidBlacklist,
  cmrStats: isValidCmrStats
};

/**
 * Validates one store payload. Returns a human-readable failure message, or
 * undefined when the payload can be booted on as-is. The envelope (payload key
 * presence, array-vs-object root) is the caller's responsibility
 * (`parseStoreText`).
 */
export function validateNoraStorePayload(store: StoreName, payload: unknown): string | undefined {
  if (!isObject(payload) && !Array.isArray(payload)) return `payload must be an object or an array`;

  const arrayValidator = ARRAY_VALIDATORS[store];
  if (arrayValidator !== undefined) {
    if (!everyObject(payload)) return `must be an array of objects`;
    if (!arrayValidator(payload)) return `contains malformed entries`;
    return undefined;
  }

  const objectValidator = OBJECT_VALIDATORS[store];
  if (objectValidator !== undefined) {
    if (!isObject(payload)) return `must be an object`;
    if (!objectValidator(payload)) return `is malformed`;
    return undefined;
  }

  return undefined;
}

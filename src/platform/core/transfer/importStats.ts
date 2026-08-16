import { basename } from '../playlists/pathUtils';
import { logger } from '../playlists/logger';
import {
  countersFromLegacyRows,
  deriveListeningRows,
  mergeCounterFiles,
  trackKeyOf,
  type DayCounts,
  type ListeningCounterFile
} from '../stats/listeningEvents';
import { fingerprintOfSong, matchFingerprints } from '../stats/songFingerprint';
import { showOpenDialog } from '../playlists/dialog';
import { joinPath } from './joinPath';
import { md5Hex } from './md5';
import {
  importCollections,
  isValidExportedPlaylist,
  isValidExportPreferences,
  isValidTierlistExport
} from './importCollections';
import type { StatsTransferRepository } from './statsTransferRepository';

type StatsExportFileWithEvents = StatsExportFile & { events?: unknown };

/**
 * Port of `src/main/core/statsTransfer/importStats.ts` — the fork's "portable
 * everything" merge. It never trusts installation-local songIds or absolute
 * paths: songs are remapped by metadata fingerprint (file name / title /
 * artists / duration), everything is validated in memory BEFORE any write, the
 * current stats are backed up first, ambiguous matches are skipped and
 * sum-vs-max merge modes are offered. No store is imported directly.
 * Signature: `importStatsData(repo, mergeMode, source)`.
 */

const isDefined = <T>(value: T | undefined): value is T => value !== undefined;

const mergeScalar = (local = 0, foreign = 0, mergeMode: StatsMergeMode) =>
  mergeMode === 'separateDevices' ? local + foreign : Math.max(local, foreign);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isNonNegativeNumber = (value: unknown): value is number =>
  isFiniteNumber(value) && value >= 0;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// ---------------------------------------------------------------------------
// 1. Read + validate the import source fully in memory (before ANY write)
// ---------------------------------------------------------------------------

/** Accepts the folder itself or its parent (the folder exportAppData nests into). */
const resolveLegacyExportFolder = async (repo: StatsTransferRepository, folder: string) => {
  if (await repo.exists(joinPath(folder, 'listening_data.json'))) return folder;
  const nested = joinPath(folder, 'Nora exports');
  if (await repo.exists(joinPath(nested, 'listening_data.json'))) return nested;
  return folder;
};

const readLegacyExportFolder = async (
  repo: StatsTransferRepository,
  selectedFolder: string
): Promise<StatsExportFile> => {
  const folder = await resolveLegacyExportFolder(repo, selectedFolder);
  const [listeningRaw, songsRaw] = await Promise.all([
    repo.readTextFile(joinPath(folder, 'listening_data.json')),
    repo.readTextFile(joinPath(folder, 'songs.json'))
  ]);

  const listeningJson = JSON.parse(listeningRaw) as { listeningData?: unknown };
  const songsJson = JSON.parse(songsRaw) as { songs?: unknown };
  if (!Array.isArray(listeningJson.listeningData) || !Array.isArray(songsJson.songs))
    throw new Error('The selected folder does not contain valid Nora export files.');

  // Stock and older CMR exports do not contain this optional file. Asked for
  // rather than caught: a rejected read carries no `error.code` here, so an
  // absent file was indistinguishable from an unreadable one and the second was
  // being treated as the first.
  let elo: EloData | undefined;
  const cmrStatsPath = joinPath(folder, 'cmr_stats.json');
  if (await repo.exists(cmrStatsPath)) {
    const cmrStatsRaw = await repo.readTextFile(cmrStatsPath);
    const cmrStatsJson = JSON.parse(cmrStatsRaw) as { cmrStats?: { elo?: EloData } };
    elo = cmrStatsJson.cmrStats?.elo;
  }

  const foreignSongs = songsJson.songs as SavableSongData[];
  return {
    format: 'nora-cmr-stats-export',
    formatVersion: 1,
    exportId: `legacy-${md5Hex(listeningRaw)}`,
    exportedAt: '',
    appVersion: '',
    songs: foreignSongs.map((song) => ({
      songId: song.songId,
      title: song.title,
      artists: song.artists?.map((artist) => artist.name) ?? [],
      duration: song.duration,
      fileName: basename(song.path)
    })),
    listeningData: listeningJson.listeningData as SongListeningData[],
    ...(elo ? { elo } : {})
  };
};

const readImportSource = async (
  repo: StatsTransferRepository,
  source: StatsImportSource
): Promise<StatsExportFileWithEvents> => {
  if (source === 'folder') {
    const folders = await showOpenDialog({
      title: 'Select a "Nora exports" folder',
      directory: true
    });
    if (!folders[0]) throw new Error('PROMPT_CLOSED_BEFORE_INPUT');
    return readLegacyExportFolder(repo, folders[0]);
  }

  const files = await showOpenDialog({
    title: 'Select a stats export file',
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (!files[0]) throw new Error('PROMPT_CLOSED_BEFORE_INPUT');

  const raw = await repo.readTextFile(files[0]);
  const parsed = JSON.parse(raw) as StatsExportFileWithEvents;
  if (parsed.format !== 'nora-cmr-stats-export')
    throw new Error('The selected file is not a Nora stats export.');
  if (parsed.formatVersion !== 1) throw new Error('Unsupported stats export file version.');
  return parsed;
};

const isValidListeningEntry = (entry: SongListeningData): boolean =>
  !!entry &&
  typeof entry.songId === 'string' &&
  (entry.fullListens === undefined || isNonNegativeNumber(entry.fullListens)) &&
  (entry.skips === undefined || isNonNegativeNumber(entry.skips)) &&
  (entry.inNoOfPlaylists === undefined || isNonNegativeNumber(entry.inNoOfPlaylists)) &&
  (entry.seeks === undefined ||
    (Array.isArray(entry.seeks) &&
      entry.seeks.every(
        (seek) => !!seek && isNonNegativeNumber(seek.position) && isNonNegativeNumber(seek.seeks)
      ))) &&
  Array.isArray(entry.listens) &&
  entry.listens.every(
    (year) =>
      !!year &&
      Number.isInteger(year.year) &&
      Array.isArray(year.listens) &&
      year.listens.every(
        (pair) =>
          Array.isArray(pair) &&
          pair.length === 2 &&
          isFiniteNumber(pair[0]) &&
          isNonNegativeNumber(pair[1])
      )
  );

const isValidFingerprint = (song: SongFingerprint): boolean =>
  !!song &&
  typeof song.songId === 'string' &&
  typeof song.title === 'string' &&
  typeof song.fileName === 'string' &&
  isNonNegativeNumber(song.duration) &&
  Array.isArray(song.artists) &&
  song.artists.every((artist) => typeof artist === 'string');

/** 24 local hours, keyed as plain strings so the file stays readable. */
const isValidHourHistogram = (value: unknown): boolean =>
  isRecord(value) &&
  Object.entries(value).every(([hour, count]) => {
    const index = Number(hour);
    return Number.isInteger(index) && index >= 0 && index <= 23 && isNonNegativeNumber(count);
  });

const isValidDayCounts = (value: unknown): value is DayCounts =>
  isRecord(value) &&
  Object.entries(value).every(([metric, count]) => {
    // `h` arrived with hour-of-day statistics and is optional by design: an
    // export written before it existed has none, and one written after it must
    // not be rejected by an older validator that never heard of it. Rejecting
    // here would silently drop the whole events block and fall back to the
    // aggregate path, which is exactly the kind of quiet downgrade this
    // subsystem is supposed to be free of.
    if (metric === 'h') return isValidHourHistogram(count);
    return (metric === 'l' || metric === 'f' || metric === 's') && isNonNegativeNumber(count);
  });

const isValidLocalDay = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
};

const isValidEventsBlock = (
  value: unknown,
  exportedSongs: readonly SongFingerprint[]
): value is ListeningCounterFile => {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.installId !== 'string' ||
    value.installId.length === 0 ||
    !isRecord(value.tracks) ||
    !isRecord(value.counters)
  )
    return false;

  const referencedKeys = new Set(exportedSongs.map(trackKeyOf));
  for (const [key, identity] of Object.entries(value.tracks)) {
    if (
      !isValidFingerprint(identity as SongFingerprint) ||
      trackKeyOf(identity as SongFingerprint) !== key ||
      !referencedKeys.has(key)
    )
      return false;
  }

  for (const [key, sources] of Object.entries(value.counters)) {
    if (!Object.prototype.hasOwnProperty.call(value.tracks, key) || !isRecord(sources))
      return false;
    for (const [sourceId, days] of Object.entries(sources)) {
      if (sourceId.length === 0 || !isRecord(days)) return false;
      for (const [day, counts] of Object.entries(days)) {
        if (!isValidLocalDay(day) || !isValidDayCounts(counts)) return false;
      }
    }
  }
  return true;
};

const isValidEloData = (elo: EloData): boolean => {
  if (
    !elo ||
    typeof elo !== 'object' ||
    !elo.ratings ||
    typeof elo.ratings !== 'object' ||
    Array.isArray(elo.ratings) ||
    !Array.isArray(elo.history) ||
    !isNonNegativeNumber(elo.totalDuels)
  )
    return false;

  const ratingsAreValid = Object.values(elo.ratings).every(
    (rating) =>
      !!rating &&
      isFiniteNumber(rating.rating) &&
      isNonNegativeNumber(rating.games) &&
      isNonNegativeNumber(rating.wins) &&
      isNonNegativeNumber(rating.losses) &&
      (rating.draws === undefined || isNonNegativeNumber(rating.draws)) &&
      (rating.lastDuelAt === undefined || isNonNegativeNumber(rating.lastDuelAt))
  );
  if (!ratingsAreValid) return false;

  return elo.history.every(
    (record) =>
      !!record &&
      isNonNegativeNumber(record.at) &&
      typeof record.songAId === 'string' &&
      typeof record.songBId === 'string' &&
      (record.winner === 'A' || record.winner === 'B' || record.winner === 'draw') &&
      isFiniteNumber(record.deltaA) &&
      isFiniteNumber(record.deltaB)
  );
};

/** Validates EVERY imported listening entry — a single bad entry aborts the whole import. */
const validateExportData = (data: StatsExportFileWithEvents): string | undefined => {
  if (!data || typeof data !== 'object') return 'The import file is not a valid stats export.';
  if (!Array.isArray(data.songs) || !Array.isArray(data.listeningData))
    return 'The import file is missing song or listening data.';
  if (typeof data.exportId !== 'string' || data.exportId.length === 0)
    return 'The import file is missing its export id.';
  if (!data.songs.every(isValidFingerprint))
    return 'The import file contains malformed song fingerprints.';
  if (!data.listeningData.every(isValidListeningEntry))
    return 'The import file contains malformed listening data.';
  if (data.elo !== undefined && !isValidEloData(data.elo))
    return 'The import file contains malformed ELO data.';
  return undefined;
};

// ---------------------------------------------------------------------------
// 2. Fingerprint matching (foreign song -> local songId; songIds are random per install)
// ---------------------------------------------------------------------------

// One matcher for the whole app: the same rules reattach a row after a library
// rebuild and move one between two installs. Two copies would eventually
// disagree, and a track that reattaches locally but not on import (or the other
// way round) is a bug nobody would think to look for.
const matchForeignSongs = matchFingerprints;

// ---------------------------------------------------------------------------
// 3. Merge
// ---------------------------------------------------------------------------

/** Buckets listen records by CALENDAR DAY — raw ms are never compared across devices. */
const bucketListensByDay = (listens: YearlyListeningRate[]) => {
  const dayMap = new Map<number, number>(); // dayStartMs -> count
  for (const year of listens ?? [])
    for (const [ms, count] of year.listens ?? []) {
      const date = new Date(ms);
      const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
      dayMap.set(dayStart, (dayMap.get(dayStart) ?? 0) + count);
    }
  return dayMap;
};

const rebuildYearlyListens = (dayMap: Map<number, number>): YearlyListeningRate[] => {
  const byYear = new Map<number, [number, number][]>();
  const sortedDays = [...dayMap.entries()].sort((a, b) => a[0] - b[0]);
  for (const [dayStartMs, count] of sortedDays) {
    const year = new Date(dayStartMs).getFullYear();
    const list = byYear.get(year);
    const pair: [number, number] = [dayStartMs, count];
    if (list) list.push(pair);
    else byYear.set(year, [pair]);
  }
  return [...byYear.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, listens]) => ({ year, listens }));
};

/** ±5s position clustering (mirrors updateSeeksArray), capped at 100 entries. */
const mergeSeeks = (
  localSeeks: SongSeek[] = [],
  foreignSeeks: SongSeek[] = [],
  mergeMode: StatsMergeMode
): SongSeek[] => {
  const merged = localSeeks.map((seek) => ({ ...seek }));
  for (const foreignSeek of foreignSeeks) {
    const cluster = merged.find(
      (seek) => foreignSeek.position < seek.position + 5 && foreignSeek.position > seek.position - 5
    );
    if (cluster) cluster.seeks = mergeScalar(cluster.seeks, foreignSeek.seeks, mergeMode);
    else merged.push({ ...foreignSeek });
  }
  return merged.slice(0, 100);
};

const mergeListeningEntry = (
  localEntry: SongListeningData | undefined,
  foreignEntry: SongListeningData,
  localSongId: string,
  mergeMode: StatsMergeMode
): SongListeningData => {
  const mergedDays = bucketListensByDay(localEntry?.listens ?? []);
  const foreignDays = bucketListensByDay(foreignEntry.listens);
  for (const [dayStartMs, count] of foreignDays) {
    const localCount = mergedDays.get(dayStartMs);
    mergedDays.set(
      dayStartMs,
      localCount === undefined ? count : mergeScalar(localCount, count, mergeMode)
    );
  }

  const merged: SongListeningData = {
    songId: localSongId,
    listens: rebuildYearlyListens(mergedDays)
  };

  const fullListens = mergeScalar(localEntry?.fullListens, foreignEntry.fullListens, mergeMode);
  const skips = mergeScalar(localEntry?.skips, foreignEntry.skips, mergeMode);
  if (fullListens > 0) merged.fullListens = fullListens;
  if (skips > 0) merged.skips = skips;
  // inNoOfPlaylists is derived from local playlists — the foreign value is meaningless here.
  if (localEntry?.inNoOfPlaylists) merged.inNoOfPlaylists = localEntry.inNoOfPlaylists;
  const seeks = mergeSeeks(localEntry?.seeks, foreignEntry.seeks, mergeMode);
  if (seeks.length > 0) merged.seeks = seeks;

  return merged;
};

const mergeListeningData = (
  exportData: StatsExportFile,
  matches: Map<string, string>,
  mergeMode: StatsMergeMode,
  localListeningData: SongListeningData[]
) => {
  // Untouched local entries keep their original object references (byte-identical passthrough).
  const mergedById = new Map(localListeningData.map((entry) => [entry.songId, entry]));
  const touchedIds = new Set<string>();
  let matchedSongs = 0;
  let unmatchedSongs = 0;

  for (const foreignEntry of exportData.listeningData) {
    const localSongId = matches.get(foreignEntry.songId);
    if (!localSongId) {
      unmatchedSongs += 1;
      continue;
    }
    matchedSongs += 1;
    mergedById.set(
      localSongId,
      mergeListeningEntry(mergedById.get(localSongId), foreignEntry, localSongId, mergeMode)
    );
    touchedIds.add(localSongId);
  }

  return {
    listeningData: [...mergedById.values()],
    matchedSongs,
    unmatchedSongs,
    mergedEntries: touchedIds.size
  };
};

const normalizeRating = (rating: EloSongRating): EloSongRating => ({
  rating: typeof rating?.rating === 'number' ? rating.rating : 1200,
  games: typeof rating?.games === 'number' ? rating.games : 0,
  wins: typeof rating?.wins === 'number' ? rating.wins : 0,
  losses: typeof rating?.losses === 'number' ? rating.losses : 0,
  draws: typeof rating?.draws === 'number' ? rating.draws : 0,
  ...(typeof rating?.lastDuelAt === 'number' ? { lastDuelAt: rating.lastDuelAt } : {})
});

const mergeEloData = (
  foreignElo: EloData | undefined,
  localElo: EloData,
  matches: Map<string, string>,
  mergeMode: StatsMergeMode
) => {
  if (!foreignElo || typeof foreignElo !== 'object') return { elo: localElo, merged: false };

  const ratings: Record<string, EloSongRating> = { ...localElo.ratings };
  for (const [foreignSongId, foreignRatingRaw] of Object.entries(foreignElo.ratings ?? {})) {
    const localSongId = matches.get(foreignSongId);
    if (!localSongId) continue;

    const foreignRating = normalizeRating(foreignRatingRaw);
    const localRating = ratings[localSongId];
    if (!localRating) {
      ratings[localSongId] = foreignRating;
      continue;
    }

    const games = mergeScalar(localRating.games, foreignRating.games, mergeMode);
    const wins = mergeScalar(localRating.wins, foreignRating.wins, mergeMode);
    const losses = mergeScalar(localRating.losses, foreignRating.losses, mergeMode);
    const draws = mergeScalar(localRating.draws ?? 0, foreignRating.draws ?? 0, mergeMode);
    const totalGamesWeight = localRating.games + foreignRating.games;
    // A song rated on both sides keeps the games-weighted mean of both ratings.
    const rating =
      totalGamesWeight > 0
        ? Math.round(
            ((localRating.rating * localRating.games + foreignRating.rating * foreignRating.games) /
              totalGamesWeight) *
              10
          ) / 10
        : 1200;
    const lastDuelAt = Math.max(localRating.lastDuelAt ?? 0, foreignRating.lastDuelAt ?? 0);

    ratings[localSongId] = {
      rating,
      games,
      wins,
      losses,
      draws,
      ...(lastDuelAt > 0 ? { lastDuelAt } : {})
    };
  }

  const remappedForeignHistory = (Array.isArray(foreignElo.history) ? foreignElo.history : [])
    .map((record) => {
      const songAId = matches.get(record.songAId);
      const songBId = matches.get(record.songBId);
      if (!songAId || !songBId) return undefined;
      return { ...record, songAId, songBId };
    })
    .filter(isDefined);

  const combinedHistory = [...localElo.history, ...remappedForeignHistory];
  const historySource =
    mergeMode === 'sameOrigin'
      ? [
          ...new Map(
            combinedHistory.map((record) => [
              [
                record.at,
                record.songAId,
                record.songBId,
                record.winner,
                record.deltaA,
                record.deltaB
              ].join('|'),
              record
            ])
          ).values()
        ]
      : combinedHistory;
  const history = historySource.sort((a, b) => b.at - a.at).slice(0, 1000);

  const totalDuels = mergeScalar(localElo.totalDuels, foreignElo.totalDuels, mergeMode);

  return { elo: { ratings, history, totalDuels }, merged: true };
};

// ---------------------------------------------------------------------------
// 4. Backup (before the single write)
// ---------------------------------------------------------------------------

const BACKED_UP_STORE_FILES = [
  'listening_data.json',
  'listening_events.json',
  'cmr_stats.json',
  'playlists.json',
  'tierlists.json'
];

const backupCurrentStatsFiles = async (repo: StatsTransferRepository) => {
  const userDataPath = await repo.profilePath();
  const backupsFolder = joinPath(userDataPath, 'backups');
  await repo.makeDir(backupsFolder);

  const epoch = Date.now();
  let firstBackupPath: string | undefined;

  for (const fileName of BACKED_UP_STORE_FILES) {
    const source = joinPath(userDataPath, fileName);
    // A store that was never written is not a failure: cmr_stats.json appears
    // with the first duel, tierlists.json with the first tierlist. This used to
    // be handled by letting the copy fail and matching `error.code === 'ENOENT'`
    // on the rejection - a shape nothing in this app produces, because the copy
    // commands reject with a bare string. Every install where one of these five
    // files was absent, or where the copy failed for any other reason, refused
    // the whole import with "Failed to create a backup".
    if (!(await repo.exists(source))) continue;

    const destination = joinPath(backupsFolder, `${fileName}.backup.${epoch}.json`);
    await repo.copyFileAtomic(source, destination);
    if (!firstBackupPath) firstBackupPath = destination;
  }

  return firstBackupPath;
};

// ---------------------------------------------------------------------------

const importStatsData = async (
  repo: StatsTransferRepository,
  mergeMode: StatsMergeMode,
  source: StatsImportSource
): Promise<StatsImportReport> => {
  const fail = (message?: string): StatsImportReport => ({
    success: false,
    ...(message ? { message } : {}),
    matchedSongs: 0,
    unmatchedSongs: 0,
    mergedListens: 0,
    eloMerged: false
  });

  if (mergeMode !== 'separateDevices' && mergeMode !== 'sameOrigin')
    return fail('Unknown stats merge mode.');
  if (source !== 'file' && source !== 'folder') return fail('Unknown stats import source.');

  // 1. Read + validate everything fully in memory — before ANY write.
  let exportData: StatsExportFileWithEvents;
  try {
    exportData = await readImportSource(repo, source);
  } catch (error) {
    if ((error as Error).message === 'PROMPT_CLOSED_BEFORE_INPUT') return fail();
    logger.error('Failed to read the stats import source.', { error, source });
    return fail((error as Error).message || 'Failed to read the selected import source.');
  }

  const validationError = validateExportData(exportData);
  if (validationError) {
    logger.warn('Stats import aborted: invalid import data.', { validationError, source });
    return fail(validationError);
  }

  // Optional blocks never abort the import — a malformed one is skipped with a note.
  const blockNotes: string[] = [];
  if (
    exportData.playlists !== undefined &&
    !(Array.isArray(exportData.playlists) && exportData.playlists.every(isValidExportedPlaylist))
  ) {
    blockNotes.push('Skipped a malformed playlists block.');
    exportData = { ...exportData, playlists: undefined };
  }
  if (
    exportData.tierlists !== undefined &&
    !(Array.isArray(exportData.tierlists) && exportData.tierlists.every(isValidTierlistExport))
  ) {
    blockNotes.push('Skipped a malformed tierlists block.');
    exportData = { ...exportData, tierlists: undefined };
  }
  if (exportData.preferences !== undefined && !isValidExportPreferences(exportData.preferences)) {
    blockNotes.push('Skipped malformed preferences.');
    exportData = { ...exportData, preferences: undefined };
  }

  let foreignEvents: ListeningCounterFile | undefined;
  if (exportData.events !== undefined) {
    if (isValidEventsBlock(exportData.events, exportData.songs)) foreignEvents = exportData.events;
    else blockNotes.push('Skipped a malformed events block.');
  }

  const cmrStats = repo.getCmrStatsData();

  // Double-import guard: summing the same export twice would double every number.
  if (
    mergeMode === 'separateDevices' &&
    cmrStats.importedStatsExportIds.includes(exportData.exportId)
  ) {
    return { ...fail('This export was already imported.'), alreadyImported: true };
  }

  // 2. Fingerprint-match + merge fully in memory.
  const songs = repo.getSongsData();
  const matches = matchForeignSongs(exportData.songs, songs);
  const mergedListening = mergeListeningData(
    exportData,
    matches,
    mergeMode,
    repo.getListeningData()
  );
  const mergedElo = mergeEloData(exportData.elo, cmrStats.elo, matches, mergeMode);
  const localCounters = repo.getListeningCounters();
  const songById = new Map(songs.map((song) => [song.songId, song]));
  const counters = foreignEvents
    ? mergeCounterFiles(localCounters, foreignEvents)
    : countersFromLegacyRows(
        mergedListening.listeningData.map((row) => {
          if (row.fingerprint) return row;
          const song = songById.get(row.songId);
          return song ? { ...row, fingerprint: fingerprintOfSong(song) } : row;
        }),
        `stats-export-${md5Hex(exportData.exportId)}`,
        localCounters.installId
      ).file;
  const listeningData = foreignEvents
    ? deriveListeningRows(counters, songs, mergedListening.listeningData)
    : mergedListening.listeningData;

  // 3. Backup the current files before touching them.
  let backupPath: string | undefined;
  try {
    backupPath = await backupCurrentStatsFiles(repo);
  } catch (error) {
    logger.error('Stats import aborted: failed to create a backup.', { error });
    return fail('Failed to create a backup before importing. Nothing was changed.');
  }

  // 4. Single write via the existing setters.
  repo.saveListeningCounters(counters);
  repo.saveListeningData(listeningData);
  repo.setCmrStatsData({
    elo: mergedElo.elo,
    importedStatsExportIds: cmrStats.importedStatsExportIds.includes(exportData.exportId)
      ? cmrStats.importedStatsExportIds
      : [...cmrStats.importedStatsExportIds, exportData.exportId]
  });

  // 5. Playlists + tierlists (no-ops for exports that don't carry them).
  const collections = importCollections(repo, exportData, matches);

  // 6. Refresh listeners — no app restart needed.
  repo.emitDataUpdate('songs/listeningData');
  repo.emitDataUpdate('eloDuels');

  logger.info('Stats data imported successfully.', {
    source,
    mergeMode,
    matchedSongs: mergedListening.matchedSongs,
    unmatchedSongs: mergedListening.unmatchedSongs,
    backupPath
  });

  const notes = [...blockNotes, ...collections.notes];
  return {
    success: true,
    matchedSongs: mergedListening.matchedSongs,
    unmatchedSongs: mergedListening.unmatchedSongs,
    mergedListens: mergedListening.mergedEntries,
    eloMerged: mergedElo.merged,
    ...(collections.playlistsImported > 0
      ? { playlistsImported: collections.playlistsImported }
      : {}),
    ...(collections.tierlistsImported > 0
      ? { tierlistsImported: collections.tierlistsImported }
      : {}),
    ...(exportData.preferences ? { importedPreferences: exportData.preferences } : {}),
    ...(notes.length > 0 ? { notes } : {}),
    ...(backupPath ? { backupPath } : {})
  };
};

export default importStatsData;

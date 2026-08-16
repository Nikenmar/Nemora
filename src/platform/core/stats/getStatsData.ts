import { getEffectiveEloRating, getEloConfidence } from './duelMatchmaker';
import { trackKeyOf, type ListeningCounterFile } from './listeningEvents';
import { fingerprintOfSong } from './songFingerprint';

/**
 * Stats dashboard aggregation (fork identity: exact bucket/streak semantics).
 *
 * Port of `src/main/core/getStatsData.ts`. Library, stats and artwork-path
 * data arrive through the injected `StatsDataRepo` — no store is imported
 * directly. Signature: `getStatsData(repo, timeRange)`.
 */

export interface StatsDataRepo {
  getSongsData(): SavableSongData[];
  getListeningData(): SongListeningData[];
  getListeningCounters(): ListeningCounterFile;
  getPlaylistData(playlistIds?: string[]): SavablePlaylist[];
  getGenresData(): SavableGenre[];
  getCmrStatsData(): CmrStatsData;
  getSongArtworkPath(songId: string, isArtworkAvailable: boolean): ArtworkPaths;
  isSongBlacklisted(songId: string, songPath: string): boolean;
  logger: { debug(message: string, data?: object): void };
}

const DAY_MS = 24 * 60 * 60 * 1000;

const isDefined = <T>(value: T | undefined): value is T => value !== undefined;

const getRangeStart = (timeRange: StatsTimeRange, now: number) => {
  if (timeRange === 'last30Days') return now - 30 * DAY_MS;
  if (timeRange === 'last12Months') return now - 365 * DAY_MS;
  return 0;
};

const yearOfRange = (timeRange: StatsTimeRange): number | null => {
  if (!timeRange.startsWith('year:')) return null;
  const year = Number(timeRange.slice('year:'.length));
  return Number.isInteger(year) && year >= 0 && year <= 9999 ? year : null;
};

interface RangeFilter {
  start: number;
  year: number | null;
}

const inRange = (dateMs: number, range: RangeFilter): boolean =>
  range.year === null ? dateMs >= range.start : dayInfo(dateMs).year === range.year;

/** Sums day-counts across all yearly buckets, keeping only days inside the range. */
const countListensInRange = (data: SongListeningData, range: RangeFilter) => {
  let count = 0;
  for (const year of data.listens)
    for (const [dateMs, dayCount] of year.listens) if (inRange(dateMs, range)) count += dayCount;
  return count;
};

/** What every listening row needs to know about the day it fell on. */
interface DayInfo {
  /** Local midnight of that day, in epoch milliseconds. */
  start: number;
  year: number;
  month: number;
  /** Monday is 0 and Sunday is 6. */
  weekday: number;
}

/**
 * One Date per DAY in the history, not one per listening row.
 *
 * The obvious spelling - `new Date(d.getFullYear(), d.getMonth(), d.getDate())`
 * - allocates two Dates per row, and the calendar and the activity chart each
 * walk every listening row there is: 69 700 rows in a three-year history, so a
 * quarter of a million Date objects to draw one dashboard. That allocation, not
 * the arithmetic, was most of what the page cost.
 *
 * Keyed by UTC day, which is what keeps the cache bounded: a whole history is a
 * few thousand days however many times its songs were played. Two approximations
 * are deliberate and both are absorbed by the day-rounding every caller does:
 * the local offset is read at the timestamp rather than at its own midnight, and
 * one UTC day is assumed to have one offset - which is untrue only on the two
 * daylight-saving days a year, and then only by an hour.
 */
const dayCache = new Map<number, DayInfo>();

const dayInfo = (dateMs: number): DayInfo => {
  const utcDay = Math.floor(dateMs / DAY_MS);
  const cached = dayCache.get(utcDay);
  if (cached) return cached;

  const date = new Date(dateMs);
  const offsetMs = date.getTimezoneOffset() * 60_000;
  const info: DayInfo = {
    start: Math.floor((dateMs - offsetMs) / DAY_MS) * DAY_MS + offsetMs,
    year: date.getFullYear(),
    month: date.getMonth(),
    weekday: (date.getDay() + 6) % 7
  };
  dayCache.set(utcDay, info);
  return info;
};

const toISODate = (ms: number) => {
  const date = new Date(ms);
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
};

/**
 * Activity buckets. Monthly ranges produce 12 buckets ending at the current
 * month; last30Days produces 30 daily buckets ending today. Labels are ISO
 * dates of the bucket start — the renderer localizes them.
 */
const buildActivity = (
  listeningData: SongListeningData[],
  timeRange: StatsTimeRange,
  nowMs: number
) => {
  const now = new Date(nowMs);
  const selectedYear = yearOfRange(timeRange);

  if (selectedYear !== null) {
    const buckets = new Array<number>(12).fill(0);

    for (const entry of listeningData)
      for (const year of entry.listens)
        for (const [dateMs, count] of year.listens) {
          const day = dayInfo(dateMs);
          if (day.year === selectedYear) buckets[day.month] += count;
        }

    return buckets.map((listens, month) => ({
      label: toISODate(new Date(selectedYear, month, 1).getTime()),
      listens
    }));
  }

  if (timeRange === 'last30Days') {
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const buckets = new Array<number>(30).fill(0);

    for (const entry of listeningData)
      for (const year of entry.listens)
        for (const [dateMs, count] of year.listens) {
          const daysAgo = Math.round((startOfToday - dayInfo(dateMs).start) / DAY_MS);
          if (daysAgo >= 0 && daysAgo < 30) buckets[29 - daysAgo] += count;
        }

    return buckets.map((listens, i) => ({
      label: toISODate(startOfToday - (29 - i) * DAY_MS),
      listens
    }));
  }

  const nowMonthIndex = now.getFullYear() * 12 + now.getMonth();
  const buckets = new Array<number>(12).fill(0);

  for (const entry of listeningData)
    for (const year of entry.listens)
      for (const [dateMs, count] of year.listens) {
        const day = dayInfo(dateMs);
        const monthsAgo = nowMonthIndex - (day.year * 12 + day.month);
        if (monthsAgo >= 0 && monthsAgo < 12) buckets[11 - monthsAgo] += count;
      }

  return buckets.map((listens, i) => {
    const monthIndex = nowMonthIndex - (11 - i);
    const year = Math.floor(monthIndex / 12);
    const month = ((monthIndex % 12) + 12) % 12;
    return { label: toISODate(new Date(year, month, 1).getTime()), listens };
  });
};

const getAvailableYears = (listeningData: readonly SongListeningData[]): number[] => {
  const years = new Set<number>();
  for (const entry of listeningData)
    for (const yearly of entry.listens)
      for (const [dateMs, count] of yearly.listens) if (count > 0) years.add(dayInfo(dateMs).year);
  return [...years].sort((first, second) => second - first);
};

const buildWeekdayHistogram = (
  listeningData: readonly SongListeningData[],
  range: RangeFilter
): number[] => {
  const histogram = new Array<number>(7).fill(0);
  for (const entry of listeningData)
    for (const yearly of entry.listens)
      for (const [dateMs, count] of yearly.listens)
        if (inRange(dateMs, range)) histogram[dayInfo(dateMs).weekday] += count;
  return histogram;
};

const localDayStart = (day: string): number => {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year, month - 1, date).getTime();
};

const buildHourStats = (
  file: ListeningCounterFile,
  currentTrackKeys: ReadonlySet<string>,
  range: RangeFilter
): { histogram: number[]; dataSince: number | null } => {
  const histogram = new Array<number>(24).fill(0);
  let dataSince: number | null = null;

  for (const [trackKey, sources] of Object.entries(file.counters)) {
    if (!currentTrackKeys.has(trackKey)) continue;
    for (const days of Object.values(sources)) {
      for (const [day, counts] of Object.entries(days)) {
        if (counts.h === undefined) continue;
        const dayStart = localDayStart(day);
        if (dataSince === null || dayStart < dataSince) dataSince = dayStart;
        if (!inRange(dayStart, range)) continue;
        for (const [hourText, count] of Object.entries(counts.h)) {
          const hour = Number(hourText);
          if (Number.isInteger(hour) && hour >= 0 && hour < 24) histogram[hour] += count;
        }
      }
    }
  }

  return { histogram, dataSince };
};

const scopes: StatsScopes = {
  totalListens: 'range',
  fullListens: 'allTime',
  skips: 'allTime',
  distinctSongsPlayed: 'range',
  approxListeningTimeSec: 'range',
  favorites: 'range',
  activity: 'range',
  calendar: 'allTime',
  topSongs: 'range',
  topArtists: 'range',
  topAlbums: 'range',
  topGenres: 'range',
  mostSkipped: 'allTime',
  elo: 'allTime'
};

/**
 * Range-independent GitHub-style activity calendar: always the trailing 53
 * weeks (371 days) ending today, plus streak stats. Consumed by the renderer
 * as 7 weekday rows x N week columns.
 */
const buildCalendar = (listeningData: SongListeningData[], nowMs: number) => {
  const dayCount = 371;
  const now = new Date(nowMs);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const days = new Array<number>(dayCount).fill(0);

  for (const entry of listeningData)
    for (const year of entry.listens)
      for (const [dateMs, count] of year.listens) {
        const daysAgo = Math.round((startOfToday - dayInfo(dateMs).start) / DAY_MS);
        if (daysAgo >= 0 && daysAgo < dayCount) days[dayCount - 1 - daysAgo] += count;
      }

  // Current streak counts back from today; a silent (so far) today does not kill it.
  let currentStreak = 0;
  let cursor = dayCount - 1;
  if (days[cursor] === 0) cursor -= 1;
  while (cursor >= 0 && days[cursor] > 0) {
    currentStreak += 1;
    cursor -= 1;
  }

  let longestStreak = 0;
  let run = 0;
  let mostActiveDay: { date: string; listens: number } | null = null;
  for (let i = 0; i < dayCount; i += 1) {
    run = days[i] > 0 ? run + 1 : 0;
    if (run > longestStreak) longestStreak = run;
    if (days[i] > 0 && (!mostActiveDay || days[i] > mostActiveDay.listens))
      mostActiveDay = {
        date: toISODate(startOfToday - (dayCount - 1 - i) * DAY_MS),
        listens: days[i]
      };
  }

  return {
    days: days.map((listens, i) => ({
      date: toISODate(startOfToday - (dayCount - 1 - i) * DAY_MS),
      listens
    })),
    currentStreak,
    longestStreak,
    mostActiveDay
  };
};

const getStatsData = (repo: StatsDataRepo, timeRange: StatsTimeRange): StatsData => {
  const now = Date.now();
  const range: RangeFilter = { start: getRangeStart(timeRange, now), year: yearOfRange(timeRange) };

  const songs = repo.getSongsData();
  const elo = repo.getCmrStatsData().elo;

  const songById = new Map(songs.map((song) => [song.songId, song]));

  // Only rows that still name a track in the library.
  //
  // The page used to mix two populations and looked broken because of it: the
  // headline counters summed every row, while time listened, top songs, top
  // artists and top albums could only ever include rows whose song was found.
  // A profile whose library had been rebuilt showed 24 190 listens over 1280
  // songs above a top-songs list whose entries added up to 198 - both numbers
  // computed from the same file, neither of them wrong on its own.
  //
  // Detached rows are NOT discarded from the profile: they are kept so that
  // rescanning the same music reattaches them (see `relinkOrphanedListeningRows`).
  // They just do not count while the music they belong to is not in the library.
  const listeningData = repo.getListeningData().filter((entry) => songById.has(entry.songId));
  const currentTrackKeys = new Set(songs.map((song) => trackKeyOf(fingerprintOfSong(song))));
  const hourStats = buildHourStats(repo.getListeningCounters(), currentTrackKeys, range);

  // listens per song inside the selected range
  const listensBySongId = new Map<string, number>();
  let totalListens = 0;
  let fullListens = 0;
  let skips = 0;
  for (const entry of listeningData) {
    const listensInRange = countListensInRange(entry, range);
    listensBySongId.set(entry.songId, listensInRange);
    totalListens += listensInRange;
    fullListens += entry.fullListens ?? 0;
    skips += entry.skips ?? 0;
  }

  const favorites = repo.getPlaylistData(['Favorites'])[0]?.songs.length ?? 0;

  let approxListeningTimeSec = 0;
  for (const [songId, count] of listensBySongId) {
    const song = songById.get(songId);
    if (song) approxListeningTimeSec += count * song.duration;
  }

  const isVisibleSong = (song: SavableSongData | undefined): song is SavableSongData =>
    !!song && !repo.isSongBlacklisted(song.songId, song.path);

  const toSongEntry = (song: SavableSongData, listensInRange: number): StatsSongEntry => ({
    songId: song.songId,
    title: song.title,
    artists: song.artists?.map((artist) => artist.name) ?? [],
    artworkPath: repo.getSongArtworkPath(song.songId, song.isArtworkAvailable).artworkPath,
    listensInRange
  });

  // ----- top songs -----
  const topSongs = songs
    .filter((song) => (listensBySongId.get(song.songId) ?? 0) > 0 && isVisibleSong(song))
    .map((song) => toSongEntry(song, listensBySongId.get(song.songId) ?? 0))
    .sort((a, b) => b.listensInRange - a.listensInRange || a.title.localeCompare(b.title))
    .slice(0, 25);

  // ----- top artists / albums / genres (song-side joins) -----
  const artistListens = new Map<string, StatsNameEntry>();
  const albumListens = new Map<string, StatsNameEntry>();
  const genreListens = new Map<string, StatsNameEntry>();

  for (const song of songs) {
    const listens = listensBySongId.get(song.songId) ?? 0;
    if (listens === 0 || !isVisibleSong(song)) continue;

    for (const artist of song.artists ?? []) {
      const key = artist.artistId || artist.name.trim().toLowerCase();
      const entry = artistListens.get(key) ?? {
        name: artist.name,
        artistId: artist.artistId,
        listens: 0
      };
      entry.listens += listens;
      artistListens.set(key, entry);
    }

    if (song.album) {
      const key = song.album.albumId || song.album.name.trim().toLowerCase();
      const entry = albumListens.get(key) ?? { name: song.album.name, listens: 0 };
      entry.listens += listens;
      albumListens.set(key, entry);
    }

    for (const genre of song.genres ?? []) {
      const key = genre.genreId || genre.name.trim().toLowerCase();
      const entry = genreListens.get(key) ?? { name: genre.name, listens: 0 };
      entry.listens += listens;
      genreListens.set(key, entry);
    }
  }

  // Fallback for libraries where songs carry no genre refs: aggregate via the genre store.
  if (genreListens.size === 0) {
    for (const genre of repo.getGenresData()) {
      let listens = 0;
      for (const genreSong of genre.songs) {
        if (isVisibleSong(songById.get(genreSong.songId)))
          listens += listensBySongId.get(genreSong.songId) ?? 0;
      }
      if (listens > 0) genreListens.set(genre.genreId, { name: genre.name, listens });
    }
  }

  const byListensDesc = (a: StatsNameEntry, b: StatsNameEntry) =>
    b.listens - a.listens || a.name.localeCompare(b.name);

  const topArtists = [...artistListens.values()].sort(byListensDesc).slice(0, 10);
  const topAlbums = [...albumListens.values()].sort(byListensDesc).slice(0, 10);
  const topGenres = [...genreListens.values()].sort(byListensDesc).slice(0, 10);

  // ----- most skipped (all-time skips scalar) -----
  const mostSkipped = listeningData
    .filter((entry) => (entry.skips ?? 0) > 0)
    .map((entry) => {
      const song = songById.get(entry.songId);
      if (!isVisibleSong(song)) return undefined;
      return {
        ...toSongEntry(song, listensBySongId.get(entry.songId) ?? 0),
        skips: entry.skips ?? 0
      };
    })
    .filter(isDefined)
    .sort((a, b) => (b.skips ?? 0) - (a.skips ?? 0) || a.title.localeCompare(b.title))
    .slice(0, 10);

  // ----- ELO -----
  const topRated = Object.entries(elo.ratings)
    .filter(([, rating]) => rating.games > 0)
    .map(([songId, rating]) => {
      const song = songById.get(songId);
      if (!isVisibleSong(song)) return undefined;
      return {
        ...toSongEntry(song, listensBySongId.get(songId) ?? 0),
        rating: rating.rating,
        effectiveRating: getEffectiveEloRating(rating),
        isProvisional: getEloConfidence(rating) < 1,
        games: rating.games,
        wins: rating.wins,
        losses: rating.losses,
        draws: rating.draws ?? 0
      };
    })
    .filter(isDefined)
    .sort((a, b) => b.effectiveRating - a.effectiveRating || a.title.localeCompare(b.title))
    .slice(0, 10);

  // Duels whose songs left the library are KEPT in the store now, so that
  // re-adding the music brings the duel record back with it. Until then they
  // have no titles to show, and a list of "? beat ?" is worse than a shorter
  // list, so they are filtered out here rather than rendered blank.
  const recentDuels = elo.history
    .filter((duel) => songById.has(duel.songAId) && songById.has(duel.songBId))
    .slice(0, 10)
    .map((duel) => ({
      at: duel.at,
      titleA: songById.get(duel.songAId)?.title ?? '?',
      titleB: songById.get(duel.songBId)?.title ?? '?',
      winner: duel.winner,
      deltaA: duel.deltaA,
      deltaB: duel.deltaB
    }));

  const distinctSongsPlayed = [...listensBySongId.values()].filter((count) => count > 0).length;

  repo.logger.debug('Sending stats data.', { timeRange, distinctSongsPlayed, totalListens });

  return {
    timeRange,
    scopes,
    availableYears: getAvailableYears(listeningData),
    hourHistogram: hourStats.histogram,
    weekdayHistogram: buildWeekdayHistogram(listeningData, range),
    hourDataSince: hourStats.dataSince,
    totals: {
      distinctSongsPlayed,
      totalListens,
      fullListens,
      skips,
      approxListeningTimeSec: Math.round(approxListeningTimeSec),
      favorites
    },
    activity: buildActivity(listeningData, timeRange, now),
    calendar: buildCalendar(listeningData, now),
    topSongs,
    topArtists,
    topAlbums,
    topGenres,
    mostSkipped,
    elo: {
      totalDuels: elo.totalDuels,
      topRated,
      recentDuels
    }
  };
};

export default getStatsData;
export { getStatsData };

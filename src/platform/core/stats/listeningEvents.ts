import { md5Hex } from '../transfer/md5';
import { fingerprintOfSong } from './songFingerprint';

export type ListeningKind = 'listen' | 'fullListen' | 'skip';

export interface DayCounts {
  l?: number;
  f?: number;
  s?: number;
  /** Listen counts by local hour ("0" through "23"). Absent for legacy history. */
  h?: Record<string, number>;
}

export interface ListeningCounterFile {
  version: 1;
  installId: string;
  tracks: Record<string, SongFingerprint>;
  counters: Record<string, Record<string, Record<string, DayCounts>>>;
}

export interface LegacySurplusResult {
  file: ListeningCounterFile;
  rowsAbsorbed: number;
  listensAbsorbed: number;
}

const normalise = (value: string): string => value.trim().toLowerCase();

const localDay = (atMs: number): string => {
  const date = new Date(atMs);
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
};

const localDayStart = (day: string): number => {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year, month - 1, date).getTime();
};

const copyFingerprint = (fingerprint: SongFingerprint): SongFingerprint => ({
  ...fingerprint,
  artists: [...fingerprint.artists]
});

const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;

  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(',')}}`;
};

/** Content hash for a legacy profile, independent of row and object-key ordering. */
export function legacyRowsDigest(rows: readonly SongListeningData[]): string {
  return md5Hex(`[${rows.map(canonicalJson).sort().join(',')}]`);
}

/** Deterministic content key. Same fingerprint always yields the same key. */
export function trackKeyOf(fingerprint: SongFingerprint): string {
  const artists = fingerprint.artists.map(normalise).sort().join('|');
  const input = [
    normalise(fingerprint.fileName),
    Math.round(fingerprint.duration),
    normalise(fingerprint.title),
    artists
  ].join('\u0000');
  return md5Hex(input);
}

/** Empty store for a fresh profile. `installId` is caller supplied so it can be seeded in tests. */
export function createCounterFile(installId: string): ListeningCounterFile {
  return { version: 1, installId, tracks: {}, counters: {} };
}

const chooseFingerprint = (
  first: SongFingerprint | undefined,
  second: SongFingerprint | undefined
): SongFingerprint | undefined => {
  if (!first) return second ? copyFingerprint(second) : undefined;
  if (!second) return copyFingerprint(first);

  // A track key deliberately excludes songId, so two installs normally differ
  // only in that field. A stable choice keeps the merge deterministic in the
  // unlikely event that the stored identities differ in another field too.
  const firstText = JSON.stringify(first);
  const secondText = JSON.stringify(second);
  return copyFingerprint(firstText <= secondText ? first : second);
};

const mergedCounts = (base: DayCounts | undefined, incoming: DayCounts | undefined): DayCounts => {
  const result: DayCounts = {};
  const listens = Math.max(base?.l ?? 0, incoming?.l ?? 0);
  const fullListens = Math.max(base?.f ?? 0, incoming?.f ?? 0);
  const skips = Math.max(base?.s ?? 0, incoming?.s ?? 0);
  if (base?.l !== undefined || incoming?.l !== undefined) result.l = listens;
  if (base?.f !== undefined || incoming?.f !== undefined) result.f = fullListens;
  if (base?.s !== undefined || incoming?.s !== undefined) result.s = skips;
  if (base?.h !== undefined || incoming?.h !== undefined) {
    result.h = {};
    const hours = new Set([...Object.keys(base?.h ?? {}), ...Object.keys(incoming?.h ?? {})]);
    for (const hour of hours)
      result.h[hour] = Math.max(base?.h?.[hour] ?? 0, incoming?.h?.[hour] ?? 0);
  }
  return result;
};

/** Value-wise maximum merge. The base profile keeps its own install identity. */
export function mergeCounterFiles(
  base: ListeningCounterFile,
  incoming: ListeningCounterFile
): ListeningCounterFile {
  const result = createCounterFile(base.installId);
  const trackKeys = new Set([...Object.keys(base.tracks), ...Object.keys(incoming.tracks)]);
  for (const trackKey of trackKeys) {
    const identity = chooseFingerprint(base.tracks[trackKey], incoming.tracks[trackKey]);
    if (identity) result.tracks[trackKey] = identity;
  }

  const counterTrackKeys = new Set([
    ...Object.keys(base.counters),
    ...Object.keys(incoming.counters)
  ]);
  for (const trackKey of counterTrackKeys) {
    const sources: Record<string, Record<string, DayCounts>> = {};
    const sourceIds = new Set([
      ...Object.keys(base.counters[trackKey] ?? {}),
      ...Object.keys(incoming.counters[trackKey] ?? {})
    ]);
    for (const sourceId of sourceIds) {
      const days: Record<string, DayCounts> = {};
      const dayKeys = new Set([
        ...Object.keys(base.counters[trackKey]?.[sourceId] ?? {}),
        ...Object.keys(incoming.counters[trackKey]?.[sourceId] ?? {})
      ]);
      for (const day of dayKeys)
        days[day] = mergedCounts(
          base.counters[trackKey]?.[sourceId]?.[day],
          incoming.counters[trackKey]?.[sourceId]?.[day]
        );
      sources[sourceId] = days;
    }
    result.counters[trackKey] = sources;
  }
  return result;
}

/** Adds one play for the given track on the given day, attributed to `sourceId`. Pure. */
export function recordListening(
  file: ListeningCounterFile,
  fingerprint: SongFingerprint,
  kind: ListeningKind,
  atMs: number,
  sourceId: string
): ListeningCounterFile {
  const trackKey = trackKeyOf(fingerprint);
  const day = localDay(atMs);
  const metric: 'l' | 'f' | 's' = kind === 'listen' ? 'l' : kind === 'fullListen' ? 'f' : 's';
  const previous = file.counters[trackKey]?.[sourceId]?.[day] ?? {};
  const nextDay: DayCounts = { ...previous, [metric]: (previous[metric] ?? 0) + 1 };
  if (kind === 'listen') {
    const hour = `${new Date(atMs).getHours()}`;
    nextDay.h = { ...previous.h, [hour]: (previous.h?.[hour] ?? 0) + 1 };
  }

  return {
    ...file,
    tracks: { ...file.tracks, [trackKey]: copyFingerprint(fingerprint) },
    counters: {
      ...file.counters,
      [trackKey]: {
        ...file.counters[trackKey],
        [sourceId]: { ...file.counters[trackKey]?.[sourceId], [day]: nextDay }
      }
    }
  };
}

const addMetric = (
  file: ListeningCounterFile,
  trackKey: string,
  sourceId: string,
  day: string,
  metric: 'l' | 'f' | 's',
  amount: number
): void => {
  if (!Number.isFinite(amount) || amount <= 0) return;
  const sources = (file.counters[trackKey] ??= {});
  const days = (sources[sourceId] ??= {});
  const counts = (days[day] ??= {});
  counts[metric] = (counts[metric] ?? 0) + amount;
};

/** Turns fingerprinted legacy rows into counters attributed to one source. */
export function countersFromLegacyRows(
  rows: readonly SongListeningData[],
  sourceId: string,
  installId: string
): { file: ListeningCounterFile; migrated: number; skipped: number } {
  const file = createCounterFile(installId);
  let migrated = 0;
  let skipped = 0;

  for (const row of rows) {
    if (!row.fingerprint) {
      skipped += 1;
      continue;
    }

    migrated += 1;
    const trackKey = trackKeyOf(row.fingerprint);
    file.tracks[trackKey] = copyFingerprint(row.fingerprint);
    let latestDay: string | undefined;
    for (const yearly of row.listens) {
      for (const [atMs, count] of yearly.listens) {
        const day = localDay(atMs);
        addMetric(file, trackKey, sourceId, day, 'l', count);
        if (!latestDay || day > latestDay) latestDay = day;
      }
    }

    const scalarDay = latestDay ?? '1970-01-01';
    addMetric(file, trackKey, sourceId, scalarDay, 'f', row.fullListens ?? 0);
    addMetric(file, trackKey, sourceId, scalarDay, 's', row.skips ?? 0);
  }

  return { file, migrated, skipped };
}

const summedTrackCounts = (
  counters: Record<string, Record<string, DayCounts>>
): { days: Map<string, number>; fullListens: number; skips: number } => {
  const days = new Map<string, number>();
  let fullListens = 0;
  let skips = 0;
  for (const source of Object.values(counters)) {
    for (const [day, counts] of Object.entries(source)) {
      if (counts.l) days.set(day, (days.get(day) ?? 0) + counts.l);
      fullListens += counts.f ?? 0;
      skips += counts.s ?? 0;
    }
  }
  return { days, fullListens, skips };
};

interface LegacyTrackCounts {
  fingerprint: SongFingerprint;
  rows: number;
  days: Map<string, number>;
  fullListens: number;
  skips: number;
  latestDay?: string;
}

/**
 * Adds only the counts by which the legacy view exceeds the merge-safe store.
 * Existing counter values are never reduced, and the dedicated drift source
 * makes repeated hydration a no-op until an older build advances the view.
 */
export function absorbLegacySurplus(
  file: ListeningCounterFile,
  rows: readonly SongListeningData[],
  sourceId: string
): LegacySurplusResult {
  const legacyByTrack = new Map<string, LegacyTrackCounts>();
  for (const row of rows) {
    if (!row.fingerprint) continue;
    const trackKey = trackKeyOf(row.fingerprint);
    const aggregate = legacyByTrack.get(trackKey) ?? {
      fingerprint: copyFingerprint(row.fingerprint),
      rows: 0,
      days: new Map<string, number>(),
      fullListens: 0,
      skips: 0
    };
    aggregate.rows += 1;
    aggregate.fullListens += row.fullListens ?? 0;
    aggregate.skips += row.skips ?? 0;
    for (const yearly of row.listens) {
      for (const [atMs, count] of yearly.listens) {
        if (!Number.isFinite(count) || count <= 0) continue;
        const day = localDay(atMs);
        aggregate.days.set(day, (aggregate.days.get(day) ?? 0) + count);
        if (!aggregate.latestDay || day > aggregate.latestDay) aggregate.latestDay = day;
      }
    }
    legacyByTrack.set(trackKey, aggregate);
  }

  const result = mergeCounterFiles(createCounterFile(file.installId), file);
  let rowsAbsorbed = 0;
  let listensAbsorbed = 0;

  for (const [trackKey, legacy] of legacyByTrack) {
    const current = summedTrackCounts(file.counters[trackKey] ?? {});
    let changed = false;
    result.tracks[trackKey] ??= copyFingerprint(legacy.fingerprint);

    for (const [day, count] of legacy.days) {
      const missing = count - (current.days.get(day) ?? 0);
      if (missing <= 0) continue;
      addMetric(result, trackKey, sourceId, day, 'l', missing);
      listensAbsorbed += missing;
      changed = true;
    }

    const scalarDay = legacy.latestDay ?? '1970-01-01';
    const missingFullListens = legacy.fullListens - current.fullListens;
    const missingSkips = legacy.skips - current.skips;
    if (missingFullListens > 0) {
      addMetric(result, trackKey, sourceId, scalarDay, 'f', missingFullListens);
      changed = true;
    }
    if (missingSkips > 0) {
      addMetric(result, trackKey, sourceId, scalarDay, 's', missingSkips);
      changed = true;
    }
    if (changed) rowsAbsorbed += legacy.rows;
  }

  return { file: result, rowsAbsorbed, listensAbsorbed };
}

/** Rebuilds legacy listening rows from counters against the current library. */
export function deriveListeningRows(
  file: ListeningCounterFile,
  songs: readonly SavableSongData[],
  existingRows: readonly SongListeningData[]
): SongListeningData[] {
  const songByTrackKey = new Map<string, SavableSongData>();
  for (const song of songs) {
    const key = trackKeyOf(fingerprintOfSong(song));
    if (!songByTrackKey.has(key)) songByTrackKey.set(key, song);
  }

  const existingBySongId = new Map(existingRows.map((row) => [row.songId, row]));

  // Indexed once, not searched per track. This runs on every play, and the
  // straight nested scan cost 5 to 7 SECONDS on a real 1083-row profile because
  // it hashed every row again for every tracked key: a million md5 calls to
  // answer a question one pass can answer.
  const rowsByTrackKey = new Map<string, SongListeningData[]>();
  for (const row of existingRows) {
    if (!row.fingerprint) continue;
    const key = trackKeyOf(row.fingerprint);
    const bucket = rowsByTrackKey.get(key);
    if (bucket) bucket.push(row);
    else rowsByTrackKey.set(key, [row]);
  }

  const representedRows = new Set<SongListeningData>();
  const result: SongListeningData[] = [];

  for (const [trackKey, counters] of Object.entries(file.counters)) {
    const song = songByTrackKey.get(trackKey);
    if (!song) continue;

    const existing = existingBySongId.get(song.songId);
    if (existing) representedRows.add(existing);
    for (const row of rowsByTrackKey.get(trackKey) ?? []) representedRows.add(row);

    const totals = summedTrackCounts(counters);
    const byYear = new Map<number, [number, number][]>();
    for (const [day, count] of [...totals.days].sort(([first], [second]) =>
      first.localeCompare(second)
    )) {
      const start = localDayStart(day);
      const year = new Date(start).getFullYear();
      const entries = byYear.get(year) ?? [];
      entries.push([start, count]);
      byYear.set(year, entries);
    }

    const row: SongListeningData = {
      songId: song.songId,
      listens: [...byYear]
        .sort(([first], [second]) => first - second)
        .map(([year, listens]) => ({ year, listens })),
      fingerprint: fingerprintOfSong(song)
    };
    if (totals.fullListens > 0) row.fullListens = totals.fullListens;
    if (totals.skips > 0) row.skips = totals.skips;
    if (existing?.seeks !== undefined) row.seeks = existing.seeks;
    if (existing?.inNoOfPlaylists !== undefined) row.inNoOfPlaylists = existing.inNoOfPlaylists;
    result.push(row);
  }

  for (const existing of existingRows) {
    if (!representedRows.has(existing)) result.push(existing);
  }
  return result;
}

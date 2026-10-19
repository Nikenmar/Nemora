/** Turns one launch's sampler events and app marks into numbers. Pure functions, no I/O. */

export const median = (values) => {
  const s = values.filter((v) => v != null && Number.isFinite(v)).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export const spread = (values) => {
  const s = values.filter((v) => v != null && Number.isFinite(v));
  return s.length ? { min: Math.min(...s), max: Math.max(...s) } : null;
};

const metricSamples = (events) => events.filter((e) => e.k === 'm');
/** The meter's readings between two times; a reading above this is sound. */
const AUDIBLE = 0.0005;
const loud = (sample) => sample.p > AUDIBLE;
const audio = (events, from, to) => events.filter((e) => e.k === 'a' && e.t >= from && e.t <= to);
const mark = (marks, name) => marks.find((m) => m.name === name);
const marksNamed = (marks, name) => marks.filter((m) => m.name === name);

/**
 * Whether another app was adding sound to the device while the capture listened. A session that
 * only mirrors the player (a recorder capturing the desktop audio, OBS for one) reads the same
 * level as the player; one that plays something of its own does not.
 */
function anotherAppPlaying(events, from, to) {
  const samples = audio(events, from, to).filter((e) => (e.q ?? 0) > AUDIBLE);
  const foreign = samples.filter((e) => Math.abs(e.q - e.p) > 0.05 * Math.max(e.p, e.q) + 0.002);
  const all = audio(events, from, to).length;
  return all > 0 && foreign.length / all > 0.2 ? Math.max(...foreign.map((e) => e.q)) : 0;
}

/** Silences the loopback capture heard between two times. */
const silencesIn = (events, from, to) => events.filter((e) => e.k === 's' && e.t >= from && e.t <= to);
const captured = (events) => events.some((e) => e.k === 'l');

/** CPU as a percentage of ONE core, between two wall-clock times, from cumulative tree CPU. */
export function cpuPercent(events, from, to) {
  const samples = metricSamples(events).filter((e) => e.t >= from && e.t <= to);
  if (samples.length < 2) return null;
  const first = samples[0];
  const last = samples.at(-1);
  return ((last.cpu - first.cpu) / (last.t - first.t)) * 100;
}

/** Bytes the tree read (`rd`) or wrote (`wr`) between two times. */
export function ioBytes(events, from, to, field) {
  const samples = metricSamples(events).filter((e) => e.t >= from && e.t <= to && e[field] != null);
  return samples.length < 2 ? null : samples.at(-1)[field] - samples[0][field];
}

export function cpuSeconds(events, from, to) {
  const samples = metricSamples(events).filter((e) => e.t >= from && e.t <= to);
  return samples.length < 2 ? null : (samples.at(-1).cpu - samples[0].cpu) / 1000;
}

/** Median of a memory field over a window: one number for a steady state, not a lucky sample. */
export function memory(events, from, to, field = 'pws') {
  return median(metricSamples(events).filter((e) => e.t >= from && e.t <= to).map((e) => e[field]));
}

export function peak(events, field = 'pws', from = 0, to = Infinity) {
  const values = metricSamples(events).filter((e) => e.t >= from && e.t <= to).map((e) => e[field]);
  return values.length ? Math.max(...values) : null;
}

export function processCount(events, from, to) {
  return median(metricSamples(events).filter((e) => e.t >= from && e.t <= to).map((e) => e.n));
}

export const windowShownAt = (events) => events.find((e) => e.k === 'w')?.t ?? null;

/**
 * The first moment after `from` when the tree stays below `limit` percent of one core for `holdMs`:
 * how the harness tells that background work (covers, colours) has finished.
 */
export function quietAt(events, from, { limit = 5, holdMs = 3000 } = {}) {
  const samples = metricSamples(events).filter((e) => e.t >= from);
  for (let i = 0; i < samples.length; i += 1) {
    let j = i;
    while (j + 1 < samples.length && samples[j + 1].t - samples[i].t <= holdMs) j += 1;
    if (samples[j].t - samples[i].t < holdMs * 0.9) return null;
    const percent = ((samples[j].cpu - samples[i].cpu) / (samples[j].t - samples[i].t)) * 100;
    if (percent < limit) return samples[i].t;
  }
  return null;
}

/** One launch of each phase, reduced to the figures the report shows. */
export const reduce = {
  scan(launch, { app }) {
    const { marks, events } = launch;
    const start = mark(marks, 'scan-start')?.at;
    const listed = mark(marks, 'scan-listed')?.at;
    if (!start || !listed) return { ok: false, reason: 'the scan did not finish' };
    // Nora derives cover colours after it has answered, in timers; the CPU must not be read as
    // quiet in the gap before they start.
    const palettes = app === 'nora' ? mark(marks, 'palettes-done')?.at : listed;
    const finished = launch.finishedAt ?? null;
    const end = finished ?? Infinity;
    return {
      ok: finished != null && palettes != null,
      reason: finished == null ? 'never went quiet' : palettes == null ? 'colours never finished' : undefined,
      listedMs: listed - start,
      finishedMs: finished != null ? finished - start : null,
      cpuSeconds: finished != null ? cpuSeconds(events, start, finished) : null,
      peakPrivateWorkingSet: peak(events, 'pws', start, end),
      bytesRead: ioBytes(events, start, end, 'rd'),
      bytesWritten: ioBytes(events, start, end, 'wr'),
      // The interface while the songs were being added: frames recorded inside the app.
      frames: mark(marks, 'scan-listed')?.data?.frames ?? null,
      profileBytes: launch.profileBytes ?? null,
      songs: mark(marks, 'scan-listed')?.data?.count
    };
  },

  startup(launch, { steadyFromMs, steadyForMs }) {
    const { marks, events, spawnedAt } = launch;
    const ready = mark(marks, 'ready')?.at;
    const shown = windowShownAt(events);
    if (!ready) return { ok: false, reason: 'never ready' };
    const from = spawnedAt + steadyFromMs;
    const to = from + steadyForMs;
    return {
      ok: true,
      windowMs: shown ? shown - spawnedAt : null,
      readyMs: ready - spawnedAt,
      // Everything the app does once started, including work after its window is up.
      firstMinuteCpuSeconds: cpuSeconds(events, spawnedAt, from),
      firstMinuteBytesRead: ioBytes(events, spawnedAt, from, 'rd'),
      firstMinuteBytesWritten: ioBytes(events, spawnedAt, from, 'wr'),
      steadyPrivateWorkingSet: memory(events, from, to, 'pws'),
      steadyWorkingSet: memory(events, from, to, 'ws'),
      steadyPrivateBytes: memory(events, from, to, 'priv'),
      steadyCpuPercent: cpuPercent(events, from, to),
      peakPrivateWorkingSet: peak(events, 'pws'),
      processes: processCount(events, from, to)
    };
  },

  ui(launch) {
    const { marks, events } = launch;
    const pages = marksNamed(marks, 'page').map((m) => m.data);
    const searches = marksNamed(marks, 'search').map((m) => m.data);
    const scroll = mark(marks, 'scroll')?.data ?? null;
    const first = marks.find((m) => m.name === 'page')?.at;
    const done = mark(marks, 'done')?.at;
    if (!pages.length || !done) return { ok: false, reason: 'the scenario did not finish' };
    return {
      ok: true,
      pages: Object.fromEntries(pages.map((p) => [p.label, p.ms])),
      searchMs: median(searches.map((s) => s.ms)),
      searches,
      scroll,
      cpuSeconds: cpuSeconds(events, first, done),
      peakPrivateWorkingSet: peak(events, 'pws', first, done)
    };
  },

  playback(launch, { listenFromMs, listenForMs }) {
    const { marks, events } = launch;
    const requested = mark(marks, 'play-requested')?.at;
    if (!requested) return { ok: false, reason: 'never asked to play' };
    const samples = audio(events, requested, Infinity);
    const firstSound = samples.find(loud)?.t;
    if (!firstSound) return { ok: false, reason: 'SILENT: no sound left the app' };
    const from = firstSound + listenFromMs;
    const to = from + listenForMs;
    // Sound must be there for most of the window, or the CPU figure belongs to a player that is not
    // playing (the false row this harness exists to prevent).
    const window = audio(events, from, to);
    const heard = window.length ? window.filter(loud).length / window.length : 0;
    if (heard < 0.6) return { ok: false, reason: `SILENT for most of the window (${Math.round(heard * 100)} % heard)` };
    // The track is loud throughout its first 40 s (chosen so by `prepare`), so any silence the
    // capture hears in the window is the player dropping out.
    let dropouts = null;
    if (captured(events) && !anotherAppPlaying(events, from, to)) {
      const silences = silencesIn(events, from, to);
      dropouts = { count: silences.length, ms: silences.reduce((sum, s) => sum + s.d, 0) };
    }
    return {
      ok: true,
      startMs: firstSound - requested,
      cpuPercent: cpuPercent(events, from, to),
      privateWorkingSet: memory(events, from, to, 'pws'),
      workingSet: memory(events, from, to, 'ws'),
      dropouts,
      heard
    };
  },

  /**
   * The silence between two queued songs, from the device's own output (the sampler's loopback
   * capture, to the millisecond; silences under 2 ms are not reported and read as none). The first
   * song ends loud and the second starts loud (chosen so by `prepare`), so any silence at the change
   * is the player's.
   */
  transition(launch) {
    const { marks, events } = launch;
    const seek = mark(marks, 'seek-to-end');
    const check = mark(marks, 'transition-check')?.data;
    if (!seek || !check) return { ok: false, reason: 'never reached the end of the first song' };
    if (!check.firstWasPlaying) return { ok: false, reason: 'the first song was not the one playing' };
    if (!check.secondIsPlaying) return { ok: false, reason: 'the second song did not start' };
    if (!captured(events)) {
      const error = events.find((e) => e.k === 'e')?.msg;
      return { ok: false, reason: `no loopback capture${error ? `: ${error}` : ''}` };
    }
    const endsAt = seek.data.endsAt;
    // The capture hears the whole device: another app's sound would fill the very gap measured.
    const others = anotherAppPlaying(events, seek.at, endsAt + 4_000);
    if (others) return { ok: false, reason: `another app was playing (peak ${others.toFixed(3)})` };
    if (!audio(events, endsAt + 1_000, endsAt + 4_000).some(loud))
      return { ok: false, reason: 'SILENT after the change' };
    // A silence starting near the end of the first song is the change; the seek's own, four seconds
    // earlier, is not.
    const silences = silencesIn(events, endsAt - 2_500, endsAt + 2_500);
    return { ok: true, gapMs: Math.max(0, ...silences.map((e) => e.d)), silences: silences.length };
  }
};

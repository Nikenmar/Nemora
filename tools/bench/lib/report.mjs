/** The results as a table a person reads: medians over the good runs, with their spread and count. */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { median, spread } from './metrics.mjs';

const MB = 1024 * 1024;
const fmt = {
  ms: (v) =>
    v == null ? '–' : v >= 10_000 ? `${(v / 1000).toFixed(1)} s` : v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`,
  mb: (v) => (v == null ? '–' : v >= 10 * 1024 * MB ? `${(v / 1024 / MB).toFixed(1)} GB` : `${Math.round(v / MB)} MB`),
  pct: (v) => (v == null ? '–' : `${v.toFixed(2)} %`),
  s: (v) => (v == null ? '–' : `${v.toFixed(1)} s`),
  n: (v) => (v == null ? '–' : `${Math.round(v)}`),
  fps: (v) => (v == null ? '–' : `${v.toFixed(0)}`)
};

/** How many times better B is than A, for a metric where lower is better (or higher, when `up`). */
function ratio(a, b, up = false) {
  if (a == null || b == null) return '';
  if (a === 0 && b === 0) return 'same';
  if (a === 0 || b === 0) return up ? (b > a ? 'better' : 'worse') : b < a ? 'better' : 'worse';
  const r = up ? b / a : a / b;
  if (Math.abs(r - 1) < 0.05) return 'same';
  return r > 1 ? `${r.toFixed(r >= 10 ? 0 : 1)}× better` : `${(1 / r).toFixed(1)}× worse`;
}

const PLAYBACK = {
  flac: 'Playing FLAC, window open',
  mp3: 'Playing MP3, window open',
  'flac-minimized': 'Playing FLAC, window minimized',
  'flac-tray': 'Playing FLAC, hidden in the tray'
};

export function writeReport(root, raw) {
  const apps = Object.keys(raw.apps);
  const [a, b] = apps;
  const good = (phase, app, variant) =>
    raw.launches
      .filter((l) => l.phase === phase && l.app === app && (variant === undefined || l.variant === variant) && l.metrics?.ok)
      .map((l) => l.metrics);

  const rows = [];
  const section = (title) => rows.push({ title });
  const row = (label, pick, format, { phase, variant, up = false, total = false } = {}) => {
    const values = Object.fromEntries(
      apps.map((app) => [app, phase ? good(phase, app, variant).map(pick) : [pick(raw.apps[app])]])
    );
    const known = (app) => values[app].filter((v) => v != null);
    // A rare event (a dropout in one run of three) is the finding; a median would read it as none.
    const med = Object.fromEntries(
      apps.map((app) => [app, total ? (known(app).length ? known(app).reduce((s, v) => s + v, 0) : null) : median(values[app])])
    );
    if (apps.every((app) => med[app] == null)) return;
    const cell = (app) => {
      const s = spread(values[app]);
      const count = known(app).length;
      if (med[app] == null) return '–';
      if (total) return `${format(med[app])} <sub>in ${count} runs</sub>`;
      if (!phase || count < 2 || !s) return format(med[app]);
      return `${format(med[app])} <sub>${format(s.min)}–${format(s.max)}, n=${count}</sub>`;
    };
    rows.push({ label, cells: apps.map(cell), ratio: b ? ratio(med[a], med[b], up) : '' });
  };

  section('Install');
  row('Installer download', (x) => x.installerBytes, fmt.mb);
  row('Installed on disk', (x) => x.installedBytes, fmt.mb);

  const sizes = ['small', 'large'].filter((size) => raw.launches.some((l) => l.variant === size));
  const tracks = (size) => raw.library?.[size] ?? '?';

  for (const size of sizes) {
    const scan = { phase: 'scan', variant: size };
    section(`Building the library: ${tracks(size)} tracks added to an empty profile`);
    row('Songs listed', (m) => m.listedMs, fmt.ms, scan);
    row('Everything done (covers, colours)', (m) => m.finishedMs, fmt.ms, scan);
    row('CPU time spent', (m) => m.cpuSeconds, fmt.s, scan);
    row('RAM at its peak', (m) => m.peakPrivateWorkingSet, fmt.mb, scan);
    row('Written to disk', (m) => m.bytesWritten, fmt.mb, scan);
    row('Profile on disk afterwards', (m) => m.profileBytes, fmt.mb, scan);
    row('Interface meanwhile: frames over 33 ms', (m) => m.frames?.longFrames, fmt.n, scan);
    row('Interface meanwhile: longest frame', (m) => m.frames?.maxMs, fmt.ms, scan);
    row('Interface meanwhile: time frozen (frames over 100 ms)', (m) => m.frames?.frozenMs, fmt.ms, scan);
  }

  for (const size of sizes) {
    const startup = { phase: 'startup', variant: size };
    section(`Starting with ${tracks(size)} tracks`);
    row('Window on screen', (m) => m.windowMs, fmt.ms, startup);
    row('Ready (library loaded, home page painted)', (m) => m.readyMs, fmt.ms, startup);
    row('CPU time in the first minute', (m) => m.firstMinuteCpuSeconds, fmt.s, startup);
    row('Read from disk in the first minute', (m) => m.firstMinuteBytesRead, fmt.mb, startup);
    row('Written to disk in the first minute', (m) => m.firstMinuteBytesWritten, fmt.mb, startup);
    row('RAM in use after a minute', (m) => m.steadyPrivateWorkingSet, fmt.mb, startup);
    row('CPU idle after a minute', (m) => m.steadyCpuPercent, fmt.pct, startup);
    row('Processes', (m) => m.processes, fmt.n, startup);
  }

  for (const size of sizes) {
    const ui = { phase: 'ui', variant: size };
    section(`Using it with ${tracks(size)} tracks`);
    const labels = [
      ...new Set(
        raw.launches
          .filter((l) => l.phase === 'ui' && l.variant === size && l.metrics?.ok)
          .flatMap((l) => Object.keys(l.metrics.pages))
          .filter((label) => !label.includes('for scrolling'))
      )
    ];
    for (const label of labels) row(`Open ${label}`, (m) => m.pages[label], fmt.ms, ui);
    row('Search: typing to results painted (includes the view’s 250 ms pause, in both)', (m) => m.searchMs, fmt.ms, ui);
    row('Song list scroll, frames per second', (m) => m.scroll?.fps, fmt.fps, { ...ui, up: true });
    row('Song list scroll, frames over 33 ms', (m) => m.scroll?.longFrames, fmt.n, ui);
    row('Song list scroll, 95th percentile frame', (m) => m.scroll?.p95Ms, fmt.ms, ui);
    row('CPU time for the whole session', (m) => m.cpuSeconds, fmt.s, ui);
    row('RAM at its peak', (m) => m.peakPrivateWorkingSet, fmt.mb, ui);
  }

  const variants = [...new Set(raw.launches.filter((l) => l.phase === 'playback').map((l) => l.variant))];
  for (const variant of variants) {
    const playback = { phase: 'playback', variant };
    section(`${PLAYBACK[variant] ?? variant} (sound confirmed by the Windows audio meter)`);
    if (!variant.includes('-')) row('Sound starts after the click', (m) => m.startMs, fmt.ms, playback);
    row('CPU while playing', (m) => m.cpuPercent, fmt.pct, playback);
    row('RAM while playing', (m) => m.privateWorkingSet, fmt.mb, playback);
    row('Dropouts: silences of 2 ms or more in the recorded output, all runs together', (m) => m.dropouts?.count, fmt.n, {
      ...playback,
      total: true
    });
    row('Dropouts: their total length', (m) => m.dropouts?.ms, fmt.ms, { ...playback, total: true });
  }

  if (raw.launches.some((l) => l.phase === 'transition')) {
    section(`From one song to the next (${raw.library?.transition?.format?.toUpperCase() ?? ''}, queued)`);
    row('Silence between the two songs (recorded output; under 2 ms reads as none)', (m) => m.gapMs, fmt.ms, {
      phase: 'transition',
      variant: null
    });
  }

  const head = `| | ${apps.map((app) => `${raw.apps[app].label} <sub>${raw.apps[app].version ?? ''}</sub>`).join(' | ')} | |`;
  const lines = [
    `# ${apps.map((app) => raw.apps[app].label).join(' vs ')}`,
    '',
    `Measured ${raw.startedAt}${raw.quick ? ' (QUICK: one run each, short windows, not for publishing)' : ''} on ${raw.machine.cpu}, ${raw.machine.cores} threads, ${Math.round(raw.machine.memoryBytes / 1024 ** 3)} GB, Windows ${raw.machine.windows}.`,
    'Medians over the good runs; small print is the range and the run count. CPU is a percentage of one core, RAM the private working set of the whole process tree, disk figures all I/O the tree did (both players run offline).',
    '',
    head,
    `|---|${apps.map(() => '---:').join('|')}|---|`
  ];
  for (const r of rows) {
    if (r.title) lines.push(`| **${r.title}** | ${apps.map(() => '').join(' | ')} | |`);
    else lines.push(`| ${r.label} | ${r.cells.join(' | ')} | ${r.ratio} |`);
  }

  const measured = raw.launches.filter((l) => l.phase !== 'prime');
  const discarded = measured.filter((l) => !l.metrics?.ok);
  lines.push('', `## Runs: ${measured.length - discarded.length} good, ${discarded.length} discarded`);
  for (const l of discarded) {
    lines.push(`- ${l.phase}${l.variant ? ` ${l.variant}` : ''} ${l.app} #${l.run}: ${l.error?.message ?? l.metrics?.reason ?? l.outcome}`);
  }
  const busy = measured.filter((l) => l.machine && !l.machine.quiet);
  if (busy.length) {
    lines.push('', `Started on a busy machine (kept, but worth a look): ${busy.map((l) => `${l.phase} ${l.variant ?? ''} ${l.app} #${l.run} (${l.machine.busy.toFixed(1)} %)`).join(', ')}.`);
  }
  if (raw.library?.queries?.length) lines.push('', `Search terms: ${raw.library.queries.join(', ')}.`);

  const out = join(root, 'results', 'report.md');
  writeFileSync(out, `${lines.join('\n')}\n`);
  return out;
}

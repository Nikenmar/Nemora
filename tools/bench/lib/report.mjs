/** The results as a table a person reads: medians over the good runs, with their spread and count. */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { median, spread } from './metrics.mjs';

const MB = 1024 * 1024;
const fmt = {
  ms: (v) => (v == null ? '–' : v >= 10_000 ? `${(v / 1000).toFixed(1)} s` : v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`),
  mb: (v) => (v == null ? '–' : `${Math.round(v / MB)} MB`),
  pct: (v) => (v == null ? '–' : `${v.toFixed(2)} %`),
  s: (v) => (v == null ? '–' : `${v.toFixed(1)} s`),
  n: (v) => (v == null ? '–' : `${Math.round(v)}`),
  fps: (v) => (v == null ? '–' : `${v.toFixed(0)}`)
};

/** How many times better B is than A, for a metric where lower is better (or higher, when `up`). */
function ratio(a, b, up = false) {
  if (a == null || b == null || a === 0 || b === 0) return '';
  const r = up ? b / a : a / b;
  if (Math.abs(r - 1) < 0.05) return 'same';
  return r > 1 ? `${r.toFixed(r >= 10 ? 0 : 1)}× better` : `${(1 / r).toFixed(1)}× worse`;
}

export function writeReport(root, raw) {
  const apps = Object.keys(raw.apps);
  const [a, b] = apps;
  const good = (phase, app, variant = null) =>
    raw.launches.filter((l) => l.phase === phase && l.app === app && l.variant === variant && l.metrics?.ok).map((l) => l.metrics);

  const rows = [];
  const section = (title) => rows.push({ title });
  const row = (label, pick, format, { phase, variant = null, up = false } = {}) => {
    const values = Object.fromEntries(apps.map((app) => [app, phase ? good(phase, app, variant).map(pick) : [pick(raw.apps[app])]]));
    const med = Object.fromEntries(apps.map((app) => [app, median(values[app])]));
    const cell = (app) => {
      const s = spread(values[app]);
      const count = values[app].filter((v) => v != null).length;
      if (med[app] == null) return '–';
      if (!phase || count < 2 || !s) return format(med[app]);
      return `${format(med[app])} <sub>${format(s.min)}–${format(s.max)}, n=${count}</sub>`;
    };
    rows.push({ label, cells: apps.map(cell), ratio: b ? ratio(med[a], med[b], up) : '' });
  };

  section('Install');
  row('Installer download', (x) => x.installerBytes, fmt.mb);
  row('Installed on disk', (x) => x.installedBytes, fmt.mb);

  section(`Building the library (${raw.library.tracks} tracks, empty profile)`);
  row('Songs listed', (m) => m.listedMs, fmt.ms, { phase: 'scan' });
  row('Everything done (covers, colours)', (m) => m.finishedMs, fmt.ms, { phase: 'scan' });
  row('CPU time spent', (m) => m.cpuSeconds, fmt.s, { phase: 'scan' });
  row('RAM at its peak', (m) => m.peakPrivateWorkingSet, fmt.mb, { phase: 'scan' });

  section('Start with that library');
  row('Window on screen', (m) => m.windowMs, fmt.ms, { phase: 'startup' });
  row('Ready (library loaded, home page painted)', (m) => m.readyMs, fmt.ms, { phase: 'startup' });
  row('RAM in use after a minute', (m) => m.steadyPrivateWorkingSet, fmt.mb, { phase: 'startup' });
  row('CPU idle after a minute', (m) => m.steadyCpuPercent, fmt.pct, { phase: 'startup' });
  row('Processes', (m) => m.processes, fmt.n, { phase: 'startup' });

  section('Using it');
  const labels = [...new Set(raw.launches.filter((l) => l.phase === 'ui' && l.metrics?.ok).flatMap((l) => Object.keys(l.metrics.pages)))];
  for (const label of labels) row(`Open ${label}`, (m) => m.pages[label], fmt.ms, { phase: 'ui' });
  row('Search (backend)', (m) => m.searchMs, fmt.ms, { phase: 'ui' });
  row('Song list scroll, frames per second', (m) => m.scroll?.fps, fmt.fps, { phase: 'ui', up: true });
  row('Song list scroll, frames over 33 ms', (m) => m.scroll?.longFrames, fmt.n, { phase: 'ui' });
  row('Song list scroll, 95th percentile frame', (m) => m.scroll?.p95Ms, fmt.ms, { phase: 'ui' });
  row('CPU time for the whole session', (m) => m.cpuSeconds, fmt.s, { phase: 'ui' });

  const formats = [...new Set(raw.launches.filter((l) => l.phase === 'playback').map((l) => l.variant))];
  for (const format of formats) {
    section(`Playing ${format?.toUpperCase()} (sound confirmed by the Windows audio meter)`);
    row('Sound starts after the click', (m) => m.startMs, fmt.ms, { phase: 'playback', variant: format });
    row('CPU while playing', (m) => m.cpuPercent, fmt.pct, { phase: 'playback', variant: format });
    row('RAM while playing', (m) => m.privateWorkingSet, fmt.mb, { phase: 'playback', variant: format });
  }

  const head = `| | ${apps.map((app) => `${raw.apps[app].label} <sub>${raw.apps[app].version ?? ''}</sub>`).join(' | ')} | |`;
  const lines = [
    `# ${apps.map((app) => raw.apps[app].label).join(' vs ')}`,
    '',
    `Measured ${raw.startedAt}${raw.quick ? ' (QUICK: one run each, short windows, not for publishing)' : ''} on ${raw.machine.cpu}, ${raw.machine.cores} threads, ${Math.round(raw.machine.memoryBytes / 1024 ** 3)} GB, Windows ${raw.machine.windows}.`,
    'Medians over the good runs; small print is the range and the run count. CPU is a percentage of one core, RAM the private working set of the whole process tree.',
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
  const searches = raw.launches.find((l) => l.phase === 'ui' && l.metrics?.ok)?.metrics.searches ?? [];
  if (searches.length) lines.push('', `Search terms: ${searches.map((s) => s.query).join(', ')}.`);

  const out = join(root, 'results', 'report.md');
  writeFileSync(out, `${lines.join('\n')}\n`);
  return out;
}

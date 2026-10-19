#!/usr/bin/env node
/**
 * Renders a run's results/raw.json into the README's benchmark card, results/benchmark.png.
 *
 *   cd tools/bench && npm install        # once: satori and resvg
 *   node tools/bench/card.mjs --root E:\bench\2026-10 [--out <file.png>]
 *
 * Deliberately minimal: no title, no methodology. The README and results/report.md carry those in
 * text, where they can be read and corrected; conditions baked into a raster only make it noisy.
 * No number is typed by hand: every value is the median of the good runs in raw.json, as in the
 * report, so the card cannot drift from the measurement.
 *
 * Styled from the app's dark tokens and set in Poppins, so it looks like a page of the player.
 * Satori reads ttf but not woff2, so the app's fonts are converted once (Python fontTools) into
 * <root>/card-fonts. Satori implements flexbox only: every box declares `display: flex`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Resvg } from '@resvg/resvg-js';
import satori from 'satori';

import { median } from './lib/metrics.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const option = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i > -1 ? argv[i + 1] : undefined;
};
const ROOT = option('root');
if (!ROOT) throw new Error('usage: card.mjs --root <benchmark folder> [--out <file.png>]');
const raw = JSON.parse(readFileSync(join(ROOT, 'results', 'raw.json'), 'utf8'));
const [A, B] = Object.keys(raw.apps);

// Not numbers, so not in raw.json: what each side is built on, for the legend.
const RUNTIME = { nora: 'Electron', nemora: 'Tauri' };

/** The median over the good runs of one phase (and variant), as the report computes it. */
const of = (app, phase, variant, pick) =>
  median(
    raw.launches
      .filter((l) => l.phase === phase && l.app === app && (variant === undefined || l.variant === variant) && l.metrics?.ok)
      .map((l) => pick(l.metrics))
  );
const both = (phase, variant, pick) => [of(A, phase, variant, pick), of(B, phase, variant, pick)];

const fmt = {
  mb: (bytes) => `${Math.round(bytes / 1048576)} MB`,
  seconds: (ms) => `${(ms / 1000).toFixed(ms >= 10_000 ? 1 : 2)} s`,
  percent: (value) => `${value.toFixed(2)} %`,
  gap: (ms) => (ms === 0 ? 'none' : `${Math.round(ms)} ms`)
};

const scale = raw.library.large ? 'large' : 'small';
const tracks = raw.library[scale];
const row = (label, [a, b], format) => a != null && b != null && { label, a, b, format };
const rows = [
  row('Installed on disk', [raw.apps[A].installedBytes, raw.apps[B].installedBytes], fmt.mb),
  // Drawn only when both sides have an installer to weigh: a missing one is not "0 MB".
  raw.apps[A].installerBytes > 0 &&
    raw.apps[B].installerBytes > 0 &&
    row('Installer download', [raw.apps[A].installerBytes, raw.apps[B].installerBytes], fmt.mb),
  row('Window on screen', both('startup', scale, (m) => m.windowMs), fmt.seconds),
  row('RAM in use', both('startup', scale, (m) => m.steadyPrivateWorkingSet), fmt.mb),
  row(`Building a ${tracks}-track library`, both('scan', scale, (m) => m.finishedMs), fmt.seconds),
  row('CPU while a track plays', both('playback', 'flac', (m) => m.cpuPercent), fmt.percent),
  row('RAM while a track plays', both('playback', 'flac', (m) => m.privateWorkingSet), fmt.mb),
  row('Silence between two songs', both('transition', null, (m) => m.gapMs), fmt.gap)
].filter(Boolean);

// The app's dark theme, verbatim.
const COLORS = {
  bg: 'hsl(228, 7%, 14%)', // --dark-background-color-1
  surface: 'hsl(225, 8%, 20%)', // --dark-background-color-2
  line: 'hsl(225, 8%, 24%)',
  text: 'hsl(0, 0%, 100%)', // --dark-text-color
  muted: 'hsl(225, 8%, 62%)',
  nora: 'hsl(225, 8%, 42%)',
  nemora: 'hsl(213, 80%, 78%)', // --dark-text-color-highlight
  win: 'hsl(151, 55%, 62%)',
  loss: 'hsl(354, 78%, 72%)'
};

/**
 * A percentage of a tiny base misleads both ways, so past 3x the change is a multiple. Lower is
 * better on every row; a silence gone entirely has no multiple.
 */
const deltaOf = ({ a, b }) => {
  if (a === 0 && b === 0) return { text: 'even', tie: true };
  if (b === 0) return { text: 'gapless', better: true };
  if (a === 0) return { text: 'worse', better: false };
  const change = (b - a) / a;
  if (Math.abs(change) < 0.02) return { text: 'even', tie: true };
  const better = b < a;
  const ratio = b > a ? b / a : a / b;
  if (ratio >= 3) return { text: `${ratio.toFixed(ratio < 10 ? 1 : 0)}x`, better };
  return { text: `${change > 0 ? '+' : ''}${Math.round(change * 100)}%`, better };
};

const h = (type, props = {}, ...children) => ({
  type,
  props: { ...props, children: children.flat().filter((c) => c !== null && c !== false) }
});

const BAR_WIDTH = 330;
const bar = (value, max, color) =>
  h('div', {
    style: {
      display: 'flex',
      width: `${Math.max(4, (value / max) * BAR_WIDTH)}px`,
      height: '12px',
      borderRadius: '6px',
      background: color
    }
  });

const metricRow = (row, index) => {
  const max = Math.max(row.a, row.b) || 1;
  const delta = deltaOf(row);
  const line = (value, color, valueStyle) =>
    h(
      'div',
      { style: { display: 'flex', alignItems: 'center', gap: '14px' } },
      bar(value, max, color),
      h('div', { style: { display: 'flex', fontSize: '15px', ...valueStyle } }, row.format(value))
    );
  return h(
    'div',
    {
      style: {
        display: 'flex',
        alignItems: 'center',
        padding: '16px 30px',
        borderTop: index === 0 ? 'none' : `1px solid ${COLORS.line}`
      }
    },
    h('div', { style: { display: 'flex', width: '230px', fontSize: '18px', fontWeight: 400 } }, row.label),
    h(
      'div',
      { style: { display: 'flex', flexDirection: 'column', width: '450px', gap: '8px' } },
      line(row.a, COLORS.nora, { color: COLORS.muted }),
      line(row.b, COLORS.nemora, { color: COLORS.text, fontWeight: 500 })
    ),
    h(
      'div',
      {
        style: {
          display: 'flex',
          justifyContent: 'flex-end',
          width: '96px',
          fontSize: '20px',
          fontWeight: 500,
          color: delta.tie ? COLORS.muted : delta.better ? COLORS.win : COLORS.loss
        }
      },
      delta.text
    )
  );
};

const legendDot = (color, label) =>
  h(
    'div',
    { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
    h('div', { style: { display: 'flex', width: '11px', height: '11px', borderRadius: '6px', background: color } }),
    h('div', { style: { display: 'flex', fontSize: '15px', color: COLORS.muted } }, label)
  );
const legendName = (app) => [raw.apps[app].label, RUNTIME[app]].filter(Boolean).join(', ');

const card = h(
  'div',
  {
    style: {
      display: 'flex',
      flexDirection: 'column',
      width: '940px',
      padding: '26px',
      background: COLORS.bg,
      fontFamily: 'Poppins',
      color: COLORS.text
    }
  },
  h('div', { style: { display: 'flex', flexDirection: 'column', background: COLORS.surface, borderRadius: '14px' } }, rows.map(metricRow)),
  h(
    'div',
    { style: { display: 'flex', gap: '26px', padding: '18px 30px 4px 30px' } },
    legendDot(COLORS.nora, legendName(A)),
    legendDot(COLORS.nemora, legendName(B))
  )
);

const FACES = ['Poppins-Regular', 'Poppins-Medium', 'Poppins-SemiBold'];
const fontDir = join(ROOT, 'card-fonts');
if (FACES.some((face) => !existsSync(join(fontDir, `${face}.ttf`)))) {
  mkdirSync(fontDir, { recursive: true });
  const source = resolve(here, '../../apps/desktop/src/renderer/src/assets/fonts');
  const convert = spawnSync(
    'python',
    [
      '-c',
      'import sys\nfrom fontTools.ttLib import TTFont\nfor face in sys.argv[3:]:\n f = TTFont(f"{sys.argv[1]}/{face}.woff2"); f.flavor = None; f.save(f"{sys.argv[2]}/{face}.ttf")',
      source,
      fontDir,
      ...FACES
    ],
    { encoding: 'utf8' }
  );
  if (convert.status !== 0) throw new Error(`converting the fonts needs Python with fontTools:\n${convert.stderr}`);
}
const font = (face) => readFileSync(join(fontDir, `${face}.ttf`));

const svg = await satori(card, {
  width: 940,
  fonts: [
    { name: 'Poppins', data: font('Poppins-Regular'), weight: 400, style: 'normal' },
    { name: 'Poppins', data: font('Poppins-Medium'), weight: 500, style: 'normal' },
    { name: 'Poppins', data: font('Poppins-SemiBold'), weight: 600, style: 'normal' }
  ]
});
const png = new Resvg(svg, { fitTo: { mode: 'width', value: 1880 } }).render().asPng();
const out = option('out') ?? join(ROOT, 'results', 'benchmark.png');
writeFileSync(out, png);
console.log(`wrote ${out} (${(png.length / 1024).toFixed(0)} KB)`);

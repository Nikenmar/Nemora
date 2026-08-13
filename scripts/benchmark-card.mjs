#!/usr/bin/env node
/**
 * Renders docs/tauri-port/benchmark-raw.json into the README's benchmark card.
 *
 * Deliberately minimal: no title, no methodology, no process counts. The
 * README carries all of that in text, where it can be read, corrected and
 * linked. A picture repeating it just makes the picture noisy, and the
 * conditions of a measurement are exactly the part that should not be baked
 * into a raster.
 *
 * Styled from the app's own dark tokens (tailwind.config.js / styles.css) and
 * set in Poppins, so the card looks like a page of the player rather than a
 * generic chart. Satori cannot read woff2, so the fonts are converted to ttf
 * by scripts/bench-fonts.py first.
 *
 * Satori implements flexbox only, so every box declares `display: flex`,
 * including ones with a single text child; it throws otherwise.
 *
 * No number here is typed by hand. Everything is read from the raw JSON, so
 * the card cannot drift away from the measurement.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(readFileSync(join(root, 'docs/tauri-port/benchmark-raw.json'), 'utf8'));

/**
 * The library build, measured separately and folded in here.
 *
 * Parsing every track and encoding every cover is the heaviest thing either
 * player does, and neither scans on startup - so it cannot live in the same
 * harness as the launch measurements. `bench-scan.mjs` times it from the
 * profile on disk after a human clicks "add folder"; this reads what it wrote.
 * Absent file, absent row.
 */
const scanPath = join(root, 'docs/tauri-port/benchmark-scan.json');
const scan = existsSync(scanPath) ? JSON.parse(readFileSync(scanPath, 'utf8')) : { runs: [] };
const scanOf = (needle) =>
  scan.runs?.find((run) => run.label.toLowerCase().includes(needle));
const { electron, tauri } = data.results;


const h = (type, props = {}, ...children) => ({
  type,
  props: { ...props, children: children.flat().filter((c) => c !== null && c !== false) }
});

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
 * The legend names the builds that were actually measured, taken from the raw
 * JSON like every other value on this card. Versions typed by hand are versions
 * that go stale the first time the comparison is re-run against something else.
 *
 * "Nora 3.1.0-stable (Electron)" reads as "Nora 3.1.0, Electron".
 */
const legendName = (label) =>
  label.replace(/-stable\b/g, '').replace(/\s*\(([^)]+)\)\s*$/u, ', $1');

const fmt = {
  mb: (bytes) => `${Math.round(bytes / 1048576)} MB`,
  seconds: (ms) => `${(ms / 1000).toFixed(2)} s`,
  percent: (value) => `${value.toFixed(2)} %`
};

const rows = [
  {
    label: 'Installed on disk',
    a: electron.installedBytes,
    b: tauri.installedBytes,
    format: fmt.mb
  },
  // Drawn only when BOTH sides actually have an installer to measure.
  //
  // A portable copy has none, and the row then showed "0 MB" against Nemora's
  // 27 MB - which reads as an installer that weighs nothing rather than as a
  // measurement that does not exist. An absent row says that honestly.
  electron.installerBytes > 0 &&
    tauri.installerBytes > 0 && {
      label: 'Installer download',
      a: electron.installerBytes,
      b: tauri.installerBytes,
      format: fmt.mb
    },
  {
    label: 'Window on screen',
    a: electron.startup.windowMedianMs,
    b: tauri.startup.windowMedianMs,
    format: fmt.seconds
  },
  // "Ready to use" (CPU going quiet) is deliberately NOT on the card.
  //
  // It measures when all startup work stops, and both players spend part of
  // that time on a network call to their own update feed. Nemora's is
  // suppressed while it is being measured, Nora 3.1.0 has no setting that turns
  // its own off - so the row would compare one player with its update check
  // silenced against one without, in Nemora's favour. The two medians came out
  // within 0.06 s of each other anyway (3.69 s and 3.75 s), which is a fair
  // result to state in prose and a misleading one to draw as a bar.
  //
  // What the card does show is `Window on screen`, which no update check can
  // move.
  // The two memory rows are NOT the same number said twice, and their old
  // names ("working set", "private") were jargon nobody reads off a picture.
  //
  //   RAM in use          - what Task Manager shows: physical memory the app
  //                         occupies right now, shared Windows libraries and all.
  //   RAM it alone holds  - the part that belongs to this app only and cannot
  //                         be shared with anything else. It is the better
  //                         predictor of what a second copy would cost.
  {
    label: 'RAM in use',
    a: electron.memory.workingSetBytes,
    b: tauri.memory.workingSetBytes,
    format: fmt.mb
  },
  {
    label: 'RAM it alone holds',
    a: electron.memory.privateBytes,
    b: tauri.memory.privateBytes,
    format: fmt.mb
  },
  {
    label: 'RAM at its hungriest',
    a: electron.memory.peakWorkingSetBytes,
    b: tauri.memory.peakWorkingSetBytes,
    format: fmt.mb
  },
  // `CPU, idle` is off the card for the same reason as `Ready to use`, and it
  // is worth being explicit that this was the ONE row Nemora lost.
  //
  // The idle window opens the moment the settle point is reached, so
  // suppressing Nemora's update check - which is what made its settle honest -
  // also moved its idle window earlier, into work Nora had already finished by
  // the time its own window opened. Across three runs the medians were 0.13,
  // 0.13 and 1.39 % for Nemora against 0.25, 5.21 and 1.01 % for Nora: swings
  // far larger than the difference being claimed. Both figures live in the raw
  // JSON; neither belongs in a picture.
  // Only drawn when BOTH sides were confirmed to be producing sound during the
  // measurement. The harness discards silent runs; if a player never managed an
  // audible one, the row is absent rather than fabricated from an app sitting
  // on an error dialog, which is exactly how this row was wrong the first time.
  electron.playback?.confirmedAudible > 0 &&
    tauri.playback?.confirmedAudible > 0 && {
      label: 'CPU while a track plays',
      a: electron.playback.cpuPercent,
      b: tauri.playback.cpuPercent,
      format: fmt.percent
    },
  // Songs parsed and covers encoded, for the same 300 tracks. Both players are
  // doing identical work here, so the row is a like-for-like time and the one
  // most of this port went into.
  scanOf('nora') &&
    scanOf('nemora') && {
      label: 'Building a 300-track library',
      a: scanOf('nora').completeMs,
      b: scanOf('nemora').completeMs,
      format: fmt.seconds
    },
  electron.playback?.confirmedAudible > 0 &&
    tauri.playback?.confirmedAudible > 0 && {
      label: 'RAM while a track plays',
      a: electron.playback.workingSetBytes,
      b: tauri.playback.workingSetBytes,
      format: fmt.mb
    }
].filter(Boolean);

/**
 * A percentage of a tiny base misleads in both directions: "+1900%" reads as a
 * catastrophe when the move is 0.4% to 7% of one core, and the same trick can
 * dress a trivial win as enormous. Past 3x it is shown as a multiple. Lower is
 * better for every row on this card.
 */
const deltaOf = (row) => {
  if (!row.a || !row.b) return null;
  const change = (row.b - row.a) / row.a;
  if (Math.abs(change) < 0.02) return { text: 'even', tie: true };
  const better = row.b < row.a;
  const ratio = row.b > row.a ? row.b / row.a : row.a / row.b;
  if (ratio >= 3) return { text: `${ratio.toFixed(ratio < 10 ? 1 : 0)}x`, better };
  return { text: `${change > 0 ? '+' : ''}${Math.round(change * 100)}%`, better };
};

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
  const max = Math.max(row.a ?? 0, row.b ?? 0) || 1;
  const delta = deltaOf(row);
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
    h(
      'div',
      {
        style: {
          display: 'flex',
          width: '230px',
          fontSize: '18px',
          fontWeight: 400,
          color: COLORS.text
        }
      },
      row.label
    ),
    h(
      'div',
      { style: { display: 'flex', flexDirection: 'column', width: '450px', gap: '8px' } },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: '14px' } },
        bar(row.a ?? 0, max, COLORS.nora),
        h(
          'div',
          { style: { display: 'flex', fontSize: '15px', color: COLORS.muted } },
          row.format(row.a)
        )
      ),
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: '14px' } },
        bar(row.b ?? 0, max, COLORS.nemora),
        h(
          'div',
          { style: { display: 'flex', fontSize: '15px', fontWeight: 500, color: COLORS.text } },
          row.format(row.b)
        )
      )
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
          color: delta && !delta.tie ? (delta.better ? COLORS.win : COLORS.loss) : COLORS.muted
        }
      },
      delta ? delta.text : ''
    )
  );
};

const legendDot = (color, label) =>
  h(
    'div',
    { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
    h('div', {
      style: { display: 'flex', width: '11px', height: '11px', borderRadius: '6px', background: color }
    }),
    h('div', { style: { display: 'flex', fontSize: '15px', color: COLORS.muted } }, label)
  );

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
  h(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        background: COLORS.surface,
        borderRadius: '14px'
      }
    },
    rows.map(metricRow)
  ),
  h(
    'div',
    { style: { display: 'flex', gap: '26px', padding: '18px 30px 4px 30px' } },
    legendDot(COLORS.nora, legendName(electron.label)),
    legendDot(COLORS.nemora, legendName(tauri.label))
  )
);

const FONT_DIR = process.env.NEMORA_FONT_DIR ?? 'E:/tmp/nemora-fonts';
const font = (file) => {
  const path = join(FONT_DIR, file);
  if (!existsSync(path)) {
    throw new Error(`missing ${path}; run: python scripts/bench-fonts.py`);
  }
  return readFileSync(path);
};

const svg = await satori(card, {
  width: 940,
  fonts: [
    { name: 'Poppins', data: font('Poppins-Regular.ttf'), weight: 400, style: 'normal' },
    { name: 'Poppins', data: font('Poppins-Medium.ttf'), weight: 500, style: 'normal' },
    { name: 'Poppins', data: font('Poppins-SemiBold.ttf'), weight: 600, style: 'normal' }
  ]
});
const png = new Resvg(svg, { fitTo: { mode: 'width', value: 1880 } }).render().asPng();

const out = join(root, 'resources/features/benchmark.png');
writeFileSync(out, png);
process.stdout.write(`wrote ${out} (${(png.length / 1024).toFixed(0)} KB)\n`);

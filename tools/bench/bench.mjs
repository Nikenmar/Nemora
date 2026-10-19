#!/usr/bin/env node
/**
 * Nora 3.1.0 against Nemora 2.0, measured from outside and driven from inside.
 *
 *   node tools/bench/bench.mjs prepare --root <folder> [--source <music folder>]... [--count 400]
 *   node tools/bench/bench.mjs run     --root <folder> [--quick] [--only nora|nemora] [--phases scan,startup,ui,playback]
 *   node tools/bench/bench.mjs report  --root <folder>
 *
 * ONE FOLDER HOLDS EVERYTHING. `prepare` fills it with a seeded sample of real tracks (hard links)
 * and a bench.json naming the two builds; `run` gives every launch a fresh subfolder and starts the
 * app with `--bench=<subfolder>`, which both builds understand: profile, renderer state, logs, temp
 * files all stay inside it. Deleting the folder removes every trace.
 *
 * THE RULES, each one paid for by an earlier, wrong benchmark (vault: nemora/BenchmarkHarness):
 *  - Both sides run the same scenario through the same code (tools/bench/app/bench.ts, built into
 *    both views); each app only says where its own data lives.
 *  - Every number comes from Windows, not from the app: the window on screen, CPU and memory of the
 *    WHOLE process tree, sound from the audio session peak meter.
 *  - A playback run with no sound is discarded, never averaged.
 *  - Memory is the private working set (what Task Manager shows), sampled over a window at the same
 *    age for both players, not a peak caught at a lucky moment.
 *  - The real profiles are fingerprinted around every launch; any change stops the benchmark.
 *  - Launches alternate between the players, so drift (heat, background work) hits both alike.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { launch } from './lib/launch.mjs';
import { createGuard, runningPlayers } from './lib/guard.mjs';
import { buildLibrary, installedMusicFolders } from './lib/library.mjs';
import { quietAt, reduce } from './lib/metrics.mjs';
import { writeReport } from './lib/report.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const argv = process.argv.slice(2);
const command = argv[0];
const option = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i > -1 ? argv[i + 1] : fallback;
};
const options = (name) => argv.flatMap((a, i) => (a === `--${name}` ? [argv[i + 1]] : []));
const flag = (name) => argv.includes(`--${name}`);

const rootArg = option('root');
if (!command || !rootArg) {
  console.error('usage: node tools/bench/bench.mjs prepare|run|report --root <folder> [options]');
  process.exit(1);
}
const ROOT = resolve(rootArg);
const CONFIG = join(ROOT, 'bench.json');

/** The newest file in `dir` whose name matches. */
function newest(dir, pattern) {
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((f) => pattern.test(f))
    .map((f) => join(dir, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return files[0] ?? null;
}

function defaultApps() {
  const nora = 'E:/NemoraBench/nora-3.1.0';
  return {
    nora: {
      label: 'Nora 3.1.0',
      exe: join(nora, 'dist/win-unpacked/Nora.exe'),
      // Sizes are the official release's: the bench build differs from it only by the hooks.
      installer: 'E:/tmp/Nora.v3.1.0-stable-win-x64.exe',
      installed: 'E:/tmp/nora-3.1.0-portable'
    },
    nemora: {
      label: 'Nemora 2.0',
      exe: join(REPO, 'target/release/nemora.exe'),
      installer: newest(join(REPO, 'target/release/bundle/nsis'), /^Nemora_.*-setup\.exe$/),
      // The installer places the binary and its uninstaller; the binary is the whole program.
      installed: join(REPO, 'target/release/nemora.exe')
    }
  };
}

// ---------------------------------------------------------------------------------------------
// prepare

async function prepare() {
  mkdirSync(ROOT, { recursive: true });
  let sources = options('source');
  if (!sources.length) sources = await installedMusicFolders();
  if (!sources.length) throw new Error('no music folder found; pass --source <folder>');
  const count = Number(option('count', 400));
  const seed = Number(option('seed', 20261019));
  const lib = buildLibrary({ root: ROOT, sources, count, seed });
  const config = {
    createdAt: new Date().toISOString(),
    seed,
    library: lib.library,
    tracks: lib.tracks,
    play: lib.play,
    queries: lib.queries,
    apps: defaultApps(),
    runs: { scan: 3, startup: 5, ui: 3, playback: 3 }
  };
  writeFileSync(CONFIG, JSON.stringify(config, null, 2));
  console.log(`library: ${lib.tracks.length} tracks of ${lib.available} (${lib.linked} linked, ${lib.copied} copied)`);
  console.log(`playback tracks: ${Object.entries(lib.play).map(([f, n]) => `${f}: ${n}`).join(', ') || 'none found'}`);
  if (!lib.screened) console.log('  WARNING: ffmpeg not found, playback tracks were chosen by size and not checked for quiet passages');
  console.log(`search terms: ${lib.queries.join(', ')}`);
  for (const [key, app] of Object.entries(config.apps)) {
    console.log(`${key}: ${app.exe} ${existsSync(app.exe) ? '' : '(MISSING)'}`);
  }
  console.log(`\nwrote ${CONFIG}; edit it to change builds or run counts, then: run --root ${ROOT}`);
}

// ---------------------------------------------------------------------------------------------
// run

function fileVersion(exe) {
  return (
    spawnSync('powershell', ['-NoProfile', '-Command', `(Get-Item '${exe}').VersionInfo.FileVersion`], {
      encoding: 'utf8'
    }).stdout?.trim() || null
  );
}

function sizeOf(path) {
  if (!path || !existsSync(path)) return null;
  const stat = statSync(path);
  if (!stat.isDirectory()) return stat.size;
  let total = 0;
  for (const entry of readdirSync(path, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) total += statSync(join(entry.parentPath ?? entry.path, entry.name)).size;
  }
  return total;
}

function phases(config, quick) {
  const lib = config.library;
  const n = config.tracks.length;
  const steady = quick ? { steadyFromMs: 20_000, steadyForMs: 5_000 } : { steadyFromMs: 60_000, steadyForMs: 10_000 };
  const listen = quick ? { listenFromMs: 3_000, listenForMs: 8_000 } : { listenFromMs: 5_000, listenForMs: 20_000 };
  const pageOrder = ['Songs', 'Albums', 'Artists', 'Genres', 'Playlists', 'Home'];
  const again = ['Albums', 'Artists', 'Genres', 'Playlists', 'Home', 'Songs'];
  const runs = (key) => (quick ? 1 : config.runs[key]);
  const playFormats = Object.entries(config.play ?? {});

  return [
    {
      key: 'scan',
      runs: runs('scan'),
      variants: [null],
      // Not a first launch: see the priming below.
      seedFrom: 'blank',
      timeoutMs: 25 * 60_000,
      scenario: () => ({
        library: lib,
        steps: [
          { do: 'home' },
          { do: 'addFolder', expect: n },
          { do: 'waitSignal', name: 'continue', timeoutMs: 20 * 60_000 },
          { do: 'quit' }
        ]
      }),
      // The scan is over when the songs are listed, the colours are done, and the CPU has gone quiet.
      tick: (app) => {
        let finishedAt = null;
        return {
          onTick: ({ marks, events, signal }) => {
            if (finishedAt) return;
            const listed = marks.find((m) => m.name === 'scan-listed')?.at;
            const colours = app === 'nora' ? marks.find((m) => m.name === 'palettes-done')?.at : listed;
            if (!listed || !colours) return;
            const quiet = quietAt(events, Math.max(listed, colours));
            if (quiet) {
              finishedAt = quiet;
              signal('continue');
            }
          },
          finishedAt: () => finishedAt
        };
      },
      reduce: (result, ctx) => reduce.scan(result, ctx)
    },
    {
      key: 'startup',
      runs: runs('startup'),
      variants: [null],
      seedFrom: 'base',
      timeoutMs: 5 * 60_000,
      scenario: () => ({
        library: lib,
        steps: [{ do: 'ready' }, { do: 'wait', ms: steady.steadyFromMs + steady.steadyForMs + 2_000 }, { do: 'quit' }]
      }),
      reduce: (result) => reduce.startup(result, steady)
    },
    {
      key: 'ui',
      runs: runs('ui'),
      variants: [null],
      seedFrom: 'base',
      timeoutMs: 5 * 60_000,
      scenario: () => ({
        library: lib,
        steps: [
          { do: 'ready' },
          { do: 'wait', ms: 4_000 },
          ...pageOrder.map((page) => ({ do: 'page', page, label: `${page} (first)` })),
          ...again.map((page) => ({ do: 'page', page, label: `${page} (again)` })),
          ...config.queries.map((query) => ({ do: 'search', query })),
          { do: 'scroll', ms: quick ? 3_000 : 8_000 },
          { do: 'wait', ms: 1_000 },
          { do: 'quit' }
        ]
      }),
      reduce: (result) => reduce.ui(result)
    },
    {
      key: 'playback',
      runs: runs('playback'),
      variants: playFormats.map(([format]) => format),
      seedFrom: 'base',
      timeoutMs: 5 * 60_000,
      scenario: (format) => ({
        library: lib,
        steps: [
          { do: 'ready' },
          { do: 'wait', ms: 3_000 },
          { do: 'play', path: join(lib, config.play[format]) },
          { do: 'wait', ms: listen.listenFromMs + listen.listenForMs + 3_000 },
          { do: 'quit' }
        ]
      }),
      reduce: (result) => reduce.playback(result, listen)
    }
  ];
}

function saveRaw(raw) {
  mkdirSync(join(ROOT, 'results'), { recursive: true });
  writeFileSync(join(ROOT, 'results', 'raw.json'), JSON.stringify(raw, null, 2));
}

async function run() {
  if (!existsSync(CONFIG)) throw new Error(`no ${CONFIG}; run prepare first`);
  const config = JSON.parse(readFileSync(CONFIG, 'utf8'));
  const quick = flag('quick');
  const only = option('only');
  const wanted = option('phases')?.split(',') ?? null;
  const appKeys = Object.keys(config.apps).filter((key) => !only || key === only);

  for (const key of appKeys) {
    if (!existsSync(config.apps[key].exe)) throw new Error(`missing build for ${key}: ${config.apps[key].exe}`);
  }
  const running = runningPlayers();
  if (running.length) {
    throw new Error(
      `close every Nemora and Nora first (the tray too); running now:\n  ${running.join('\n  ')}\n` +
        'They would share the machine with the measurement, and the guard could not tell their writes from a leak.'
    );
  }
  const guard = createGuard();

  const raw = {
    startedAt: new Date().toISOString(),
    quick,
    machine: {
      cpu: os.cpus()[0]?.model?.trim(),
      cores: os.cpus().length,
      memoryBytes: os.totalmem(),
      windows: os.release()
    },
    library: { tracks: config.tracks.length, play: config.play, queries: config.queries },
    apps: Object.fromEntries(
      appKeys.map((key) => {
        const app = config.apps[key];
        return [
          key,
          {
            label: app.label,
            version: fileVersion(app.exe),
            installerBytes: sizeOf(app.installer),
            installedBytes: sizeOf(app.installed)
          }
        ];
      })
    ),
    launches: []
  };
  saveRaw(raw);

  const all = phases(config, quick).filter((phase) => !wanted || wanted.includes(phase.key));
  const base = (app) => join(ROOT, 'base', app);
  const failedScan = new Set();
  const record = (entry) => {
    raw.launches.push(entry);
    saveRaw(raw);
    if (!entry.isolation.ok) {
      console.log('ISOLATION BROKEN');
      console.log(
        [
          ...entry.isolation.escaped.map((e) => `outside the folder: ${e.join(' ')}`),
          ...entry.isolation.leaks
        ].join('\n')
      );
      throw new Error('stopped: a run reached outside its folder');
    }
  };

  // The profile every scan starts from: each player opened twice on an empty profile and closed, as
  // by someone who has started it before adding music. Not a ritual: Nora 3.1.0 records its store
  // migrations only on the SECOND launch, and that launch runs the 3.0.0 migration, which empties
  // the library. A scan measured on a never-opened profile would be wiped by the next launch.
  if (all.some((phase) => phase.seedFrom === 'blank')) {
    for (const key of appKeys) {
      for (const pass of [1, 2]) {
        const name = `prime-${key}-${pass}`;
        process.stdout.write(`${name.padEnd(28)} `);
        const result = await launch({
          app: { key, exe: config.apps[key].exe },
          dir: join(ROOT, 'blank', key),
          keep: pass === 2,
          seed: null,
          scenario: { steps: [{ do: 'home' }, { do: 'wait', ms: 3_000 }, { do: 'quit' }] },
          timeoutMs: 2 * 60_000,
          guard
        });
        const ok = result.outcome === 'done';
        record({
          phase: 'prime',
          variant: null,
          app: key,
          run: pass,
          outcome: result.outcome,
          isolation: result.isolation,
          metrics: { ok, prime: true }
        });
        console.log(ok ? 'ok' : `FAILED (${result.outcome})`);
        if (!ok) failedScan.add(key);
        await sleep(2_000);
      }
    }
  }

  for (const phase of all) {
    for (const variant of phase.variants) {
      for (let i = 0; i < phase.runs; i += 1) {
        // Alternate who goes first, so drift does not always land on the same player.
        const order = i % 2 === 0 ? appKeys : [...appKeys].reverse();
        for (const key of order) {
          const seed = join(ROOT, phase.seedFrom, key);
          if (failedScan.has(key) || !existsSync(seed)) continue;
          const app = { key, exe: config.apps[key].exe };
          const name = `${phase.key}${variant ? `-${variant}` : ''}-${key}-${i + 1}`;
          const dir = join(ROOT, 'runs', name);
          process.stdout.write(`${name.padEnd(28)} `);
          const tick = phase.tick?.(key);
          const result = await launch({
            app,
            dir,
            seed,
            scenario: phase.scenario(variant),
            timeoutMs: phase.timeoutMs,
            guard,
            onTick: tick?.onTick
          });
          result.finishedAt = tick?.finishedAt() ?? null;
          writeFileSync(join(dir, 'events.jsonl'), result.events.map((e) => JSON.stringify(e)).join('\n'));

          const metrics = result.outcome === 'done' ? phase.reduce(result, { app: key }) : { ok: false };
          const entry = {
            phase: phase.key,
            variant,
            app: key,
            run: i + 1,
            outcome: result.outcome,
            forced: result.forced,
            isolation: result.isolation,
            error: result.marks.find((m) => m.name === 'error')?.data,
            metrics
          };
          record(entry);
          const why = entry.error?.message ?? metrics.reason ?? result.outcome;
          console.log(metrics.ok ? 'ok' : `DISCARDED (${why})`);

          if (phase.key === 'scan') {
            if (metrics.ok && !existsSync(base(key))) {
              // The first good scan becomes the library every later launch starts from.
              mkdirSync(base(key), { recursive: true });
              for (const part of ['profile', 'webview']) {
                if (existsSync(join(dir, part))) cpSync(join(dir, part), join(base(key), part), { recursive: true });
              }
            }
          }
          await sleep(3_000);
        }
      }
    }
    if (phase.key === 'scan') for (const key of appKeys) if (!existsSync(base(key))) failedScan.add(key);
  }

  raw.finishedAt = new Date().toISOString();
  saveRaw(raw);
  const out = writeReport(ROOT, raw);
  console.log(`\nwrote ${out}`);
}

// ---------------------------------------------------------------------------------------------

try {
  if (command === 'prepare') await prepare();
  else if (command === 'run') await run();
  else if (command === 'report') {
    const raw = JSON.parse(readFileSync(join(ROOT, 'results', 'raw.json'), 'utf8'));
    console.log(`wrote ${writeReport(ROOT, raw)}`);
  } else throw new Error(`unknown command ${command}`);
} catch (error) {
  console.error(`\n${error.message}`);
  process.exit(1);
}

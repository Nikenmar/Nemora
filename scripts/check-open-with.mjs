#!/usr/bin/env node
/**
 * How reliably does "Open with Nemora" actually play the file?
 *
 * The Electron build turned out to fail intermittently on the same corpus
 * ("MEDIA_ELEMENT_ERROR: Format error"), which is what invalidated the
 * benchmark's playback row. Intermittent is the worst kind of answer, so this
 * asks the same question of Nemora directly and counts, rather than trusting
 * one launch that happened to work.
 *
 * Success is read from the app's own stderr: the renderer forwards console
 * errors to the log, and a failed load prints a player error there. Silence
 * across the whole window is a play.
 */

import { spawn, spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? Number(process.argv[i + 1]) : fallback;
};

const RUNS = arg('runs', 5);
const WATCH_MS = arg('watch', 14_000);
const BENCH = (process.env.NEMORA_BENCH_DIR ?? 'E:/tmp/nemora-bench2').replaceAll('\\', '/');
const CORPUS = `${BENCH}/music`;
const exe = join(root, 'src-tauri', 'target', 'release', 'nemora.exe');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ps = (script) =>
  spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8'
  }).stdout ?? '';

const stopTree = (rootPid) => {
  ps(`
    $all = Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId
    $want = New-Object System.Collections.Generic.HashSet[int]
    [void]$want.Add(${rootPid})
    for ($i=0; $i -lt 8; $i++) { foreach ($q in $all) { if ($want.Contains([int]$q.ParentProcessId)) { [void]$want.Add([int]$q.ProcessId) } } }
    foreach ($id in $want) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
  `);
};

const tracks = readdirSync(CORPUS)
  .filter((f) => /\.(flac|mp3)$/i.test(f))
  .sort();

const failures = [];
let played = 0;

for (let run = 0; run < RUNS; run += 1) {
  // A different track each run: a per-file problem and a race look identical
  // if the same file is used every time.
  const track = join(CORPUS, tracks[(run * 37) % tracks.length]);

  spawnSync('python', [join(root, 'scripts', 'bench-seed.py'), `${BENCH}/tauri/Nemora`], {
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
  });

  let log = '';
  const child = spawn(exe, [track], {
    env: { ...process.env, NEMORA_PROFILE_DIR: `${BENCH}/tauri/Nemora`.replaceAll('/', '\\') }
  });
  child.stderr.on('data', (chunk) => (log += chunk.toString()));
  child.stdout.on('data', (chunk) => (log += chunk.toString()));

  await sleep(WATCH_MS);

  // ANY forwarded console error counts as a failure, not just the ones whose
  // text I can guess. Error objects reach the log as "[object Object]", so a
  // check that grepped for SONG_DATA_SEND_FAILED reported a clean run while
  // the app was showing exactly that dialog.
  const errors = log
    .split(/\r?\n/)
    .filter((line) => line.includes('[ERROR]'))
    .slice(0, 3);
  const broke = errors.length > 0;
  if (broke) failures.push({ run: run + 1, track: track.split('\\').pop(), errors });
  else played += 1;
  process.stdout.write(
    `run ${run + 1}/${RUNS} ${broke ? 'FAILED' : 'played'}  ${track.split('\\').pop()}\n`
  );
  for (const line of errors) process.stdout.write(`    ${line.slice(0, 150)}\n`);

  stopTree(child.pid);
  await sleep(2500);
}

process.stdout.write(`\nplayed ${played}/${RUNS}\n`);
for (const failure of failures) process.stdout.write(`  failed: run ${failure.run} ${failure.track}\n`);

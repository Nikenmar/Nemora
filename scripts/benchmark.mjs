#!/usr/bin/env node
/**
 * Nora (Electron) vs Nemora (Tauri), measured rather than asserted.
 *
 * THE RULE THIS EXISTS TO ENFORCE: no number is recorded for a state the app
 * was not actually in. The first version of this harness published "Electron
 * 0.68% CPU while playing" for a player that was producing no sound at all,
 * because it inferred playback from CPU rising off idle and memory growing,
 * which a failed load also does. Windows knows whether an app is rendering
 * audio, so every playback run is now gated on the audio session meter and a
 * silent run is discarded, never averaged.
 *
 * The other rules, unchanged:
 *  - BOTH sides are release builds. A debug Rust binary would flatter Electron.
 *  - The WHOLE process tree is counted. Electron spawns a main, a renderer, a
 *    GPU process and utilities; Tauri spawns msedgewebview2.exe children.
 *  - Both run from the SAME 300-track library, seeded from one base copy, with
 *    the audio files left in their real location. Copies in a scratch folder
 *    are what the Electron build silently refuses to play.
 *  - The stores are restored before every run, so no run inherits the last
 *    one's state.
 *  - Nothing is killed by name; only the measured tree is stopped.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? Number(process.argv[i + 1]) : fallback;
};

const RUNS = arg('runs', 5);
const PLAYBACK_RUNS = arg('playback-runs', 3);

const SETTLE_CPU_PERCENT = 8;
const SETTLE_STABLE_MS = 2000;
const SETTLE_TIMEOUT_MS = 120_000;
const IDLE_SAMPLE_MS = 12_000;
const PLAYBACK_WARMUP_MS = 24_000;
const PLAYBACK_SAMPLE_S = 20;
const SAMPLE_INTERVAL_MS = 250;
/** Both players run well under ten processes; anything near this is a mismatched tree. */
const MAX_TREE_PROCESSES = 32;

const BENCH = (process.env.NEMORA_BENCH_DIR ?? 'E:/tmp/nemora-bench2').replaceAll('\\', '/');
const profileScript = join(root, 'scripts', 'bench-profiles.py');
const audioProbe = join(root, 'scripts', 'audio-probe.ps1');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sum = (rows, key) => rows.reduce((a, r) => a + (r[key] ?? 0), 0);
const median = (values) => {
  const s = values.filter((v) => v != null).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const spread = (values) => {
  const clean = values.filter((v) => v != null);
  return clean.length ? { min: Math.min(...clean), max: Math.max(...clean) } : null;
};

const ps = (script) =>
  spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024
  }).stdout ?? '';

const treePreamble = (rootPid) => `
  $all = Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name
  $want = New-Object System.Collections.Generic.HashSet[int]
  [void]$want.Add(${rootPid})
  for ($i = 0; $i -lt 8; $i++) {
    foreach ($p in $all) { if ($want.Contains([int]$p.ParentProcessId)) { [void]$want.Add([int]$p.ProcessId) } }
  }
`;

function processTree(rootPid) {
  const raw = ps(`${treePreamble(rootPid)}
    $out = foreach ($id in $want) {
      $proc = Get-Process -Id $id -ErrorAction SilentlyContinue
      if ($proc) {
        [pscustomobject]@{
          pid = $id; name = $proc.ProcessName
          ws = $proc.WorkingSet64; priv = $proc.PrivateMemorySize64
          cpu = $proc.TotalProcessorTime.TotalSeconds
          threads = $proc.Threads.Count; handles = $proc.HandleCount
        }
      }
    }
    $out | ConvertTo-Json -Compress -Depth 3
  `);
  if (!raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

/** A discrete event both players reach the same way; CPU settling is too noisy alone. */
function hasWindow(rootPid) {
  const raw = ps(`${treePreamble(rootPid)}
    $found = 0
    foreach ($id in $want) {
      $proc = Get-Process -Id $id -ErrorAction SilentlyContinue
      if ($proc -and $proc.MainWindowHandle -ne 0) { $found = 1 }
    }
    $found
  `);
  return raw.trim() === '1';
}

/** Peak audio meter plus CPU over the same window. The gate for playback runs. */
function probeAudioAndCpu(rootPid, seconds) {
  const raw = spawnSync(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-File', audioProbe, '-RootPid', String(rootPid), '-Seconds', String(seconds)],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
  ).stdout;
  try {
    return JSON.parse((raw ?? '').trim());
  } catch {
    return null;
  }
}

function stopTree(rootPid) {
  ps(`${treePreamble(rootPid)}
    foreach ($id in $want) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
  `);
}

function directorySize(path) {
  if (!existsSync(path)) return null;
  let total = 0;
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else
        try {
          total += statSync(full).size;
        } catch {
          /* vanished mid-walk */
        }
    }
  };
  const stat = statSync(path);
  if (stat.isDirectory()) walk(path);
  else total = stat.size;
  return total;
}

function newestMatching(dir, match) {
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((f) => match.test(f))
    .map((f) => ({ file: join(dir, f), at: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.at - a.at);
  return files[0]?.file ?? null;
}

const restoreProfiles = () =>
  spawnSync('python', [profileScript, 'restore'], {
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
  });

// The Electron side is whatever build is being compared against, so it comes
// from the environment rather than a path baked in here. Defaults point at an
// installed Nora; `NEMORA_BENCH_ELECTRON_DIR` is the install directory, which
// is also what the installed-size figure is measured from.
const ELECTRON_DIR = (
  process.env.NEMORA_BENCH_ELECTRON_DIR ?? join(root, 'dist', 'win-unpacked')
).replaceAll('\\', '/');
const ELECTRON_LABEL = process.env.NEMORA_BENCH_ELECTRON_LABEL ?? 'Nora (Electron)';
const ELECTRON_INSTALLER = process.env.NEMORA_BENCH_ELECTRON_INSTALLER ?? null;
const TAURI_LABEL = process.env.NEMORA_BENCH_TAURI_LABEL ?? 'Nemora (Tauri)';

const targets = [
  {
    key: 'electron',
    label: ELECTRON_LABEL,
    exe: join(ELECTRON_DIR, 'Nora.exe'),
    profileDir: `${BENCH}/electron/Nora`,
    // ELECTRON IGNORES `APPDATA`. It resolves its data directory through the
    // Windows known-folder API, so setting that variable - which is what this
    // did - left the app reading the REAL profile: 1745 songs against the 300
    // the other side was given, which flattered every memory figure on the
    // card. Verified twice, through a shell launch and through spawn with an
    // explicit environment; only the Chromium switch actually redirects it.
    // Forward slashes deliberately: Chromium accepts them on Windows, and a
    // backslash path is one escaping mistake away from being mangled into a
    // directory that does not exist - which happened, and Chromium answers that
    // by quietly falling back to the default profile, which is the real one.
    args: [`--user-data-dir=${BENCH}/electron/Nora`],
    installedPath: ELECTRON_DIR,
    installer: () =>
      ELECTRON_INSTALLER ?? newestMatching(join(root, 'dist'), /-win-x64\.exe$/)
  },
  {
    key: 'tauri',
    label: TAURI_LABEL,
    exe: join(root, 'src-tauri', 'target', 'release', 'nemora.exe'),
    profileDir: `${BENCH}/tauri/Nemora`,
    env: { NEMORA_PROFILE_DIR: `${BENCH}\\tauri\\Nemora`.replaceAll('/', '\\') },
    // The NSIS script places exactly one file in $INSTDIR: the binary. The
    // WebView2 bootstrapper goes to $TEMP, because the runtime is a shared
    // Windows component rather than a private copy. That difference IS the
    // size difference, and the README says so rather than implying magic.
    // Suppresses the startup update check. Without it the settle metric times a
    // request to GitHub rather than the app: one machine produced 3.6 s and
    // 11.8 s for the SAME build on two runs an hour apart.
    benchmarkMode: true,
    installedPath: join(root, 'src-tauri', 'target', 'release', 'nemora.exe'),
    installer: () =>
      newestMatching(join(root, 'src-tauri', 'target', 'release', 'bundle', 'nsis'), /^Nemora_.*-setup\.exe$/)
  }
];

/**
 * The environment a measured launch runs in.
 *
 * `benchmarkMode` is set on the target rather than passed at the call site so a
 * new measurement cannot forget it: every launch of a build that understands
 * the flag is quiet by construction.
 */
const childEnv = (target) => ({
  ...process.env,
  ...target.env,
  ...(target.benchmarkMode ? { NEMORA_BENCHMARK_MODE: '1' } : {})
});

async function measureStartup(target) {
  restoreProfiles();
  const started = Date.now();
  const child = spawn(target.exe, [...(target.args ?? [])], { env: childEnv(target), stdio: 'ignore' });
  const rootPid = child.pid;

  let peakWorkingSet = 0;
  let peakPrivate = 0;
  let settledAt = null;
  let windowAt = null;
  let calmSince = null;
  let previous = null;

  while (Date.now() - started < SETTLE_TIMEOUT_MS) {
    await sleep(SAMPLE_INTERVAL_MS);
    const tree = processTree(rootPid);
    if (tree.length === 0) break;
    if (windowAt === null && hasWindow(rootPid)) windowAt = Date.now();

    peakWorkingSet = Math.max(peakWorkingSet, sum(tree, 'ws'));
    peakPrivate = Math.max(peakPrivate, sum(tree, 'priv'));

    const cpuSeconds = sum(tree, 'cpu');
    const now = Date.now();
    if (previous) {
      const percent = ((cpuSeconds - previous.cpu) / ((now - previous.at) / 1000)) * 100;
      if (percent < SETTLE_CPU_PERCENT) {
        calmSince ??= now;
        if (now - calmSince >= SETTLE_STABLE_MS) {
          settledAt = now - SETTLE_STABLE_MS;
          break;
        }
      } else calmSince = null;
    }
    previous = { cpu: cpuSeconds, at: now };
  }

  const before = processTree(rootPid);
  const idleStart = Date.now();
  await sleep(IDLE_SAMPLE_MS);
  const after = processTree(rootPid);
  const idleSeconds = (Date.now() - idleStart) / 1000;

  const result = {
    windowMs: windowAt ? windowAt - started : null,
    startupMs: settledAt ? settledAt - started : null,
    workingSetBytes: after.length ? sum(after, 'ws') : null,
    privateBytes: after.length ? sum(after, 'priv') : null,
    peakWorkingSetBytes: peakWorkingSet || null,
    idleCpuPercent:
      after.length && before.length ? ((sum(after, 'cpu') - sum(before, 'cpu')) / idleSeconds) * 100 : null,
    processCount: after.length || null
  };

  stopTree(rootPid);
  await sleep(2500);
  return result;
}

async function measurePlayback(target, track) {
  restoreProfiles();
  const child = spawn(target.exe, [...(target.args ?? []), track], { env: childEnv(target), stdio: 'ignore' });
  const rootPid = child.pid;

  await sleep(PLAYBACK_WARMUP_MS);
  const probe = probeAudioAndCpu(rootPid, PLAYBACK_SAMPLE_S);

  stopTree(rootPid);
  await sleep(2500);
  if (!probe) return { audible: false, reason: 'probe failed' };
  return {
    audible: probe.producedSound === true,
    peak: probe.peak,
    audibleTicks: probe.audibleTicks,
    totalTicks: probe.totalTicks,
    cpuPercent: probe.cpuPercent,
    workingSetMb: probe.workingSetMb
  };
}

const tracks = JSON.parse(readFileSync(`${BENCH}/tracks.json`, 'utf8'));
const results = {};

for (const target of targets) {
  if (!existsSync(target.exe)) throw new Error(`missing build: ${target.exe}`);
  process.stdout.write(`\n${target.label}\n`);

  const startups = [];
  const rejected = [];
  for (let run = 1; run <= RUNS; run += 1) {
    process.stdout.write(`  startup ${run}/${RUNS} ... `);
    const one = await measureStartup(target);
    // A tree that suddenly holds twenty times the processes is not this app.
    //
    // Descendants are found by walking parent ids, so a recycled pid grafts an
    // unrelated subtree onto ours: one run reported 139 processes and 5.4 GB
    // where every other run of the same build reported 7 and 500 MB. Averaging
    // that in would publish a number for a state the app was never in, which is
    // the one thing this harness exists to prevent.
    if (one.processCount && one.processCount > MAX_TREE_PROCESSES) {
      rejected.push({ run, reason: 'implausible process tree', ...one });
      process.stdout.write(`REJECTED, ${one.processCount} processes in the tree
`);
      run -= 1;
      if (rejected.length > RUNS) throw new Error('the process tree never settled to a plausible size');
      continue;
    }
    startups.push(one);
    process.stdout.write(
      `window ${one.windowMs ? (one.windowMs / 1000).toFixed(2) : '?'} s, ` +
        `idle ${one.startupMs ? (one.startupMs / 1000).toFixed(2) : '?'} s, ` +
        `${one.workingSetBytes ? Math.round(one.workingSetBytes / 1048576) : '?'} MB\n`
    );
  }

  const playbacks = [];
  let attempts = 0;
  while (playbacks.length < PLAYBACK_RUNS && attempts < PLAYBACK_RUNS * 3) {
    const track = tracks[(attempts * 41) % tracks.length];
    attempts += 1;
    process.stdout.write(`  playback ${playbacks.length + 1}/${PLAYBACK_RUNS} ... `);
    const one = await measurePlayback(target, track);
    if (!one.audible) {
      process.stdout.write(`SILENT, discarded (${track.split('\\').pop()})\n`);
      continue;
    }
    playbacks.push(one);
    process.stdout.write(`${one.cpuPercent.toFixed(2)} % CPU, ${one.workingSetMb} MB, peak ${one.peak}\n`);
  }

  const installer = target.installer();
  results[target.key] = {
    label: target.label,
    runs: RUNS,
    installerBytes: installer ? statSync(installer).size : null,
    installedBytes: directorySize(target.installedPath),
    startup: {
      windowMedianMs: median(startups.map((r) => r.windowMs)),
      windowSpreadMs: spread(startups.map((r) => r.windowMs)),
      medianMs: median(startups.map((r) => r.startupMs)),
      spreadMs: spread(startups.map((r) => r.startupMs))
    },
    memory: {
      workingSetBytes: median(startups.map((r) => r.workingSetBytes)),
      privateBytes: median(startups.map((r) => r.privateBytes)),
      peakWorkingSetBytes: median(startups.map((r) => r.peakWorkingSetBytes))
    },
    idle: { cpuPercent: median(startups.map((r) => r.idleCpuPercent)) },
    playback: {
      confirmedAudible: playbacks.length,
      discarded: attempts - playbacks.length,
      cpuPercent: median(playbacks.map((r) => r.cpuPercent)),
      workingSetBytes: median(playbacks.map((r) => r.workingSetMb * 1048576))
    },
    processes: { count: median(startups.map((r) => r.processCount)) },
    raw: { startups, playbacks, rejected }
  };
}

const outPath = join(root, 'docs', 'tauri-port', 'benchmark-raw.json');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(
  outPath,
  JSON.stringify(
    {
      measuredAt: new Date().toISOString(),
      library: { songs: tracks.length, note: 'Sampled from the real library; audio files stay in place.' },
      playbackGate: 'Windows audio session peak meter; silent runs discarded.',
      results
    },
    null,
    2
  )
);
process.stdout.write(`\nwrote ${outPath}\n`);

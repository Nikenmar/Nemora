/**
 * One measured launch: a fresh run folder, the app started with `--bench=<folder>`, the sampler
 * watching its process tree, the marks the app writes, and the proof that nothing left the folder.
 */
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const HERE = dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Starts the sampler and resolves once it has compiled and is waiting for a pid. */
async function startSampler(capture) {
  const child = spawn(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(HERE, 'sampler.ps1'), ...(capture ? ['-Capture'] : [])],
    { stdio: ['pipe', 'pipe', 'pipe'] }
  );
  const events = [];
  let stderr = '';
  child.stderr.on('data', (chunk) => (stderr += chunk));
  const lines = createInterface({ input: child.stdout });
  await new Promise((resolveReady, reject) => {
    const timer = setTimeout(() => reject(new Error(`sampler did not start: ${stderr}`)), 60_000);
    lines.on('line', (line) => {
      if (line === 'ready') {
        clearTimeout(timer);
        resolveReady();
        return;
      }
      try {
        events.push(JSON.parse(line));
      } catch {
        /* not ours */
      }
    });
    child.on('exit', () => reject(new Error(`sampler exited: ${stderr}`)));
  });
  return {
    events,
    watch: (pid) => child.stdin.write(`watch ${pid}\n`),
    stop: async () => {
      child.stdin.write('stop\n');
      await Promise.race([new Promise((r) => child.on('exit', r)), sleep(3000)]);
      child.kill();
    }
  };
}

function readMarks(dir) {
  const file = join(dir, 'marks.jsonl');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

const inside = (root, path) => {
  const rel = relative(resolve(root), resolve(path));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

/** Kills exactly the tree of `pid`, nothing found by name. */
function killTree(pid) {
  return new Promise((r) => spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }).on('exit', r));
}

/**
 * @param {object} o
 * @param {{key: string, exe: string}} o.app
 * @param {string} o.dir           the run folder; wiped first
 * @param {string|null} o.seed     a base folder copied in first (the profile after a scan)
 * @param {object} o.scenario      { library, steps }
 * @param {number} o.timeoutMs
 * @param {object} o.guard         from guard.mjs
 * @param {Function} [o.onTick]    called every 250 ms with ({ marks, events, signal }); `signal(name)`
 *                                 creates the file a `waitSignal` step is waiting for
 * @param {boolean} [o.keep]       reuse the folder as it is (a second launch on the same profile)
 * @param {boolean} [o.capture]    also record the device's output and report its silences
 */
export async function launch({ app, dir, seed, scenario, timeoutMs, guard, onTick, keep = false, capture = false }) {
  if (!keep) rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  // Only the app's state is carried over; a stale marks file would read as a finished scenario.
  if (seed) {
    for (const part of ['profile', 'webview']) {
      if (existsSync(join(seed, part))) cpSync(join(seed, part), join(dir, part), { recursive: true });
    }
  }
  for (const stale of ['marks.jsonl', 'events.jsonl', 'bench-env.json', 'continue']) rmSync(join(dir, stale), { force: true });
  writeFileSync(join(dir, 'scenario.json'), JSON.stringify(scenario, null, 2));

  const before = guard.fingerprint();
  const sampler = await startSampler(capture);
  const spawnedAt = Date.now();
  const child = spawn(app.exe, [`--bench=${dir}`], { cwd: dirname(app.exe), stdio: 'ignore', detached: false });
  sampler.watch(child.pid);

  let exited = false;
  child.on('exit', () => (exited = true));
  const deadline = spawnedAt + timeoutMs;
  let marks = [];
  let outcome = 'timeout';
  while (Date.now() < deadline) {
    await sleep(250);
    marks = readMarks(dir);
    onTick?.({ marks, events: sampler.events, signal: (name) => writeFileSync(join(dir, name), '') });
    if (marks.some((m) => m.name === 'error')) {
      outcome = 'error';
      break;
    }
    if (marks.some((m) => m.name === 'done')) {
      outcome = 'done';
      break;
    }
    if (exited) {
      outcome = 'exited early';
      break;
    }
  }
  // The scenario quits by itself; give it time to flush its stores before anything is forced.
  const quitBy = Date.now() + 20_000;
  while (!exited && Date.now() < quitBy) await sleep(100);
  const forced = !exited;
  if (forced) await killTree(child.pid);
  // The tree, not just the root: WebView2 and Chromium children outlive the window briefly.
  await sleep(1500);
  await sampler.stop();
  marks = readMarks(dir);

  const env = existsSync(join(dir, 'bench-env.json')) ? JSON.parse(readFileSync(join(dir, 'bench-env.json'), 'utf8')) : null;
  const escaped = env
    ? Object.entries(env.paths ?? {}).filter(([, path]) => path && !inside(dir, path))
    : [['bench-env.json', 'missing']];
  // A redirect that did not take is silent: the webview falls back to its default folder. The
  // folder having been created here is the proof that it did take.
  for (const key of ['profile', 'webview', 'userData']) {
    const path = env?.paths?.[key];
    if (path && !existsSync(path)) escaped.push([key, `${path} was never created`]);
  }
  const leaks = guard.compare(before, guard.fingerprint());

  return {
    spawnedAt,
    outcome,
    forced,
    marks,
    events: sampler.events,
    env,
    isolation: { escaped, leaks, ok: escaped.length === 0 && leaks.length === 0 }
  };
}

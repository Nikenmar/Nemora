#!/usr/bin/env node
/**
 * Automated port-defect check.
 *
 * Builds the Tauri shell, runs it against a COPY of a real profile with the
 * self-check flag set, and fails on anything the unit suite structurally cannot
 * see: a channel that throws, a channel that hangs, a console error nobody
 * displayed, or a response whose shape drifted from a recorded baseline.
 *
 * Every defect found during the first live run belonged to that class -
 * window.api undefined at module scope, a stale CSP blocking IPC, a missing
 * global Buffer, external fetch dying on CORS, and a channel quietly returning
 * the 50x50 artwork variant instead of the full one.
 *
 *   node scripts/port-check.mjs                  check against the baseline
 *   node scripts/port-check.mjs --update-baseline  record the current shapes
 *
 * Exit code 0 means no regressions.
 */
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = process.env.NEMORA_CHECK_SANDBOX ?? 'E:/tmp/nemora-portcheck/Nemora';
const reportPath = join(root, 'port-check-report.json');
const baselinePath = join(root, 'docs', 'tauri-port', 'api-baseline.json');
const updateBaseline = process.argv.includes('--update-baseline');

// Seed from Nemora's own profile when it exists, otherwise from Nora's, so the
// check has real data to work against on a machine that has not run Nemora yet.
const nemoraProfile = join(process.env.APPDATA ?? '', 'Nemora');
const realProfile = existsSync(nemoraProfile)
  ? nemoraProfile
  : join(process.env.APPDATA ?? '', 'Nora');

function die(message) {
  console.error(`\n  FAIL  ${message}\n`);
  process.exit(1);
}

// 1. Fresh copy of the profile. The check must never touch the real one: the
//    only reason we know that matters is that an earlier run, believing APPDATA
//    would sandbox it, wrote to it. Tauri resolves dataDir() through the
//    Windows known-folder API and ignores that variable.
if (!existsSync(realProfile)) die(`no profile to copy at ${realProfile}`);
rmSync(sandbox, { recursive: true, force: true });
mkdirSync(sandbox, { recursive: true });
console.log(`  copying profile -> ${sandbox}`);
cpSync(realProfile, sandbox, { recursive: true });

// 2. Build.
console.log('  building tauri shell...');
execFileSync('npm', ['run', 'tauri:build', '--', '--debug', '--no-bundle'], {
  cwd: root,
  stdio: 'inherit',
  shell: true
});

// 3. Run with the self-check flag. The app writes the report and exits itself.
rmSync(reportPath, { force: true });
console.log('  running self-check...');
const exe = join(root, 'src-tauri', 'target', 'debug', 'nemora.exe');
const child = spawn(exe, [], {
  env: {
    ...process.env,
    NEMORA_PROFILE_DIR: sandbox.replaceAll('/', '\\'),
    NEMORA_SELFCHECK_OUT: reportPath.replaceAll('\\', '/')
  },
  stdio: 'ignore'
});

const timeout = setTimeout(() => {
  child.kill();
  die('the app never finished its self-check (120s). It probably failed before startup completed.');
}, 120_000);

child.on('exit', () => {
  clearTimeout(timeout);
  if (!existsSync(reportPath)) {
    die('no report was written. The renderer likely crashed before the check ran - look at the app log.');
  }

  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  const { ok, threw, timeout: timedOut, skipped } = report.summary;
  console.log(`\n  channels: ${ok} ok, ${threw} threw, ${timedOut} timed out, ${skipped} skipped`);

  const problems = [];

  for (const r of report.results.filter((x) => x.status === 'threw' || x.status === 'timeout')) {
    problems.push(`${r.channel}: ${r.status} - ${r.error}`);
  }
  for (const message of report.consoleErrors) {
    problems.push(`console error: ${message}`);
  }

  // 4. Shape drift against the baseline. This is what catches a channel that
  //    still "works" but returns something subtly different - the artwork
  //    regression returned a valid path, just the wrong variant.
  if (updateBaseline) {
    const shapes = Object.fromEntries(
      report.results.filter((r) => r.status === 'ok').map((r) => [r.channel, r.shape])
    );
    mkdirSync(dirname(baselinePath), { recursive: true });
    writeFileSync(baselinePath, JSON.stringify(shapes, null, 2) + '\n');
    console.log(`\n  baseline written: ${Object.keys(shapes).length} channels\n`);
    process.exit(0);
  }

  if (existsSync(baselinePath)) {
    const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
    for (const r of report.results.filter((x) => x.status === 'ok')) {
      const was = baseline[r.channel];
      if (was !== undefined && was !== r.shape) {
        problems.push(`${r.channel}: shape changed\n      was: ${was}\n      now: ${r.shape}`);
      }
    }
  } else {
    console.log('  (no baseline yet - run with --update-baseline to record one)');
  }

  if (problems.length > 0) {
    console.error('\n  PORT CHECK FAILED\n');
    for (const p of problems) console.error(`    - ${p}`);
    console.error('');
    process.exit(1);
  }

  console.log('\n  PORT CHECK PASSED\n');
  process.exit(0);
});

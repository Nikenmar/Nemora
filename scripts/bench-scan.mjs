#!/usr/bin/env node
/**
 * Times the one thing the rest of the benchmark cannot: building a library.
 *
 * Parsing every track and producing every cover is the heaviest work either
 * player does, and it is the work most of this port went into - but neither
 * player scans on startup, so no harness can trigger it without a human. What
 * IS automatable is the measurement: this watches a profile directory and
 * reports when the catalogue and the covers stop growing.
 *
 * So one click is yours and every number is the machine's:
 *
 * ```text
 * node scripts/bench-scan.mjs --profile "E:\tmp\bench\Nemora" --label "Nemora 1.0.5"
 * ```
 *
 * Then add the music folder in the app. The script prints a result when the
 * library has stopped changing, and appends it to docs/tauri-port/benchmark-scan.json
 * so the two players can be compared afterwards.
 *
 * IT MEASURES BOTH HALVES SEPARATELY, because they finish at different times
 * and the difference is the point: songs appear first and are usable, covers
 * follow. A player that shows nothing until every cover is encoded is doing the
 * same work in a worse order, and one figure would hide that.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const flag = (name, fallback = null) => {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : fallback;
};

const profile = flag('profile');
const label = flag('label', 'unnamed build');
const expected = Number(flag('expect', 0));
/** How long nothing may change before the library counts as finished. */
const QUIET_MS = Number(flag('quiet', 6000));
const POLL_MS = 250;

if (!profile) {
  console.error(
    'usage: node scripts/bench-scan.mjs --profile <dir> [--label <name>] [--expect <songs>]'
  );
  process.exit(1);
}

const songsFile = join(profile, 'songs.json');
const coversDir = join(profile, 'song_covers');

const countSongs = () => {
  try {
    const raw = JSON.parse(readFileSync(songsFile, 'utf8'));
    const songs = Array.isArray(raw) ? raw : raw.songs;
    return Array.isArray(songs) ? songs.length : 0;
  } catch {
    // Mid-write, or not written yet. Both are "no answer", not zero.
    return null;
  }
};

const countCovers = () => {
  try {
    return readdirSync(coversDir).filter((name) => name.endsWith('.webp')).length;
  } catch {
    return 0;
  }
};

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`;

console.log(`watching ${profile}`);
console.log(`build:    ${label}`);
console.log('\nAdd the music folder in the app now. Timing starts at the first song.\n');

const baselineSongs = countSongs() ?? 0;
const baselineCovers = countCovers();

let startedAt = null;
let songsDoneAt = null;
let coversDoneAt = null;
let lastChangeAt = Date.now();
let songs = baselineSongs;
let covers = baselineCovers;
let printed = '';

for (;;) {
  await sleep(POLL_MS);
  const nowSongs = countSongs();
  const nowCovers = countCovers();
  const now = Date.now();

  if (nowSongs !== null && nowSongs !== songs) {
    songs = nowSongs;
    lastChangeAt = now;
    startedAt ??= now;
    // The catalogue is finished when it reaches the expected count, or when it
    // simply stops moving - checked below.
    if (expected && songs - baselineSongs >= expected) songsDoneAt ??= now;
  }
  if (nowCovers !== covers) {
    covers = nowCovers;
    lastChangeAt = now;
    startedAt ??= now;
  }

  if (startedAt) {
    const line = `songs +${songs - baselineSongs}, covers +${covers - baselineCovers}, ${seconds(now - startedAt)}`;
    if (line !== printed) {
      process.stdout.write(`\r${line.padEnd(70)}`);
      printed = line;
    }
    if (now - lastChangeAt >= QUIET_MS) {
      coversDoneAt = lastChangeAt;
      songsDoneAt ??= lastChangeAt;
      break;
    }
  }
}

// Two anchors, both recorded. The click is the honest one; the first-write
// anchor stays so runs published before this change remain comparable.
const total = coversDoneAt - clickedAt;
const toSongs = songsDoneAt - clickedAt;
const firstWriteMs = startedAt ? startedAt - clickedAt : null;
const legacyCompleteMs = startedAt ? coversDoneAt - startedAt : null;
const legacyUsableMs = startedAt ? songsDoneAt - startedAt : null;
const addedSongs = songs - baselineSongs;
const addedCovers = covers - baselineCovers;

console.log('\n');
console.log(`${label}`);
console.log(`  songs added        ${addedSongs}`);
console.log(`  covers written     ${addedCovers}`);
console.log(`  library usable     ${seconds(toSongs)}   (every song listed and playable)`);
console.log(`  everything done    ${seconds(total)}   (covers finished too)`);
console.log(`  per track          ${(total / Math.max(addedSongs, 1)).toFixed(0)} ms`);

const outPath = join(root, 'docs', 'tauri-port', 'benchmark-scan.json');
mkdirSync(dirname(outPath), { recursive: true });
const previous = existsSync(outPath) ? JSON.parse(readFileSync(outPath, 'utf8')) : { runs: [] };
previous.runs = previous.runs.filter((run) => run.label !== label);
previous.runs.push({
  label,
  measuredAt: new Date().toISOString(),
  profile,
  songsAdded: addedSongs,
  coversWritten: addedCovers,
  usableMs: toSongs,
  completeMs: total,
  msPerTrack: total / Math.max(addedSongs, 1),
  /** How long the app worked before it wrote anything at all. */
  firstWriteMs,
  /** The old first-write anchor, kept so earlier runs stay comparable. */
  legacyUsableMs,
  legacyCompleteMs,
  startAnchor: process.argv.includes('--start-now') ? 'script' : 'operator-click'
});
previous.note =
  'Timed from the operator clicking "add folder" to the library going quiet, which ' +
  'includes the reading and parsing that happens before a player writes anything. ' +
  'Both halves are reported: songs listed, then covers finished, plus how long the ' +
  'app worked before its first write. Runs recorded before 2026-08-17 used the first ' +
  'write as the anchor instead, which measured how a player BATCHES its writes rather ' +
  'than how fast it scans: a player that commits its catalogue in one go scored 0.0 s ' +
  'for "library usable". Those runs carry no startAnchor field and are not comparable ' +
  'with the ones that do.';
writeFileSync(outPath, JSON.stringify(previous, null, 2));
console.log(`\nwrote ${outPath}`);

if (previous.runs.length >= 2) {
  const [slow, fast] = [...previous.runs].sort((a, b) => b.completeMs - a.completeMs);
  console.log(
    `\n${fast.label} finished the same work ${(slow.completeMs / fast.completeMs).toFixed(1)}x faster than ${slow.label}.`
  );
}

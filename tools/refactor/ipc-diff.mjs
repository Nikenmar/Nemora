// PLAN/21 protocol: compare IPC traces recorded by the stand (`shots.mjs --probe
// tools/refactor/ipc-tour.js --ipc-trace file.json`).
//
// What must be identical: the set of distinct calls - each command with the digest of its
// arguments and of its answer. Answers of commands that read the clock (this week's insights, the
// mix, Smart Shuffle's weights on the map) are compared by their arguments only. How many times a
// call repeats follows render timing, not the code, so a different count is reported as a note.
//
//   node tools/refactor/ipc-diff.mjs before.json after.json
//   node tools/refactor/ipc-diff.mjs before1.json before2.json ... -- after.json
//
// With several runs of the old build around the new one (old, new, old, minutes apart), a call of
// the new run counts as the same when any old run made it, and a call every old run made must be
// in the new one. That is what separates the code from the clock: the mix of the day draws from
// windows measured back from `now`, so its songs change from one minute to the next on the same
// build (measured 2026-11-03), and the stand's network capture sometimes starts after the first
// call (smtc_update) of a run.
import { readFileSync } from 'node:fs';

/** Commands whose answers follow the clock: their arguments must match, their answers may not. */
const CLOCKED = /^(stats_insights|stats_dashboard|taste_map|smart_lists|mix_of_day|mega_shuffle_data|shuffle_explain|skip_context|engine_position)$/;

const load = (path) => JSON.parse(readFileSync(path, 'utf8')).trace;
const key = (call) => (CLOCKED.test(call.cmd) ? `${call.cmd} ${call.args}` : `${call.cmd} ${call.args} -> ${call.result}`);
const count = (trace) => {
  const map = new Map();
  for (const call of trace) map.set(key(call), (map.get(key(call)) ?? 0) + 1);
  return map;
};

const args = process.argv.slice(2);
const split = args.indexOf('--');
const beforePaths = split >= 0 ? args.slice(0, split) : args.slice(0, 1);
const afterPath = split >= 0 ? args[split + 1] : args[1];
const befores = beforePaths.map(load);
const after = load(afterPath);
const cbs = befores.map(count);
const ca = count(after);

const missing = [];
const notes = [];
const inAny = (k) => cbs.some((c) => c.has(k));
const inAll = (k) => cbs.every((c) => c.has(k));
for (const k of new Set([...cbs.flatMap((c) => [...c.keys()]), ...ca.keys()])) {
  const y = ca.get(k) ?? 0;
  if (y > 0 && !inAny(k)) missing.push(`new only     ${k}`);
  else if (y === 0 && inAll(k)) missing.push(`old only     ${k}`);
  else if (y === 0) notes.push(`in some old runs only  ${k}`);
  else if (cbs.some((c) => (c.get(k) ?? 0) !== y)) notes.push(`count ${cbs.map((c) => c.get(k) ?? 0).join('/')} -> ${y}  ${k}`);
}
console.log(
  `IPC before ${befores.map((t) => t.length).join('/')} calls, after ${after.length}: ${missing.length} difference(s), ${notes.length} note(s)`
);
for (const line of missing.sort()) console.log(`  DIFF ${line}`);
for (const line of notes.sort()) console.log(`  note ${line}`);
process.exitCode = missing.length === 0 ? 0 : 1;

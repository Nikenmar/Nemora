// PLAN/21 protocol: compare two IPC traces recorded by the stand (`shots.mjs --probe
// tools/refactor/ipc-tour.js --ipc-trace file.json`).
//
// What must be identical: the set of distinct calls - each command with the digest of its
// arguments and of its answer. Answers of commands that read the clock (this week's insights, the
// mix, Smart Shuffle's weights on the map) are compared by their arguments only. How many times a
// call repeats follows render timing, not the code, so a different count is reported as a note.
//
//   node tools/refactor/ipc-diff.mjs before.json after.json
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

const [a, b] = process.argv.slice(2).map(load);
const ca = count(a);
const cb = count(b);
const missing = [];
const notes = [];
for (const k of new Set([...ca.keys(), ...cb.keys()])) {
  const x = ca.get(k) ?? 0;
  const y = cb.get(k) ?? 0;
  if ((x === 0) !== (y === 0)) missing.push(`${x} -> ${y}  ${k}`);
  else if (x !== y) notes.push(`${x} -> ${y}  ${k}`);
}
console.log(`IPC before ${a.length} calls, after ${b.length}: ${missing.length} difference(s), ${notes.length} repeat count(s) changed`);
for (const line of missing.sort()) console.log(`  DIFF ${line}`);
for (const line of notes.sort()) console.log(`  note ${line}`);
process.exitCode = missing.length === 0 ? 0 : 1;

// PLAN/21 protocol: the stand's pixel diff. Compares every PNG of two shot runs
// (E:/tmp/nemora-shots/<label>/png) pixel by pixel and reports, per shot, how many pixels differ
// and where (their bounding box); a shot missing on either side is a difference too.
//
//   node tools/refactor/pixel-diff.mjs <before-label> <after-label> [--out <dir>] [--stable]
//
// With --stable, only the shots in stable-shots.txt (identical across three runs of one build) must
// match; a difference elsewhere is reported as a note and never fails the run.
//
// With --out, each differing shot gets a diff image: the after picture dimmed, the changed pixels
// in red, to see at once what moved.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(resolve(import.meta.dirname, '../../apps/desktop/package.json'));
const { PNG } = require('pngjs');

const ROOT = 'E:/tmp/nemora-shots';
const [before, after] = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--out');
const outAt = process.argv.indexOf('--out');
const STABLE = process.argv.includes('--stable')
  ? new Set(
      readFileSync(resolve(import.meta.dirname, 'stable-shots.txt'), 'utf8')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'))
    )
  : null;
const out = outAt > 0 ? process.argv[outAt + 1] : '';
if (!before || !after) {
  console.error('usage: pixel-diff.mjs <before-label> <after-label> [--out <dir>]');
  process.exit(2);
}
const dir = (label) => join(ROOT, label, 'png');
const names = new Set([...readdirSync(dir(before)), ...readdirSync(dir(after))].filter((n) => n.endsWith('.png')));
if (out) mkdirSync(out, { recursive: true });

let differing = 0;
let notes = 0;
const fail = (name, line) => {
  if (STABLE && !STABLE.has(name)) {
    notes += 1;
    console.log(`note ${line}`);
  } else {
    differing += 1;
    console.log(`DIFF ${line}`);
  }
};
for (const name of [...names].sort()) {
  const a = join(dir(before), name);
  const b = join(dir(after), name);
  if (!existsSync(a) || !existsSync(b)) {
    fail(name, `${name}: only in ${existsSync(a) ? before : after}`);
    continue;
  }
  const pa = PNG.sync.read(readFileSync(a));
  const pb = PNG.sync.read(readFileSync(b));
  if (pa.width !== pb.width || pa.height !== pb.height) {
    fail(name, `${name}: size ${pa.width}x${pa.height} -> ${pb.width}x${pb.height}`);
    continue;
  }
  let count = 0;
  let [x0, y0, x1, y1] = [Infinity, Infinity, -1, -1];
  const mark = out ? new PNG({ width: pb.width, height: pb.height }) : null;
  for (let y = 0; y < pa.height; y++) {
    for (let x = 0; x < pa.width; x++) {
      const i = (y * pa.width + x) * 4;
      const same =
        pa.data[i] === pb.data[i] && pa.data[i + 1] === pb.data[i + 1] && pa.data[i + 2] === pb.data[i + 2] && pa.data[i + 3] === pb.data[i + 3];
      if (mark) {
        mark.data[i] = same ? pb.data[i] >> 2 : 255;
        mark.data[i + 1] = same ? pb.data[i + 1] >> 2 : 0;
        mark.data[i + 2] = same ? pb.data[i + 2] >> 2 : 0;
        mark.data[i + 3] = 255;
      }
      if (!same) {
        count += 1;
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    }
  }
  if (count > 0) {
    fail(name, `${name}: ${count} px in [${x0},${y0}]-[${x1},${y1}]`);
    if (mark) writeFileSync(join(out, name), PNG.sync.write(mark));
  }
}
console.log(`PIXELS ${names.size} shots, ${differing} differing${STABLE ? ` among the ${STABLE.size} stable, ${notes} dynamic noted` : ''}`);
process.exitCode = differing === 0 ? 0 : 1;

// Node baseline for TEST 3 — this is what the current Electron main process does.
import { readFile, open } from 'node:fs/promises';
import { parseFile, parseBuffer } from 'music-metadata';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { bench } = require('./files.json');

const HEAD_BYTES = 256 * 1024;

async function armParseFile(paths) {
  let ok = 0;
  const t0 = performance.now();
  for (const p of paths) {
    try { await parseFile(p, { duration: false }); ok++; } catch { /* ignore */ }
  }
  return { ms: performance.now() - t0, ok, bytes: 0 };
}

async function armHead(paths) {
  let ok = 0, bytes = 0;
  const t0 = performance.now();
  for (const p of paths) {
    try {
      const fh = await open(p, 'r');
      const buf = Buffer.alloc(HEAD_BYTES);
      const { bytesRead } = await fh.read(buf, 0, HEAD_BYTES, 0);
      await fh.close();
      const slice = buf.subarray(0, bytesRead);
      bytes += slice.byteLength;
      await parseBuffer(slice, undefined, { duration: false });
      ok++;
    } catch { /* ignore */ }
  }
  return { ms: performance.now() - t0, ok, bytes };
}

async function armWhole(paths) {
  let ok = 0, bytes = 0;
  const t0 = performance.now();
  for (const p of paths) {
    try {
      const buf = await readFile(p);
      bytes += buf.byteLength;
      await parseBuffer(buf, undefined, { duration: false });
      ok++;
    } catch { /* ignore */ }
  }
  return { ms: performance.now() - t0, ok, bytes };
}

function report(name, n, r) {
  const mb = r.bytes / 1048576;
  const rate = mb > 0 ? `${(mb / (r.ms / 1000)).toFixed(0)} MB/s` : '-';
  console.log(
    `${name.padEnd(14)} ${(r.ms / 1000).toFixed(2).padStart(7)}s  ` +
    `${(r.ms / n).toFixed(1).padStart(7)} ms/file  ` +
    `parsed ${r.ok}/${n}  read ${mb.toFixed(0)} MB  ${rate}`
  );
}

const n = bench.length;
console.log(`Node ${process.version} baseline — ${n} files, head ${HEAD_BYTES / 1024} KB`);
console.log('arm            elapsed   per-file   parsed        read      rate');
report('node-parseFile', n, await armParseFile(bench));
report('node-head', n, await armHead(bench));
report('node-whole', n, await armWhole(bench));

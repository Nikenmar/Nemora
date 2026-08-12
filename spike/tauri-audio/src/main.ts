import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { readFile, open } from '@tauri-apps/plugin-fs';
import { parseBuffer } from 'music-metadata';
import files from '../bench/files.json';

const logEl = document.getElementById('log') as HTMLDivElement;

function log(msg: string, cls: '' | 'ok' | 'bad' | 'warn' | 'dim' = '') {
  const line = document.createElement('div');
  if (cls) line.className = cls;
  line.textContent = msg;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
  console.log(msg);
}

/**
 * Electron serves `nora://localfiles/<path>` directly. Tauri does NOT: on Windows
 * a custom scheme is reachable only as `http://<scheme>.localhost/<path>`, and
 * convertFileSrc is what produces the platform-correct form.
 */
function noraUrl(path: string) {
  return convertFileSrc(path, 'nora');
}

/** The Electron-shaped URL, kept to demonstrate that it resolves to nothing here. */
function electronStyleUrl(path: string) {
  return `nora://localfiles/${encodeURIComponent(path).replace(/%5C/gi, '/')}`;
}

const once = (el: EventTarget, ev: string, timeoutMs = 15000) =>
  new Promise<Event>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for "${ev}"`)), timeoutMs);
    el.addEventListener(ev, (e) => { clearTimeout(t); resolve(e); }, { once: true });
  });

// ---------------------------------------------------------------- test 1
/** Isolates "does the protocol answer at all" from "does <audio> accept it". */
async function probeProtocol(url: string) {
  log('--- protocol probe via fetch() ---', 'dim');
  try {
    const res = await fetch(url, { headers: { Range: 'bytes=0-1023' } });
    const body = await res.arrayBuffer();
    log(`  status ${res.status} ${res.statusText}`, res.status === 206 ? 'ok' : 'warn');
    log(`  content-type:  ${res.headers.get('content-type')}`, 'dim');
    log(`  content-range: ${res.headers.get('content-range')}`, 'dim');
    log(`  accept-ranges: ${res.headers.get('accept-ranges')}`, 'dim');
    log(`  bytes received: ${body.byteLength}`, body.byteLength === 1024 ? 'ok' : 'warn');
    // FLAC files start with the magic "fLaC"
    const magic = new TextDecoder().decode(new Uint8Array(body).subarray(0, 4));
    log(`  magic: ${JSON.stringify(magic)}`, magic === 'fLaC' ? 'ok' : 'bad');
    return res.status === 206 && body.byteLength === 1024;
  } catch (e) {
    log(`  fetch threw: ${(e as Error).message}`, 'bad');
    return false;
  }
}

async function testRangeSeek() {
  log('\n=== TEST 1: 206 Partial Content + seek ===');
  await invoke('clear_range_log');

  const probe = (files as any).probe.flac as string;
  log(`probe: ${probe}`, 'dim');
  log(`tauri url:    ${noraUrl(probe)}`, 'dim');
  log(`electron url: ${electronStyleUrl(probe)}`, 'dim');

  // Control A: the Electron-shaped nora:// URL, to show it is dead on Windows.
  log('--- control: Electron-shaped nora:// URL ---', 'dim');
  const electronOk = await probeProtocol(electronStyleUrl(probe));
  log(`electron-style URL → ${electronOk ? 'OK' : 'FAILED (expected on Windows)'}`, electronOk ? 'ok' : 'warn');

  // Control B: pure-ASCII path, so an encoding fault cannot masquerade as a
  // WebView2 limitation.
  const ascii = (files as any).probe.ascii as string;
  log(`ascii control: ${ascii}`, 'dim');
  const asciiOk = await probeProtocol(noraUrl(ascii));
  log(`ascii path → ${asciiOk ? 'OK' : 'FAILED'}`, asciiOk ? 'ok' : 'bad');

  const protocolOk = await probeProtocol(noraUrl(probe));
  log(`unicode path → ${protocolOk ? 'OK' : 'FAILED'}`, protocolOk ? 'ok' : 'bad');
  if (!protocolOk) {
    const reqs = (await invoke('get_range_log')) as string[];
    log(`handler saw ${reqs.length} request(s):`, reqs.length ? 'warn' : 'bad');
    reqs.slice(0, 6).forEach((r) => log(`   ${r}`, 'dim'));
    if (!reqs.length) log('  → the request never reached Rust: URL or scheme registration is wrong, not WebView2.', 'warn');
  }

  log(`canPlayType('audio/flac') = ${JSON.stringify(new Audio().canPlayType('audio/flac'))}`, 'dim');
  log(`canPlayType('audio/mpeg') = ${JSON.stringify(new Audio().canPlayType('audio/mpeg'))}`, 'dim');

  const audio = new Audio();
  audio.preload = 'auto';
  audio.src = noraUrl(probe);

  try {
    await once(audio, 'loadedmetadata');
  } catch (e) {
    log(`FAIL: metadata never loaded — ${(e as Error).message}`, 'bad');
    log(`      audio.error: ${audio.error?.code} ${audio.error?.message ?? ''}`, 'bad');
    const reqs = (await invoke('get_range_log')) as string[];
    log(`      handler saw ${reqs.length} request(s) during the audio load:`, 'dim');
    reqs.slice(-6).forEach((r) => log(`        ${r}`, 'dim'));
    return false;
  }
  log(`duration: ${audio.duration.toFixed(2)}s`, 'ok');

  // seek far into the file — this is what forces a Range request
  const target = audio.duration * 0.72;
  audio.currentTime = target;
  try {
    await once(audio, 'seeked');
  } catch (e) {
    log(`FAIL: seek never completed — ${(e as Error).message}`, 'bad');
    return false;
  }
  const drift = Math.abs(audio.currentTime - target);
  log(`seek → target ${target.toFixed(2)}s, landed ${audio.currentTime.toFixed(2)}s (drift ${drift.toFixed(3)}s)`,
      drift < 1 ? 'ok' : 'warn');

  // confirm playback actually advances after the seek
  await audio.play();
  const before = audio.currentTime;
  await new Promise((r) => setTimeout(r, 900));
  const advanced = audio.currentTime - before;
  audio.pause();
  log(`playback advanced ${advanced.toFixed(2)}s after seek`, advanced > 0.3 ? 'ok' : 'bad');

  const reqs = (await invoke('get_range_log')) as string[];
  log(`server saw ${reqs.length} request(s):`, 'dim');
  reqs.slice(0, 12).forEach((r) => log(`   ${r}`, 'dim'));
  const ranged = reqs.filter((r) => !r.includes('Range: <none>')).length;
  log(`ranged requests: ${ranged}/${reqs.length}`, ranged > 0 ? 'ok' : 'bad');

  const pass = drift < 1 && advanced > 0.3 && ranged > 0;
  log(pass ? 'TEST 1: PASS' : 'TEST 1: FAIL', pass ? 'ok' : 'bad');
  return pass;
}

// ---------------------------------------------------------------- test 2
async function testCorsDeclick() {
  log('\n=== TEST 2: CORS + MediaElementSource + gain ramp (declick) ===');
  const probe = (files as any).probe.flac as string;

  const audio = new Audio();
  audio.crossOrigin = 'anonymous'; // the whole question: does WebView2 allow this on nora://
  audio.preload = 'auto';
  audio.src = noraUrl(probe);

  try {
    await once(audio, 'canplay');
  } catch (e) {
    log(`FAIL: canplay never fired with crossOrigin=anonymous — ${(e as Error).message}`, 'bad');
    log(`      audio.error: ${audio.error?.code} ${audio.error?.message ?? ''}`, 'bad');
    log('      → CORS refused the request; declick is impossible on this path.', 'bad');
    return false;
  }
  log('canplay fired with crossOrigin=anonymous', 'ok');

  const ctx = new AudioContext();
  await ctx.resume();

  let source: MediaElementAudioSourceNode;
  try {
    source = ctx.createMediaElementSource(audio);
  } catch (e) {
    log(`FAIL: createMediaElementSource threw — ${(e as Error).message}`, 'bad');
    return false;
  }

  const gain = ctx.createGain();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(gain);
  gain.connect(analyser);
  analyser.connect(ctx.destination);

  // start mid-track so we are guaranteed real signal, not a fade-in
  audio.currentTime = audio.duration * 0.4;
  await once(audio, 'seeked').catch(() => {});

  // the actual declick envelope: ramp in over 12 ms
  const now = ctx.currentTime;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(1, now + 0.012);

  await audio.play();
  await new Promise((r) => setTimeout(r, 700));

  // If CORS was silently refused, Chromium feeds the graph zeros.
  const buf = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(buf);
  let sum = 0;
  for (const v of buf) sum += v * v;
  const rms = Math.sqrt(sum / buf.length);

  // ramp out, then confirm no exception on the way down
  const t = ctx.currentTime;
  gain.gain.setValueAtTime(gain.gain.value, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.012);
  await new Promise((r) => setTimeout(r, 120));
  audio.pause();
  await ctx.close();

  log(`RMS through the Web Audio graph: ${rms.toFixed(6)}`, rms > 0.0005 ? 'ok' : 'bad');
  const pass = rms > 0.0005;
  log(pass
      ? 'TEST 2: PASS — audio reaches the graph, gain ramps applied'
      : 'TEST 2: FAIL — graph is silent (classic CORS-tainted media)',
      pass ? 'ok' : 'bad');
  return pass;
}

// ---------------------------------------------------------------- test 3
const HEAD_BYTES = 256 * 1024;

async function armFsWhole(paths: string[]) {
  let ok = 0, bytes = 0;
  const t0 = performance.now();
  for (const p of paths) {
    try {
      const buf = await readFile(p);
      bytes += buf.byteLength;
      await parseBuffer(buf, undefined, { duration: false });
      ok++;
    } catch { /* counted as failure */ }
  }
  return { ms: performance.now() - t0, ok, bytes };
}

async function armFsHead(paths: string[]) {
  let ok = 0, bytes = 0;
  const t0 = performance.now();
  for (const p of paths) {
    try {
      const fh = await open(p, { read: true });
      const buf = new Uint8Array(HEAD_BYTES);
      const n = await fh.read(buf);
      await fh.close();
      const slice = buf.subarray(0, n ?? 0);
      bytes += slice.byteLength;
      await parseBuffer(slice, undefined, { duration: false });
      ok++;
    } catch { /* truncated head may be too small for some files */ }
  }
  return { ms: performance.now() - t0, ok, bytes };
}

async function armRustHead(paths: string[]) {
  let ok = 0, bytes = 0;
  const t0 = performance.now();
  for (const p of paths) {
    try {
      const arr = (await invoke('read_head', { path: p, len: HEAD_BYTES })) as number[];
      const buf = new Uint8Array(arr);
      bytes += buf.byteLength;
      await parseBuffer(buf, undefined, { duration: false });
      ok++;
    } catch { /* counted as failure */ }
  }
  return { ms: performance.now() - t0, ok, bytes };
}

function report(name: string, n: number, r: { ms: number; ok: number; bytes: number }) {
  const mb = r.bytes / 1048576;
  log(`${name.padEnd(14)} ${(r.ms / 1000).toFixed(2).padStart(7)}s  ` +
      `${(r.ms / n).toFixed(1).padStart(7)} ms/file  ` +
      `parsed ${r.ok}/${n}  read ${mb.toFixed(0)} MB  ` +
      `${(mb / (r.ms / 1000)).toFixed(0)} MB/s`,
      r.ok === n ? 'ok' : 'warn');
}

async function testFsThroughput() {
  log('\n=== TEST 3: fs throughput (tag parsing over the real library) ===');
  const paths = (files as any).bench as string[];
  const n = paths.length;
  log(`${n} files, head size ${(HEAD_BYTES / 1024).toFixed(0)} KB`, 'dim');
  log('arm            elapsed   per-file   parsed        read      rate', 'dim');

  const head = await armFsHead(paths);
  report('fs-head', n, head);

  const rust = await armRustHead(paths);
  report('rust-head', n, rust);

  const whole = await armFsWhole(paths);
  report('fs-whole', n, whole);

  log('\nCompare against the Node baseline: npm run bench:node', 'dim');
  log('TEST 3: measured (no pass/fail — the numbers are the finding)', 'warn');
  return true;
}

// ---------------------------------------------------------------- wiring
const btn = (id: string) => document.getElementById(id) as HTMLButtonElement;
const guard = (fn: () => Promise<unknown>) => async () => {
  document.querySelectorAll('button').forEach((b) => (b.disabled = true));
  try { await fn(); } catch (e) { log(`UNCAUGHT: ${(e as Error).stack ?? e}`, 'bad'); }
  document.querySelectorAll('button').forEach((b) => (b.disabled = false));
};

btn('t1').onclick = guard(testRangeSeek);
btn('t2').onclick = guard(testCorsDeclick);
btn('t3').onclick = guard(testFsThroughput);
btn('all').onclick = guard(async () => {
  const a = await testRangeSeek();
  const b = await testCorsDeclick();
  await testFsThroughput();
  log(`\n=== SUMMARY: range/seek ${a ? 'PASS' : 'FAIL'} | cors/declick ${b ? 'PASS' : 'FAIL'} ===`,
      a && b ? 'ok' : 'bad');
});
btn('clear').onclick = () => { logEl.innerHTML = ''; };

log('ready — WebView2 UA:', 'dim');
log(navigator.userAgent, 'dim');

// Headless run: execute everything, dump the transcript to spike/results.txt, quit.
(async () => {
  await new Promise((r) => setTimeout(r, 400));
  const a = await testRangeSeek().catch((e) => { log(`TEST 1 threw: ${e}`, 'bad'); return false; });
  const b = await testCorsDeclick().catch((e) => { log(`TEST 2 threw: ${e}`, 'bad'); return false; });
  await testFsThroughput().catch((e) => log(`TEST 3 threw: ${e}`, 'bad'));
  log(`\n=== SUMMARY: range/seek ${a ? 'PASS' : 'FAIL'} | cors/declick ${b ? 'PASS' : 'FAIL'} ===`,
      a && b ? 'ok' : 'bad');
  await invoke('write_results', { text: logEl.innerText });
  await new Promise((r) => setTimeout(r, 300));
  await invoke('finish');
})();

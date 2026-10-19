/**
 * The library both players are measured on: a fixed, seeded sample of real tracks, placed in the
 * bench folder as hard links (same volume) or copies, so each player scans a folder of its own and
 * nothing of the real music folders is ever handed to either app.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, linkSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

/** What both players read; identical lists in Nora 3.1.0 and Nemora 2.0. */
export const EXTENSIONS = ['.mp3', '.wav', '.ogg', '.aac', '.m4r', '.m4a', '.opus', '.flac'];

/** The music folders of the installed Nemora, read without opening its database for writing. */
export async function installedMusicFolders() {
  const profile = join(process.env.APPDATA ?? '', 'Nemora');
  const db = join(profile, 'nemora.db');
  if (existsSync(db)) {
    try {
      const { DatabaseSync } = await import('node:sqlite');
      const conn = new DatabaseSync(db, { readOnly: true });
      try {
        const folders = conn
          .prepare('SELECT uri FROM folders WHERE parent_id IS NULL AND excluded = 0 ORDER BY uri')
          .all()
          .map((row) => row.uri);
        if (folders.length) return folders;
      } finally {
        conn.close();
      }
    } catch {
      // A read-only connection cannot open a WAL database whose side files are missing; the 1.x
      // stores below name the same folders.
    }
  }
  const legacy = join(profile, 'userData.json');
  if (existsSync(legacy)) {
    const data = JSON.parse(readFileSync(legacy, 'utf8'));
    return (data.userData?.musicFolders ?? data.musicFolders ?? []).map((folder) => folder.path);
  }
  return [];
}

function audioFiles(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) audioFiles(full, out);
    else if (EXTENSIONS.includes(extname(entry.name).toLowerCase())) out.push(full);
  }
}

/**
 * Peaks of 250 ms windows over the first `seconds` of a file, decoded by ffmpeg; null when ffmpeg is
 * not there or cannot read the file.
 */
function windowPeaks(file, seconds) {
  const decoded = spawnSync(
    'ffmpeg',
    ['-v', 'error', '-t', String(seconds), '-i', file, '-ac', '1', '-ar', '8000', '-f', 's16le', '-'],
    { maxBuffer: 64 * 1024 * 1024 }
  );
  if (decoded.error || decoded.status !== 0) return null;
  const samples = decoded.stdout;
  const peaks = [];
  for (let start = 0; start < samples.length / 2; start += 2000) {
    let peak = 0;
    for (let i = start; i < Math.min(samples.length / 2, start + 2000); i += 1) {
      peak = Math.max(peak, Math.abs(samples.readInt16LE(i * 2)));
    }
    peaks.push(peak / 32768);
  }
  return peaks;
}

/**
 * A playback track must be loud from its first quarter second and never go quiet in the first 40 s:
 * the harness hears the start of the sound and requires sound for most of its window. A track with
 * a soft intro once read as a 7 s start and a silent player.
 */
function loudThroughout(file) {
  const peaks = windowPeaks(file, 40);
  if (peaks === null) return null;
  return peaks.length >= 160 && peaks[0] >= 0.05 && Math.min(...peaks) >= 0.02;
}

/** mulberry32: the same seed gives the same sample on any machine with the same files. */
function prng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Puts `count` tracks into `<root>/library` and describes them. */
export function buildLibrary({ root, sources, count, seed }) {
  const all = [];
  for (const source of sources) audioFiles(source, all);
  all.sort();
  if (all.length === 0) throw new Error(`no audio files under ${sources.join(', ')}`);
  const random = prng(seed);
  for (let i = all.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  const picked = all.slice(0, Math.min(count, all.length));

  const library = join(root, 'library');
  mkdirSync(library, { recursive: true });
  let linked = 0;
  let copied = 0;
  const tracks = picked.map((source, index) => {
    const name = `${String(index + 1).padStart(4, '0')} ${basename(source)}`;
    const target = join(library, name);
    if (!existsSync(target)) {
      try {
        linkSync(source, target);
        linked += 1;
      } catch {
        copyFileSync(source, target);
        copied += 1;
      }
    }
    return { name, bytes: statSync(target).size, ext: extname(name).toLowerCase() };
  });

  // One long track per common format for the playback runs: a lossless one and a lossy one decode
  // at very different costs, and a real library has both.
  let screened = true;
  const pick = (ext, min, max) =>
    tracks.find((t) => {
      if (t.ext !== ext || t.bytes < min || t.bytes > max) return false;
      const loud = loudThroughout(join(library, t.name));
      if (loud === null) screened = false;
      return loud !== false;
    });
  const play = Object.fromEntries(
    [
      ['flac', pick('.flac', 12e6, 120e6)],
      ['mp3', pick('.mp3', 4e6, 30e6)]
    ]
      .filter(([, track]) => track)
      .map(([format, track]) => [format, track.name])
  );

  // Search terms taken from the sample itself, so both players have something to find.
  const words = [];
  for (const track of tracks) {
    for (const word of track.name.replace(/\.[^.]+$/, '').split(/[\s\-_()[\],.]+/)) {
      if (/^\p{L}{4,}$/u.test(word) && !words.some((w) => w.toLowerCase() === word.toLowerCase())) words.push(word);
    }
    if (words.length >= 12) break;
  }
  const queries = [words[0], words[4], words[8]].filter(Boolean).map((w) => w.toLowerCase());

  return { library, tracks, play, screened, queries, linked, copied, available: all.length };
}

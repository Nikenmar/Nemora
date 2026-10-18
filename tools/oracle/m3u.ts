/*
 * Oracle: android/base's playlist import resolver (the newest one; 1.1.9 had an older importer).
 * Run it against the android/base checkout: `tools/oracle/run.ps1 -Name m3u -Old E:\Nemora`.
 */
import {
  cleanFileStem,
  compactKey,
  createPlaylistResolver,
  fileNameFromContentUri,
  locationToPath,
  parseM3u
} from '@old/platform/core/playlists/playlistImportResolver';

const makePrng = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const prng = makePrng(42);
const pick = <T>(list: T[]) => list[Math.floor(prng() * list.length)];

const TITLES = ['Shiniest Sky', 'Night Drive', 'Café del Mar', "Don't Stop", 'Звезда', 'Ёлки', 'desire machine', 'Halo',
  'The Final View', 'Maybe once again', 'Dystopia', 'winter mist', 'melancholy', 'Crystals', 'Glow', 'aether', 'broken',
  'voices', 'wasted', 'snowfall', 'A Moment In Time', 'Bossier City', 'Gats', 'Rory in early 20s', '残酷な天使のテーゼ'];
const ARTISTS = ['Red X', 'Habazane', 'Lvstlove', 'Energy 52', 'Кино', 'Ёлка', 'spirit blue', 'Beyoncé', 'Nujabes', 'SPURME',
  'Øneheart', 'reidenshi', 'Iwakura', 'Isolate.exe', 'AOMORI', 'Mejer', 'cornwave', 'MoonDeity', 'Envacity', '$uicideboy$',
  'Susumu Hirasawa', 'Sadisutikku Kensa', '高橋洋子'];
const FOLDERS = ['Музонон', 'Walahi', 'phonk', 'Downloads', 'Rips'];

const tracks = [];
for (let i = 0; i < 60; i += 1) {
  const title = TITLES[i % TITLES.length] + (i >= TITLES.length ? ` ${pick(['(slowed)', 'Remix', 'II', '(sped up)'])}` : '');
  const artists = [pick(ARTISTS), ...(prng() < 0.3 ? [pick(ARTISTS)] : [])].filter((a, k, all) => all.indexOf(a) === k);
  const folder = pick(FOLDERS);
  const base = `${artists.join(', ')} - ${title}`.replace(/[\\/:*?"<>|]/g, '');
  const ext = pick(['flac', 'mp3', 'm4a']);
  const style = prng();
  const path =
    style < 0.5
      ? `E:\\${folder}\\${base}.${ext}`
      : style < 0.8
        ? `/storage/emulated/0/Music/${folder}/${base}.${ext}`
        : `content://com.android.externalstorage.documents/tree/primary%3AMusic/document/primary%3AMusic%2F${encodeURIComponent(folder)}%2F${encodeURIComponent(base)}.${ext}`;
  tracks.push({ songId: `t${i}`, path, title, artists, durationSec: 90 + Math.floor(prng() * 300) });
}
// Copies of one recording in two folders, and two different songs with one title.
tracks.push({ ...tracks[0], songId: 'copy0', path: tracks[0].path.replace(/\\[^\\]+\\/, '\\Backup\\') });
tracks.push({ songId: 'cover1', path: 'E:\\Rips\\Somebody - Halo.mp3', title: 'Halo', artists: ['Somebody'], durationSec: 200 });

const lines: string[] = [];
const entryFor = (t: (typeof tracks)[number]) => {
  const name = t.path.startsWith('content://') ? decodeURIComponent(t.path.slice(t.path.lastIndexOf('%2F') + 3)) : t.path.split(/[\\/]/).at(-1)!;
  const r = prng();
  const extinf = `#EXTINF:${prng() < 0.15 ? t.durationSec * 1000 : t.durationSec},${t.artists.join(', ')} - ${t.title}`;
  if (r < 0.15) return [extinf, t.path];
  if (r < 0.3) return [extinf, `D:/Old Music/${name}`];
  if (r < 0.4) return [`file:///C:/Users/x/Music/${encodeURIComponent(name)}`];
  if (r < 0.5) return [`/sdcard/Music/${pick(FOLDERS)}/0${Math.floor(prng() * 9) + 1}. ${name.replace(/\.[^.]+$/, '')} (320).mp3`];
  if (r < 0.6) return [extinf, `/sdcard/Music/renamed_${Math.floor(prng() * 1000)}.mp3`];
  if (r < 0.7) return [`#EXTINF:${t.durationSec},${t.title}`, `x/${t.title.replace(/'/g, ' ')}.mp3`];
  if (r < 0.8) return [`E:\\cut\\${name.slice(0, Math.max(12, Math.floor(name.length * 0.6)))}`];
  if (r < 0.9) return [`#EXTINF:-1,${t.title} - ${t.artists[0]}`, `nowhere.mp3`];
  return [`#EXTINF:${t.durationSec + 2},${t.title}`, `unknown/${t.title}.flac`];
};
for (let k = 0; k < 400; k += 1) lines.push(...entryFor(pick(tracks)));
for (let k = 0; k < 8; k += 1) {
  const t = pick(tracks);
  lines.push(`#EXTINF:-1,${t.artists[0]} ${t.title}`, 'nowhere/x.mp3');
}
lines.push('#EXTINF:200,Halo', 'whatever/Halo.mp3', '#EXTINF:0,Nobody - Nothing', 'C:\\none\\Nothing.mp3', '# a comment', '');

const playlistText = '\uFEFF#EXTM3U\r\n' + lines.join('\r\n');
const entries = parseM3u(playlistText);
const resolver = createPlaylistResolver(tracks);
const resolved = entries.map((entry) => {
  const r = resolver.resolve(entry);
  return { songId: r.songId ?? null, method: r.method ?? null };
});

const samples = [...new Set([...tracks.map((t) => t.path), ...lines])];
const helpers = samples.map((s) => ({
  input: s,
  compact: compactKey(s),
  stem: cleanFileStem(s.split(/[\\/]/).at(-1)!),
  path: locationToPath(s),
  contentName: fileNameFromContentUri(s) ?? null
}));

process.stdout.write(JSON.stringify({ generatedFrom: 'android/base (a3d6e9d)', tracks, playlistText, entries, resolved, helpers }));

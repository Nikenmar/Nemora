/**
 * Screenshot stand of the redesign (PLAN/13 in the vault): every surface of the desktop app, in the
 * black and the light theme, from a debug build that runs in a `--bench` folder of its own.
 *
 *   node tools/redesign/shots.mjs [--label before] [--only 12-songs,14-artist] [--themes dark,light]
 *                                 [--out E:\tmp\nemora-shots] [--exe target\debug\nemora.exe]
 *                                 [--source %APPDATA%\Nemora] [--skip-empty] [--port 9361]
 *
 * Two runs: `library` starts from a copy of a real profile (the database is copied through SQLite's
 * backup, so the live one is only read; the covers are copied as files), `empty` from nothing, for
 * the empty states. The installed Nemora is never touched: a bench run keeps its profile, webview
 * data and logs in its own folder, stays offline and runs beside the installed instance.
 *
 * The app is driven through `window.__nemoraShots` (renderer `other/shots.tsx`), the app's own
 * navigation, so the shots survive the redesign's DOM changes. Output: one PNG per surface and
 * theme, plus index.html to look at them side by side.
 */
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync, openSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync, backup } from 'node:sqlite';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function option(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
}
const LABEL = option('label', 'current');
const OUT = join(option('out', 'E:\\tmp\\nemora-shots'), LABEL);
const EXE = option('exe', join(ROOT, 'target', 'debug', 'nemora.exe'));
const SOURCE = option('source', join(process.env.APPDATA ?? '', 'Nemora'));
const THEMES = option('themes', 'dark,light').split(',');
const ONLY = option('only', '').split(',').filter(Boolean);
const PORT = Number(option('port', '9361'));
const SKIP_EMPTY = process.argv.includes('--skip-empty');

const VIEW = { width: 1600, height: 900 };

/**
 * The surfaces. `setup` runs in the page as the body of an async function with `S` (the stand's
 * bridge), `api` (window.api), `D` (ids found in the library) and the helpers below in scope.
 */
const SHOTS = [
  { id: '00-primitives', surface: 'Primitives showcase', setup: `S.prompt('showcase');`, settle: 1500 },
  { id: '01-shell', surface: 'Top bar, sidebar, player on Songs', setup: `S.go('Songs');` },
  { id: '04-context-menu', surface: 'Context menu on a song', setup: `S.go('Songs'); await wait(900); await contextMenuOn(['[data-shot="song-row"]', '[data-index="2"]']);` },
  { id: '05-dialog-shortcuts', surface: 'Dialog: shortcuts', setup: `S.prompt('shortcuts');`, settle: 1200 },
  { id: '05-dialog-confirm', surface: 'Dialog: confirm a destructive action', setup: `S.prompt('confirm');` },
  { id: '05-dialog-link', surface: 'Dialog: open a link', setup: `S.prompt('openLink');` },
  { id: '05-dialog-error', surface: 'Dialog: error', setup: `S.prompt('error');` },
  {
    id: '06-notifications',
    surface: 'Notifications',
    setup: `S.addNewNotifications([
      { id: 'shot-1', content: 'Added 3 songs to Night drive', iconName: 'done', duration: 3000 },
      { id: 'shot-2', content: 'Scanning music folders', iconName: 'sync', duration: 3000, progressBarData: { total: 100, value: 40 } }
    ]);`
  },
  { id: '08-mini-player', surface: 'Mini player', view: { width: 400, height: 240 }, setup: `S.updatePlayerType('mini');`, settle: 1500 },
  { id: '09-full-screen', surface: 'Full-screen player', setup: `S.updatePlayerType('full');`, settle: 1800 },
  { id: '11-home', surface: 'Home', setup: `S.go('Home');`, settle: 1800 },
  { id: '12-songs', surface: 'Songs', setup: `S.go('Songs');` },
  { id: '13-artists', surface: 'Artists', setup: `S.go('Artists');` },
  { id: '14-artist', surface: 'Artist', setup: `S.go('ArtistInfo', { artistId: D.artist.artistId, artistName: D.artist.name });`, settle: 1800 },
  { id: '15-albums', surface: 'Albums', setup: `S.go('Albums');` },
  { id: '16-album', surface: 'Album', setup: `S.go('AlbumInfo', { albumId: D.album.albumId });` },
  { id: '17-genres', surface: 'Genres', setup: `S.go('Genres');` },
  { id: '18-genre', surface: 'Genre', setup: `S.go('GenreInfo', { genreId: D.genre.genreId });` },
  { id: '19-playlists', surface: 'Playlists', setup: `S.go('Playlists');` },
  { id: '20-playlist', surface: 'Playlist', setup: `S.go('PlaylistInfo', { playlistId: D.playlist.playlistId });` },
  { id: '21-folders', surface: 'Folders', setup: `S.go('Folders');` },
  { id: '22-folder', surface: 'Folder', setup: `S.go('MusicFolderInfo', { folderPath: D.folder });` },
  { id: '23-search', surface: 'Search', setup: `S.go('Search', { keyword: D.query });`, settle: 2000 },
  {
    id: '24-all-results',
    surface: 'All search results',
    setup: `const r = await api.search.search('Songs', D.query, false);
      S.go('AllSearchResults', { searchQuery: D.query, searchFilter: 'Songs', searchResults: r.songs ?? [] });`
  },
  { id: '25-queue', surface: 'Queue', setup: `S.go('CurrentQueue');` },
  { id: '26-lyrics', surface: 'Lyrics', setup: `S.go('Lyrics');`, settle: 2000 },
  {
    id: '27-lyrics-editor',
    surface: 'Lyrics editor',
    setup: `S.go('LyricsEditor', { lyrics: D.lyricLines, songId: D.song.songId, songTitle: D.song.title, isEditingEnhancedSyncedLyrics: false });`
  },
  { id: '28-song-info', surface: 'Song info', setup: `S.go('SongInfo', { songId: D.song.songId });`, settle: 1800 },
  {
    id: '29-tag-editor',
    surface: 'Tag editor',
    setup: `S.go('SongTagsEditor', { songId: D.song.songId, songArtworkPath: D.song.artworkPaths?.artworkPath, songPath: D.song.path, isKnownSource: true });`,
    settle: 2000
  },
  { id: '30-tierlists', surface: 'Tierlists', setup: `S.go('Tierlists');` },
  { id: '31-tierlist-editor', surface: 'Tierlist editor', setup: `if (!D.tierlist) throw new Error('no tierlist in this profile'); S.go('TierlistEditor', { tierlistId: D.tierlist.tierlistId });`, settle: 2000 },
  { id: '32-stats', surface: 'Stats', setup: `S.go('Stats');`, settle: 2000 },
  { id: '33-songguessr', surface: 'SongGuessr', setup: `S.go('Songs'); await wait(400); document.querySelector('[data-shot=songguessr-dock]').click();`, settle: 1800 },
  { id: '34-duel', surface: 'Duel', setup: `S.go('Songs'); await wait(400); document.querySelector('[data-shot=duel-dock]').click();`, settle: 1800 },
  { id: '35-settings-1', surface: 'Settings, top', setup: `S.go('Settings');`, settle: 1500 },
  { id: '35-settings-2', surface: 'Settings, middle', setup: `S.go('Settings'); await wait(1200); scrollMain(0.4);` },
  { id: '35-settings-3', surface: 'Settings, lower', setup: `S.go('Settings'); await wait(1200); scrollMain(0.75);` },
  { id: '36-release-notes', surface: "What's new", setup: `S.prompt('releaseNotes');`, settle: 1500 }
];

/** In the empty run: the screens a new user sees before the first scan. */
const EMPTY_SHOTS = [
  { id: 'e-home', surface: 'Home, empty library', setup: `S.go('Home');`, settle: 1800 },
  { id: 'e-songs', surface: 'Songs, empty', setup: `S.go('Songs');` },
  { id: 'e-albums', surface: 'Albums, empty', setup: `S.go('Albums');` },
  { id: 'e-playlists', surface: 'Playlists, empty', setup: `S.go('Playlists');` },
  { id: 'e-folders', surface: 'Folders, empty', setup: `S.go('Folders');` },
  { id: 'e-tierlists', surface: 'Tierlists, empty', setup: `S.go('Tierlists');` },
  { id: 'e-search', surface: 'Search, empty', setup: `S.go('Search');` },
  { id: 'e-queue', surface: 'Queue, empty', setup: `S.go('CurrentQueue');` },
  { id: 'e-stats', surface: 'Stats, empty', setup: `S.go('Stats');`, settle: 1500 }
];

/** Helpers available to every setup. */
const HELPERS = `
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function contextMenuOn(selectors) {
  for (let i = 0; i < 40; i++) {
    for (const sel of selectors) {
      // The innermost match: a virtualised list wraps each row in an element with the same index.
      const el = [...document.querySelectorAll(sel)].pop();
      if (el) {
        const r = el.getBoundingClientRect();
        const x = r.left + Math.min(260, r.width / 3), y = r.top + r.height / 2;
        el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y, pageX: x, pageY: y, button: 2 }));
        return;
      }
    }
    await wait(100);
  }
  throw new Error('nothing to right-click: ' + selectors.join(', '));
}
function clickLabel(label) {
  const all = [...document.querySelectorAll('button, [role=button], a, li, div')];
  const text = (e) => [...e.childNodes].map((n) => (n.nodeType === 3 ? n.textContent : n.classList?.contains('material-icons-round') || n.dataset?.icon ? '' : n.textContent)).join('').trim();
  const el = all.find((e) => e.getAttribute('aria-label') === label || e.getAttribute('title') === label)
    ?? all.reverse().find((e) => e.children.length < 4 && (e.textContent?.trim() === label || text(e) === label));
  if (!el) throw new Error('nothing labelled ' + label);
  el.click();
}
function scrollMain(fraction) {
  const boxes = [...document.querySelectorAll('*')].filter((e) => e.scrollHeight - e.clientHeight > 200 && getComputedStyle(e).overflowY !== 'visible');
  const box = boxes.sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight))[0];
  if (box) box.scrollTop = (box.scrollHeight - box.clientHeight) * fraction;
}
`;

/** Between shots: no prompt, no game window, no menu, the normal player. */
const RESET = `
S.closePrompt();
S.updatePlayerType('normal');
for (const d of document.querySelectorAll('dialog[open]')) {
  d.querySelector('[aria-label=Close], [title=Close], button[data-close]')?.click();
  d.dispatchEvent(new Event('cancel'));
  d.close();
}
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
document.body.click();`;

/** Finds what the shots open: the richest album, artist, genre, playlist, a tierlist, a song. */
const DISCOVER = `
const api = window.api;
const songs = (await api.audioLibraryControls.getAllSongs('aToZ'))?.data ?? [];
const withArt = songs.filter((s) => s.artworkPaths && !s.artworkPaths.isDefaultArtwork);
let song = withArt[Math.floor(withArt.length / 3)] ?? songs[0];
let lyricLines = [{ text: '' }];
for (const candidate of withArt.slice(0, 120)) {
  try {
    const l = await api.lyrics.getSongLyrics({ songTitle: candidate.title, songArtists: candidate.artists?.map((a) => a.name), album: candidate.album?.name, songPath: candidate.path, duration: candidate.duration }, 'ANY', 'OFFLINE_ONLY', 'NONE');
    if (l?.lyrics?.parsedLyrics?.length > 4) { song = candidate; lyricLines = l.lyrics.parsedLyrics.map((x) => ({ ...x, text: x.originalText })); break; }
  } catch {}
}
const most = (list, key) => [...(list ?? [])].sort((a, b) => (b[key]?.length ?? 0) - (a[key]?.length ?? 0))[0];
const albums = await api.albumsData.getAlbumData([]);
const artists = await api.artistsData.getArtistData([]);
const genres = await api.genresData.getGenresData([]);
const playlists = await api.playlistsData.getPlaylistData([]);
const tierlists = await api.tierlistsData.getTierlistData([]).catch(() => []);
const folders = await api.folderData.getFolderStructures();
const word = (song?.title ?? 'a').split(/\\s+/).find((w) => w.length > 3) ?? 'love';
return {
  songCount: songs.length,
  song, lyricLines,
  queue: [song, ...withArt.filter((s) => s.songId !== song?.songId).slice(0, 29)].filter(Boolean).map((s) => s.songId),
  album: most(albums, 'songs'),
  artist: most(artists, 'songs'),
  genre: most(genres, 'songs'),
  playlist: most(playlists.filter((p) => (p.songs?.length ?? 0) > 0 && !['History', 'Favorites'].includes(p.playlistId)), 'songs') ?? most(playlists, 'songs'),
  tierlist: tierlists?.[0],
  folder: folders?.[0]?.path,
  query: word.toLowerCase()
};
`;

class Cdp {
  static async connect(port, timeoutMs = 90_000) {
    const end = Date.now() + timeoutMs;
    for (;;) {
      try {
        const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
        const page = targets.find((t) => t.type === 'page' && !t.url.startsWith('devtools://'));
        if (page) {
          const cdp = new Cdp(page.webSocketDebuggerUrl);
          await cdp.open;
          return cdp;
        }
      } catch {
        /* not up yet */
      }
      if (Date.now() > end) throw new Error('the app never exposed a page over CDP');
      await sleep(500);
    }
  }
  constructor(url) {
    this.id = 0;
    this.pending = new Map();
    this.ws = new WebSocket(url);
    this.open = new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });
    this.ws.onmessage = (message) => {
      const data = JSON.parse(message.data);
      const waiter = this.pending.get(data.id);
      if (!waiter) return;
      this.pending.delete(data.id);
      if (data.error) waiter.reject(new Error(data.error.message));
      else waiter.resolve(data.result);
    };
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`CDP ${method} timed out`));
      }, 60_000);
    });
  }
  async eval(body) {
    const expression = `(async () => { ${HELPERS}\nconst S = window.__nemoraShots, api = window.api, D = window.__shotData;\n${body}\n})()`;
    const reply = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (reply.exceptionDetails) throw new Error(reply.exceptionDetails.exception?.description ?? reply.exceptionDetails.text);
    return reply.result.value;
  }
  async view({ width, height }) {
    await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  }
  async shoot(file) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(file, Buffer.from(data, 'base64'));
  }
  close() {
    this.ws.close();
  }
}

/** The process id owning the foreground window: the stand's app must never be it. */
function foreground() {
  const script = `Add-Type -Name F -Namespace W -MemberDefinition '[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(System.IntPtr h, out int p);'
$p = 0; [void][W.F]::GetWindowThreadProcessId([W.F]::GetForegroundWindow(), [ref]$p); $p`;
  try {
    return execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', timeout: 15_000 }).trim();
  } catch {
    return '?';
  }
}

function prepareProfile(dir, copyFrom) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'profile'), { recursive: true });
  // A bench run starts only with a scenario; this one has no steps, the stand drives it.
  writeFileSync(join(dir, 'scenario.json'), JSON.stringify({ steps: [] }));
  if (!copyFrom) return;
  const db = join(copyFrom, 'nemora.db');
  if (!existsSync(db)) throw new Error(`no nemora.db in ${copyFrom}`);
  const source = new DatabaseSync(db, { readOnly: true });
  return backup(source, join(dir, 'profile', 'nemora.db')).then(() => {
    source.close();
    if (existsSync(join(copyFrom, 'covers'))) cpSync(join(copyFrom, 'covers'), join(dir, 'profile', 'covers'), { recursive: true });
  });
}

async function runOne(name, shots, copyFrom) {
  const dir = join(OUT, `run-${name}`);
  await prepareProfile(dir, copyFrom);
  const log = openSync(join(dir, 'stdout.log'), 'w');
  const app = spawn(EXE, [`--bench=${dir}`], {
    env: {
      ...process.env,
      // In the background (bench.rs): no focus, no taskbar button, behind every window. The window
      // is then covered, so Chromium must not stop painting it.
      NEMORA_SHOTS_BACKGROUND: '1',
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: [
        `--remote-debugging-port=${PORT}`,
        '--disable-features=CalculateNativeWinOcclusion,msWebOOUI,msPdfOOUI,AudioServiceOutOfProcess',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding'
      ].join(' ')
    },
    stdio: ['ignore', log, log]
  });
  const failures = [];
  let cdp;
  try {
    cdp = await Cdp.connect(PORT);
    await cdp.send('Page.enable');
    await cdp.view(VIEW);
    mkdirSync(join(OUT, 'png'), { recursive: true });
    if (name === 'library' && (ONLY.length === 0 || ONLY.includes('07-loading'))) {
      await sleep(300);
      await cdp.shoot(join(OUT, 'png', `07-loading.dark.png`));
    }
    for (let i = 0; i < 240; i++) {
      if (await cdp.eval('return !!window.__nemoraShots').catch(() => false)) break;
      await sleep(250);
    }
    await cdp.eval(`S.toggleMutedState(true);`);
    // The library is the copied database; the folder watcher may still be catching up.
    for (let i = 0; i < 120 && copyFrom; i++) {
      const n = await cdp.eval(`return (await api.audioLibraryControls.getAllSongs('aToZ'))?.data?.length ?? 0;`);
      if (n > 0) break;
      await sleep(500);
    }
    const data = await cdp.eval(`window.__shotData = await (async () => { ${DISCOVER} })(); return window.__shotData;`);
    console.log(`[${name}] ${data.songCount} songs; song "${data.song?.title}", album "${data.album?.title}", artist "${data.artist?.name}", lyric lines ${data.lyricLines.length}`);
    if (copyFrom && data.queue.length) {
      await cdp.eval(`S.createQueue(D.queue, 'songs', false, undefined, true); await wait(2500); S.togglePlay(false); await wait(300); S.updateSongPosition(Math.round((D.song?.duration ?? 200) * 0.4));`);
    }
    if (Number(foreground()) === app.pid) failures.push(`focus (${name}): the stand's window took the foreground`);
    for (const theme of THEMES) {
      await cdp.eval(`api.theme.changeAppTheme('${theme}');`);
      await sleep(800);
      for (const shot of shots) {
        if (ONLY.length && !ONLY.includes(shot.id)) continue;
        const file = join(OUT, 'png', `${shot.id}.${theme}.png`);
        try {
          await cdp.eval(RESET);
          await cdp.view(VIEW);
          await sleep(500);
          if (shot.view) await cdp.view(shot.view);
          await cdp.eval(shot.setup);
          await sleep(shot.settle ?? 1200);
          await cdp.shoot(file);
          process.stdout.write('.');
        } catch (error) {
          failures.push(`${shot.id} (${theme}): ${error.message.split('\n')[0]}`);
          process.stdout.write('x');
        }
      }
    }
    process.stdout.write('\n');
  } finally {
    try {
      await cdp?.eval(`S.toggleMutedState(false); api.bench.quit();`);
    } catch {
      /* already gone */
    }
    cdp?.close();
    await Promise.race([new Promise((r) => app.on('exit', r)), sleep(5000)]);
    if (app.exitCode === null) app.kill();
  }
  return failures;
}

function contactSheet(shots) {
  const rows = shots
    .filter((s) => ONLY.length === 0 || ONLY.includes(s.id))
    .map(
      (s) => `<section><h2>${s.id} <span>${s.surface}</span></h2><div class="pair">${(s.themes ?? THEMES).map(
        (t) => `<a href="png/${s.id}.${t}.png"><img loading="lazy" src="png/${s.id}.${t}.png" alt="${s.surface}, ${t}"></a>`
      ).join('')}</div></section>`
    )
    .join('\n');
  writeFileSync(
    join(OUT, 'index.html'),
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Nemora shots: ${LABEL}</title><style>
body{margin:0;padding:24px;background:#000;color:#f0f0f1;font:14px 'Segoe UI',sans-serif}
h1{font-size:22px;margin:0 0 20px}h2{font-size:15px;margin:28px 0 8px}h2 span{color:#929293;font-weight:400;margin-left:8px}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}img{width:100%;border:1px solid #242425;border-radius:6px;display:block}
</style></head><body><h1>Nemora shots: ${LABEL}</h1>${rows}</body></html>`
  );
}

if (!existsSync(EXE)) throw new Error(`no build at ${EXE}: run \`npm run tauri -- build --debug --no-bundle\` in apps/desktop`);
mkdirSync(OUT, { recursive: true });
const failures = [...(await runOne('library', SHOTS, SOURCE))];
if (!SKIP_EMPTY) failures.push(...(await runOne('empty', EMPTY_SHOTS, null)));
contactSheet([{ id: '07-loading', surface: 'Loading (first frame)', themes: ['dark'] }, ...SHOTS, ...(SKIP_EMPTY ? [] : EMPTY_SHOTS)]);
console.log(`Shots in ${OUT}\\index.html`);
if (failures.length) {
  console.log(`\n${failures.length} failed:\n${failures.join('\n')}`);
  process.exitCode = 1;
}

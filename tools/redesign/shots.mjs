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
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, openSync } from 'node:fs';
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
// --scale 2 renders the view at twice its pixel density (the layout stays the same): crisp text for the
// README pictures, which are cut and scaled down from these shots.
const SCALE = Number(option('scale', '1'));
const SKIP_EMPTY = process.argv.includes('--skip-empty') || Boolean(option('probe', '')) || Boolean(option('film', ''));
/** `--probe file.js`: run that script in the app (after the library and queue are up) instead of shooting, and print what it returns, once per `--probe-widths`. */
const PROBE = option('probe', '');
/** `--cdp-timeout <s>`: how long one page evaluation may run (a probe that holds the stand open for an agent needs more than 120 s). */
const CDP_TIMEOUT_MS = Number(option('cdp-timeout', '120')) * 1000;
/**
 * `--ipc-trace file.json` (with `--probe`): records every command the app sends to Rust while the
 * probe runs, from the outside (CDP Network, the `ipc.localhost` requests Tauri 2 makes on
 * Windows), with a digest of its arguments and answer; `tools/refactor/ipc-diff.mjs` compares two
 * traces (PLAN/21 protocol). The product is not touched.
 */
const IPC_TRACE = option('ipc-trace', '');
/**
 * `--film file.js`: run that script (its last act starts the motion), then freeze every finite
 * animation and shoot it at 0, 25, 50, 75 and 100% of its run, in each `--themes` theme, into
 * `<out>/film/<name>.<pct>.<theme>.png` (name: `--film-name`, else the script's file name).
 */
const FILM = option('film', '');
const FILM_NAME = option('film-name', FILM ? FILM.replace(/^.*[\\/]/, '').replace(/\.js$/, '') : '');
/**
 * `--render-count` (with `--probe`): counts React component renders from outside the product
 * (PLAN/21 P21.3). A React DevTools hook is installed before the page loads (the page is reloaded
 * once for it); after each commit it walks the tree and counts every function or class component
 * whose props or hook state object is new since its last commit, a mount included. The probe reads
 * `window.__renders.total`, `window.__renders.commits` and calls `window.__renders.reset()`.
 */
const RENDER_COUNT = process.argv.includes('--render-count');
const RENDER_HOOK = `(() => {
  const seen = new WeakMap();
  const counter = { total: 0, commits: 0, reset() { this.total = 0; this.commits = 0; } };
  window.__renders = counter;
  const COMPONENT = new Set([0, 1, 11, 14, 15]);
  const visit = (fiber) => {
    const stack = [fiber];
    while (stack.length) {
      const f = stack.pop();
      if (!f) continue;
      if (COMPONENT.has(f.tag)) {
        const last = seen.get(f) ?? (f.alternate ? seen.get(f.alternate) : undefined);
        if (!last || last.props !== f.memoizedProps || last.state !== f.memoizedState) counter.total++;
        const record = { props: f.memoizedProps, state: f.memoizedState };
        seen.set(f, record);
        if (f.alternate) seen.set(f.alternate, record);
      }
      if (f.sibling) stack.push(f.sibling);
      if (f.child) stack.push(f.child);
    }
  };
  let id = 0;
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    renderers: new Map(),
    inject(renderer) { id += 1; this.renderers.set(id, renderer); return id; },
    checkDCE() {},
    onScheduleFiberRoot() {},
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    onCommitFiberRoot(_id, root) { counter.commits++; visit(root.current); }
  };
})();`;
/** `--cpu <seconds>`: after a probe or film, the app's CPU (its whole process tree) over that time, in % of one core. */
const CPU_SECONDS = Number(option('cpu', '0'));

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
  { id: '30b-tier-suggestions', surface: 'Tier suggestions', setup: `S.go('Tierlists'); await wait(1200); document.querySelector('.tier-suggestions-btn').click();`, settle: 2500 },
  { id: '31-tierlist-editor', surface: 'Tierlist editor', setup: `if (!D.tierlist) throw new Error('no tierlist in this profile'); S.go('TierlistEditor', { tierlistId: D.tierlist.tierlistId });`, settle: 2000 },
  { id: '32-stats', surface: 'Stats', setup: `S.go('Stats');`, settle: 2000 },
  { id: '33-songguessr', surface: 'SongGuessr', setup: `S.go('Songs'); await wait(400); document.querySelector('[data-shot=songguessr-dock]').click();`, settle: 1800 },
  { id: '33b-songguessr-mode', surface: 'SongGuessr, mode menu over the dialog', setup: `S.go('Songs'); await wait(400); document.querySelector('[data-shot=songguessr-dock]').click(); await wait(1500); document.querySelector('dialog[open] #song-guessr-mode').click();`, settle: 900 },
  { id: '33c-songguessr-result', surface: 'SongGuessr, round over', setup: `S.go('Songs'); await wait(400); document.querySelector('[data-shot=songguessr-dock]').click(); await wait(1800); for (let i = 0; i < 6; i++) { [...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent.trim().endsWith('Skip'))?.click(); await wait(500); }`, settle: 1500 },
  { id: '34-duel', surface: 'Duel', setup: `S.go('Songs'); await wait(400); document.querySelector('[data-shot=duel-dock]').click();`, settle: 1800 },
  { id: '34b-tournament', surface: 'Duel, tournament', setup: `S.go('Songs'); await wait(400); document.querySelector('[data-shot=duel-dock]').click(); await wait(1500); [...document.querySelectorAll('dialog[open] [role=radio]')].at(-1).click();`, settle: 1500 },
  { id: '35-settings-1', surface: 'Settings, top', setup: `S.go('Settings');`, settle: 1500 },
  { id: '35-settings-2', surface: 'Settings, middle', setup: `S.go('Settings'); await wait(1200); scrollMain(0.4);` },
  { id: '35-settings-3', surface: 'Settings, lower', setup: `S.go('Settings'); await wait(1200); scrollMain(0.75);` },
  { id: '36-release-notes', surface: "What's new", setup: `S.prompt('releaseNotes');`, settle: 1500 },
  // PLAN/14: Smart Shuffle explained and steered, the taste map, the visuals and their settings.
  { id: '36b-queue-smart', surface: 'Queue, Smart Shuffle with reasons and steering', setup: `S.go('Songs'); await wait(800); const b = document.querySelector('.song-controls-container .tier-shuffle-btn'); if (b.getAttribute('aria-pressed') !== 'true') { b.click(); await wait(2500); } S.go('CurrentQueue'); await wait(1800); const row = document.querySelectorAll('.songs-container [data-index] .song-cover-and-play-btn-container')[3]; row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 600, clientY: 400 })); await wait(400); [...document.querySelectorAll('.context-menu [role=menuitem], .context-menu > div')].find((e) => /Less of/.test(e.textContent))?.click(); await wait(2500);`, settle: 1500 },
  { id: '36c-why-this-song', surface: 'Why this song?', setup: `S.prompt('why');`, settle: 1500 },
  { id: '36d-taste-map', surface: 'Taste map, an island picked', setup: `S.go('Home'); await wait(400); S.go('TasteMap'); await wait(3000); const c = document.querySelector('.taste-map-box canvas:nth-of-type(2)'); const r = c.getBoundingClientRect(); const at = { bubbles: true, pointerId: 1, button: 0, clientX: r.left + r.width * 0.5, clientY: r.top + r.height * 0.5 }; c.dispatchEvent(new PointerEvent('pointerdown', at)); c.dispatchEvent(new PointerEvent('pointerup', at));`, settle: 1500 },
  { id: '36h-taste-map-zoom', surface: 'Taste map, zoomed in to covers', setup: `S.go('Home'); await wait(400); S.go('TasteMap'); await wait(3000); const c = document.querySelector('.taste-map-box canvas:nth-of-type(2)'); const r = c.getBoundingClientRect(); for (let i = 0; i < 6; i++) { c.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: r.left + r.width * 0.5, clientY: r.top + r.height * 0.5, deltaY: -260 })); await wait(60); }`, settle: 2500 },
  { id: '36i-taste-map-shuffle', surface: 'Taste map, Smart Shuffle now, zoomed a little', setup: `S.go('Home'); await wait(400); S.go('TasteMap'); await wait(3000); [...document.querySelectorAll('.taste-map-page button')].find((b) => b.textContent.trim() === 'Smart Shuffle now')?.click(); const c = document.querySelector('.taste-map-box canvas:nth-of-type(2)'); const r = c.getBoundingClientRect(); c.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: r.left + r.width * 0.4, clientY: r.top + r.height * 0.5, deltaY: -400 }));`, settle: 1800 },
  { id: '36j-taste-map-islands', surface: 'Taste map, islands, full screen', setup: `S.go('Home'); await wait(400); S.go('TasteMap'); await wait(3000); [...document.querySelectorAll('.taste-map-page button')].find((b) => b.textContent.trim() === 'Islands')?.click(); [...document.querySelectorAll('.taste-map-page button')].find((b) => b.getAttribute('aria-label') === 'Full screen' || b.title === 'Full screen' || b.querySelector('.ms-icon')?.textContent === 'open_in_full')?.click();`, settle: 2200 },
  { id: '36k-sound-panel', surface: 'Slowed & reverb panel, Slowed + Reverb', setup: `S.go('Home'); await wait(600); document.querySelector('.sound-btn').click(); await wait(500); [...document.querySelectorAll('.sound-panel button')].find((b) => b.textContent.trim() === 'Slowed')?.click(); await wait(200); [...document.querySelectorAll('.sound-panel button')].find((b) => b.textContent.trim() === '+ Reverb')?.click();`, settle: 1200 },
  { id: '36e-settings-visuals', surface: 'Settings, Visuals', setup: `S.go('Settings'); await wait(1200); document.querySelector('.secondary-container.visuals').scrollIntoView({ block: 'center' });` },
  { id: '36f-settings-smart', surface: 'Settings, Smart Shuffle', setup: `S.go('Settings'); await wait(1200); document.querySelector('#smartShuffleSettings').scrollIntoView({ block: 'center' });` },
  { id: '36g-full-screen-bars', surface: 'Full screen with bars under the cover', setup: `S.setPreference('isFullScreenSpectrum', true); S.updatePlayerType('full'); await wait(2500);`, settle: 1500 },
  // Last on purpose: the accent stays chosen in this run's profile copy.
  { id: '36l-headphone-correction', surface: 'Settings, Equalizer, headphone correction with an AutoEQ profile (fetched live)', setup: `S.go('Settings'); await wait(1200); const box = document.querySelector('#headphoneCorrection'); box.scrollIntoView({ block: 'center' }); [...box.querySelectorAll('button')].find((b) => /Find my headphones/.test(b.textContent))?.click(); for (let i = 0; i < 40 && !box.querySelector('input[type=search]'); i++) await wait(250); const input = box.querySelector('input[type=search]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'sennheiser hd 600'); input.dispatchEvent(new Event('input', { bubbles: true })); await wait(400); [...box.querySelectorAll('ul button')].find((b) => /oratory1990/.test(b.textContent))?.click(); for (let i = 0; i < 40 && !box.querySelector('svg polyline'); i++) await wait(250); box.scrollIntoView({ block: 'center' });`, settle: 800 },
  { id: '36m-home-today', surface: 'Home, Today: Continue and the mix of the day (PLAN/19)', setup: `S.go('Home'); for (let i = 0; i < 40 && !document.querySelector('.mix-of-the-day'); i++) await wait(250);`, settle: 1500 },
  { id: '36n-home-for-you', surface: 'Home, For you with its tabs, On repeat chosen', setup: `S.go('Home'); for (let i = 0; i < 40 && !document.querySelector('.for-you-container [role=tab]'); i++) await wait(250); const tabs = [...document.querySelectorAll('.for-you-container [role=tab]')]; (tabs.find((b) => /On repeat/.test(b.textContent)) ?? tabs[1])?.click(); await wait(800); document.querySelector('.for-you-container').scrollIntoView({ block: 'center' });`, settle: 1200 },
  { id: '36o-mix-page', surface: 'The mix of the day as a page, with why each song is in it', setup: `S.go('SmartList', { list: 'mix' }); for (let i = 0; i < 40 && !document.querySelector('.smart-list-row'); i++) await wait(250);`, settle: 1500 },
  // The README's own shots (tools/readme/compose.py): see README_HIDDEN and README_SONGS above.
  { id: 'r-home', surface: 'README: Home, Today and For you', setup: `S.closePrompt(); S.go('Home'); await readmeHome();`, settle: 1200 },
  { id: 'r-tierlist', surface: 'README: a sample tierlist of well-known songs', setup: `S.closePrompt(); const ids = await readmeSongIds(); let tl = (await api.tierlistsData.getTierlistData([])).find((x) => x.name === 'Desert island'); if (!tl) { const pl = await api.playlistsData.addNewPlaylist('Desert island', ids); tl = (await api.tierlistsData.addTierlist('Desert island', [pl.playlist.playlistId], 'track')).tierlist; } const cut = [0, 5, 11, 17, 23]; tl.tiers = tl.tiers.slice(0, 4).map((tier, i) => ({ ...tier, items: ids.slice(cut[i], cut[i + 1]) })); await api.tierlistsData.saveTierlist(tl); S.go('Home'); await wait(600); S.go('TierlistEditor', { tierlistId: tl.tierlistId });`, settle: 2500 },
  { id: 'r-sound', surface: 'README: Slowed & reverb panel over Home', setup: `S.closePrompt(); S.go('Home'); await readmeHome(); document.querySelector('.sound-btn').click(); await wait(500); [...document.querySelectorAll('.sound-panel button')].find((b) => b.textContent.trim() === 'Slowed')?.click(); await wait(200); [...document.querySelectorAll('.sound-panel button')].find((b) => b.textContent.trim() === '+ Reverb')?.click();`, settle: 1200 },
  { id: 'r-search', surface: 'README: a Japanese title found from its reading with a typo, Did you mean', setup: `S.closePrompt(); S.go('Search', { keyword: 'yoru ni kakru' }); for (let i = 0; i < 40 && !document.querySelector('.most-relevant-results-container, .did-you-mean'); i++) await wait(250);`, settle: 1200 },
  { id: 'r-duel', surface: 'README: a duel of two well-known songs', setup: `S.closePrompt(); S.go('Songs'); await wait(400); const songs = (await api.audioLibraryControls.getAllSongs('aToZ'))?.data ?? []; const id = (t) => songs.find((x) => x.title === t)?.songId; const [a, b] = [id('Little Dark Age'), id('Where Is My Mind? (Remastered)')]; const side = (pair, id) => (pair.songA.songId === id ? pair.songA : pair.songB); const pair = { songA: side(await api.eloDuels.getDuelPair(a), a), songB: side(await api.eloDuels.getDuelPair(b), b) }; const real = api.eloDuels.getDuelPair; api.eloDuels.getDuelPair = async () => pair; document.querySelector('[data-shot=duel-dock]').click(); await wait(1500); api.eloDuels.getDuelPair = real;`, settle: 1500 },
  { id: '36y-update-offer', surface: 'Update card: a new version offered (a sample offer)', setup: `S.closePrompt(); S.go('Home'); await wait(800); S.update('offer');`, settle: 900 },
  { id: '36z-update-downloading', surface: 'Update card: the download under way (a sample)', setup: `S.go('Home'); await wait(800); S.update('downloading');`, settle: 900 },
  { id: '36x-settings-about', surface: 'Settings, About', setup: `S.closePrompt(); await wait(500); S.go('Settings'); for (let i = 0; i < 40 && !document.querySelector('.about-container'); i++) await wait(250); document.querySelector('.about-container').scrollIntoView({ block: 'start' });`, settle: 1200 },
  { id: '36v-settings-privacy', surface: 'Settings, About, Privacy (a prompt)', setup: `S.closePrompt(); await wait(500); S.go('Settings'); await wait(1200); const b = document.querySelector('.privacy-prompt-btn'); b.scrollIntoView({ block: 'center' }); await wait(300); b.click(); await wait(600);`, settle: 800 },
  { id: '19s-spotify-import', surface: 'Playlists, Import from Spotify with a public playlist (fetched live)', setup: `S.closePrompt(); await wait(500); S.go('Playlists'); await wait(1200); document.querySelector('.spotify-import-btn').click(); await wait(800); const input = document.querySelector('input[name=spotifyLink]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'https://open.spotify.com/playlist/37i9dQZF1DX4UtSsGT1Sbe'); input.dispatchEvent(new Event('input', { bubbles: true })); await wait(200); [...document.querySelectorAll('.spotify-import button')].find((b) => /Find/.test(b.textContent))?.click(); for (let i = 0; i < 60 && !document.querySelector('.spotify-import input[name=playlistName]'); i++) await wait(250);`, settle: 1200 },
  { id: '36p-settings-lyrics-library', surface: 'Settings, Lyrics: fetch lyrics for my library (off; not switched on, it sends names to LRCLIB)', setup: `S.go('Settings'); for (let i = 0; i < 40 && !document.querySelector('.lyrics-library'); i++) await wait(250); document.querySelector('.lyrics-library').scrollIntoView({ block: 'center' });`, settle: 1200 },
  { id: '36q-search-in-lyrics', surface: 'Search, In lyrics: a line with its context and Play from this line (PLAN/19)', setup: `window.__TAURI_INTERNALS__.invoke('lyrics_search', { query: 'better men' }); await wait(1500); S.go('Search', { keyword: 'better men' }); for (let i = 0; i < 40 && !document.querySelector('.lyrics-hit'); i++) await wait(250);`, settle: 1000 },
  { id: '36r-moment-card', surface: 'Lyrics, Share moment: the card of a line (PLAN/19)', setup: `S.go('Lyrics'); for (let i = 0; i < 40 && document.querySelectorAll('.highlight').length < 6; i++) await wait(250); const line = document.querySelectorAll('.highlight')[5]; const r = line.getBoundingClientRect(); line.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.top + 10, pageX: r.left + 20, pageY: r.top + 10, button: 2 })); await wait(400); [...document.querySelectorAll('*')].find((e) => e.children.length === 0 && e.textContent.trim() === 'Share moment')?.click(); for (let i = 0; i < 20 && !document.querySelector('.moment-card'); i++) await wait(150);`, settle: 1200 },
  { id: '36s-search-did-you-mean', surface: 'Search with a typo in a Japanese reading: the kanji title found, Did you mean (PLAN/20)', setup: `S.go('Search', { keyword: 'mushku tensei' }); for (let i = 0; i < 40 && !document.querySelector('.did-you-mean'); i++) await wait(250);`, settle: 1000 },
  { id: '36t-stats-insights', surface: 'Stats, Insights on top (PLAN/20)', setup: `S.go('Stats'); for (let i = 0; i < 40 && !document.querySelector('.insight-card'); i++) await wait(250);`, settle: 1500 },
  { id: '36w-settings-agents', surface: 'Settings, AI agents: the access level, the command, the agents to set up, the log (PLAN/22)', setup: `S.go('Settings'); for (let i = 0; i < 40 && !document.querySelector('.agents-settings-container'); i++) await wait(250); document.querySelector('.agents-settings-container').scrollIntoView({ block: 'start' });`, settle: 1200 },
  { id: '36u-version-tag', surface: 'A version beside its song, the sound tag after the title (PLAN/18)', setup: `await api.tierlistsData.versionCreate(D.song.songId, { name: 'Slowed', semitones: -4, keepPitch: false, reverb: 0.35, size: 'hall' }); await wait(600); S.go('Search', { keyword: D.song.title.split(' ').slice(0, 3).join(' ') }); for (let i = 0; i < 40 && !document.querySelector('.search-results-container .sound-tag'); i++) await wait(200);`, settle: 1200 },
  { id: '37-accent-picker', surface: 'Accent colour picker, violet chosen', setup: `S.go('Settings'); await wait(1200); document.querySelector('[role=radiogroup] [aria-label=Violet]').click(); await wait(300); document.querySelector('.accent-color').scrollIntoView({ block: 'center' });`, settle: 1200 },
  { id: '38-accent-home', surface: 'Home in teal', setup: `S.go('Settings'); await wait(1200); document.querySelector('[role=radiogroup] [aria-label=Teal]').click(); await wait(300); S.go('Home');`, settle: 1800 }
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

/**
 * What the README's shots leave out: titles and artists of the library not to be shown on a public
 * page, one pattern per line (a regular expression, case-insensitive; `#` starts a comment line).
 * The list names the user's own library, so it lives in a gitignored file next to this one; without
 * it nothing is left out.
 */
const README_HIDDEN_FILE = join(ROOT, 'tools', 'redesign', 'readme-hidden.local.txt');
const README_HIDDEN_PATTERNS = existsSync(README_HIDDEN_FILE)
  ? readFileSync(README_HIDDEN_FILE, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  : [];
if (process.argv.includes('--readme') && README_HIDDEN_PATTERNS.length === 0) {
  console.warn(`[readme] no ${README_HIDDEN_FILE}: the README shots leave nothing out`);
}

/** Helpers available to every setup. */
const HELPERS = `
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ----- the README's shots (tools/readme): the real app, with what a public page should not show left out
// Songs the README does not show by name (readme-hidden.local.txt), and Home's Recently added row.
const README_HIDDEN = ${JSON.stringify(README_HIDDEN_PATTERNS)}.map((p) => new RegExp(p, 'i'));
async function readmeHome() {
  for (let i = 0; i < 40 && !document.querySelector('.mix-of-the-day'); i++) await wait(250);
  await wait(700);
  document.querySelector('.recently-added-songs-container')?.remove();
  for (const grid of document.querySelectorAll('.home-page .songs-container, .home-page .artists-container')) {
    for (const card of [...grid.children]) if (README_HIDDEN.some((r) => r.test(card.textContent))) card.remove();
  }
}
// Well-known songs, for the README's sample tierlist and duel (title, artist).
const README_SONGS = [
  ['Where Is My Mind? (Remastered)', 'Pixies'], ['Little Dark Age', 'MGMT'],
  ['Better Off Alone', 'Alice Deejay'], ['aruarian dance', 'Nujabes'], ['Chamber Of Reflection', 'Mac Demarco'],
  ['Freaks', 'Surf Curse'], ["Jazz (We've Got)", 'A Tribe Called Quest'], ['I Wish (Radio Edit)', 'Skee-Lo'],
  ['Key', 'C418'], ['Frostfall', 'Jeremy Soule'], ['Crimewave', 'Crystal Castles'], ['Mrs Magic', 'Strawberry Guy'],
  ['Road to the West', 'Seatbelts'], ['children (nostalgia verision)', 'robert miles'], ['Poison Tree', 'Grouper'],
  ['Feather', 'Nujabes'], ['Betty (Get Money)', 'Yung Gravy'], ['Mice on Venus', 'C418'], ['QKThr', 'Aphex Twin'],
  ['Only Love Can Break Your Heart (Masters at Work Mix)', 'Saint Etienne'], ['Serenity', 'Capcom Sound Team'],
  ['Elrond Half-elven', 'Bear McCreary'], ['Scatman (Sped Up)', 'Scatman John']
];
async function readmeSongIds() {
  const songs = (await api.audioLibraryControls.getAllSongs('aToZ'))?.data ?? [];
  const ids = [];
  for (const [title, artist] of README_SONGS) {
    const song = songs.find((x) => x.title === title && x.artists?.some((a) => a.name === artist));
    if (song) ids.push(song.songId);
  }
  return ids;
}
// Motion (PLAN/14): finite animations only; looping ones (equalizer bars, spinners) are left alone.
const finite = (a) => Number.isFinite(a.effect?.getComputedTiming?.().activeDuration ?? Infinity);
async function untilAnimating(timeout = 1500) {
  for (let t = 0; t < timeout; t += 16) {
    const running = document.getAnimations().filter((a) => finite(a) && a.playState === 'running');
    // A view transition announces itself on <html> before its animations exist (it may wait for
    // the new page): wait for those, not for a hover fading somewhere.
    const transitioning = 'vtKind' in document.documentElement.dataset;
    const ready = transitioning
      ? running.some((a) => String(a.effect?.pseudoElement ?? '').includes('view-transition'))
      : running.length > 0;
    if (ready) return true;
    await wait(16);
  }
  return false;
}
function seekAnimations(p) {
  for (const a of document.getAnimations()) {
    if (!finite(a)) continue;
    a.pause();
    const t = a.effect.getComputedTiming();
    a.currentTime = (t.delay || 0) + p * t.activeDuration;
  }
}
function finishAnimations() {
  for (const a of document.getAnimations()) if (finite(a)) try { a.finish(); } catch {}
}
function animationInventory() {
  return document.getAnimations().filter(finite).map((a) => ({
    name: a.animationName ?? a.transitionProperty ?? a.id ?? '',
    on: a.effect?.pseudoElement ?? (a.effect?.target?.className?.toString?.() ?? '').slice(0, 50),
    ms: Math.round(a.effect.getComputedTiming().activeDuration)
  }));
}
async function longTasksDuring(run, settle = 600) {
  const tasks = [];
  const observer = new PerformanceObserver((list) => list.getEntries().forEach((e) => tasks.push(Math.round(e.duration))));
  observer.observe({ type: 'longtask', buffered: false });
  await run();
  await wait(settle);
  observer.disconnect();
  return tasks;
}
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
    this.listeners = [];
    this.ws.onmessage = (message) => {
      const data = JSON.parse(message.data);
      if (data.method) for (const listen of this.listeners) listen(data);
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
      }, CDP_TIMEOUT_MS);
    });
  }
  async eval(body) {
    const expression = `(async () => { ${HELPERS}\nconst S = window.__nemoraShots, api = window.api, D = window.__shotData;\n${body}\n})()`;
    const reply = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (reply.exceptionDetails) throw new Error(reply.exceptionDetails.exception?.description ?? reply.exceptionDetails.text);
    return reply.result.value;
  }
  async view({ width, height }) {
    await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: SCALE, mobile: false });
  }
  async shoot(file) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(file, Buffer.from(data, 'base64'));
  }
  close() {
    this.ws.close();
  }
}

/**
 * Records every change of the foreground window for the whole run, polled every 20 ms: a single
 * look at the end can both miss a moment in front and catch one that did not happen. `stop()`
 * returns the stretches the stand's own process held the foreground.
 */
function watchForeground() {
  const script = `Add-Type -Name F -Namespace W -MemberDefinition '[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(System.IntPtr h, out int p); [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(System.IntPtr h, System.Text.StringBuilder s, int n);'
$prev = -1
while ($true) { $h = [W.F]::GetForegroundWindow(); if ($h -ne $prev) { $p = 0; [void][W.F]::GetWindowThreadProcessId($h, [ref]$p); $c = New-Object System.Text.StringBuilder 128; [void][W.F]::GetClassName($h, $c, 128); [Console]::Out.WriteLine("$([DateTimeOffset]::Now.ToUnixTimeMilliseconds()) $p $c"); [Console]::Out.Flush(); $prev = $h }; Start-Sleep -Milliseconds 20 }`;
  const changes = [];
  let buffer = '';
  const watcher = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  watcher.stdout.setEncoding('utf8');
  watcher.stdout.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop();
    for (const line of lines) {
      const [at, pid, ...rest] = line.trim().split(' ');
      if (Number.isFinite(Number(at))) changes.push({ at: Number(at), pid: Number(pid), window: rest.join(' ') });
    }
  });
  return {
    stop(pid) {
      watcher.kill();
      const end = Date.now();
      return changes
        .map((change, i) => ({ ...change, ms: (changes[i + 1]?.at ?? end) - change.at }))
        .filter((change) => change.pid === pid);
    }
  };
}

/** CPU of a process and all its descendants (WebView2 runs as children), in % of one core. */
function cpuPercent(pid, seconds) {
  const script = `$all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId
function Tree($p) { $p; $all | Where-Object { $_.ParentProcessId -eq $p } | ForEach-Object { Tree $_.ProcessId } }
$ids = @(Tree ${pid})
function Total { (Get-Process -Id $ids -ErrorAction SilentlyContinue | ForEach-Object { $_.TotalProcessorTime.TotalMilliseconds } | Measure-Object -Sum).Sum }
$a = Total; $t = [Diagnostics.Stopwatch]::StartNew(); Start-Sleep -Seconds ${seconds}; $b = Total
[Math]::Round(($b - $a) / $t.ElapsedMilliseconds * 100, 2)`;
  try {
    return execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', timeout: (seconds + 30) * 1000, windowsHide: true }).trim();
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
    // The copy starts without the view's state the user's app wrote to the core (PLAN/21 P21.4):
    // with it, a fresh webview would restore the user's own settings and queue, and runs would
    // follow whatever the user did last. A run that needs that state makes it itself.
    const copy = new DatabaseSync(join(dir, 'profile', 'nemora.db'));
    copy.exec("DELETE FROM settings_device WHERE key LIKE 'view.%' OR key LIKE 'queue.%'; DELETE FROM queue_items;");
    if (README_PLAYS) seedReadmePlays(copy);
    copy.close();
    if (existsSync(join(copyFrom, 'covers'))) cpSync(join(copyFrom, 'covers'), join(dir, 'profile', 'covers'), { recursive: true });
  });
}

/**
 * `--reuse`: start again on the run folder a previous run of the same `--label` left (its profile
 * and webview data): an app restart, for checks across one (PLAN/21 P21.4).
 */
const REUSE = process.argv.includes('--reuse');

/**
 * `--readme`: the README's shots (r-*) play a set of songs first, in the COPY only: a few recent
 * plays of well-known and everyday songs, newest first, so Home's Continue, Recently played and
 * Recent artists show them rather than whatever the profile played last.
 */
const README_PLAYS = process.argv.includes('--readme');
const README_PLAYED = [
  ['Little Dark Age', 'MGMT'], ['Where Is My Mind? (Remastered)', 'Pixies'], ['夜に駆ける', 'YOASOBI'],
  ['Chamber Of Reflection', 'Mac Demarco'], ['aruarian dance', 'Nujabes'], ['satellites', 'Øneheart'],
  ['Freaks', 'Surf Curse'], ['Key', 'C418'], ['Better Off Alone', 'Alice Deejay'], ['Mrs Magic', 'Strawberry Guy'],
  ['Crimewave', 'Crystal Castles'], ['Frostfall', 'Jeremy Soule']
];
function seedReadmePlays(db) {
  const find = db.prepare(`SELECT v.song_id FROM track_variants v JOIN variant_artists a ON a.variant_id = v.variant_id
    WHERE v.title = ? AND a.name = ? AND a.position = 0 LIMIT 1`);
  const add = db.prepare(`INSERT OR REPLACE INTO play_events (event_id, device_id, seq, song_id, started_at, ended_at,
    utc_offset_min, heard_ms, duration_ms, max_position_ms, end_reason) VALUES (?, 'readme', ?, ?, ?, ?, ?, 180000, 180000, 180000, 'finished')`);
  const now = Date.now();
  const offset = -new Date().getTimezoneOffset();
  README_PLAYED.forEach(([title, artist], i) => {
    const row = find.get(title, artist);
    if (!row) return console.warn(`[readme] not in the library: ${title} - ${artist}`);
    const started = now - (i + 1) * 4 * 60_000;
    add.run(`readme:${i}`, 1_000_000 + i, row.song_id, started, started + 180_000, offset);
  });
}

async function runOne(name, shots, copyFrom) {
  const dir = join(OUT, `run-${name}`);
  if (!(REUSE && existsSync(join(dir, 'profile', 'nemora.db')))) await prepareProfile(dir, copyFrom);
  const log = openSync(join(dir, 'stdout.log'), 'w');
  const focus = watchForeground();
  await sleep(1500);
  const started = Date.now();
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
    stdio: ['ignore', log, log],
    // A debug build is a console program: without this its console window opens and takes the focus.
    windowsHide: true
  });
  const failures = [];
  let cdp;
  try {
    cdp = await Cdp.connect(PORT);
    await cdp.send('Page.enable');
    if (RENDER_COUNT) {
      await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: RENDER_HOOK });
      await cdp.send('Page.reload', { ignoreCache: false });
      await sleep(1500);
    }
    // Ordinary shots must not catch a page mid-transition; motion is shot on purpose with --film.
    if (!PROBE && !FILM) await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
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
    if (PROBE) {
      const body = readFileSync(PROBE, 'utf8');
      const ipc = [];
      const answers = [];
      if (IPC_TRACE) {
        const volatile = /^(at|atMs|startedAt|now|updatedAt|updated_at|writtenAt|ts|seq|generation|elapsed|took|today)$/i;
        const digest = (text) => {
          // The stand's run folder (named after --label) appears in every artwork URL: one name for all.
          let value = (text ?? '').replace(/nemora-shots(%5C|\\|\|\/)[^%\/"]+/g, 'nemora-shots$1<run>');
          try {
            value = JSON.stringify(JSON.parse(value), (k, v) => (volatile.test(k) ? undefined : v));
          } catch {
            /* not JSON: hashed as it is */
          }
          let h = 0x811c9dc5;
          for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 0x01000193) >>> 0;
          return `${value.length}:${h.toString(16)}`;
        };
        const byId = new Map();
        cdp.listeners.push((event) => {
          if (event.method === 'Network.requestWillBeSent') {
            const url = event.params.request.url;
            const m = /ipc\.localhost\/([^?]+)/.exec(url);
            // The CORS preflight (OPTIONS, no body) precedes each call: only the POST is the call.
            if (!m || event.params.request.method !== 'POST') return;
            const raw = event.params.request.postData ?? '';
            const call = { cmd: decodeURIComponent(m[1]), args: digest(raw), result: null, text: raw.slice(0, 160) };
            byId.set(event.params.requestId, call);
            ipc.push(call);
          } else if (event.method === 'Network.loadingFinished' && byId.has(event.params.requestId)) {
            const call = byId.get(event.params.requestId);
            answers.push(
              cdp
                .send('Network.getResponseBody', { requestId: event.params.requestId })
                .then((r) => {
                  const body = r.base64Encoded ? Buffer.from(r.body, 'base64').toString('latin1') : r.body;
                  call.result = digest(body);
                  // `--ipc-raw dir`: every answer as it came, to find what differs between runs.
                  if (option('ipc-raw', '')) {
                    mkdirSync(option('ipc-raw', ''), { recursive: true });
                    writeFileSync(join(option('ipc-raw', ''), `${String(ipc.indexOf(call)).padStart(3, '0')}-${call.cmd}.txt`), body);
                  }
                })
                .catch(() => (call.result = 'unread'))
            );
          }
        });
        await cdp.send('Network.enable', { maxPostDataSize: 1 << 20 });
      }
      for (const width of option('probe-widths', String(VIEW.width)).split(',').map(Number)) {
        await cdp.view({ width, height: VIEW.height });
        await sleep(800);
        console.log(`[probe ${width}px]`, JSON.stringify(await cdp.eval(body), null, 1));
      }
      if (IPC_TRACE) {
        await sleep(500);
        await Promise.all(answers);
        // Polled or clocked commands: their count follows timing, not the code under test.
        const noisy = /^(plugin:|engine_clipped$|engine_status$|lyrics_library$|energy_analysis$|widget_)/;
        const trace = ipc.filter((c) => !noisy.test(c.cmd));
        writeFileSync(IPC_TRACE, JSON.stringify({ commands: trace.length, trace }, null, 1));
        console.log(`[ipc] ${trace.length} commands written to ${IPC_TRACE}`);
      }
      if (CPU_SECONDS > 0) console.log(`[cpu] ${cpuPercent(app.pid, CPU_SECONDS)}% of one core over ${CPU_SECONDS} s`);
      return failures;
    }
    if (FILM) {
      const body = readFileSync(FILM, 'utf8');
      mkdirSync(join(OUT, 'film'), { recursive: true });
      for (const theme of THEMES) {
        await cdp.eval(RESET);
        await cdp.eval(`api.theme.changeAppTheme('${theme}');`);
        await sleep(900);
        await cdp.eval(body);
        const moving = await cdp.eval(`const ok = await untilAnimating(); seekAnimations(0); return ok ? animationInventory() : null;`);
        if (!moving) {
          failures.push(`film ${FILM_NAME} (${theme}): nothing animated`);
          continue;
        }
        console.log(`[film ${FILM_NAME} ${theme}]`, JSON.stringify(moving));
        for (const p of [0, 0.25, 0.5, 0.75, 1]) {
          await cdp.eval(`seekAnimations(${p});`);
          await sleep(80);
          await cdp.shoot(join(OUT, 'film', `${FILM_NAME}.${String(p * 100).padStart(3, '0')}.${theme}.png`));
        }
        await cdp.eval(`finishAnimations();`);
        await sleep(400);
      }
      if (CPU_SECONDS > 0) console.log(`[cpu] ${cpuPercent(app.pid, CPU_SECONDS)}% of one core over ${CPU_SECONDS} s`);
      return failures;
    }
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
      // The view's state reaches the core a moment after a change (PLAN/21 P21.4): unmute, let it
      // land, then quit.
      await cdp?.eval(`S.toggleMutedState(false); await wait(2000); api.bench.quit();`);
    } catch {
      /* already gone */
    }
    cdp?.close();
    await Promise.race([new Promise((r) => app.on('exit', r)), sleep(5000)]);
    if (app.exitCode === null) app.kill();
    const taken = focus.stop(app.pid);
    if (taken.length) {
      failures.push(`focus (${name}): the stand's window was in front ${taken.length}x, ${taken.map((t) => `${t.window || 'a window'} ${t.ms} ms at +${((t.at - started) / 1000).toFixed(1)} s`).join(', ')}`);
    }
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
if (!PROBE && !FILM) contactSheet([{ id: '07-loading', surface: 'Loading (first frame)', themes: ['dark'] }, ...SHOTS, ...(SKIP_EMPTY ? [] : EMPTY_SHOTS)]);
console.log(`Shots in ${OUT}\\index.html`);
if (failures.length) {
  console.log(`\n${failures.length} failed:\n${failures.join('\n')}`);
  process.exitCode = 1;
}

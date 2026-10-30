/**
 * Redesign progress counter (PLAN/13 in the vault). Counts, per file of the desktop view, what the
 * redesign removes: `dark:` classes, the old theme colours, colours written into class names,
 * Tailwind palette colours, the old icon classes and Poppins. The redesign is done when every count
 * is zero.
 *
 *   node tools/redesign/audit.mjs            totals, per surface, the 25 heaviest files
 *   node tools/redesign/audit.mjs --files    every file with something left
 *   node tools/redesign/audit.mjs --json     machine-readable, for comparing two runs
 *   node tools/redesign/audit.mjs <path...>  only files under these paths
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DESKTOP = join(ROOT, 'apps', 'desktop');
const SOURCES = [join(DESKTOP, 'src', 'renderer'), join(DESKTOP, 'src', 'platform'), join(DESKTOP, 'tailwind.config.js')];

/** Old theme colour names, as Tailwind classes and as CSS variables. */
const OLD = String.raw`(?:dark-)?(?:background-color-(?:[123]|dimmed)|side-bar-background|song-background-color|font-color(?:-(?:dimmed|black|white|highlight(?:-2)?|crimson|variant))?|text-color(?:-(?:dimmed|white|black|crimson|highlight(?:-2)?|variant))?|seekbar(?:-track)?-background-color|context-menu-(?:background|list-hover)|foreground-color-1|scrollbar-thumb-background-color|slider-opacity)`;

const RULES = {
  /** `dark:` variants: tokens switch with the theme, so none are needed. */
  dark: /(?<![\w-])dark:[^\s'"`]+/g,
  /** Old theme colours used as classes (`bg-background-color-2`, `text-dark-font-color-highlight/50`). */
  oldClass: new RegExp(String.raw`(?<![\w-])(?:[a-z-]+:)*-?(?:bg|text|border|from|via|to|fill|stroke|outline|ring|ring-offset|shadow|divide|placeholder|accent|caret|decoration)-${OLD}(?:\/\d+)?(?![\w-])`, 'g'),
  /** Old theme colours used as CSS variables (`var(--background-color-1)`, `hsl(var(--text-color-highlight))`). */
  oldVar: new RegExp(String.raw`--${OLD}(?![\w-])`, 'g'),
  /** Colours written straight into a class: `text-[#ccc]`, `bg-[hsla(0,0%,0%,0.5)]`. */
  rawColour: /(?<![\w-])(?:[a-z-]+:)*-?(?:bg|text|border|from|via|to|fill|stroke|outline|ring|shadow|divide)-\[(?:#|hsla?\(|rgba?\()[^\]]*\]/g,
  /** Tailwind palette colours (`text-red-500`, `bg-black/50`, `border-white`). */
  palette: /(?<![\w-])(?:[a-z-]+:)*-?(?:bg|text|border|from|via|to|fill|stroke|outline|ring|shadow|divide)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|black|white)(?:-\d{2,3})?(?:\/\d+)?(?![\w-])/g,
  /** The old icon classes; the `Icon` component replaces them. */
  icon: /material-icons-round(?:-outlined)?/g,
  /** The old typeface. */
  poppins: /Poppins/g
};

/** Files whose colours are deliberate and stay (the tier colours of the tier maker). */
const KEEP = new Set(['src/renderer/src/components/TierlistEditorPage/tierColors.ts']);

/** Which checklist surface (PLAN/13) a file belongs to, by its folder or name. */
const SURFACES = [
  [/components\/TitleBar\//, '01 Top bar'],
  [/components\/Sidebar\//, '02 Sidebar'],
  [/components\/(SongsControlsContainer\/|SeekBarSlider|VolumeSlider)/, '03 Player'],
  [/components\/ContextMenu\/|other\/nativeContextMenu/, '04 Context menu'],
  [/components\/(PromptMenu\/|SensitiveActionConfirmPrompt|OpenLinkConfirmPrompt|ErrorPrompt|SongUnplayableErrorPrompt|UnsupportedFileMessagePrompt)/, '05 Dialogs'],
  [/components\/NotificationPanel\/|parseNotificationFromMain/, '06 Notifications'],
  [/components\/(Preloader\/|SuspenseLoader)/, '07 Loading'],
  [/components\/MiniPlayer\//, '08 Mini player'],
  [/components\/FullScreenPlayer\//, '09 Full-screen player'],
  [/assets\/styles\/|tailwind\.config/, '10 Global styles'],
  [/components\/HomePage\//, '11 Home'],
  [/components\/SongsPage\//, '12 Songs'],
  [/components\/ArtistPage\//, '13 Artists'],
  [/components\/(ArtistInfoPage|Biography)\//, '14 Artist'],
  [/components\/AlbumsPage\//, '15 Albums'],
  [/components\/AlbumInfoPage\//, '16 Album'],
  [/components\/GenresPage\//, '17 Genres'],
  [/components\/GenreInfoPage\//, '18 Genre'],
  [/components\/PlaylistsPage\//, '19 Playlists'],
  [/components\/PlaylistsInfoPage\//, '20 Playlist'],
  [/components\/MusicFoldersPage\//, '21 Folders'],
  [/components\/MusicFolderInfoPage\//, '22 Folder'],
  [/components\/SearchPage\//, '23 Search'],
  [/components\/CurrentQueuePage\//, '25 Queue'],
  [/components\/LyricsPage\//, '26 Lyrics'],
  [/components\/LyricsEditingPage\//, '27 Lyrics editor'],
  [/components\/SongInfoPage\//, '28 Song info'],
  [/components\/SongTagsEditingPage\//, '29 Tag editor'],
  [/components\/TierlistsPage\//, '30 Tierlists'],
  [/components\/TierlistEditorPage\//, '31 Tierlist editor'],
  [/components\/StatsPage\//, '32 Stats'],
  [/components\/SongGuessr\//, '33 SongGuessr'],
  [/components\/EloDuel\//, '34 Duel'],
  [/components\/SettingsPage\//, '35 Settings'],
  [/components\/(ReleaseNotesPrompt\/|ErrorBoundary)/, '36 Release notes, errors'],
  [/components\/ui\//, 'P2 Primitives'],
  [/components\/[A-Za-z]+\.tsx$/, 'P2 Shared components'],
  [/./, 'App and the rest']
];

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const only = args.filter((a) => !a.startsWith('--')).map((p) => join(process.cwd(), p));

function walk(path, out) {
  const stat = statSync(path);
  if (stat.isDirectory()) {
    for (const name of readdirSync(path)) {
      if (name === 'node_modules' || name === 'locales' || name === 'images' || name === 'fonts') continue;
      walk(join(path, name), out);
    }
  } else if (/\.(tsx?|css|js|html)$/.test(path)) out.push(path);
  return out;
}

const files = SOURCES.flatMap((s) => walk(s, [])).filter((f) => only.length === 0 || only.some((o) => f.startsWith(o)));
const rows = [];
for (const file of files) {
  const rel = relative(DESKTOP, file).split(sep).join('/');
  if (rel.endsWith('other/shots.tsx')) continue;
  const text = readFileSync(file, 'utf8');
  const counts = {};
  let total = 0;
  for (const [name, re] of Object.entries(RULES)) {
    if (KEEP.has(rel) && (name === 'rawColour' || name === 'palette')) {
      counts[name] = 0;
      continue;
    }
    const n = (text.match(re) || []).length;
    counts[name] = n;
    total += n;
  }
  const surface = SURFACES.find(([re]) => re.test(rel))[1];
  rows.push({ file: rel, surface, total, ...counts });
}

const sum = (list, key) => list.reduce((acc, row) => acc + row[key], 0);
const totals = Object.fromEntries(Object.keys(RULES).map((k) => [k, sum(rows, k)]));
const grand = sum(rows, 'total');

if (flags.has('--json')) {
  console.log(JSON.stringify({ at: new Date().toISOString(), grand, totals, files: rows.filter((r) => r.total > 0) }, null, 1));
  process.exit(0);
}

const pad = (s, n) => String(s).padEnd(n);
const num = (s, n) => String(s).padStart(n);
console.log(`Redesign audit: ${grand} left in ${rows.filter((r) => r.total).length} of ${rows.length} files\n`);
console.log(Object.entries(totals).map(([k, v]) => `${pad(k, 10)} ${num(v, 6)}`).join('\n'));

const bySurface = new Map();
for (const row of rows) bySurface.set(row.surface, (bySurface.get(row.surface) ?? 0) + row.total);
console.log('\nPer surface');
for (const [surface, n] of [...bySurface].sort((a, b) => a[0].localeCompare(b[0]))) console.log(`${pad(surface, 32)} ${num(n, 6)}${n === 0 ? '  done' : ''}`);

const left = rows.filter((r) => r.total > 0).sort((a, b) => b.total - a.total);
const shown = flags.has('--files') ? left : left.slice(0, 25);
if (shown.length) {
  console.log(`\n${flags.has('--files') ? 'Files' : 'Heaviest files'}  (dark old var raw pal icon poppins)`);
  for (const r of shown)
    console.log(`${num(r.total, 5)}  ${pad(r.file, 78)} ${[r.dark, r.oldClass, r.oldVar, r.rawColour, r.palette, r.icon, r.poppins].join(' ')}`);
}
process.exitCode = flags.has('--strict') && grand > 0 ? 1 : 0;

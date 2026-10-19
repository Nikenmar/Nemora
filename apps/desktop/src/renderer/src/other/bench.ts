/**
 * The in-app half of the benchmark (tools/bench in the Nemora repository).
 *
 * The SAME file is built into Nora 3.1.0 and into Nemora 2.0, so both players run the identical
 * scenario through identical code; only `window.api.bench` (the config, the marks file, quitting)
 * belongs to each app. Inert unless the app was started with `--bench=<folder>`.
 *
 * Every step leaves a mark with a wall-clock time. The harness reads them to know what the app was
 * doing while it measured CPU, memory and sound from outside.
 */

type PageName = 'Home' | 'Songs' | 'Albums' | 'Artists' | 'Genres' | 'Playlists' | 'Search';

type Step =
  /** The start page is on screen, library or not. */
  | { do: 'home' }
  /** The library is loaded and the start page is on screen. */
  | { do: 'ready' }
  /**
   * Links the bench library as a music folder; done once the app lists `expect` songs. Every frame
   * is recorded meanwhile: whether the interface keeps moving while the library is built.
   */
  | { do: 'addFolder'; expect: number }
  /** Opens a page; timed until its first item is painted. */
  | { do: 'page'; page: PageName; label?: string }
  /** Opens a page that may have nothing on it yet, untimed. */
  | { do: 'goto'; page: PageName }
  /** Types into the search page's box and times until results are painted, as a person sees it. */
  | { do: 'typeSearch'; query: string }
  /** Scrolls the song list for `ms`, recording every frame. */
  | { do: 'scroll'; ms: number }
  /** Plays the song at `path`; the harness hears when the sound starts. */
  | { do: 'play'; path: string }
  /** Minimizes the window, hides it to the tray, or shows it again. */
  | { do: 'window'; state: 'minimized' | 'hidden' | 'shown' }
  /**
   * Queues `from` then `to`, and seeks to `tailSec` before the end of `from`: the harness hears the
   * gap between the two.
   */
  | { do: 'transition'; from: string; to: string; tailSec: number }
  | { do: 'wait'; ms: number }
  /** Waits for the harness to create the file `name` in the run folder: it decides when work is over. */
  | { do: 'waitSignal'; name: string; timeoutMs: number }
  | { do: 'quit' };

interface BenchConfig {
  steps: Step[];
  /** Each app's own description of the library folder, as its add-folder call takes it. */
  structures: unknown[];
}

interface BenchApi {
  config: () => Promise<BenchConfig | null>;
  mark: (name: string, at: number, data?: unknown) => void;
  signal: (name: string) => Promise<boolean>;
  quit: () => void;
}

// Method syntax on purpose: each app's own, wider signatures must be accepted here.
interface AppBridge {
  changeCurrentActivePage(page: PageName): void;
  playSong(songId: string, isStartPlay?: boolean): void;
  createQueue(
    queue: string[],
    queueType: 'songs',
    isShuffleQueue?: boolean,
    queueId?: string,
    startPlaying?: boolean
  ): void;
  updateSongPosition(position: number): void;
  currentSongId(): string | undefined;
}

interface Song {
  songId: string;
  path: string;
  duration: number;
}

interface LibraryApi {
  audioLibraryControls: {
    getAllSongs: (sortType?: string) => Promise<{ data: Song[] }>;
    addSongsFromFolderStructures: (structures: never[]) => Promise<unknown>;
  };
  windowControls: { minimizeApp: () => void; hideApp: () => void; showApp: () => void };
}

const api = () => (window as unknown as { api: LibraryApi & { bench?: BenchApi } }).api;

/** What is on screen once a page has painted its first item. */
const FIRST_ITEM: Record<PageName, string> = {
  Home: '.home-page',
  Songs: '.songs-container .song-cover-and-play-btn-container',
  Albums: '.album',
  Artists: '.artist',
  Genres: '.genre',
  Playlists: '.playlist',
  Search: '#searchBar'
};

/** Any result the search page can show. */
const SEARCH_RESULT = '.song-cover-and-play-btn-container, .album, .artist, .genre, .playlist';

let bridge: AppBridge | null = null;
let started = false;

const frame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Two frames after the DOM has it: the frame that lays it out, and the one that shows it. */
const painted = async () => {
  await frame();
  await frame();
};

async function until<T>(
  check: () => T | null | undefined | false,
  timeoutMs: number,
  what: string
): Promise<T> {
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    const value = check();
    if (value) return value;
    if (performance.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await frame();
  }
}

const normalize = (path: string) => path.replaceAll('/', '\\').toLowerCase();

async function songs(): Promise<Song[]> {
  const result = await api().audioLibraryControls.getAllSongs('aToZ');
  return result?.data ?? [];
}

async function songAt(path: string): Promise<Song> {
  const wanted = normalize(path);
  const song = (await songs()).find((candidate) => normalize(candidate.path) === wanted);
  if (!song) throw new Error(`the library has no song at ${path}`);
  return song;
}

/** Waits until an element matching `selector` appears that was not there in `before`. */
const appears = (selector: string, before: Set<Element>, timeoutMs: number, what: string) =>
  until(
    () => [...document.querySelectorAll(selector)].some((element) => !before.has(element)),
    timeoutMs,
    what
  );

/**
 * A page is ready when an item appears that was not on screen before the switch, so an album card
 * on the home page cannot count as the albums page having painted.
 */
async function openPage(page: PageName): Promise<number> {
  const selector = FIRST_ITEM[page];
  const before = new Set(document.querySelectorAll(selector));
  const t0 = performance.now();
  bridge!.changeCurrentActivePage(page);
  await appears(selector, before, 30_000, `the ${page} page`);
  await painted();
  return performance.now() - t0;
}

/** Sets the box's value the way typing does, so React's onChange sees it. */
function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function typeSearch(query: string): Promise<number> {
  const input = await until(
    () => document.querySelector<HTMLInputElement>(FIRST_ITEM.Search),
    10_000,
    'the search box'
  );
  // An empty box first, so the previous query's results are gone before this one is timed.
  type(input, '');
  await sleep(600);
  const before = new Set(document.querySelectorAll(SEARCH_RESULT));
  const t0 = performance.now();
  type(input, query);
  await appears(SEARCH_RESULT, before, 15_000, `results for ${query}`);
  await painted();
  return performance.now() - t0;
}

/** The element that scrolls the song list: the tallest scrollable box inside it. */
function songScroller(): HTMLElement | null {
  const container = document.querySelector('.songs-container');
  if (!container) return null;
  const candidates = [container, ...container.querySelectorAll('*')].filter(
    (element): element is HTMLElement => {
      if (!(element instanceof HTMLElement)) return false;
      const style = getComputedStyle(element);
      return (
        element.scrollHeight > element.clientHeight + 200 && /(auto|scroll)/.test(style.overflowY)
      );
    }
  );
  return candidates.sort((a, b) => b.scrollHeight - a.scrollHeight)[0] ?? null;
}

const percentile = (sorted: number[], p: number) =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))] : 0;

/** Frame gaps reduced to what a person notices. */
function frameStats(gaps: number[], ms: number) {
  const sorted = [...gaps].sort((a, b) => a - b);
  return {
    frames: gaps.length,
    fps: gaps.length / (ms / 1000),
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    maxMs: sorted.at(-1) ?? 0,
    // Two refreshes or more at 60 Hz: a frame the eye sees as missing.
    longFrames: gaps.filter((gap) => gap > 33.4).length,
    // Long enough to read as the interface hanging.
    frozenMs: gaps.filter((gap) => gap > 100).reduce((sum, gap) => sum + gap, 0)
  };
}

/** Records every frame until `stop()`; the gaps are what was not drawn. */
function recordFrames() {
  const gaps: number[] = [];
  let running = true;
  const started = performance.now();
  let last = started;
  const tick = (now: number) => {
    gaps.push(now - last);
    last = now;
    if (running) requestAnimationFrame(tick);
  };
  requestAnimationFrame((now) => {
    last = now;
    requestAnimationFrame(tick);
  });
  return () => {
    running = false;
    return frameStats(gaps, performance.now() - started);
  };
}

/** Scrolls at a fixed speed and records the gap between frames; a long gap is a visible stutter. */
async function scroll(ms: number) {
  const scroller = await until(songScroller, 10_000, 'the song list');
  scroller.scrollTop = 0;
  await painted();
  const gaps: number[] = [];
  let last = await frame();
  const end = last + ms;
  while (last < end) {
    if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2)
      scroller.scrollTop = 0;
    else scroller.scrollTop += 40;
    const now = await frame();
    gaps.push(now - last);
    last = now;
  }
  return frameStats(gaps, ms);
}

async function run(bench: BenchApi, config: BenchConfig) {
  const mark = (name: string, data?: unknown) => bench.mark(name, Date.now(), data);
  mark('runner-start');
  for (const [index, step] of config.steps.entries()) {
    try {
      switch (step.do) {
        case 'home': {
          await until(() => document.querySelector(FIRST_ITEM.Home), 60_000, 'the home page');
          await painted();
          mark('home');
          break;
        }
        case 'ready': {
          await until(() => document.querySelector(FIRST_ITEM.Home), 60_000, 'the home page');
          // Loaded means the library answers, not only that a page exists.
          const deadline = performance.now() + 60_000;
          while ((await songs()).length === 0) {
            if (performance.now() > deadline) throw new Error('the library never loaded');
            await sleep(50);
          }
          await painted();
          mark('ready');
          break;
        }
        case 'addFolder': {
          const stop = recordFrames();
          mark('scan-start');
          await api().audioLibraryControls.addSongsFromFolderStructures(
            config.structures as never[]
          );
          mark('scan-returned');
          const deadline = performance.now() + 30 * 60_000;
          let count = 0;
          while ((count = (await songs()).length) < step.expect) {
            if (performance.now() > deadline)
              throw new Error(`only ${count} of ${step.expect} songs appeared`);
            await sleep(100);
          }
          mark('scan-listed', { count, frames: stop() });
          break;
        }
        case 'page': {
          const ms = await openPage(step.page);
          mark('page', { page: step.page, label: step.label ?? step.page, ms });
          break;
        }
        case 'goto': {
          bridge!.changeCurrentActivePage(step.page);
          await sleep(1_000);
          await painted();
          mark('goto', { page: step.page });
          break;
        }
        case 'typeSearch': {
          mark('search', { query: step.query, ms: await typeSearch(step.query) });
          break;
        }
        case 'scroll': {
          mark('scroll-start');
          mark('scroll', await scroll(step.ms));
          break;
        }
        case 'play': {
          const song = await songAt(step.path);
          mark('play-requested', { songId: song.songId });
          bridge!.playSong(song.songId, true);
          break;
        }
        case 'window': {
          const controls = api().windowControls;
          if (step.state === 'minimized') controls.minimizeApp();
          else if (step.state === 'hidden') controls.hideApp();
          else controls.showApp();
          mark('window', { state: step.state });
          break;
        }
        case 'transition': {
          const from = await songAt(step.from);
          const to = await songAt(step.to);
          bridge!.createQueue([from.songId, to.songId], 'songs', false, undefined, true);
          mark('transition-start');
          // Let the first song load and play before jumping to its end.
          await sleep(3_000);
          const playing = bridge!.currentSongId();
          bridge!.updateSongPosition(Math.max(0, from.duration - step.tailSec));
          mark('seek-to-end', { endsAt: Date.now() + step.tailSec * 1000, playing });
          // By ear the two songs cannot be told apart, so the app is asked which one plays now.
          await sleep(step.tailSec * 1000 + 2_500);
          mark('transition-check', {
            firstWasPlaying: playing === from.songId,
            secondIsPlaying: bridge!.currentSongId() === to.songId
          });
          break;
        }
        case 'wait':
          await sleep(step.ms);
          break;
        case 'waitSignal': {
          const deadline = performance.now() + step.timeoutMs;
          while (!(await bench.signal(step.name))) {
            if (performance.now() > deadline) throw new Error(`no ${step.name} signal`);
            await sleep(250);
          }
          break;
        }
        case 'quit':
          mark('done');
          bench.quit();
          return;
      }
    } catch (error) {
      mark('error', {
        step: index,
        do: step.do,
        message: error instanceof Error ? error.message : String(error)
      });
      bench.quit();
      return;
    }
  }
  mark('done');
}

/** Called by App with its navigation and playback; the first call starts the scenario. */
export function registerBenchApp(app: AppBridge) {
  bridge = app;
  if (started) return;
  started = true;
  const bench = api().bench;
  if (!bench) return;
  void bench.config().then((config) => {
    if (config) void run(bench, config);
  });
}

/** Whether the app runs under the harness; anything that would phone home checks this first. */
export async function isBenchRun(): Promise<boolean> {
  return (
    (await api()
      .bench?.config()
      .catch(() => null)) != null
  );
}

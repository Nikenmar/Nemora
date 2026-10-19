# Benchmark: Nora 3.1.0 against Nemora 2.0

One folder per benchmark. Everything a run writes goes into it, and nothing else on the machine is
touched; deleting the folder removes every trace.

```text
node tools/bench/bench.mjs prepare --root E:\bench\2026-10   # sample the library, write bench.json
node tools/bench/bench.mjs run     --root E:\bench\2026-10   # ~35 min; --quick for a 6 min check
node tools/bench/bench.mjs report  --root E:\bench\2026-10   # rebuild results\report.md from raw.json
```

Close every Nemora and Nora first, the tray icon included. `run` refuses to start otherwise.

## What runs where

- **The apps carry the hooks.** Both builds take `--bench=<folder>`, which moves their profile,
  renderer state, logs and temp files into that folder, turns off what would reach outside it
  (update checks, the `nora://` protocol registration, global shortcuts, the single-instance hand-off
  to an installed copy, the 1.x import, Nemora's HTTP cookie jar), keeps both players OFFLINE, and
  runs a scenario. Offline because a request to the internet is noise in every figure, and an
  asymmetry whenever one side gets an answer the other does not.
  - Nemora: `apps/desktop/src-tauri/src/bench.rs`, `apps/desktop/src/platform/api/bench.ts`.
  - Nora: `nora/apply-patch.py` builds the same hooks into a checkout of `v3.1.0-stable`
    (`nora/bench-main.ts` is its main-process half). Without the flag the build behaves as the release.
- **One scenario runner for both.** `app/bench.ts` is copied into both views unchanged; it opens
  pages, searches, scrolls, links the library folder and plays a song through each app's own
  `changeCurrentActivePage` / `playSong`, and writes a timestamped mark for every step.
- **One instrument outside both.** `lib/sampler.ps1` watches the process tree from Windows: when the
  window becomes visible, CPU and private working set of every process in the tree, and the peak
  meter of the tree's audio sessions. No number is taken from the app's opinion of itself.

## The run folder

```text
<root>\
  bench.json            builds, run counts, the sampled tracks; edit before `run` if needed
  library\              hard links to the sampled tracks (copies if on another volume)
  base\<app>\           the profile after the first good scan; every later launch starts from it
  runs\<phase>-<app>-N\ one launch: profile, webview, logs, marks.jsonl, events.jsonl, bench-env.json
  results\raw.json      every launch, its marks reduced to metrics, discards with their reason
  results\report.md     the table
```

## Phases

| Phase | Starts from | Measures |
|---|---|---|
| prime | nothing | each player opened twice on an empty profile; not measured, see below |
| scan | the primed empty profile | adding the library folder: songs listed, all covers and colours done, CPU time, peak RAM |
| startup | the scanned profile | window on screen, ready (library loaded, home painted), RAM and idle CPU over 60 to 70 s |
| ui | the scanned profile | each page opened twice, three searches, an 8 s scroll of the song list (frame times) |
| playback | the scanned profile | one FLAC and one MP3: time to first sound, CPU and RAM over 20 s of confirmed sound |

Launches alternate between the players. Playback runs where Windows hears no sound are discarded.
The playback tracks are chosen by `prepare` with ffmpeg: loud from the first quarter second and never
quiet in the first 40 s, so the start of the sound is the start of the track and a quiet passage
cannot read as a silent player.

**Why prime.** Nora 3.1.0 does not record its store migrations when it creates a fresh profile. The
second launch therefore runs every migration, including 3.0.0's, which empties the library. A library
built in the very first session of a new Nora 3.1.0 install is gone at the next start (reproduced:
30 songs before, 0 after). Priming gives both players the profile of someone who has opened the app
before, which is also the honest starting point for timing a scan.

Opening a page the first time includes loading that page's code; the view is the same code in both
players, so that row compares the runtimes, not two implementations.

## Isolation, checked every launch

- `bench-env.json`, written by the app itself, lists every location it writes to; each must lie
  inside the run folder, and the profile and webview folders must have been created there.
- The real profiles (`%APPDATA%\Nemora`, `%APPDATA%\Nora`, Nemora's WebView2 folder, Nora's updater
  cache) and the `nora`/`nemora` protocol and autostart registry keys are fingerprinted before and
  after; any difference stops the benchmark with the list of changes.
- Only the launched process tree is ever killed, and only if it does not quit by itself.

## Building the two sides

```text
# Nemora: a release build (a debug build would flatter Electron)
cd apps/desktop && npx tauri build --config "{\"bundle\":{\"createUpdaterArtifacts\":false}}"

# Nora 3.1.0 with the hooks, from the upstream tag
git -C <Nora repo> worktree add -b bench/nora-3.1.0 E:\NemoraBench\nora-3.1.0 v3.1.0-stable
cd E:\NemoraBench\nora-3.1.0 && npm ci
python <Nemora repo>\tools\bench\nora\apply-patch.py E:\NemoraBench\nora-3.1.0
npm run build:unpack          # dist\win-unpacked\Nora.exe, Electron 35.0.3 as in the release
```

`python tools/bench/nemora/apply-hooks.py` copies `app/bench.ts` into Nemora's view after a change.
Installer and installed sizes are taken from the official Nora 3.1.0 release files named in
`bench.json`, since the bench build differs from them only by the hooks.

# Benchmark: Nora 3.1.0 against Nemora 2.0

One folder per benchmark. Everything a run writes goes into it, and nothing else on the machine is
touched; deleting the folder removes every trace.

```text
node tools/bench/bench.mjs prepare --root E:\bench\2026-10   # sample the libraries, write bench.json
node tools/bench/bench.mjs run     --root E:\bench\2026-10   # ~70 min; --quick for a short check
node tools/bench/bench.mjs report  --root E:\bench\2026-10   # rebuild results\report.md from raw.json
node tools/bench/card.mjs          --root E:\bench\2026-10   # results\benchmark.png, the README card
```

The card needs `npm install` in `tools/bench` once (satori, resvg) and Python with fontTools to
convert the app's Poppins to ttf; the harness itself runs on Node alone.

Close every Nemora and Nora first, the tray icon included; `run` refuses to start otherwise. Close
anything else that plays sound too: a playback or transition run during which another app adds sound
to the device is discarded. Apps that only record the desktop audio (OBS, Discord) are recognised as
mirrors and do not count, but OBS still costs CPU that both players then share.

`prepare` takes `--count` (the small library, 400 by default), `--large` (the scale library, 0 for the
whole collection) and `--source` (music folders; by default those of the installed Nemora).

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
  pages, types searches, scrolls, links the library folder, plays, queues and seeks through each
  app's own `App` callbacks (`app/bridge.py` wires them in), records frame times, and writes a
  timestamped mark for every step.
- **One instrument outside both.** `lib/sampler.ps1` watches the process tree from Windows: when the
  window becomes visible, CPU, private working set and I/O of every process in the tree, the peak
  meter of the tree's audio sessions and of every other app's. In the playback and transition phases
  it also records what the device plays (WASAPI loopback) and reports every silence of 2 ms or more:
  the peak meter refreshes only every few tens of ms and reports the loudest moment of that period,
  so a short silence inside music never shows on it.

## The run folder

```text
<root>\
  bench.json              builds, run counts, the tracks; edit before `run` if needed
  library-small\          hard links to the sampled tracks (copies if on another volume)
  library-large\          the same for the scale runs
  blank\<app>\            the primed empty profile every scan starts from
  base\<size>\<app>\      the profile after the first good scan of that size
  runs\<phase>-<variant>-<app>-N\  one launch: profile, webview, logs, marks, events, bench-env.json
  results\raw.json        every launch, its metrics, discards with their reason
  results\report.md       the table
```

## Phases

| Phase | Starts from | Measures |
|---|---|---|
| prime | nothing | each player opened twice on an empty profile; not measured, see below |
| scan (small, large) | the primed profile | adding the library with the song list on screen: songs listed, everything done, CPU time, peak RAM, bytes written, profile size afterwards, and the interface meanwhile (long and frozen frames) |
| startup (small, large) | the scanned profile | window on screen, ready, CPU time and disk I/O in the first minute, RAM and idle CPU over 60 to 70 s |
| ui (small, large) | the scanned profile | each page opened twice, three searches typed into the search box, an 8 s scroll of the song list (frame times) |
| playback | the small scanned profile | FLAC and MP3 with the window open, FLAC minimized and hidden in the tray: time to first sound, CPU and RAM over 20 s of confirmed sound, dropouts |
| transition | the small scanned profile | two queued songs, the first ending loud and the second starting loud: the silence between them |

Launches alternate between the players, and each waits until the whole machine has been under 6 %
CPU for two seconds (a run that never got there is kept and flagged in the report). Playback runs
where Windows hears no sound are discarded. `prepare` chooses the tracks with ffmpeg: playback tracks
loud from the first quarter second and never quiet in the first 40 s, so the start of the sound is the
start of the track and any silence in the window is a dropout; the transition pair ending and starting
loud, so any silence at the change is the player's.

**Why prime.** Nora 3.1.0 does not record its store migrations when it creates a fresh profile. The
second launch therefore runs every migration, including 3.0.0's, which empties the library. A library
built in the very first session of a new Nora 3.1.0 install is gone at the next start (reproduced:
30 songs before, 0 after). Priming gives both players the profile of someone who has opened the app
before, which is also the honest starting point for timing a scan.

Opening a page the first time includes loading that page's code, and a typed search includes the
view's 250 ms pause after typing; the view is the same code in both players, so those rows compare
the runtimes, not two implementations.

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

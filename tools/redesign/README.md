# Redesign tools

Branch-only helpers for the desktop redesign (vault: `PROJECTS/nemora-reborn/PLAN/13-desktop-redesign.md`).

- `node tools/redesign/audit.mjs` counts what the redesign removes (`dark:` classes, old theme
  colours, raw colours in classes, Tailwind palette colours, old icon classes, Poppins), per
  surface and per file. Done means zero.
- `node tools/redesign/shots.mjs --label <name>` shoots every surface in the black and the light
  theme from `target/debug/nemora.exe` (build it first: `npm run tauri -- build --debug --no-bundle`
  in `apps/desktop`). It runs in a `--bench` folder under `E:\tmp\nemora-shots\<name>` with a copy
  of the installed profile, offline and muted, and writes `index.html` with the shots side by side.
  `--only 12-songs,14-artist` limits it; `--skip-empty` skips the empty-library run.
  The window runs in the background and is never activated (`bench.rs`), so the machine stays
  usable meanwhile; the foreground is recorded for the whole run, and a run fails if the stand's
  window was in front even for a moment.

The app side is `apps/desktop/src/renderer/src/other/shots.tsx`, inert outside a bench run.

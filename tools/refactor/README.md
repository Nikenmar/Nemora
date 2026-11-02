# Refactoring without breaking anything (PLAN/21)

Every refactor commit is checked against the code as it was, with the tools here. A commit that
cannot pass all of them is not made.

| Check | Command | Must be |
|---|---|---|
| Renderer characterisation tests | `npm --prefix apps/desktop test` | all pass, no snapshot changed |
| The tests can fail | `node tools/refactor/mutation.mjs` | every mutation caught |
| IPC trace | `node tools/redesign/shots.mjs --label <x> --exe target/release/nemora.exe --probe tools/refactor/ipc-tour.js --ipc-trace E:/tmp/ipc-<x>.json`, then `node tools/refactor/ipc-diff.mjs E:/tmp/ipc-base.json E:/tmp/ipc-<x>.json` | 0 differences |
| Pixels | `node tools/redesign/shots.mjs --label <x> --exe target/release/nemora.exe`, then `node tools/refactor/pixel-diff.mjs base1 <x> --stable --out E:/tmp/pixdiff-<x>` | 0 differing among the stable shots; dynamic ones looked at |
| Core and app | `cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace --locked`, `npm --prefix apps/desktop run check-types`, `npm --prefix apps/desktop run lint -- --max-warnings 0`, `node tools/licenses/licenses.mjs --check` | clean |
| IPC types | `cargo test -p nemora-desktop --test desktop ipc_types` (the generated file is what the commands say), then `node tools/refactor/ipc-types-check.mjs` | 0 differing; each explained one has its reason in `ipc-types-explained.json` |

- **The IPC trace** is read from outside the page (CDP Network, the `ipc.localhost` POSTs Tauri 2
  makes on Windows): the bridge `window.__TAURI_INTERNALS__.invoke` is frozen, and the product
  carries no recorder. Answers of clocked commands are compared by their arguments only; the stand's
  run folder is normalised out of every answer.
- **Record the IPC baseline just before the comparison**, from the build before the change. The
  stand starts from a fresh profile copy, so the mix of the day is computed anew on every run, and
  it depends on the time of day as well as the date (measured on 2026-11-03: the same build at
  01:02 and at 04:00 differs in the mix's songs; at the same time, old and new builds agree).
- **IPC types** (PLAN/21 P21.2): `src-tauri/src/ipc_types.rs` reads every command's arguments and
  answer from Rust with specta, in a test only (specta is a dev-dependency, the attributes are
  `cfg_attr(test, ...)`), and writes `apps/desktop/src/platform/ipc/generated.ts`.
  `ipc-types-check.mjs` reads the view with the TypeScript compiler and compares each call's
  expected answer and sent arguments with it. A command answering `serde_json::Value` is untyped
  on the Rust side and is listed, not proven.
- **The pixel baseline** is `base1` (three runs of one build agreed on 95 of 147 shots,
  `stable-shots.txt`). The other shots move between runs of the same build (time windows, random
  orders, duels, Song Guessr, covers loading, notifications): their differences are written as
  images with `--out` and looked at, never counted as a pass by themselves.

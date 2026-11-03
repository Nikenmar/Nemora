# Refactoring without breaking anything (PLAN/21)

Every refactor commit is checked against the code as it was, with the tools here. A commit that
cannot pass all of them is not made.

| Check | Command | Must be |
|---|---|---|
| Renderer characterisation tests | `npm --prefix apps/desktop test` | all pass, no snapshot changed |
| The tests can fail | `node tools/refactor/mutation.mjs` | every mutation caught |
| IPC trace | `node tools/redesign/shots.mjs --label <x> --exe target/release/nemora.exe --probe tools/refactor/ipc-tour.js --ipc-trace E:/tmp/ipc-<x>.json` for the old exe, the new one, the old again; then `node tools/refactor/ipc-diff.mjs E:/tmp/ipc-old1.json E:/tmp/ipc-old2.json -- E:/tmp/ipc-<x>.json` | 0 differences |
| Pixels | `node tools/redesign/shots.mjs --label <x> --exe target/release/nemora.exe`, then `node tools/refactor/pixel-diff.mjs base1 <x> --stable --out E:/tmp/pixdiff-<x>` | 0 differing among the stable shots; dynamic ones looked at |
| Core and app | `cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace --locked`, `npm --prefix apps/desktop run check-types`, `npm --prefix apps/desktop run lint -- --max-warnings 0`, `node tools/licenses/licenses.mjs --check` | clean |
| Render counts | `node tools/redesign/shots.mjs --label <x> --exe <exe> --probe tools/refactor/render-tour.js --render-count` for the build before and after | fewer or equal on every step; ordinary use (seek, play, pause) unchanged |
| Persistence across restarts | `node tools/redesign/shots.mjs --label <x> --exe <exe> --probe tools/refactor/persist-probe.js`, then the same with `--reuse` twice | every step: no slice differing, an empty shadow log, the slices restored from the core with the switch on |
| Smart Shuffle order in Rust | `cargo test -p nemora-core --test mega_order` (400 cases from the view's oracle, `megaOrderCases.test.ts`), then `node tools/redesign/shots.mjs --label <x> --exe <exe> --probe tools/refactor/mega-order-probe.js` | 0 mismatches; an empty shadow log |
| IPC types | `cargo test -p nemora-desktop --test desktop ipc_types` (the generated file is what the commands say), then `node tools/refactor/ipc-types-check.mjs` | 0 differing; each explained one has its reason in `ipc-types-explained.json` |

- **The IPC trace** is read from outside the page (CDP Network, the `ipc.localhost` POSTs Tauri 2
  makes on Windows): the bridge `window.__TAURI_INTERNALS__.invoke` is frozen, and the product
  carries no recorder. Answers of clocked commands are compared by their arguments only; the stand's
  run folder is normalised out of every answer.
- **Bracket the new build between runs of the old one** (old, new, old, minutes apart) and compare
  with `ipc-diff.mjs old1.json old2.json -- new.json`. The stand starts from a fresh profile copy,
  so the mix of the day is computed anew on every run from windows measured back from `now`: its
  songs change from one minute to the next on the same build (measured 2026-11-03, 01:39 vs 01:52
  on one exe). The network capture also sometimes starts after a run's first call
  (`smtc_update`). A call of the new run passes when an old run made it; a call every old run made
  must be in the new one.
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

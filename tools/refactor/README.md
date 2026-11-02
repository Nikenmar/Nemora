# Refactoring without breaking anything (PLAN/21)

Every refactor commit is checked against the code as it was, with the tools here. A commit that
cannot pass all of them is not made.

| Check | Command | Must be |
|---|---|---|
| Renderer characterisation tests | `npm --prefix apps/desktop test` | all pass, no snapshot changed |
| The tests can fail | `node tools/refactor/mutation.mjs` | every mutation caught |
| IPC trace | `node tools/redesign/shots.mjs --label <x> --exe target/release/nemora.exe --probe tools/refactor/ipc-tour.js --ipc-trace E:/tmp/ipc-<x>.json`, then `node tools/refactor/ipc-diff.mjs E:/tmp/ipc-base.json E:/tmp/ipc-<x>.json` | 0 differences |
| Pixels | `node tools/redesign/shots.mjs --label <x> --exe target/release/nemora.exe`, then `node tools/refactor/pixel-diff.mjs base1 <x> --stable --out E:/tmp/pixdiff-<x>` | 0 differing among the stable shots; dynamic ones looked at |
| Core and app | `cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace --locked`, `npm --prefix apps/desktop run check-types`, `node tools/licenses/licenses.mjs --check` | clean |

- **The IPC trace** is read from outside the page (CDP Network, the `ipc.localhost` POSTs Tauri 2
  makes on Windows): the bridge `window.__TAURI_INTERNALS__.invoke` is frozen, and the product
  carries no recorder. Answers of clocked commands are compared by their arguments only; the stand's
  run folder is normalised out of every answer.
- **The pixel baseline** is `base1` (three runs of one build agreed on 95 of 147 shots,
  `stable-shots.txt`). The other shots move between runs of the same build (time windows, random
  orders, duels, Song Guessr, covers loading, notifications): their differences are written as
  images with `--out` and looked at, never counted as a pass by themselves.

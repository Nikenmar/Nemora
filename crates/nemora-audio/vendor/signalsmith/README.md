# Vendored: Signalsmith Stretch

Speed changes without a change of pitch (`src/stretch.rs`). Copied unchanged; every part is MIT
licensed, with its licence next to it.

| Path | What | From |
| --- | --- | --- |
| `signalsmith-stretch/` | the stretcher (header only) | <https://github.com/Signalsmith-Audio/signalsmith-stretch>, as bundled in `signalsmith-stretch` 0.1.3 on crates.io |
| `signalsmith-linear/` | its STFT and FFT (`stft.h`, `fft.h` only) | <https://github.com/Signalsmith-Audio/linear>, same bundle |
| `wrapper/` | a C interface over interleaved buffers | <https://github.com/colinmarc/signalsmith-stretch-rs> 0.1.3 (`src/wrapper.*`) |

The crate itself is not a dependency: it generates its bindings with bindgen, which needs libclang
at build time. `build.rs` compiles the wrapper with `cc`, and `src/stretch.rs` declares the few
functions it uses by hand.

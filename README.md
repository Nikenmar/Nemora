# Nemora 2.0

Work in progress: Nemora rebuilt from scratch. The released app is 1.x on the `main` branch.

- `crates/nemora-core`: the shared Rust core. It is the only code that reads or writes the
  library database, identifies tracks and decides what a play, a skip or a duel result is.
- `crates/nemora-core/spec`: the format contracts (track identity, database schema).
- `apps/desktop`: the Windows app, Tauri v2 with a React view.

## Build

```
cargo test
cd apps/desktop && npm install && npm run tauri dev
```

Development builds keep their data in `%APPDATA%\Nemora-dev`, never in the profile of an installed
Nemora. `NEMORA_PROFILE_DIR` overrides the location.

## License

MIT. Nemora started as a fork of [Nora](https://github.com/Sandakan/Nora) by Sandakan Nipunajith.

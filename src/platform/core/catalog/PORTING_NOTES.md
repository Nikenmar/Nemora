# Catalog runtime integration

## Native recycle-bin command required

Recycle-bin deletion is intentionally separate from permanent deletion. The production TypeScript adapter invokes this exact command once per file:

```rust
#[tauri::command]
pub fn trash_item(path: String) -> Result<(), String> {
    trash::delete(path).map_err(|error| error.to_string())
}
```

Add the `trash` crate and register `trash_item` in the Tauri invoke handler. Until that Rust command is present, a recycle request returns `{ success: false }` and leaves both the file and catalog untouched; it never falls back to `plugin-fs.remove`. Permanent deletion continues to use `@tauri-apps/plugin-fs.remove` directly.

## Startup/open-with gate

Runtime hydration creates and starts the existing `SingleInstanceController`. Its event adapter installs the live listener before draining `drain_pending_second_instance_args`, deduplicating the narrow listener-to-drain race. `audioLibraryControls.checkForStartUpSongs()` is the readiness gate: it calls `markRendererReady()`, returns the first queued audio file as path-backed player data, and only after that routes later files through `app/playSongFromUnknownSource`.

For cold first-instance file associations, Rust must also seed `PendingSecondInstanceArgs` with the initial process argv during setup; the existing single-instance callback only covers later launches. No second TypeScript argv path is introduced.

## Cleanup guarantees

One injected catalog transformation removes each deleted song from songs, artists, albums, genres, every playlist (including Favorites and History), listening data, tierlist rows, song blacklists, ELO ratings/history, skipped-pair state, and renderer-local pending duel tickets/candidates/legacy pairs. The localStorage update preserves unknown root and nested fields and synchronizes `pendingDuels` with the surviving ticket count. Folder removal additionally removes folder blacklist entries and tierlist source-folder references; resync traverses every configured root read-only, removes missing catalog paths before scanning additions, and replaces the stored folder tree so deleted subdirectories cannot linger.

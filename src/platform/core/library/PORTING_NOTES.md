# Library scanner integration notes

## Runtime composition

The renderer/API adapter should create one `MetadataWorkerClient`. To preserve the existing two-call API without a second traversal, `getFolderStructures` must retain the complete `TraversalResult` returned by `walkMusicTrees` while returning only its `structures` field; the following `addSongsFromFolderStructures` call must consume that retained result through `scanTraversal`. `scanLibrary` is the combined convenience path when the caller already has root paths. A scan resolves only after folder structures and every metadata batch are committed; start `LibraryWatcherManager` after that promise resolves, and the manager installs both root/parent watches before running the required reconciliation pass.

The scanner's normal path cannot request more than `METADATA_HEAD_SIZE` (256 KiB). `tauriLibraryFileSystem` uses plugin-fs `open`/`read`/`close`, loops over partial reads, and closes in `finally`; it never imports or calls `readFile`. The worker receives the head as a transferable `ArrayBuffer`, and no Tauri API is imported by `metadata.worker.ts`.

## Internal-write suppression

All app-owned tag, lyric, and artwork writers must use the shared `internalWriteSuppression` instance:

```ts
await internalWriteSuppression.during([sourcePath, temporaryPath], async () => {
  await commitWrite();
});
```

The guard covers the write itself and extends the suppression window after completion, because plugin-fs watcher delivery can lag behind the close/rename. The tag writer lives outside this task's ownership, so it was not edited here.

## Required change outside ownership

`src-tauri/Cargo.toml` currently declares `tauri-plugin-fs = "2"`. The installed plugin's watcher commands are feature-gated; change that line to:

```toml
tauri-plugin-fs = { version = "2", features = ["watch"] }
```

The existing capability already includes `fs:allow-watch` and `fs:allow-unwatch`.

## Verification status

- `npx tsc -p src/platform/core/library/tsconfig.check.json` passes with strict, `erasableSyntaxOnly` settings.
- All 8 scanner/watcher tests pass: traversal visits every directory once with bounded concurrency, the scanner requests exactly the 256 KiB head constant, locked-file retries retain the legacy delay, and internal writes remain suppressed only for the configured window.
- The requested repository-wide TypeScript command currently fails only in other in-progress directories (`core/lyrics`, `core/net`) and pre-existing renderer files; it reports no library/watcher diagnostics.
- The full Jest run reaches 421 passed / 1 skipped with all scanner/watcher suites passing; 19 failures remain in the concurrently edited `core/appdata` and `core/transfer` suites.

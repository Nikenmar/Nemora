# Renderer API compatibility notes

## Required integration outside this module

The Tauri startup path must install the API in `src/renderer/src/index.tsx`, inside `mount()`, after `await runLocalStorageMigrationGate()` and before `await import('./App')`. The intended insertion is:

```ts
if (isTauri) {
  const { runLocalStorageMigrationGate } = await import('@platform/migration');
  await runLocalStorageMigrationGate();

  const { bootstrapApi } = await import('@platform/api');
  await bootstrapApi();
}

const { default: App } = await import('./App');
```

This ordering keeps both startup invariants: legacy local storage is migrated before renderer modules can run `checkLocalStorage()`, and `window.api` exists before `App` and its dependencies are evaluated.

`bootstrapApi()` hydrates all eleven `%APPDATA%\Nora` stores before installing `window.api`. Calling any cache-backed API method before this completes rejects with the named `RuntimeNotHydratedError`; it never exposes default or partial state during hydration.

`src/types/app.d.ts` also needs its `api` type import changed from `../preload` to `../platform/api`. Both files are outside this task's ownership and were intentionally not edited.

## Deliberate compatibility boundaries

- The object shape and key order match the current preload exactly: 32 namespaces and 143 immediate namespace properties, including the nested `utils.path.join` helper.
- Electron listener objects cannot be returned in a WebView. Subscription methods therefore retain synchronous, non-Promise behavior but return `void`, as specified by report 02. The adapter preserves the dummy first callback argument, duplicate-listener behavior, remove-one semantics for explicit remove methods, remove-all semantics for `dataUpdates`, and removal while Tauri's asynchronous `listen()` call is still pending.
- `properties.commandLineArgs` cannot come from `process.argv` in the WebView. It is initialized to an empty array; the Rust startup/open-file state must populate the eventual adapter used by `checkForStartUpSongs`.
- The taskbar subscriptions keep their renderer names but listen for the Rust events `nora://taskbar/play-pause`, `nora://taskbar/previous`, and `nora://taskbar/next`.
- `app/networkStatusChange` is the one report-02 `DIES` channel. Its wrapper remains for the existing call site and logs locally without IPC.
- The existing zero-argument `settingsHelpers.compareEncryptedData()` mismatch is preserved even though the old main-process handler expected two values.
- The existing `songUpdates.saveArtworkToSystem(songId, saveName?)` signature is preserved even though the old handler treated the first value as an artwork path.

## Binary-safe return types

The following replacement signatures intentionally cannot preserve the old byte-capable types. They use `PathBackedAudioPlayerData`, whose `artwork` value is a path or URL string, and `PathBackedUpdateSongDataResult`, whose nested player data follows the same rule:

- `audioLibraryControls.checkForStartUpSongs`
- `audioLibraryControls.getSong`
- `unknownSource.getSongFromUnknownSource`
- `unknownSource.playSongFromUnknownSource`
- `suggestions.resolveArtistDuplicates`
- `suggestions.resolveSeparateArtists`
- `suggestions.resolveFeaturingArtists`
- `songUpdates.updateSongId3Tags`

No API method sends bytes or base64 through Tauri events or invoke.

## Verification

A mechanical TypeScript-AST comparison confirmed that every namespace and immediate property in `src/preload/index.ts` exists in the replacement in the same order. `npx tsc --noEmit -p tsconfig.web.json` reports no diagnostics in `src/platform/api`; the repository-wide command remains non-zero because of pre-existing renderer diagnostics in AlbumsPage, ArtistInfoPage, DuplicateArtistsSuggestion, ArtistPage, ErrorBoundary, Img, LyricsPage, PromptMenu, UpNextSongPopup, SongTagsEditingPage, TierItemCard, and useMouseActiveState.

## Channels intentionally still typed as not ported

This is the exact post-composition inventory. Each item fails loudly with `NotPortedYetError`; none returns fabricated data.

- The new-folder and catalog paths are composed: `app/getFolderStructures` retains the scanner traversal, `app/addSongsFromFolderStructures` consumes it, and `app/resyncSongsLibrary` reconciles removals before additions while replacing the scanned folder tree.
- `app/checkForStartUpSongs` and `app/getSongFromUnknownSource` use the Rust queued-argv drain plus `SingleInstanceController`, bounded metadata-head reads, temporary path-backed artwork, and the local unknown-source event. `app/removeAMusicFolder` uses the same comprehensive catalog cleanup as resync. `app/deleteSongsFromSystem` is wired with distinct permanent/trash operations; recycle requests require the `trash_item` Rust command documented in `core/catalog/PORTING_NOTES.md` and fail without mutating the catalog when it is unavailable.
- SongGuessr has no platform repository implementation yet: `app/getSongGuessrRound`, `app/searchSongGuessrCandidates`, and `app/getSongGuessrPools`.
- Native shell capabilities for log opening, Explorer selection, storage measurement, autostart, devtools, and display-sleep inhibition are wired through `src-tauri/src/shellops.rs` and the runtime system-service port.
- `app/loginToLastFmInBrowser` is wired: it opens the Last.fm auth page through `@tauri-apps/plugin-shell` and the callback lifecycle lives in `lastfm-auth.ts` (second-instance argv event + Rust queue drain, single-use token dedupe, session encryption via `core/secrets`, `LASTFM_LOGIN_SUCCESS` message). `handleLastFmAuthUri` is the handler the renderer bootstrap should wire as `SecondInstanceRoutes.openAuthUri`.
- `app/compareEncryptedData` keeps the renderer-facing zero-argument shape exactly as the preload declares it (the legacy handler expected two values; the mismatch is documented at the implementation site). With no inputs there is nothing to compare, so it returns `false` — the same observable result the legacy handler produced when invoked without arguments. The `customMusixmatchUserToken` branch of `app/saveUserData` now encrypts the plaintext token through `core/secrets` before persisting, matching the Electron build.

The Last.fm and Musixmatch data paths are composed; legacy Electron `safeStorage` ciphertexts decrypt through `core/secrets/safeStorage.ts` (Web Crypto AES-CBC + the Rust `secrets_scrypt_key` command, byte-compatible with `crypto.scryptSync(secret, 'salt', 32)` — verified against golden fixtures generated by the Node implementation and pinned by the Rust unit tests). Discord activity transport is composed and keeps the Electron three-second coalescing lifecycle; the current Rust `DiscordActivity` envelope does not expose the renderer's `buttons` array, so preserving those buttons requires a change in `src-tauri/src/discord.rs` outside this module's ownership.

The dead `app/getAppLanguage` send is preserved as a synchronous no-op, and `app/networkStatusChange` remains the report-02 `DIES` wrapper that logs locally.

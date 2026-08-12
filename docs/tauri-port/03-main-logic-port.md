# Main-process business logic port map (Electron -> Tauri v2 WebView2)

> Rebrand note: this report was written during the Electron→Tauri port, when the
> app was still Nora (`com.sandakannipunajith.nora`, `%APPDATA%\Nora`, `nora://`).
> The port has since become its own player, Nemora (`com.cmrdevs.nemora`,
> `%APPDATA%\Nemora`, `nemora://`, repo `Nikenmar/Nemora`). The rebrand supersedes
> none of its conclusions; the port map still explains the code.

## Scope and decision summary

This map covers all **142 TypeScript files / 16,679 LOC** under `src/main`. The target is a renderer-owned TypeScript core: Rust is limited to Tauri plumbing and the few OS primitives that a WebView cannot safely provide. The existing IPC file is mostly a routing table (`src/main/ipc.ts:115-614`); after the move, ordinary business calls become direct TypeScript imports, while dialogs, window control, updater, custom media protocol, safe atomic replacement, disk-capacity inspection, and Discord IPC remain Tauri/plugin/Rust boundaries.

The main conclusions are:

1. Most `path` and JSON/file operations are mechanical. The important caveat is that Tauri path functions are asynchronous, while most existing `path` calls are synchronous string transforms.
2. Library traversal should remain TypeScript using `plugin-fs.readDir`, but it must become a **single traversal**, not the current structure pass plus a second per-folder file pass (`src/main/core/getFolderStructures.ts:21-52`, `src/main/fs/parseFolderStructuresForSongPaths.ts:122-140`).
3. Every normal FLAC scan must use `open` + a **256 KiB head read** + `music-metadata.parseBuffer`; the proven implementation is at `spike/tauri-audio/src/main.ts:215-246`. Reading whole songs is 22.6x slower than the 256 KiB path (115.3 vs 5.1 ms/file), while JSON `Vec<u8>` invoke is 5.8x slower (29.8 ms/file) (`spike/tauri-audio/results-baseline.txt:52-57`).
4. `node-taglib-sharp.IFileAbstraction` is usable only through a synchronous in-memory `IStream`. It **cannot** directly wrap Tauri's asynchronous `FileHandle`. Disk loading and committing must surround the synchronous TagLib operation.
5. Metadata writes are the port's highest risk. In addition to the FLAC auto-heal, `node-id3` reads/writes paths in four modules (`src/main/updateSongId3Tags.ts:78,685-703,794-843`, `src/main/saveLyricsToSong.ts:35-46,110`, `src/main/core/getSongLyrics.ts:59`, `src/main/core/sendSongId3Tags.ts:19`). That package must not be treated as renderer-ready merely because it was not in the requested builtin-import count.

`INFERRED` below marks conclusions not directly demonstrated by the current source or spike.

## Subsystem inventory

LOC is physical source lines, matching the supplied 16,679-line measurement. Each file appears exactly once.

### 1. Network integrations - 19 files, 1,984 LOC

Files: `auth/manageLastFmAuth.ts` (54; `src/main/auth/manageLastFmAuth.ts:1`); `core/fetchAlbumData.ts` (43; `src/main/core/fetchAlbumData.ts:1`); `core/fetchArtistData.ts` (51; `src/main/core/fetchArtistData.ts:1`); `core/fetchSongInfoFromLastFM.ts` (54; `src/main/core/fetchSongInfoFromLastFM.ts:1`); `core/getArtistInfoFromNet.ts` (194; `src/main/core/getArtistInfoFromNet.ts:1`); `other/discord.ts` (80; `src/main/other/discord.ts:1`); `other/discordRPC.ts` (38; `src/main/other/discordRPC.ts:1`); all eight `other/lastFm/*.ts` files (654 total; `src/main/other/lastFm/generateApiRequestBodyForLastFMPostRequests.ts:1`, `src/main/other/lastFm/getAlbumInfoFromLastFM.ts:1`, `src/main/other/lastFm/getArtistInfoFromLastFM.ts:1`, `src/main/other/lastFm/getLastFMAuthData.ts:1`, `src/main/other/lastFm/getSimilarTracks.ts:1`, `src/main/other/lastFm/scrobbleSong.ts:1`, `src/main/other/lastFm/sendFavoritesDataToLastFM.ts:1`, `src/main/other/lastFm/sendNowPlayingSongDataToLastFM.ts:1`); `utils/fetchLyricsFromLrclib.ts` (108; `src/main/utils/fetchLyricsFromLrclib.ts:1`); `utils/fetchLyricsFromMusixmatch.ts` (171; `src/main/utils/fetchLyricsFromMusixmatch.ts:1`); `utils/fetchSongArtworksFromSpotify.ts` (50; `src/main/utils/fetchSongArtworksFromSpotify.ts:1`); `utils/fetchSongMetadataFromInternet.ts` (487; Genius/iTunes/Deezer/Musixmatch/Last.fm at `src/main/utils/fetchSongMetadataFromInternet.ts:192-300,423-470`).

Direct Node builtins: none. Indirect blocker: Last.fm signatures use the MD5 helper (`src/main/auth/manageLastFmAuth.ts:14`, `src/main/other/lastFm/generateApiRequestBodyForLastFMPostRequests.ts:39`); Discord uses `discord-rpc` and `process.pid` (`src/main/other/discord.ts:1,46-76`). Fetch-based services otherwise move mechanically, subject to WebView CORS and secret exposure.

### 2. Playlists, favorites, and history - 15 files, 857 LOC

Files: `addArtworkToAPlaylist.ts` (38), `addNewPlaylist.ts` (67), `addSongsToPlaylist.ts` (50), `addToFavorites.ts` (41), `addToSongsHistory.ts` (34), `clearSongHistory.ts` (25), `exportPlaylist.ts` (71), `importPlaylist.ts` (160), `removeFromFavorites.ts` (39), `removePlaylists.ts` (46), `removeSongFromPlaylist.ts` (41), `renameAPlaylist.ts` (19), `sendPlaylistData.ts` (35), `toggleLikeArtists.ts` (80), and `toggleLikeSongs.ts` (111), all under `src/main/core/` (`src/main/core/addArtworkToAPlaylist.ts:1`, `src/main/core/addNewPlaylist.ts:1`, `src/main/core/addSongsToPlaylist.ts:1`, `src/main/core/addToFavorites.ts:1`, `src/main/core/addToSongsHistory.ts:1`, `src/main/core/clearSongHistory.ts:1`, `src/main/core/exportPlaylist.ts:1`, `src/main/core/importPlaylist.ts:1`, `src/main/core/removeFromFavorites.ts:1`, `src/main/core/removePlaylists.ts:1`, `src/main/core/removeSongFromPlaylist.ts:1`, `src/main/core/renameAPlaylist.ts:1`, `src/main/core/sendPlaylistData.ts:1`, `src/main/core/toggleLikeArtists.ts:1`, `src/main/core/toggleLikeSongs.ts:1`).

Node builtins: `fs/promises.writeFile` + `path.basename` in export; `fs/promises.readFile` + `path.isAbsolute/extname/basename` in import (`src/main/core/exportPlaylist.ts:1-2,35-43`, `src/main/core/importPlaylist.ts:1-2,23-57`). Dialog types/actions move to `@tauri-apps/plugin-dialog`.

### 3. Library scan and catalog - 17 files, 1,554 LOC

Files: `core/addMusicFolder.ts` (73), `checkForNewSongs.ts` (30), `checkForStartUpSongs.ts` (43), `deleteSongsFromSystem.ts` (59), `getAllSongs.ts` (56), `getDuplicates.ts` (35), `getFolderStructures.ts` (68), `getGenresInfo.ts` (43), `getMusicFolderData.ts` (88), `getSongInfo.ts` (84), `removeMusicFolder.ts` (116), `resolveDuplicates.ts` (98), `resolveFeaturingArtists.ts` (65), `resolveSeparateArtists.ts` (125), `sendAudioData.ts` (133), `sendAudioDataFromPath.ts` (91), and root `removeSongsFromLibrary.ts` (347) (`src/main/core/addMusicFolder.ts:1`, `src/main/core/checkForNewSongs.ts:1`, `src/main/core/checkForStartUpSongs.ts:1`, `src/main/core/deleteSongsFromSystem.ts:1`, `src/main/core/getAllSongs.ts:1`, `src/main/core/getDuplicates.ts:1`, `src/main/core/getFolderStructures.ts:1`, `src/main/core/getGenresInfo.ts:1`, `src/main/core/getMusicFolderData.ts:1`, `src/main/core/getSongInfo.ts:1`, `src/main/core/removeMusicFolder.ts:1`, `src/main/core/resolveDuplicates.ts:1`, `src/main/core/resolveFeaturingArtists.ts:1`, `src/main/core/resolveSeparateArtists.ts:1`, `src/main/core/sendAudioData.ts:1`, `src/main/core/sendAudioDataFromPath.ts:1`, `src/main/removeSongsFromLibrary.ts:1`).

Node builtins occur in seven files: `path.basename`; `path.extname` + `fs.statSync`; `path.extname` + `fs.unlink`; `fs.stat` + `path.extname`; `path.basename`; `path.extname/join/basename`; and `path.basename/normalize`, respectively. `sendAudioData.ts` also uses Electron `app` (`src/main/core/sendAudioData.ts:1`).

### 4. Blacklist - 6 files, 205 LOC

Files: `core/blacklistFolders.ts` (15), `blacklistSongs.ts` (15), `restoreBlacklistedFolder.ts` (38), `restoreBlacklistedSongs.ts` (44), `toggleBlacklistFolders.ts` (60), and `utils/isBlacklisted.ts` (33) (`src/main/core/blacklistFolders.ts:1`, `src/main/core/blacklistSongs.ts:1`, `src/main/core/restoreBlacklistedFolder.ts:1`, `src/main/core/restoreBlacklistedSongs.ts:1`, `src/main/core/toggleBlacklistFolders.ts:1`, `src/main/utils/isBlacklisted.ts:1`). Node builtin usage is path-only: `dirname`, `basename`, and `normalize` (`src/main/core/restoreBlacklistedFolder.ts:14-22`, `src/main/core/restoreBlacklistedSongs.ts:22`, `src/main/utils/isBlacklisted.ts:8-27`).

### 5. Window, OS, and IPC - 4 files, 1,582 LOC

Files: `core/changeAppTheme.ts` (31), `core/manageTaskbarPlaybackButtonControls.ts` (67), `ipc.ts` (616), and `main.ts` (868) (`src/main/core/changeAppTheme.ts:1`, `src/main/core/manageTaskbarPlaybackButtonControls.ts:1`, `src/main/ipc.ts:1`, `src/main/main.ts:1`). Node builtins are concentrated in `main.ts`: `path.resolve/join`, `os.cpus/release/arch/platform/totalmem`, `fs.existsSync/statSync/createReadStream`, and `fs/promises.readFile` (`src/main/main.ts:130-134,174,188,465-505`). This subsystem is not moved wholesale: delete `ipc.ts` routing for renderer-local calls, replace window/theme/shell APIs with Tauri JS plugins, and retain the custom ranged media protocol as a thin Rust handler (the spike proves the Tauri protocol and Unicode paths work at `spike/tauri-audio/results-baseline.txt:12-45`). Windows taskbar thumbnail buttons have no cross-platform web API and need a Windows-only plugin/Rust command or can be dropped (`src/main/core/manageTaskbarPlaybackButtonControls.ts:28-61`).

### 6. Search and ordering - 13 files, 1,008 LOC

Files: `core/clearSeachHistoryResults.ts` (27), root `search.ts` (359), and utilities `filterArtists.ts` (14), `filterSongs.ts` (20), `filterUniqueObjects.ts` (19), `paginateData.ts` (26), `romanizeForSearch.ts` (53), `sortAlbums.ts` (32), `sortArtists.ts` (40), `sortFolders.ts` (53), `sortGenres.ts` (32), `sortPlaylists.ts` (32), `sortSongs.ts` (301) (`src/main/core/clearSeachHistoryResults.ts:1`, `src/main/search.ts:1`, `src/main/utils/filterArtists.ts:1`, `src/main/utils/filterSongs.ts:1`, `src/main/utils/filterUniqueObjects.ts:1`, `src/main/utils/paginateData.ts:1`, `src/main/utils/romanizeForSearch.ts:1`, `src/main/utils/sortAlbums.ts:1`, `src/main/utils/sortArtists.ts:1`, `src/main/utils/sortFolders.ts:1`, `src/main/utils/sortGenres.ts:1`, `src/main/utils/sortPlaylists.ts:1`, `src/main/utils/sortSongs.ts:1`). Direct Node builtins: none. This is mechanical pure TypeScript and is a good first migration slice.

### 7. Lyrics - 10 files, 1,273 LOC

Files: `core/convertParsedLyricsToNodeID3Format.ts` (50), `core/getSongLyrics.ts` (385), `core/saveLyricsToLrcFile.ts` (144), root `saveLyricsToSong.ts` (127), and utilities `convertToPinyin.ts` (121), `convertToRomaja.ts` (113), `getTranslatedLyrics.ts` (123), `parseSongMetadataFromMusixmatchApiData.ts` (53), `resetLyrics.ts` (31), `romanizeLyrics.ts` (126) (`src/main/core/convertParsedLyricsToNodeID3Format.ts:1`, `src/main/core/getSongLyrics.ts:1`, `src/main/core/saveLyricsToLrcFile.ts:1`, `src/main/saveLyricsToSong.ts:1`, `src/main/utils/convertToPinyin.ts:1`, `src/main/utils/convertToRomaja.ts:1`, `src/main/utils/getTranslatedLyrics.ts:1`, `src/main/utils/parseSongMetadataFromMusixmatchApiData.ts:1`, `src/main/utils/resetLyrics.ts:1`, `src/main/utils/romanizeLyrics.ts:1`). Node builtins: path + file reads for `.lrc`, path + file writes for `.lrc`, and path extension checks for embedded writes (`src/main/core/getSongLyrics.ts:55-122`, `src/main/core/saveLyricsToLrcFile.ts:122-140`, `src/main/saveLyricsToSong.ts:28`). Embedded ID3 lyric access is a separate `node-id3` blocker.

### 8. Stats, ELO, and SongGuessr - 8 files, 2,273 LOC

Files: `core/duelMatchmaker.ts` (247), `eloDuels.ts` (288), `getStatsData.ts` (318), `songGuessr.ts` (310), `statsTransfer/exportStats.ts` (116), `statsTransfer/importCollections.ts` (217), `statsTransfer/importStats.ts` (638), `updateSongListeningData.ts` (139) (`src/main/core/duelMatchmaker.ts:1`, `src/main/core/eloDuels.ts:1`, `src/main/core/getStatsData.ts:1`, `src/main/core/songGuessr.ts:1`, `src/main/core/statsTransfer/exportStats.ts:1`, `src/main/core/statsTransfer/importCollections.ts:1`, `src/main/core/statsTransfer/importStats.ts:1`, `src/main/core/updateSongListeningData.ts:1`). Node builtins: `existsSync` for candidate validation; `writeFile` + basename for export; and `access/readFile/copyFile` + path joins/basenames for import/backup (`src/main/core/songGuessr.ts:62`, `src/main/core/statsTransfer/exportStats.ts:73,99`, `src/main/core/statsTransfer/importStats.ts:44-117,228,488-503`). Algorithms are otherwise pure TypeScript.

### 9. Import/export and migrations - 4 files, 642 LOC

Files: `core/exportAppData.ts` (153), `core/importAppData.ts` (208), root `migrations.ts` (235), and `resetAppData.ts` (46) (`src/main/core/exportAppData.ts:1`, `src/main/core/importAppData.ts:1`, `src/main/migrations.ts:1`, `src/main/resetAppData.ts:1`). Node builtins: `writeFile` and path joins/basename; multiple `readFile` + `readdir` and joins; recursive `rm` + `unlink` and path extension/join (`src/main/core/exportAppData.ts:118-132`, `src/main/core/importAppData.ts:48-167`, `src/main/resetAppData.ts:31-39`). Use plugin dialog + plugin-fs and preserve the existing migration order and backup-before-mutation behavior.

### 10. Artwork and palettes - 5 files, 550 LOC

Files: `core/getArtworksForMultipleArtworksCover.ts` (10), `core/saveArtworkToSystem.ts` (64), `other/artworks.ts` (184), `other/generatePalette.ts` (222), `parseSong/generateCoverBuffer.ts` (70) (`src/main/core/getArtworksForMultipleArtworksCover.ts:1`, `src/main/core/saveArtworkToSystem.ts:1`, `src/main/other/artworks.ts:1`, `src/main/other/generatePalette.ts:1`, `src/main/parseSong/generateCoverBuffer.ts:1`). Direct builtins are path/fs in the latter two filesystem-facing files (`src/main/other/artworks.ts:1-2,38-163`, `src/main/parseSong/generateCoverBuffer.ts:1-2,18-55`). `sharp`, `fs-extra`, and the Node entry of `node-vibrant` are non-portable; replacements are specified below.

### 11. Shared utilities, security, and storage reporting - 16 files, 506 LOC

Files: `core/getStorageUsage.ts` (114) plus utilities `calculateTime.ts` (6), `copyDir.ts` (28), `dirExists.ts` (29), `getAllSettledPromises.ts` (13), `getDirSize.ts` (38), `getFileSize.ts` (16), `getRootSize.ts` (96), `hashText.ts` (15), `isAnErrorWithCode.ts` (7), `isPathADir.ts` (34), `isPathAWebUrl.ts` (9), `makeDir.ts` (33), `randomId.ts` (6), `removeElementFromArray.ts` (7), `safeStorage.ts` (55) (`src/main/core/getStorageUsage.ts:1`, `src/main/utils/calculateTime.ts:1`, `src/main/utils/copyDir.ts:1`, `src/main/utils/dirExists.ts:1`, `src/main/utils/getAllSettledPromises.ts:1`, `src/main/utils/getDirSize.ts:1`, `src/main/utils/getFileSize.ts:1`, `src/main/utils/getRootSize.ts:1`, `src/main/utils/hashText.ts:1`, `src/main/utils/isAnErrorWithCode.ts:1`, `src/main/utils/isPathADir.ts:1`, `src/main/utils/isPathAWebUrl.ts:1`, `src/main/utils/makeDir.ts:1`, `src/main/utils/randomId.ts:1`, `src/main/utils/removeElementFromArray.ts:1`, `src/main/utils/safeStorage.ts:1`). Ten files import builtins: ordinary path/fs helpers plus `child_process` for disk capacity and `crypto` for MD5 and AES/scrypt.

### 12. Tierlists and Smart Shuffle - 3 files, 349 LOC

Files: `core/getTierlistArtworks.ts` (57), `core/megaShuffle.ts` (175), `core/tierlists.ts` (117) (`src/main/core/getTierlistArtworks.ts:1`, `src/main/core/megaShuffle.ts:1`, `src/main/core/tierlists.ts:1`). Only the thumbnail cache imports builtins (`existsSync`, native path joins, and POSIX URL join at `src/main/core/getTierlistArtworks.ts:34-46`). Tier/shuffle algorithms are pure TypeScript.

### 13. Rediscover - 1 file, 112 LOC

File: `core/rediscover.ts` (`src/main/core/rediscover.ts:1`). Direct Node builtins: none. It is pure derived-data logic and mechanical to move.

### 14. Persistence and shared filesystem facade - 1 file, 720 LOC

File: `filesystem.ts` (`src/main/filesystem.ts:1`). Direct builtins are `path.join` and `fs.readdir` (`src/main/filesystem.ts:25,677-694`), but the larger blocker is ten `electron-store` instances and their synchronous getter/setter contract (`src/main/filesystem.ts:101-304,310-668`). Keep the in-memory caches and TypeScript setters, replace persistence with an async write queue over plugin-fs or `@tauri-apps/plugin-store`; await initial hydration before rendering. Preserve filenames/schema/version migrations.

### 15. Watchers and directory traversal - 8 files, 654 LOC

Files: `fs/addWatchersToFolders.ts` (123), `addWatchersToParentFolders.ts` (83), `checkFolderForContentModifications.ts` (62), `checkFolderForUnknownContentModifications.ts` (120), `checkForFolderModifications.ts` (30), `controlAbortControllers.ts` (31), `getParentFolderPaths.ts` (53), `parseFolderStructuresForSongPaths.ts` (152) (`src/main/fs/addWatchersToFolders.ts:1`, `src/main/fs/addWatchersToParentFolders.ts:1`, `src/main/fs/checkFolderForContentModifications.ts:1`, `src/main/fs/checkFolderForUnknownContentModifications.ts:1`, `src/main/fs/checkForFolderModifications.ts:1`, `src/main/fs/controlAbortControllers.ts:1`, `src/main/fs/getParentFolderPaths.ts:1`, `src/main/fs/parseFolderStructuresForSongPaths.ts:1`). Seven import builtins. Current plugin-fs 2.5.1 exposes `watch` and `watchImmediate`; use `watchImmediate` only if the existing raw-event behavior is required, otherwise prefer debounced `watch`. The current watcher retry and internal-write suppression must survive (`src/main/parseSong/parseSong.ts:45-70`).

### 16. Path/URL adaptation - 1 file, 190 LOC

File: `fs/resolveFilePaths.ts` (`src/main/fs/resolveFilePaths.ts:1`). It uses only `node:path/posix.join` to construct `nora://` URLs (`src/main/fs/resolveFilePaths.ts:46-174`). Replace this with `convertFileSrc(path, "nora")` or a URL builder, never native `join`; the spike documents why Electron-shaped URLs fail in Tauri and `convertFileSrc` succeeds (`spike/tauri-audio/src/main.ts:17-29`).

### 17. Logging - 2 files, 159 LOC

Files: root `logger.ts` (144) and `utils/measureTimeUsage.ts` (15) (`src/main/logger.ts:1`, `src/main/utils/measureTimeUsage.ts:1`). `logger.ts` uses `path.join`, Electron `app.getPath`, and Winston console/file transports (`src/main/logger.ts:42-81`). Replace with `@tauri-apps/plugin-log`; keep the existing logger facade so callers do not change.

### 18. Song parsing and tag editing - 8 files, 1,959 LOC

Files: `core/sendSongId3Tags.ts` (179), `parseSong/manageAlbumArtistOfParsedSong.ts` (73), `manageAlbumsOfParsedSong.ts` (81), `manageArtistsOfParsedSong.ts` (48), `manageGenresOfParsedSong.ts` (62), `parseSong.ts` (392), `reParseSong.ts` (203), root `updateSongId3Tags.ts` (921) (`src/main/core/sendSongId3Tags.ts:1`, `src/main/parseSong/manageAlbumArtistOfParsedSong.ts:1`, `src/main/parseSong/manageAlbumsOfParsedSong.ts:1`, `src/main/parseSong/manageArtistsOfParsedSong.ts:1`, `src/main/parseSong/manageGenresOfParsedSong.ts:1`, `src/main/parseSong/parseSong.ts:1`, `src/main/parseSong/reParseSong.ts:1`, `src/main/updateSongId3Tags.ts:1`). All eight import `path`; parser/reparser use `fs.stat`; updater uses `readFile/statSync`. `music-metadata` is renderer-ready per the spike, but `node-taglib-sharp`, `node-id3`, and Sharp require the designs below.

### 19. Updater - 1 file, 102 LOC

File: `update.ts` (`src/main/update.ts:1`). No Node builtin import, but all behavior is Electron-specific: event-driven check, prompt, download progress, and `quitAndInstall(true, true)` (`src/main/update.ts:22-96`). Replace with `@tauri-apps/plugin-updater` plus `@tauri-apps/plugin-process.relaunch`; keep policy/UI in TypeScript. Installer/update signing and the fork's existing release manifest compatibility need a dedicated spike.

## Exact Node-builtin replacement map (53 importing files in the checked-out source)

The supplied measurement says 52 files. A syntax-tree recount of this checkout finds **53**: it includes `src/main/core/songGuessr.ts:1`, whose `node:fs` import is not included in the supplied “10x fs” figure. The other figures reconcile as 47 distinct files using `path`/`node:path*`, 25 using `fs/promises`, 10 using bare `fs`, two using `os`, two using `crypto`, and one using `node:child_process`; adding the `node:fs` SongGuessr file yields 53 distinct files. It is included below because the requirement is to cover every builtin importer.

### Common API equivalence

| Node API | Tauri/webview replacement | Important difference |
|---|---|---|
| `fs.readFile` bytes | `@tauri-apps/plugin-fs.readFile` | Returns `Uint8Array`; whole-file read. Do not use for normal audio scans. |
| `fs.readFile(..., "utf8")` | `readTextFile` | Async; encoding support is plugin-defined. |
| `fs.writeFile` text/bytes | `writeTextFile` / `writeFile` | Loop only applies to `FileHandle.write`; top-level `writeFile` owns completion. |
| `readdir` / `readdirSync` | `readDir` | Returns `DirEntry[]`, not names; no synchronous API. |
| `stat` / `statSync` | `stat` | `birthtime/mtime` are nullable `Date`; no synchronous API. |
| `access(F_OK)`, `accessSync`, `existsSync` | `exists` | Does not test arbitrary POSIX access modes. Current call sites only need existence. |
| `mkdir`, `mkdirSync` | `mkdir(path, { recursive })` | Async. |
| `unlink`, `rm` | `remove(path, { recursive })` | One API for files/directories. |
| `copyFile` | `copyFile` | Direct equivalent. |
| `rename` | `rename` | No current builtin call site; use for staged writes only after Windows replacement semantics are tested. |
| `openSync/readSync/writeSync/ftruncateSync` | `open` -> async `FileHandle.read/seek/write/truncate/close` | Random access exists, but it is async and therefore cannot implement TagLib's synchronous `IStream` directly. |
| `fs.watch` | `watchImmediate` or debounced `watch` | Event shapes differ; callback supplies `paths[]` and structured kinds, not `(eventType, filename)`. |
| `createReadStream({start,end})` | No plugin-fs stream equivalent | Keep ranged media serving in the Rust custom-protocol handler. |
| File locks / fsync / guaranteed atomic replace | No plugin-fs equivalent | **NEEDS_RUST** for corruption-safe metadata commit, or accept weaker crash guarantees. |

### Per-file calls and replacement

The path rule for all rows is: use a synchronous pure-string adapter for `basename/extname/dirname` where no OS lookup is involved; use async `@tauri-apps/api/path` for `join/normalize/isAbsolute/resolve` when native platform semantics matter. Do not use native path functions to build URLs.

| File | Exact builtin APIs | Replacement / portability note |
|---|---|---|
| `core/addMusicFolder.ts` | `path.basename` (`src/main/core/addMusicFolder.ts:60`) | Pure basename. Mechanical. |
| `core/checkForStartUpSongs.ts` | `path.extname`; `statSync` (`src/main/core/checkForStartUpSongs.ts:16-19`) | Pure extname; async `stat`. Make caller async. |
| `core/deleteSongsFromSystem.ts` | `path.extname`; `fs.unlink` (`src/main/core/deleteSongsFromSystem.ts:23,40`) | Pure extname; `remove`. Electron recycle-bin `shell.trashItem` at `src/main/core/deleteSongsFromSystem.ts:38` becomes Tauri shell/plugin or a small trash plugin; permanent delete remains `remove`. |
| `core/exportAppData.ts` | `path.join/basename`; `fs.writeFile` (`src/main/core/exportAppData.ts:29,118-132`) | Tauri join; `writeTextFile`; recursive copy uses `readDir/copyFile/mkdir`. |
| `core/exportPlaylist.ts` | `path.basename`; `writeFile` (`src/main/core/exportPlaylist.ts:35,43`) | Pure basename; `writeTextFile`. |
| `core/getFolderStructures.ts` | `path.extname`; `fs.stat` (`src/main/core/getFolderStructures.ts:14,23`) | Pure extname; plugin `stat`. Traversal design below. |
| `core/getSongLyrics.ts` | `path.extname/join/basename`; `readFile` (`src/main/core/getSongLyrics.ts:55,79,92-122`) | Pure name/extension; Tauri join; `readTextFile`. `NodeID3.read` at line 59 is not portable and must use the tag abstraction. |
| `core/getStorageUsage.ts` | `path.join/parse` (`src/main/core/getStorageUsage.ts:16-29,69`) | Join via Tauri. `path.parse(...).dir` has no Tauri JS equivalent; replace with `dirname`. Disk-capacity helper is **NEEDS_RUST**. |
| `core/getTierlistArtworks.ts` | `existsSync`; `path.join`; `path.posix.join` (`src/main/core/getTierlistArtworks.ts:34-46`) | `exists`; native join for disk path; `convertFileSrc`/URL builder for URL. Never native join for scheme URLs. |
| `core/importAppData.ts` | `fs.readFile/readdir`; `path.join` (`src/main/core/importAppData.ts:48-90,111-167`) | `readTextFile`; `readDir`; Tauri join. |
| `core/importPlaylist.ts` | `readFile`; `path.isAbsolute/extname/basename` (`src/main/core/importPlaylist.ts:23-57`) | `readTextFile`; Tauri `isAbsolute`; pure extname/basename. This intentionally accepts only absolute M3U entries, so do not silently add CWD-based resolution. |
| `core/removeMusicFolder.ts` | `path.basename` (`src/main/core/removeMusicFolder.ts:59`) | Pure basename. |
| `core/restoreBlacklistedFolder.ts` | `path.dirname/basename` (`src/main/core/restoreBlacklistedFolder.ts:14-22`) | Pure Windows-aware adapter or async Tauri path. |
| `core/restoreBlacklistedSongs.ts` | `path.dirname/basename` (`src/main/core/restoreBlacklistedSongs.ts:22`) | Same. |
| `core/saveLyricsToLrcFile.ts` | `path.extname/dirname/join/basename`; `fs.writeFile` (`src/main/core/saveLyricsToLrcFile.ts:122-140`) | Pure/Tauri path; `writeTextFile`. Stage + rename if preserving an existing `.lrc`. |
| `core/sendAudioDataFromPath.ts` | `path.extname/join/basename` (`src/main/core/sendAudioDataFromPath.ts:16,37-62`) | Pure disk transforms; replace `path.join(DEFAULT_FILE_URL, songPath)` with `convertFileSrc`. |
| `core/sendSongId3Tags.ts` | `path.extname` (`src/main/core/sendSongId3Tags.ts:56,137`) | Pure extname. `NodeID3.Promise.read` at `src/main/core/sendSongId3Tags.ts:19` is a separate blocker. |
| `core/songGuessr.ts` | `node:fs.existsSync` (`src/main/core/songGuessr.ts:62`) | Batch/parallel `exists` calls, or maintain availability in the watcher-backed catalog to avoid an IPC call per candidate. |
| `core/statsTransfer/exportStats.ts` | `path.basename`; `fs.writeFile` (`src/main/core/statsTransfer/exportStats.ts:73,99`) | Pure basename; `writeTextFile`. |
| `core/statsTransfer/importStats.ts` | `fs.access/readFile/copyFile`; `path.join/basename` (`src/main/core/statsTransfer/importStats.ts:44-117,228,488-503`) | `exists`; `readTextFile`; `copyFile`; Tauri join/pure basename. Preserve backup-before-import. |
| `filesystem.ts` | `path.join`; `fs.readdir({withFileTypes:true})` (`src/main/filesystem.ts:25,677-681`) | `appDataDir` + Tauri join; `readDir`. Replace `electron-store` separately. |
| `fs/addWatchersToFolders.ts` | `fs.stat`; `fs.watch`; `path.basename/extname` (`src/main/fs/addWatchersToFolders.ts:15,20,50,69-88,106`) | `stat`; `watchImmediate`/`watch`; translate structured event paths and kinds. |
| `fs/addWatchersToParentFolders.ts` | `fs.watch`; `path.basename` (`src/main/fs/addWatchersToParentFolders.ts:33-70`) | `watchImmediate`/`watch`; pure basename. |
| `fs/checkFolderForContentModifications.ts` | `fs.readdir`; `path.extname/join/normalize` (`src/main/fs/checkFolderForContentModifications.ts:11-54`) | `readDir`; pure extname; Tauri join/normalize. |
| `fs/checkFolderForUnknownContentModifications.ts` | `fs.readdir`; `path.dirname/extname/join/basename` (`src/main/fs/checkFolderForUnknownContentModifications.ts:20,29-33,69`) | `readDir`; path adapter. |
| `fs/checkForFolderModifications.ts` | `path.basename` (`src/main/fs/checkForFolderModifications.ts:14`) | Pure basename. |
| `fs/getParentFolderPaths.ts` | `path.sep/dirname` (`src/main/fs/getParentFolderPaths.ts:4-39`) | `sep()` + `dirname()`. **Not trivially portable:** it splits and reconstructs roots manually, losing leading-root information; rewrite using repeated `dirname`/common-ancestor logic and test drive letters, UNC, and POSIX roots. |
| `fs/parseFolderStructuresForSongPaths.ts` | `readdirSync`; `path.extname/join` (`src/main/fs/parseFolderStructuresForSongPaths.ts:25-30,133-140`) | Async `readDir`; path adapter. Remove this second directory read in the new single-pass traversal. |
| `fs/resolveFilePaths.ts` | `node:path/posix.join` (`src/main/fs/resolveFilePaths.ts:46-174`) | `convertFileSrc` or URL builder. URL semantics, not filesystem semantics. |
| `logger.ts` | `path.join` (`src/main/logger.ts:42-53`) | `appLogDir`/plugin-log target configuration; callers keep current facade. |
| `main.ts` | `path.resolve/join`; `os.cpus/release/arch/platform/totalmem`; `existsSync/statSync/createReadStream`; `readFile` (`src/main/main.ts:130-134,174,188,465-505`) | Preload/index paths disappear. `plugin-os` covers arch/platform/version-like data; CPU model and total memory are **NEEDS_RUST** or drop diagnostics. Custom range protocol is **NEEDS_RUST**; full image reads can use plugin-fs or the same protocol. |
| `other/artworks.ts` | `fs.stat/mkdir/unlink`; `path.join/resolve` (`src/main/other/artworks.ts:38-39,80-84,121-163`) | `exists`/`stat`, `mkdir`, `remove`, Tauri join. `resolve(temp, random)` is just join. Replace `fs-extra.pathExistsSync/emptyDirSync` at lines 175-176 with `exists`, `remove({recursive:true})`, `mkdir`. |
| `parseSong/generateCoverBuffer.ts` | `fs.readFile`; `path.join/extname` (`src/main/parseSong/generateCoverBuffer.ts:18,41-55`) | `readFile`; path adapter; return `Uint8Array`/`Blob`, not Node `Buffer`. |
| `parseSong/manageAlbumArtistOfParsedSong.ts` | `path.basename` (`src/main/parseSong/manageAlbumArtistOfParsedSong.ts:42`) | Pure basename. |
| `parseSong/manageAlbumsOfParsedSong.ts` | `path.basename` (`src/main/parseSong/manageAlbumsOfParsedSong.ts:49`) | Pure basename. |
| `parseSong/manageArtistsOfParsedSong.ts` | `path.basename` (`src/main/parseSong/manageArtistsOfParsedSong.ts:31`) | Pure basename. |
| `parseSong/manageGenresOfParsedSong.ts` | `path.basename` (`src/main/parseSong/manageGenresOfParsedSong.ts:23,49`) | Pure basename. |
| `parseSong/parseSong.ts` | `fs.stat`; `path.basename/extname` (`src/main/parseSong/parseSong.ts:38,94,133-155`) | `stat`; pure basename/extname. Replace `parseFile` at line 134 with 256 KiB `parseBuffer`. |
| `parseSong/reParseSong.ts` | `fs.stat`; `path.basename` (`src/main/parseSong/reParseSong.ts:66-82`) | `stat`; pure basename. Reparse may use a larger/fallback metadata path because it is user-initiated, but must not silently read every whole file during bulk sync. |
| `removeSongsFromLibrary.ts` | `path.basename/normalize` (`src/main/removeSongsFromLibrary.ts:211-303`) | Pure basename; Tauri normalize. Normalize once at catalog boundaries, not repeatedly in hot loops. |
| `resetAppData.ts` | `fs.rm/unlink`; `path.extname/join` (`src/main/resetAppData.ts:31-39`) | `remove(path,{recursive:true})`; pure/Tauri path. Do not infer directory from missing extension; carry resource type explicitly. |
| `saveLyricsToSong.ts` | `path.extname` (`src/main/saveLyricsToSong.ts:28`) | Pure extname. `node-id3` read/update is non-portable and corruption-sensitive. |
| `updateSongId3Tags.ts` | `path.extname/basename/join`; `readFile`; `statSync` (`src/main/updateSongId3Tags.ts:62,115,168,278,381,491,664,739`) | Path adapter; `readFile`; async `stat`. `sharp` and `node-id3` replacements are required before this module is safe. |
| `utils/copyDir.ts` | `fs.readdir({withFileTypes:true})/copyFile`; `path.join` (`src/main/utils/copyDir.ts:13-20`) | `readDir`, recursive `mkdir`, `copyFile`, Tauri join. |
| `utils/dirExists.ts` | `accessSync(constants.F_OK)` (`src/main/utils/dirExists.ts:4-6`) | Async `exists`; remove unused mode abstraction because plugin-fs has no general access-mode check. |
| `utils/getDirSize.ts` | `fs.readdir/stat`; `path.join` (`src/main/utils/getDirSize.ts:9-17`) | `plugin-fs.size(dir)` is direct in current plugin, or retain `readDir/stat` recursion if per-file cancellation/progress is needed. |
| `utils/getFileSize.ts` | `fs.stat` (`src/main/utils/getFileSize.ts:7`) | `stat().size` or `size`. |
| `utils/getRootSize.ts` | `os.platform`; `childProcess.execFile`; `path.parse/sep` (`src/main/utils/getRootSize.ts:28-88`) | `plugin-os.platform`; **NEEDS_RUST** disk-space command using an OS API/crate. Do not port PowerShell/`df` execution to the shell plugin. Drive-root parsing is Windows-specific at lines 30-32. |
| `utils/hashText.ts` | `createHash`, `BinaryToTextEncoding` (`src/main/utils/hashText.ts:1-12`) | Last.fm requires MD5, unsupported by WebCrypto: use a small audited browser MD5 implementation for MD5; use `crypto.subtle.digest` for SHA-256/512. Return hex/base64 explicitly. |
| `utils/isBlacklisted.ts` | `path.dirname/normalize` (`src/main/utils/isBlacklisted.ts:8-27`) | Path adapter. Define Windows case-folding policy; `normalize` alone does not make case-insensitive equality. |
| `utils/isPathADir.ts` | `statSync/readlinkSync`, `Dirent`; `path.join` (`src/main/utils/isPathADir.ts:4-28`) | `readDir` already provides `isDirectory/isSymlink`; for a path, plugin `stat` follows permitted symlinks. There is no plugin `readlink` in the installed 2.5.1 API, but this module does not need it after rewrite. |
| `utils/makeDir.ts` | `mkdirSync`, async `mkdir`, Node path/mode types (`src/main/utils/makeDir.ts:1-24`) | One async plugin `mkdir`; use its `{recursive, mode}` type. No sync variant. |
| `utils/safeStorage.ts` | `randomBytes/scryptSync/createCipheriv/createDecipheriv` (`src/main/utils/safeStorage.ts:10-16,31-36`) | `crypto.getRandomValues`; `scrypt-js` + WebCrypto AES-CBC can preserve the legacy format only after byte-for-byte migration tests. **INFERRED:** because the secret is bundled in frontend code today, this is obfuscation, not credential isolation. Prefer a Tauri Stronghold/OS-keychain plugin if security is intended; that changes the persistence boundary but not business policy. |

### Path calls that are not mechanical

Only four patterns require design rather than search/replace:

- `getRootSize` assumes drive-letter roots and shells out to PowerShell/`df` (`src/main/utils/getRootSize.ts:28-88`): **NEEDS_RUST**.
- `getParentFolderPaths` reconstructs paths from `sep`-split segments (`src/main/fs/getParentFolderPaths.ts:3-49`): rewrite and test UNC/POSIX roots.
- `main.ts` resolves Electron preload and renderer HTML (`src/main/main.ts:174,188`): delete, do not port.
- POSIX joins used for `nora://` (`src/main/fs/resolveFilePaths.ts:46-174`, `src/main/core/getTierlistArtworks.ts:44-46`) are URL construction. Use `convertFileSrc`, not `@tauri-apps/api/path.join`.

## Library scan: current trace and ported design

### Current Electron path

1. `getFolderStructures()` opens the directory picker, then recursively calls `generateFolderStructure()` for every selected root (`src/main/core/getFolderStructures.ts:60-67`). Each directory is `stat`ed, its files are synchronously enumerated to count supported extensions, and its subdirectories are separately obtained through `filesystem.getDirectories()` (`src/main/core/getFolderStructures.ts:10-18,21-52`, `src/main/filesystem.ts:677-700`). This is already two directory enumerations per folder.
2. The renderer sends the resulting `FolderStructure[]` to `addMusicFromFolderStructures()` through IPC (`src/main/ipc.ts:165-167`). The function removes structures already represented in the catalog and passes the survivors to `parseFolderStructuresForSongPaths()` (`src/main/core/addMusicFolder.ts:11-40`).
3. `parseFolderStructuresForSongPaths()` flattens every structure, synchronously enumerates **every directory again**, creates full paths, filters supported extensions, saves the structures, tears down/rebuilds watchers, and returns all song paths (`src/main/fs/parseFolderStructuresForSongPaths.ts:9-43,95-149`).
4. `addMusicFromFolderStructures()` parses paths sequentially, awaits each song, emits progress, and triggers palette generation after the pass (`src/main/core/addMusicFolder.ts:42-64`).
5. For every path, `tryToParseSong()` deduplicates it using an in-memory queue and retries up to five times with a five-second delay when the file may still be being written (`src/main/parseSong/parseSong.ts:28-83`).
6. `parseSong()` currently opens the file synchronously with TagLib, inspects every picture, writes `image/jpeg` into blank MIME fields, calls `file.save()`, and disposes it (`src/main/parseSong/parseSong.ts:114-131`). It then performs `fs.stat` and `music-metadata.parseFile` (`src/main/parseSong/parseSong.ts:133-135`), stores artwork, updates albums/artists/genres, writes several stores, and emits multiple data events (`src/main/parseSong/parseSong.ts:166-200,205-331`). Reparse duplicates the auto-heal and `parseFile` path (`src/main/parseSong/reParseSong.ts:43-67`).

### Required ported pipeline

```text
plugin-dialog folder selection
  -> one async readDir traversal (TS, bounded concurrency)
  -> {FolderStructure, candidate paths} from the same entries
  -> per candidate: stat + open/read exactly 256 KiB + close
  -> transfer head ArrayBuffer to metadata Web Worker
  -> parseBuffer(head, undefined, {duration:false})
  -> if FLAC picture MIME is blank: enqueue rare full-file heal transaction
  -> commit catalog mutations in small batches on the renderer thread
  -> install plugin-fs watchers after the initial snapshot is committed
```

Concrete implementation rules:

- Traverse once. `walkMusicTree(root)` calls `readDir(root)`, constructs child full paths, appends supported files, recursively schedules directories, and builds `FolderStructure` from those same entries. Remove `getAllFilePathsFromFolder()` from the initial scan path (`src/main/fs/parseFolderStructuresForSongPaths.ts:25-43`) and do not call both it and `getDirectories()`.
- Keep traversal in TypeScript via `plugin-fs.readDir`. One call returns a whole directory's `DirEntry[]`, so this preserves the “business logic in renderer” constraint and avoids transferring a potentially huge path list through custom JSON invoke. Use bounded concurrency (start at 8 directory calls; measure 4/8/16) to avoid flooding slow disks. **INFERRED:** Rust traversal may win on a library containing tens of thousands of tiny directories because it removes per-directory IPC, but there is no measurement showing that is the bottleneck. Add Rust batching only if a real traversal benchmark, separated from tag parsing, proves a material regression.
- For each audio candidate use the proven shape: `const h = await open(path,{read:true}); const head = new Uint8Array(256*1024); const n = await h.read(head); await h.close(); parseBuffer(head.subarray(0,n ?? 0), undefined, {duration:false})` (`spike/tauri-audio/src/main.ts:231-246`). Always close in `finally`.
- Do not call plugin `readFile(path)` on normal songs. The real 100-FLAC run read 25 MB and parsed 100/100 at 5.1 ms/file with heads; the whole-file arm read 1,824 MB at 115.3 ms/file (`spike/tauri-audio/results-baseline.txt:52-57`). At 10,000 songs, the measured per-file difference projects to roughly 51 seconds versus 19 minutes of read/IPC time before artwork and catalog work (`INFERRED`, linear projection).
- Do not add a Rust `invoke -> Vec<u8>` head command. Tauri's default JSON encoding expanded bytes into number arrays and measured 29.8 ms/file, almost six times slower than plugin-fs head reads (`spike/tauri-audio/src/main.ts:249-261`, `spike/tauri-audio/results-baseline.txt:55-57`). If a future Rust batch command is justified, it must use a raw/binary response channel, not JSON arrays.
- The 100/100 proof is FLAC-specific. FLAC duration is in STREAMINFO and metadata blocks are at the front. For MP3/M4A/other supported formats, retain the same 256 KiB fast path, record `metadataCompleteness`, and use bounded random-access fallbacks (for example a tail read using `FileHandle.seek`) only when the parser reports missing required fields. Never silently fall back to `readFile` for every song. Exact duration can be lazily repaired on first play if the format cannot be established from bounded reads (`INFERRED`; requires corpus tests per supported extension).
- Avoid duplicate store writes. `parseSong()` currently calls four setters and several events per song (`src/main/parseSong/parseSong.ts:284-325`). Accumulate parsed records and commit, for example, every 25 songs or 100 ms. Keep the progress event per song if the UI needs smooth feedback.
- Install watchers after the traversal snapshot and catalog commit, then run one reconciliation pass. The current code saves structures and resets watchers before metadata parsing (`src/main/fs/parseFolderStructuresForSongPaths.ts:105-135`), which can race new events with the initial parser.

### Does this need a Web Worker?

Yes for CPU work, not for filesystem calls. `readDir`, `open`, `read`, and `stat` are asynchronous IPC and do not themselves monopolize the renderer event loop. `music-metadata.parseBuffer`, TagLib's synchronous parser/writer, artwork decoding, palette quantization, sorting/dedup, and large catalog merges can monopolize it.

Recommended split:

- Main renderer thread: plugin-fs calls, permissions, path traversal scheduling, persistence queue, progress/state updates.
- Module Worker: accept `{id,path,head:ArrayBuffer}` via `postMessage(...,[head])`, call browser-bundled `music-metadata.parseBuffer`, return serializable metadata without embedded artwork bytes unless requested. A second worker or bounded task lane can handle Canvas/Vibrant work.
- Main renderer thread: only the rare auto-heal coordinator performs full-file plugin reads/writes and commits.

Can plugin-fs be called directly from the worker? **INFERRED: no, not reliably in Tauri v2.** Tauri's JS `invoke()` delegates to `window.__TAURI_INTERNALS__.invoke`; a dedicated Worker has neither `window` nor the WebView-injected internal object. Therefore, use `postMessage` between the renderer and Worker. Do not copy the internal object into the Worker or hand-roll IPC; that bypasses supported capability scoping. The transferable head buffer makes the message zero-copy from JavaScript's perspective.

## FLAC picture-MIME auto-heal in the WebView

### What the library actually requires

The current feature runs before metadata parse and mutates the user's file only when a picture MIME is blank (`src/main/parseSong/parseSong.ts:114-131`, `src/main/parseSong/reParseSong.ts:45-61`). `node-taglib-sharp` provides the right abstraction entry point: `File.createFromAbstraction(abstraction, mimeType?, propertiesStyle?)` (`node_modules/node-taglib-sharp/dist/file.d.ts:84-104`).

The exact `IFileAbstraction` shape is:

```ts
interface IFileAbstraction {
  name: string;
  readStream: IStream;
  writeStream: IStream;
  closeStream(stream: IStream): void;
}
```

(`node_modules/node-taglib-sharp/dist/fileAbstraction.d.ts:7-42`)

`IStream` is also synchronous: `canWrite`, `length`, mutable `position`, `close()`, `read(...) => number`, `seek(...) => void`, `setLength(...) => void`, and `write(...) => number` (`node_modules/node-taglib-sharp/dist/stream.d.ts:24-102`). In contrast, Tauri's `FileHandle.read/seek/stat/truncate/write` all return Promises. Consequently this adapter is **not valid**:

```ts
// WRONG: Promise-returning methods cannot satisfy node-taglib-sharp.IStream.
get readStream() { return await open(this.name, { read: true }); }
```

The local implementation confirms why: its stream is backed by synchronous `openSync/fstatSync/readSync/ftruncateSync/writeSync` (`node_modules/node-taglib-sharp/dist/stream.js:30-42,59-116`). `ByteVector.fromPath` separately calls `readFileSync` (`node_modules/node-taglib-sharp/dist/byteVector.js:317`). Avoid both paths.

### Concrete adapter shape

Use plugin-fs **outside** TagLib and an in-memory synchronous stream **inside** it:

```ts
import type { IFileAbstraction, IStream } from 'node-taglib-sharp';
import { SeekOrigin } from 'node-taglib-sharp';
import { readFile } from '@tauri-apps/plugin-fs';

class MemoryTagStream implements IStream {
  private bytes: Uint8Array;
  position = 0;
  private closed = false;

  constructor(input: Uint8Array, readonly canWrite: boolean) {
    this.bytes = input.slice();
  }
  get length() { return this.bytes.byteLength; }
  close() { this.closed = true; }
  read(target: Uint8Array, offset: number, length: number): number {
    this.assertOpen();
    const count = Math.min(length, this.length - this.position);
    target.set(this.bytes.subarray(this.position, this.position + count), offset);
    this.position += count;
    return count;
  }
  seek(offset: number, origin: SeekOrigin): void {
    this.assertOpen();
    const base = origin === SeekOrigin.Begin ? 0
      : origin === SeekOrigin.Current ? this.position : this.length;
    const next = base + offset;
    if (!Number.isSafeInteger(next) || next < 0) throw new RangeError('invalid seek');
    this.position = next;
  }
  setLength(length: number): void {
    this.assertWritable();
    const next = new Uint8Array(length);
    next.set(this.bytes.subarray(0, Math.min(length, this.length)));
    this.bytes = next;
    if (this.position > length) this.position = length;
  }
  write(source: Uint8Array, offset: number, length: number): number {
    this.assertWritable();
    const end = this.position + length;
    if (end > this.length) this.setLength(end);
    this.bytes.set(source.subarray(offset, offset + length), this.position);
    this.position = end;
    return length;
  }
  snapshot(): Uint8Array { return this.bytes.slice(); }
  private assertOpen() { if (this.closed) throw new Error('stream closed'); }
  private assertWritable() { this.assertOpen(); if (!this.canWrite) throw new Error('read-only'); }
}

class TauriBufferedFileAbstraction implements IFileAbstraction {
  private current: Uint8Array;
  private lastWriter?: MemoryTagStream;
  constructor(readonly name: string, bytes: Uint8Array) { this.current = bytes.slice(); }
  get readStream(): IStream { return new MemoryTagStream(this.current, false); }
  get writeStream(): IStream {
    // TagLib expects read/write access and may read untouched regions while rewriting tags.
    return (this.lastWriter = new MemoryTagStream(this.current, true));
  }
  closeStream(stream: IStream): void {
    if (stream === this.lastWriter) this.current = this.lastWriter.snapshot();
    stream.close();
  }
  output(): Uint8Array {
    if (!this.lastWriter) throw new Error('TagLib did not open a write stream');
    return this.lastWriter.snapshot();
  }
}

async function prepareHeal(path: string): Promise<Uint8Array | undefined> {
  const original = await readFile(path);              // rare repair path only
  const io = new TauriBufferedFileAbstraction(path, original);
  const file = taglib.File.createFromAbstraction(io, undefined, taglib.ReadStyle.None);
  try {
    let changed = false;
    for (const picture of file.tag.pictures ?? []) {
      if (!picture.mimeType?.trim()) {
        picture.mimeType = sniffImageMime(picture.data); // refuse unknown bytes
        changed = true;
      }
    }
    if (!changed) return undefined;
    file.save();                                      // synchronous, memory-only
    return io.output();                               // not committed yet
  } finally {
    file.dispose();
  }
}
```

This is a concrete shape, not production-complete code. The implementation must handle `ByteVector` input without relying on Node `Buffer`, and `snapshot()` must remain available after `closeStream` (the sketch's `close()` only prevents further I/O). Unit-test every seek origin, overwrite, extension, truncation, zero-byte read, and multiple stream-open sequence against TagLib's own synchronous `Stream` behavior (`node_modules/node-taglib-sharp/dist/stream.js:45-116`).

There is a bundling issue beyond the interface: the package is CommonJS and its root index eagerly requires `byteVector`, `fileAbstraction`, and `stream` (`node_modules/node-taglib-sharp/dist/index.js:8-21`); those modules import Node `fs` (`node_modules/node-taglib-sharp/dist/byteVector.js:5,317`, `node_modules/node-taglib-sharp/dist/stream.js:4,34-110`). A Vite alias to an empty `fs` shim is unsafe because accidental `createFromPath/fromPath` calls would fail at runtime. Maintain a small audited browser fork/patch that removes `LocalFileAbstraction`, `Stream`, and `ByteVector.fromPath`, or expose browser-safe entry modules; add a bundle test that fails if `fs`, `path`, `process`, or `Buffer` shims enter this chunk.

### Detection and commit protocol

Do not read every 18 MB FLAC into memory merely to discover whether it needs repair. During the 256 KiB scan, inspect FLAC PICTURE metadata (or `music-metadata`'s picture format) for a blank MIME. Only suspected files enter the full-file heal lane. If the embedded bytes have JPEG/PNG/WebP/GIF magic, write that real MIME; if bytes are unknown, log and do not mutate. This is safer than blindly labeling every blank picture `image/jpeg`, which is today's behavior (`src/main/parseSong/parseSong.ts:119-126`).

For a suspected file:

1. Acquire a per-canonical-path mutex and add the path plus temporary names to an `internalWrites` watcher-suppression set.
2. `stat` the source; reject directory, read-only file, unexpected size, or changed `(size,mtime)` since scan.
3. Check available space for original + temp + backup. This check is **NEEDS_RUST** (`src/main/utils/getRootSize.ts:22-94`).
4. `readFile` the whole source once. Run TagLib against the memory adapter and produce candidate bytes without touching disk.
5. Validate candidate in memory with a fresh TagLib abstraction and `music-metadata.parseBuffer`; require the correct container magic, at least one repaired picture, sane size bounds, and unchanged audio payload hash. For FLAC, parse metadata-block boundaries and compare SHA-256 of audio frames before/after (`INFERRED`; implement and corpus-test).
6. Create a random temp file in the **same directory** with `open({write:true,createNew:true})`. Loop until `FileHandle.write` has written every byte, close, `stat`, read back, and revalidate/hash the on-disk temp.
7. Keep a recoverable backup or transaction journal. The webview/plugin API exposes neither fsync nor file locking nor a documented cross-platform guaranteed atomic replace. Therefore production-safe final replacement is **NEEDS_RUST** as a tiny primitive: flush temp, atomically replace original on the current OS, preserve/restore permissions and timestamps where appropriate, and report the exact result. This is not a Rust rewrite of tag logic; TS still decides what changes and validates it.
8. Re-open the committed path and verify again before deleting backup/journal. On any failure, leave the original or restore the backup. Remove suppression entries in `finally`, then emit one catalog refresh.

If the project refuses even this thin Rust replace primitive, plugin `rename` plus backup is possible but has weaker crash/power-loss guarantees. That trade must be explicit because these are user-owned music files.

### Auto-heal failure modes (must be tested)

- Capability/scope denial for a user-selected directory; grant only selected roots and app-data/temp paths.
- File removed, renamed, or changed between head scan, full read, and commit; compare size/mtime and optionally source hash at every boundary.
- Another tagger, downloader, watcher, antivirus, cloud-sync client, or Nora task writes concurrently; per-process mutex is insufficient against external writers. Rust locking/replace behavior must be tested on Windows.
- Read-only media, ACL denial, network share disconnect, removable drive removal, path length, UNC path, symlink escape, and case-folded duplicate paths.
- Insufficient disk: temp + backup can require more than twice the file size.
- Huge files or embedded art causing WebView memory pressure: one repair at a time, hard maximum, cancellation between phases, and no parallel whole-file buffers.
- Partial `FileHandle.write`; loop on returned byte count. A zero-byte write before completion is an error.
- Crash/power loss after temp creation, after backup creation, or during replacement; startup recovery must be idempotent from a transaction journal.
- TagLib package accidentally reaching `LocalFileAbstraction`, `ByteVector.fromPath`, Node `Buffer`, or its Node stream; bundle guard required.
- Adapter bugs in seek-from-end, growth, truncation, overlapping writes, stream reuse, close semantics, and `ByteVector` conversion.
- Unsupported/corrupt container or TagLib `isPossiblyCorrupt`; never save a file marked possibly corrupt (`node_modules/node-taglib-sharp/dist/file.d.ts:123-131`).
- Wrong MIME claim: current hard-coded JPEG may mismatch PNG/WebP bytes. Sniff or refuse.
- Tag rewrite changes audio frames, drops unknown metadata blocks, padding, ReplayGain, cuesheets, pictures, or vendor comments. Compare before/after tags and audio payload on a corpus.
- Replacement changes file permissions, creation/modified time, alternate data streams, or cloud metadata and then triggers a rescan.
- Watcher sees `.tmp`/`.backup` as music or sees remove/create as user deletion/addition; ignore transaction suffixes and suppress paths.
- Cancellation after mutation begins. Cancellation may stop before prepare/commit, but must never interrupt the atomic replace primitive halfway.
- Validation succeeds in memory but disk readback differs; never delete the backup until disk validation succeeds.
- Retry repeats a completed heal; operation must be idempotent and recognize a repaired file/journal state.

## Non-portable libraries and concrete replacements

### `sharp` - five call-site modules

1. `core/getTierlistArtworks.ts` crops each full cover to 400x400, WebP quality 80/effort 2, caches `<id>-tl.webp`, concurrency four (`src/main/core/getTierlistArtworks.ts:10-18,23-53`). Replace with `createImageBitmap(blob)`, crop geometry for `fit: cover`, `OffscreenCanvas(400,400)`, `drawImage`, and `convertToBlob({type:'image/webp',quality:0.8})`, then plugin `writeFile`. No browser equivalent of Sharp's encoder `effort`; output size/visual quality will differ slightly.
2. `core/saveArtworkToSystem.ts` loads local/remote artwork and lets Sharp infer output from the chosen filename, with animation enabled (`src/main/core/saveArtworkToSystem.ts:11-22,39-49`). If the user keeps the original extension and no transformation is needed, write original bytes directly. For conversion, Canvas reliably targets PNG/JPEG/WebP in current WebView2; it does not provide TIFF encoding and GIF/AVIF encode support is not a safe assumption. Animated input becomes a single frame through Canvas. Either narrow the save dialog to supported outputs or keep a small Rust image encoder. The user-visible difference is fewer output formats and loss of animation/metadata/color profiles on converted files.
3. `other/artworks.ts` makes a 50x50 quality-50 WebP and an asynchronous full-resolution WebP, plus temporary WebP files (`src/main/other/artworks.ts:38-59,158-164`). Use one decoded `ImageBitmap`, generate both canvases, and await **both** writes before reporting completion (the current full-resolution write is intentionally not awaited at lines 53-59). Canvas strips EXIF/ICC metadata; browser resampling may differ from libvips.
4. `parseSong/generateCoverBuffer.ts` converts default/cached/embedded WebP to PNG for consumers (`src/main/parseSong/generateCoverBuffer.ts:14-25,39-56`). Prefer removing the conversion: make downstream code accept `Blob`/`Uint8Array` with MIME. If PNG is required, Canvas conversion is adequate but strips animation/profile/metadata.
5. `updateSongId3Tags.ts` converts artwork to PNG before building a `node-id3` image frame (`src/main/updateSongId3Tags.ts:195-223`). Canvas -> PNG Blob supplies the bytes, but this entire write must join the corruption-safe tag transaction. User-visible difference: embedded art may have different compression/color management and animated art becomes static.

Centralize this in a renderer `imageCodec.ts`; do not reproduce five subtly different Canvas pipelines. Decode errors, tainted remote canvases (CORS), maximum dimensions, decompression bombs, orientation, alpha, and color-space behavior need tests.

### `node-vibrant`

The module extracts the six default swatches and rounds HSL values before persisting palette IDs (`src/main/other/generatePalette.ts:51-87`), then lazily fills missing song/album/genre palettes (`src/main/other/generatePalette.ts:105-203`). The installed package explicitly ships `node-vibrant/browser`; change `node-vibrant/node` at `src/main/other/generatePalette.ts:1` to the browser entry and feed an `ImageBitmap`/browser-supported source. Preserve the same generator/quantizer to minimize palette changes. User-visible differences should be small, but browser decode/color-management and worker timing can choose slightly different swatches; do not regenerate all existing palettes during migration.

### `winston`

Winston currently creates console and file transports, formats console timestamps/color, stores the log under Electron user data, and toggles both levels between the default and verbose (`src/main/logger.ts:42-81,109-123`). Replace it with `@tauri-apps/plugin-log` JS `trace/debug/info/warn/error` calls and Rust-configured LogDir + Webview/stdout targets, level filters, rotation, and local timestamps. Keep the existing `{debug,info,warn,error,verbose}` facade so all callers are mechanical. User-visible differences: file name/location, formatting, rotation policy, and historical log continuity unless configured/migrated; ANSI color has no meaning in the file target.

### `discord-rpc`

The module opens Discord's local IPC transport, reconnects after disconnect/login errors, stores the last payload, supplies `process.pid`, and sends raw `SET_ACTIVITY` requests (`src/main/other/discord.ts:39-76`). A WebView cannot open Discord's local named pipe/socket. Options:

- Recommended: a thin Rust transport using a maintained Discord Rich Presence crate, with Tauri commands `discord_connect(clientId)`, `discord_set_activity(payload)`, `discord_clear()`, and connection-status events. Keep payload construction, preference, debounce/queue, and retry policy in TypeScript (`src/main/other/discordRPC.ts:5-38`).
- Lowest risk/scope: drop Discord RPC and remove/disable the setting.

Do not use the shell plugin or a Node sidecar. User-visible differences with a Rust crate may include reconnect timing, button/asset support, timestamp encoding, and clearing behavior; make a parity checklist against the current raw payload.

### Additional blockers not in the four-name list

- `node-id3`: synchronous/path-based read/update in tag and lyric modules (`src/main/updateSongId3Tags.ts:78,685-703,794-843`, `src/main/saveLyricsToSong.ts:35-46,110`, `src/main/core/getSongLyrics.ts:59`, `src/main/core/sendSongId3Tags.ts:19`). Consolidate MP3 reads/writes into the same browser-safe TagLib abstraction and safe commit pipeline; do not add an `fs` shim.
- `electron-store`: synchronous persistence behind `filesystem.ts` (`src/main/filesystem.ts:101-304`). Replace with hydrated in-memory state plus serialized async writes; plugin-store is acceptable if schemas/filenames and backups remain compatible.
- `fs-extra`: only `pathExistsSync/emptyDirSync` for the temp-artwork directory (`src/main/other/artworks.ts:175-176`); replace mechanically with `exists/remove/mkdir`.
- `electron-updater`: replace with Tauri updater/process plugins while retaining TypeScript policy (`src/main/update.ts:22-96`).

## Risk ranking and migration order

### Tier 0 - can corrupt user files

1. **FLAC MIME auto-heal** (`src/main/parseSong/parseSong.ts:114-131`, `src/main/parseSong/reParseSong.ts:45-61`): synchronous abstraction mismatch, whole-file memory transform, untrusted/corrupt media, concurrent writers, and crash-safe replacement. Requires the transaction design and a real corpus with byte/audio-payload comparisons.
2. **All ID3 metadata and embedded-lyrics writes** (`src/main/updateSongId3Tags.ts:68-88,664-858`, `src/main/saveLyricsToSong.ts:35-110`): larger behavior surface than the FLAC fix and currently split across pending updates, artwork conversion, and `node-id3`. Move last, behind backups and fault-injection tests.
3. **Import/reset/delete** (`src/main/core/statsTransfer/importStats.ts:488-503`, `src/main/resetAppData.ts:31-39`, `src/main/core/deleteSongsFromSystem.ts:38-40`): preserve backup-first and trash-vs-permanent semantics; validate capability scopes and selected paths.

### Tier 1 - real architecture/performance design

1. Library traversal + 256 KiB metadata pipeline + Worker split (`src/main/core/getFolderStructures.ts:21-67`, `src/main/core/addMusicFolder.ts:29-70`, `src/main/parseSong/parseSong.ts:88-360`). This is the biggest performance risk, but the spike removes the main uncertainty if the head-read rule is enforced.
2. Persistence facade (`src/main/filesystem.ts:101-304,310-720`): synchronous store assumptions must become explicit async hydration and a serialized write queue without changing schemas.
3. Watchers (`src/main/fs/addWatchersToFolders.ts:41-88`, `src/main/fs/addWatchersToParentFolders.ts:11-73`): event-model translation, debounce, rename semantics, startup reconciliation, and internal-write suppression.
4. Artwork pipeline (`src/main/other/artworks.ts:18-69`, `src/main/core/getTierlistArtworks.ts:22-53`): browser codec support, memory, cache compatibility, animation/color differences.
5. Rust-only OS edges: ranged media protocol (`src/main/main.ts:455-517`), disk capacity (`src/main/utils/getRootSize.ts:22-94`), safe atomic replace, Discord IPC, and optional Windows taskbar buttons (`src/main/core/manageTaskbarPlaybackButtonControls.ts:23-61`). These are transports/primitives; business decisions remain TS.

### Tier 2 - moderate integration risk

- Last.fm/Genius/Musixmatch/Spotify/Deezer/iTunes/LRCLIB fetches: code is fetch-based, but CORS, rate limits, and secrets exposed to WebView need live tests (`src/main/utils/fetchSongMetadataFromInternet.ts:192-300,423-470`).
- Crypto compatibility: MD5 signatures and legacy scrypt/AES ciphertext must remain byte-compatible or be explicitly migrated (`src/main/utils/hashText.ts:3-12`, `src/main/utils/safeStorage.ts:5-38`).
- Updater: plugin replacement is conceptually direct, but release manifest/signing/install-over behavior is user-visible (`src/main/update.ts:40-96`).
- Path equality and playlist portability: test drive letters, UNC, Unicode, case, symlinks, and POSIX before deleting the Electron implementation (`src/main/core/importPlaylist.ts:23-70`, `src/main/utils/isBlacklisted.ts:8-27`).

### Tier 3 - mechanical

- Search/sort/filter/pagination, tierlist CRUD/weighting, ELO/duel/rediscover algorithms, most playlist CRUD, stats aggregation, lyric romanization/translation formatting, and album/artist/genre association are pure TypeScript.
- Ordinary `basename/extname/dirname`, JSON `readTextFile/writeTextFile`, existence, stat, mkdir, copy, and remove conversions are mechanical once the async boundary is explicit.
- `ipc.ts` business handlers disappear in favor of direct imports; retain only adapters for actual Tauri calls (`src/main/ipc.ts:115-614`).

### Suggested implementation sequence

1. Create renderer-owned domain modules and move Tier 3 pure logic with tests; keep an Electron adapter temporarily.
2. Replace `filesystem.ts` storage behind the same domain API and prove old JSON compatibility/migrations.
3. Port dialog/path/fs helpers and one-pass traversal; land the 256 KiB + Worker metadata reader with benchmark gates: no normal-scan `readFile(audioPath)`, no JSON byte arrays, and corpus success by extension.
4. Port watchers and reconcile behavior; add internal-write suppression before any tag writer.
5. Port browser artwork/Vibrant/logging and validate visual/cache differences.
6. Implement read-only tag access through the in-memory abstraction, then auto-heal prepare/validate without commit.
7. Add safe commit primitive, backup/journal/recovery, failure injection, and only then enable FLAC auto-heal writes.
8. Consolidate `node-id3` writes into that transaction layer and port metadata/lyrics editing last.
9. Replace updater/Discord/Windows integrations and remove the Electron shell only after live parity tests.

## Acceptance gates

- Inventory recount still reports 142 files / 16,679 LOC accounted for by this map; representative boundary files are `src/main/main.ts:1` and `src/main/utils/sortSongs.ts:1`.
- Browser bundle has no `fs`, `path`, `os`, `crypto`, `child_process`, Sharp, Winston, Discord RPC, Electron Store, Electron Updater, or Node-ID3 runtime imports; intentional Rust/plugin boundaries are explicit.
- 100-FLAC scan gate stays at 100/100 with exactly 256 KiB maximum normal read and is benchmarked against `spike/tauri-audio/results-baseline.txt:52-57`.
- UI remains interactive during a 10k-track synthetic scan; metadata CPU work is observable in a Worker, while plugin-fs stays in the renderer.
- Auto-heal is off by default until power-loss/fault-injection tests prove original recovery at every commit phase.
- Golden tag corpus proves: only intended MIME/ID3 fields change, audio payload hashes remain equal, unknown tags survive, and repeat execution is idempotent.
- Windows real-library tests cover Unicode, long paths, drive roots, UNC/network shares, read-only files, antivirus contention, watcher events, and low disk.

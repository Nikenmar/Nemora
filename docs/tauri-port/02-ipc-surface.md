# IPC surface: Electron to Tauri v2

> Rebrand note: this report was written during the Electron→Tauri port, when the
> app was still Nora (`com.sandakannipunajith.nora`, `%APPDATA%\Nora`, `nora://`).
> The port has since become its own player, Nemora (`com.cmrdevs.nemora`,
> `%APPDATA%\Nemora`, `nemora://`, repo `Nikenmar/Nemora`). The rebrand supersedes
> none of its conclusions; the 114-channel classification still governs the code.

Branch audited: `port/tauri-v2`. This is a static, registration-by-registration audit of `initializeIPC`; it does not include a build or runtime test. The inventory is mechanically complete: `src/main/ipc.ts` contains 114 `ipcMain.handle/on` registrations, all 114 appear once in the table, and every registration has a wrapper in `src/preload/index.ts`.

The target architecture is the one already fixed by the port plan: business logic remains TypeScript in WebView2, with no Node sidecar and only thin Rust glue (`docs/tauri-port/00-PLAN.md:63-68`); the public `window.api` shape remains stable (`docs/tauri-port/00-PLAN.md:129`). The spike also makes binary transport a hard constraint: do not serialize bytes as `Vec<u8>` through `invoke` (`docs/tauri-port/00-PLAN.md:40-52`).

## Classification boundary

- **PURE_TS** — direct renderer-side TypeScript call. This includes computation, browser `fetch`, and CRUD over Nora's in-memory repositories. **INFERRED:** the repository implementation itself must be replaced once, centrally, because the current cache is initialized and persisted by `electron-store` (`src/main/filesystem.ts:101-115`, `src/main/filesystem.ts:283-304`). A row is still `PURE_TS` when it only calls that repository abstraction; otherwise nearly every business operation would be mislabeled as an OS boundary.
- **NEEDS_FS** — direct renderer-side TypeScript call whose own path directly opens, stats, traverses, parses, writes, deletes, or transforms user files. Replace the listed Node built-ins with `@tauri-apps/plugin-fs`; keep the 256 KiB-head scanning rule from `docs/tauri-port/00-PLAN.md:40-50`. Packages such as `node-id3`, `sharp`, and Node-specific `node-vibrant` entry points also need browser-safe equivalents or adapters, but the business logic remains TypeScript.
- **NEEDS_RUST** — the call requires an OS capability explicitly outside the webview. An official Tauri plugin/API is named where available; otherwise the row says `custom Rust` and suggests a crate.
- **DIES** — no replacement call is needed.

This boundary is intentionally about the **channel-specific capability**, not the implementation language. Both `PURE_TS` and `NEEDS_FS` lose IPC and become direct TypeScript calls.

## Complete classification table (114/114)

| Bucket | Channel and registration | Existing `window.api` wrapper | Handler | What it does; port justification |
|---|---|---|---|---|
| PURE_TS | `app/getSongPosition` (`src/main/ipc.ts:161`) | `playerControls.sendSongPosition` (`src/preload/index.ts:43`) | `setUserData` (`src/main/filesystem.ts:325`) | Persists the stopped playback position; direct repository write in the webview. |
| PURE_TS | `app/toggleLikeSongs` (`src/main/ipc.ts:175`) | `playerControls.toggleLikeSongs` (`src/preload/index.ts:47`) | `toggleLikeSongs` (`src/main/core/toggleLikeSongs.ts:111`) | Toggles favorite state and Favorites membership; repository mutation and local data-update notification. |
| PURE_TS | `app/toggleLikeArtists` (`src/main/ipc.ts:179`) | `artistsData.toggleLikeArtists` (`src/preload/index.ts:328`) | `toggleLikeArtists` (`src/main/core/toggleLikeArtists.ts:80`) | Toggles artist favorite state; repository mutation and local notification. |
| PURE_TS | `app/getAllSongs` (`src/main/ipc.ts:183`) | `audioLibraryControls.getAllSongs` (`src/preload/index.ts:72`) | `getAllSongs` (`src/main/core/getAllSongs.ts:56`) | Filters, sorts, paginates, and decorates cached song data; direct computation over repository state. |
| PURE_TS | `app/saveUserData` (`src/main/ipc.ts:193`) | `userData.saveUserData` (`src/preload/index.ts:291`) | `setUserData` (`src/main/filesystem.ts:325`) | Updates one user-data field; direct repository write. |
| PURE_TS | `app/getUserData` (`src/main/ipc.ts:201`) | `userData.getUserData` (`src/preload/index.ts:290`) | `getUserData` (`src/main/filesystem.ts:308`) | Returns cached user preferences/state; direct repository read. |
| PURE_TS | `app/search` (`src/main/ipc.ts:203`) | `search.search` (`src/preload/index.ts:186`) | `search` (`src/main/search.ts:359`) | Ranks library entities and optionally updates recent searches; direct TS search plus repository write. |
| PURE_TS | `app/getTranslatedLyrics` (`src/main/ipc.ts:220`) | `lyrics.getTranslatedLyrics` (`src/preload/index.ts:212`) | `getTranslatedLyrics` (`src/main/utils/getTranslatedLyrics.ts:123`) | Translates cached lyrics with an HTTP API and updates the in-memory lyric cache; browser `fetch`/library call. |
| PURE_TS | `app/romanizeLyrics` (`src/main/ipc.ts:224`) | `lyrics.romanizeLyrics` (`src/preload/index.ts:215`) | `romanizeLyrics` (`src/main/utils/romanizeLyrics.ts:126`) | Romanizes cached lyrics; pure TS/library computation. |
| PURE_TS | `app/convertLyricsToPinyin` (`src/main/ipc.ts:226`) | `lyrics.convertLyricsToPinyin` (`src/preload/index.ts:217`) | `convertLyricsToPinyin` (`src/main/utils/convertToPinyin.ts:121`) | Converts cached Chinese lyrics to pinyin; pure TS/library computation. |
| PURE_TS | `app/convertLyricsToRomaja` (`src/main/ipc.ts:228`) | `lyrics.convertLyricsToRomaja` (`src/preload/index.ts:220`) | `convertLyricsToRomaja` (`src/main/utils/convertToRomaja.ts:113`) | Converts cached Hangul lyrics to Romaja; pure TS/library computation. |
| PURE_TS | `app/resetLyrics` (`src/main/ipc.ts:230`) | `lyrics.resetLyrics` (`src/preload/index.ts:223`) | `resetLyrics` (`src/main/utils/resetLyrics.ts:31`) | Restores the cached original lyrics; in-process state update. |
| PURE_TS | `app/getSongInfo` (`src/main/ipc.ts:236`) | `audioLibraryControls.getSongInfo` (`src/preload/index.ts:78`) | `getSongInfo` (`src/main/core/getSongInfo.ts:84`) | Selects, filters, sorts, and decorates requested cached songs. |
| PURE_TS | `app/getSimilarTracksForASong` (`src/main/ipc.ts:248`) | `audioLibraryControls.getSimilarTracksForASong` (`src/preload/index.ts:115`) | `getSimilarTracks` (`src/main/other/lastFm/getSimilarTracks.ts:117`) | Fetches Last.fm similarity data and matches it to cached songs; browser `fetch` plus computation. |
| PURE_TS | `app/getAlbumInfoFromLastFM` (`src/main/ipc.ts:250`) | `albumsData.getAlbumInfoFromLastFM` (`src/preload/index.ts:347`) | `getAlbumInfoFromLastFM` (`src/main/other/lastFm/getAlbumInfoFromLastFM.ts:148`) | Fetches Last.fm album data and maps tracks to the local library. |
| PURE_TS | `app/getSongListeningData` (`src/main/ipc.ts:254`) | `audioLibraryControls.getSongListeningData` (`src/preload/index.ts:86`) | `getListeningData` (`src/main/filesystem.ts:507`) | Returns canonical cached listening rows, synthesizing defaults where absent. |
| PURE_TS | `app/updateSongListeningData` (`src/main/ipc.ts:256`) | `audioLibraryControls.updateSongListeningData` (`src/preload/index.ts:88`) | `updateSongListeningData` (`src/main/core/updateSongListeningData.ts:139`) | Updates listens/skips/seeks/full-listens and emits a local data-update event. |
| PURE_TS | `app/scrobbleSong` (`src/main/ipc.ts:268`) | `audioLibraryControls.scrobbleSong` (`src/preload/index.ts:111`) | `scrobbleSong` (`src/main/other/lastFm/scrobbleSong.ts:68`) | Posts a scrobble for cached song/auth data; browser `fetch` and Web Crypto-compatible signing. |
| PURE_TS | `app/sendNowPlayingSongDataToLastFM` (`src/main/ipc.ts:272`) | `audioLibraryControls.sendNowPlayingSongDataToLastFM` (`src/preload/index.ts:113`) | `sendNowPlayingSongDataToLastFM` (`src/main/other/lastFm/sendNowPlayingSongDataToLastFM.ts:82`) | Posts Now Playing metadata to Last.fm; browser `fetch`. |
| PURE_TS | `app/getArtistArtworks` (`src/main/ipc.ts:276`) | `artistsData.getArtistArtworks` (`src/preload/index.ts:333`) | `getArtistInfoFromNet` (`src/main/core/getArtistInfoFromNet.ts:194`) | Fetches artist images/similar artists, derives a palette, and updates cached artist data. |
| PURE_TS | `app/fetchSongInfoFromNet` (`src/main/ipc.ts:280`) | `songDataFromInternet.fetchSongInfoFromNet` (`src/preload/index.ts:281`) | `fetchSongInfoFromLastFM` (`src/main/core/fetchSongInfoFromLastFM.ts:54`) | Fetches Last.fm track info; replace Electron `net.isOnline` check with `navigator.onLine`/request failure. |
| PURE_TS | `app/searchSongMetadataResultsInInternet` (`src/main/ipc.ts:284`) | `songDataFromInternet.searchSongMetadataResultsInInternet` (`src/preload/index.ts:271`) | `searchSongMetadataResultsInInternet` (`src/main/utils/fetchSongMetadataFromInternet.ts:414`) | Searches Musixmatch/iTunes/Last.fm/Genius/Deezer; browser `fetch` with abort controllers. |
| PURE_TS | `app/fetchSongMetadataFromInternet` (`src/main/ipc.ts:290`) | `songDataFromInternet.fetchSongMetadataFromInternet` (`src/preload/index.ts:276`) | `fetchSongMetadataFromInternet` (`src/main/utils/fetchSongMetadataFromInternet.ts:451`) | Fetches full metadata from the selected internet source; browser `fetch`. |
| PURE_TS | `app/getArtistData` (`src/main/ipc.ts:296`) | `artistsData.getArtistData` (`src/preload/index.ts:321`) | `fetchArtistData` (`src/main/core/fetchArtistData.ts:51`) | Filters/sorts/decorates cached artists. |
| PURE_TS | `app/getGenresData` (`src/main/ipc.ts:307`) | `genresData.getGenresData` (`src/preload/index.ts:339`) | `getGenresInfo` (`src/main/core/getGenresInfo.ts:43`) | Selects/sorts/decorates cached genres. |
| PURE_TS | `app/getAlbumData` (`src/main/ipc.ts:313`) | `albumsData.getAlbumData` (`src/preload/index.ts:345`) | `fetchAlbumData` (`src/main/core/fetchAlbumData.ts:43`) | Selects/sorts/decorates cached albums. |
| PURE_TS | `app/getPlaylistData` (`src/main/ipc.ts:319`) | `playlistsData.getPlaylistData` (`src/preload/index.ts:353`) | `sendPlaylistData` (`src/main/core/sendPlaylistData.ts:35`) | Selects/sorts/decorates cached playlists. |
| PURE_TS | `app/getArtistDuplicates` (`src/main/ipc.ts:325`) | `suggestions.getArtistDuplicates` (`src/preload/index.ts:120`) | `getArtistDuplicates` (`src/main/core/getDuplicates.ts:14`) | Finds duplicate artist records by name in cached data. |
| PURE_TS | `app/removePlaylists` (`src/main/ipc.ts:353`) | `playlistsData.removePlaylists` (`src/preload/index.ts:376`) | `removePlaylists` (`src/main/core/removePlaylists.ts:46`) | Removes mutable playlist records and emits a local update. |
| PURE_TS | `app/getTierlistData` (`src/main/ipc.ts:358`) | `tierlistsData.getTierlistData` (`src/preload/index.ts:389`) | `sendTierlistData` (`src/main/core/tierlists.ts:33`) | Selects and sorts cached tierlists. |
| PURE_TS | `app/addTierlist` (`src/main/ipc.ts:364`) | `tierlistsData.addTierlist` (`src/preload/index.ts:393`) | `addTierlist` (`src/main/core/tierlists.ts:41`) | Creates a tierlist from playlist/folder sources in repository state. |
| PURE_TS | `app/saveTierlist` (`src/main/ipc.ts:375`) | `tierlistsData.saveTierlist` (`src/preload/index.ts:400`) | `saveTierlist` (`src/main/core/tierlists.ts:79`) | Replaces a tierlist and emits a local update. |
| PURE_TS | `app/removeTierlists` (`src/main/ipc.ts:379`) | `tierlistsData.removeTierlists` (`src/preload/index.ts:404`) | `removeTierlists` (`src/main/core/tierlists.ts:102`) | Deletes tierlist records and emits a local update. |
| PURE_TS | `app/getMegaShuffleWeights` (`src/main/ipc.ts:387`) | `tierlistsData.getMegaShuffleWeights` (`src/preload/index.ts:408`) | `getMegaShuffleWeights` (`src/main/core/megaShuffle.ts:175`) | Computes per-song Smart Shuffle weights from cached tiers/listening/ELO/history. |
| PURE_TS | `app/getMegaShuffleData` (`src/main/ipc.ts:390`) | `tierlistsData.getMegaShuffleData` (`src/preload/index.ts:410`) | `getMegaShuffleData` (`src/main/core/megaShuffle.ts:164`) | Returns weights plus ELO confidence metadata; pure computation over cached state. |
| PURE_TS | `app/getStatsData` (`src/main/ipc.ts:395`) | `statsData.getStatsData` (`src/preload/index.ts:416`) | `getStatsData` (`src/main/core/getStatsData.ts:318`) | Aggregates cached library/listening/ELO data into dashboard statistics. |
| PURE_TS | `app/getDuelPair` (`src/main/ipc.ts:417`) | `eloDuels.getDuelPair` (`src/preload/index.ts:430`) | `getDuelPair` (`src/main/core/eloDuels.ts:199`) | Selects an adaptive ELO pair from cached library/stat state. |
| PURE_TS | `app/selectDuelAnchor` (`src/main/ipc.ts:418`) | `eloDuels.selectDuelAnchor` (`src/preload/index.ts:432`) | `selectDuelAnchorFromCandidates` (`src/main/core/eloDuels.ts:176`) | Picks the best duel anchor from renderer-supplied candidates. |
| PURE_TS | `app/getDuelPairByIds` (`src/main/ipc.ts:424`) | `eloDuels.getDuelPairByIds` (`src/preload/index.ts:437`) | `getDuelPairByIds` (`src/main/core/eloDuels.ts:273`) | Builds a duel pair for two explicit song IDs. |
| PURE_TS | `app/recordDuelSkip` (`src/main/ipc.ts:427`) | `eloDuels.recordDuelSkip` (`src/preload/index.ts:439`) | `recordDuelSkip` (`src/main/core/eloDuels.ts:246`) | Records a skipped pair/reason in CMR state. |
| PURE_TS | `app/submitDuelResult` (`src/main/ipc.ts:433`) | `eloDuels.submitDuelResult` (`src/preload/index.ts:441`) | `submitDuelResult` (`src/main/core/eloDuels.ts:86`) | Applies an ELO outcome, persists state, and emits a local update. |
| PURE_TS | `app/addSongsToPlaylist` (`src/main/ipc.ts:439`) | `playlistsData.addSongsToPlaylist` (`src/preload/index.ts:365`) | `addSongsToPlaylist` (`src/main/core/addSongsToPlaylist.ts:50`) | Adds unique song IDs to a mutable playlist. |
| PURE_TS | `app/removeSongFromPlaylist` (`src/main/ipc.ts:443`) | `playlistsData.removeSongFromPlaylist` (`src/preload/index.ts:374`) | `removeSongFromPlaylist` (`src/main/core/removeSongFromPlaylist.ts:41`) | Removes a song from a playlist and updates Favorites when applicable. |
| PURE_TS | `app/renameAPlaylist` (`src/main/ipc.ts:451`) | `playlistsData.renameAPlaylist` (`src/preload/index.ts:372`) | anonymous default (`src/main/core/renameAPlaylist.ts:5`) | Renames a mutable playlist in repository state. |
| PURE_TS | `app/clearSongHistory` (`src/main/ipc.ts:455`) | `audioLibraryControls.clearSongHistory` (`src/preload/index.ts:110`) | `clearSongHistory` (`src/main/core/clearSongHistory.ts:25`) | Clears the History playlist and emits a local update. |
| PURE_TS | `app/refreshRediscoverPlaylist` (`src/main/ipc.ts:457`) | `playlistsData.refreshRediscoverPlaylist` (`src/preload/index.ts:383`) | `refreshRediscoverPlaylist` (`src/main/core/rediscover.ts:112`) | Recomputes the derived Rediscover playlist from cached state. |
| PURE_TS | `app/getBlacklistData` (`src/main/ipc.ts:472`) | `audioLibraryControls.getBlacklistData` (`src/preload/index.ts:99`) | `getBlacklistData` (`src/main/filesystem.ts:628`) | Returns cached song/folder blacklist data. |
| PURE_TS | `app/blacklistSongs` (`src/main/ipc.ts:474`) | `audioLibraryControls.blacklistSongs` (`src/preload/index.ts:100`) | `blacklistSongs` (`src/main/core/blacklistSongs.ts:15`) | Adds song IDs to the blacklist repository. |
| PURE_TS | `app/restoreBlacklistedSongs` (`src/main/ipc.ts:476`) | `audioLibraryControls.restoreBlacklistedSongs` (`src/preload/index.ts:102`) | `restoreBlacklistedSongs` (`src/main/core/restoreBlacklistedSongs.ts:44`) | Removes song IDs from the blacklist and returns restored song data. |
| PURE_TS | `app/clearSearchHistory` (`src/main/ipc.ts:494`) | `search.clearSearchHistory` (`src/preload/index.ts:192`) | `clearSearchHistoryResults` (`src/main/core/clearSeachHistoryResults.ts:27`) | Clears all or selected recent-search strings. |
| PURE_TS | `app/getFolderData` (`src/main/ipc.ts:562`) | `folderData.getFolderData` (`src/preload/index.ts:303`) | `getMusicFolderData` (`src/main/core/getMusicFolderData.ts:88`) | Aggregates folder cards/counts from cached folder and song state. |
| PURE_TS | `app/compareEncryptedData` (`src/main/ipc.ts:566`) | `settingsHelpers.compareEncryptedData` (`src/preload/index.ts:497`) | `compare` (`src/main/utils/safeStorage.ts:45`) | Decrypts and compares strings; use browser Web Crypto instead of Node `crypto`/`Buffer`. **Existing mismatch:** the preload wrapper passes no arguments although the handler requires two (`src/preload/index.ts:497`, `src/main/ipc.ts:566-568`). |
| PURE_TS | `app/isMetadataUpdatesPending` (`src/main/ipc.ts:570`) | `songUpdates.isMetadataUpdatesPending` (`src/preload/index.ts:265`) | `isMetadataUpdatesPending` (`src/main/updateSongId3Tags.ts:58`) | Checks the in-memory pending-metadata map after normalizing a path. |
| PURE_TS | `app/blacklistFolders` (`src/main/ipc.ts:574`) | `folderData.blacklistFolders` (`src/preload/index.ts:305`) | `blacklistFolders` (`src/main/core/blacklistFolders.ts:15`) | Adds folder paths to the blacklist repository. |
| PURE_TS | `app/restoreBlacklistedFolders` (`src/main/ipc.ts:578`) | `folderData.restoreBlacklistedFolders` (`src/preload/index.ts:307`) | `restoreBlacklistedFolders` (`src/main/core/restoreBlacklistedFolder.ts:38`) | Removes eligible folder paths from the blacklist repository. |
| PURE_TS | `app/toggleBlacklistedFolders` (`src/main/ipc.ts:582`) | `folderData.toggleBlacklistedFolders` (`src/preload/index.ts:309`) | `toggleBlacklistFolders` (`src/main/core/toggleBlacklistFolders.ts:60`) | Toggles folder blacklist membership in repository state. |
| PURE_TS | `app/getArtworksForMultipleArtworksCover` (`src/main/ipc.ts:597`) | `playlistsData.getArtworksForMultipleArtworksCover` (`src/preload/index.ts:378`) | `getArtworksForMultipleArtworksCover` (`src/main/core/getArtworksForMultipleArtworksCover.ts:3`) | Converts song IDs to artwork URL/path strings; no image bytes cross the boundary. |
| NEEDS_FS | `app/addSongsFromFolderStructures` (`src/main/ipc.ts:165`) | `audioLibraryControls.addSongsFromFolderStructures` (`src/preload/index.ts:64`) | `addSongsFromFolderStructures` (`src/main/core/addMusicFolder.ts:73`) | Traverses supplied folder structures, parses audio metadata, creates records/artwork, and generates palettes (`src/main/core/addMusicFolder.ts:29-70`). Replace Node `path`, transitive `fs/promises`, file-based `music-metadata`, `sharp`, and Buffer use with `plugin-fs` plus browser-safe transforms. |
| NEEDS_FS | `app/getSong` (`src/main/ipc.ts:169`) | `audioLibraryControls.getSong` (`src/preload/index.ts:70`) | `sendAudioData` (`src/main/core/sendAudioData.ts:133`) | Reads track metadata/artwork and returns player data (`src/main/core/sendAudioData.ts:63-111`). Replace file-based `music-metadata`, Electron `app`, and `Buffer`; return paths/protocol URLs, not artwork bytes. |
| NEEDS_FS | `app/getSongFromUnknownSource` (`src/main/ipc.ts:171`) | `unknownSource.getSongFromUnknownSource` (`src/preload/index.ts:152`) | `sendAudioDataFromPath` (`src/main/core/sendAudioDataFromPath.ts:91`) | Parses an arbitrary audio path and creates temporary artwork/player data. Replace Node `path`, `Buffer`, file-based `music-metadata`, and artwork file helpers with `plugin-fs`. |
| NEEDS_FS | `app/getSongLyrics` (`src/main/ipc.ts:209`) | `lyrics.getSongLyrics` (`src/preload/index.ts:198`) | `getSongLyrics` (`src/main/core/getSongLyrics.ts:385`) | Reads embedded/LRC lyrics and optionally writes fetched lyrics (`src/main/core/getSongLyrics.ts:75-111`, `src/main/core/getSongLyrics.ts:260-270`). Replace `path`, `fs/promises.readFile`, `node-id3`, and Buffer-based tag access with `plugin-fs` plus browser metadata parsing. |
| NEEDS_FS | `app/saveLyricsToSong` (`src/main/ipc.ts:232`) | `lyrics.saveLyricsToSong` (`src/preload/index.ts:225`) | `saveLyricsToSong` (`src/main/saveLyricsToSong.ts:127`) | Queues/writes embedded tags or an LRC file (`src/main/saveLyricsToSong.ts:23-96`). Replace Node `path`, `node-id3`, and transitive file writes with `plugin-fs`; preserve delayed-save semantics in TS. |
| NEEDS_FS | `app/generatePalettes` (`src/main/ipc.ts:266`) | `audioLibraryControls.generatePalettes` (`src/preload/index.ts:109`) | `generatePalettes` (`src/main/other/generatePalette.ts:213`) | Reads cover files/embedded artwork and derives palettes. Replace transitive `fs/promises`, `Buffer`, `sharp`, and `node-vibrant/node` with `plugin-fs` and browser builds/canvas codecs. |
| NEEDS_FS | `app/resolveArtistDuplicates` (`src/main/ipc.ts:329`) | `suggestions.resolveArtistDuplicates` (`src/preload/index.ts:123`) | `resolveArtistDuplicates` (`src/main/core/resolveDuplicates.ts:23`) | Merges artists and rewrites affected audio tags via `sendSongID3Tags`/`updateSongId3Tags` (`src/main/core/resolveDuplicates.ts:75-87`). Replace `path`, `fs/promises`, `node-id3`/tag writer, `sharp`, and `Buffer`. |
| NEEDS_FS | `app/resolveSeparateArtists` (`src/main/ipc.ts:335`) | `suggestions.resolveSeparateArtists` (`src/preload/index.ts:129`) | `resolveSeparateArtists` (`src/main/core/resolveSeparateArtists.ts:16`) | Splits artist identities and rewrites affected audio tags (`src/main/core/resolveSeparateArtists.ts:76-110`). Same `plugin-fs`/browser tag-writer requirement as duplicate resolution. |
| NEEDS_FS | `app/resolveFeaturingArtists` (`src/main/ipc.ts:341`) | `suggestions.resolveFeaturingArtists` (`src/preload/index.ts:135`) | `resolveFeaturingArtists` (`src/main/core/resolveFeaturingArtists.ts:65`) | Converts featured names into artist records and rewrites the song tags (`src/main/core/resolveFeaturingArtists.ts:29-45`). Same `path`/file/tag/Buffer replacement. |
| NEEDS_FS | `app/addNewPlaylist` (`src/main/ipc.ts:347`) | `playlistsData.addNewPlaylist` (`src/preload/index.ts:359`) | `addNewPlaylist` (`src/main/core/addNewPlaylist.ts:67`) | Creates a playlist and, when supplied, copies/resizes artwork (`src/main/core/addNewPlaylist.ts:1-10`). Replace transitive `fs/promises`, `path`, `fs-extra`, and `sharp` with `plugin-fs` plus browser image transforms. |
| NEEDS_FS | `app/getTierlistArtworks` (`src/main/ipc.ts:383`) | `tierlistsData.getTierlistArtworks` (`src/preload/index.ts:406`) | `getTierlistArtworks` (`src/main/core/getTierlistArtworks.ts:57`) | Checks cover files and creates 400 px cached thumbnails (`src/main/core/getTierlistArtworks.ts:1-48`). Replace `fs.existsSync`, `path`, `node:path/posix`, and `sharp` with `plugin-fs` and browser canvas/image codecs. |
| NEEDS_FS | `app/getSongGuessrRound` (`src/main/ipc.ts:407`) | `songGuessr.getRound` (`src/preload/index.ts:447`) | `getSongGuessrRound` (`src/main/core/songGuessr.ts:203`) | Selects an eligible random answer, but eligibility calls `node:fs.existsSync` (`src/main/core/songGuessr.ts:1`, `src/main/core/songGuessr.ts:49-68`); replace with `plugin-fs` or a scan-maintained existence index. |
| NEEDS_FS | `app/searchSongGuessrCandidates` (`src/main/ipc.ts:410`) | `songGuessr.searchCandidates` (`src/preload/index.ts:449`) | `searchSongGuessrCandidates` (`src/main/core/songGuessr.ts:239`) | Searches the SongGuessr index, whose rebuild validates files with `node:fs.existsSync` (`src/main/core/songGuessr.ts:106-132`); use `plugin-fs`/existence index. |
| NEEDS_FS | `app/getSongGuessrPools` (`src/main/ipc.ts:415`) | `songGuessr.getPools` (`src/preload/index.ts:455`) | `getSongGuessrPools` (`src/main/core/songGuessr.ts:273`) | Counts eligible library/playlist/genre pools; eligibility uses `node:fs.existsSync` (`src/main/core/songGuessr.ts:273-305`). |
| NEEDS_FS | `app/addArtworkToAPlaylist` (`src/main/ipc.ts:447`) | `playlistsData.addArtworkToAPlaylist` (`src/preload/index.ts:367`) | `addArtworkToAPlaylist` (`src/main/core/addArtworkToAPlaylist.ts:38`) | Removes/copies/resizes playlist artwork (`src/main/core/addArtworkToAPlaylist.ts:1-21`). Replace transitive `fs/promises`, `path`, `fs-extra`, and `sharp`. |
| NEEDS_FS | `app/resyncSongsLibrary` (`src/main/ipc.ts:467`) | `audioLibraryControls.resyncSongsLibrary` (`src/preload/index.ts:97`) | `checkForNewSongs` (`src/main/core/checkForNewSongs.ts:30`) then `sendMessageToRenderer` | Rescans watched folder structures and parses changes; replace transitive `fs/promises`/`path`/metadata access with `plugin-fs`, then emit the success message on the local bus. |
| NEEDS_FS | `app/updateSongId3Tags` (`src/main/ipc.ts:480`) | `songUpdates.updateSongId3Tags` (`src/preload/index.ts:248`) | `updateSongId3Tags` (`src/main/updateSongId3Tags.ts:921`) | Reads artwork, updates library entities, and queues/writes audio tags. Replace `path`, `fs/promises`, `Buffer`, `node-id3`, `sharp`, and native tag-writing code with `plugin-fs` plus a browser-capable tag writer; this is the highest-risk TS file-write path. |
| NEEDS_FS | `app/getSongId3Tags` (`src/main/ipc.ts:490`) | `songUpdates.getSongId3Tags` (`src/preload/index.ts:257`) | `sendSongID3Tags` (`src/main/core/sendSongId3Tags.ts:179`) | Reads tags from a known or arbitrary song path. Replace Node `path`, file-based metadata/tag readers, and Buffer handling with `plugin-fs` plus browser `music-metadata`. |
| NEEDS_FS | `app/reParseSong` (`src/main/ipc.ts:500`) | `songUpdates.reParseSong` (`src/preload/index.ts:255`) | `reParseSong` (`src/main/parseSong/reParseSong.ts:203`) | Re-reads a track and rebuilds its library metadata/artwork. Replace Node `path`, file metadata reads, artwork writes, `sharp`, and Buffer use with `plugin-fs` adapters. |
| NEEDS_FS | `app/removeAMusicFolder` (`src/main/ipc.ts:548`) | `folderData.removeAMusicFolder` (`src/preload/index.ts:315`) | `removeMusicFolder` (`src/main/core/removeMusicFolder.ts:116`) | Unlinks a folder, removes its songs, and deletes cached artwork (`src/main/removeSongsFromLibrary.ts:169-173`). Replace Node `path` and transitive `fs/promises.unlink` with `plugin-fs`. |
| NEEDS_RUST | `app/close` (`src/main/ipc.ts:117`) | `windowControls.closeApp` (`src/preload/index.ts:15`) | Electron `app.quit` | Quits the process; use Tauri window close/process exit, with cleanup on the close-request hook. |
| NEEDS_RUST | `app/minimize` (`src/main/ipc.ts:119`) | `windowControls.minimizeApp` (`src/preload/index.ts:13`) | Electron `BrowserWindow.minimize` | Native window control; use `getCurrentWindow().minimize()`. |
| NEEDS_RUST | `app/toggleMaximize` (`src/main/ipc.ts:121`) | `windowControls.toggleMaximizeApp` (`src/preload/index.ts:14`) | Electron `BrowserWindow.isMaximized/maximize/unmaximize` | Native window control; use `getCurrentWindow().toggleMaximize()` or query then maximize/unmaximize. |
| NEEDS_RUST | `app/hide` (`src/main/ipc.ts:125`) | `windowControls.hideApp` (`src/preload/index.ts:16`) | Electron `BrowserWindow.hide` | Native window control; use `getCurrentWindow().hide()`. |
| NEEDS_RUST | `app/show` (`src/main/ipc.ts:127`) | `windowControls.showApp` (`src/preload/index.ts:17`) | Electron `BrowserWindow.show` | Native window control; use `getCurrentWindow().show()`. |
| NEEDS_RUST | `app/changeAppTheme` (`src/main/ipc.ts:129`) | `theme.changeAppTheme` (`src/preload/index.ts:28`) | `changeAppTheme` (`src/main/core/changeAppTheme.ts:31`) | Reads native theme, changes native background color, persists theme, and pushes an event (`src/main/core/changeAppTheme.ts:6-28`). Use Tauri window theme APIs/events plus the TS repository. |
| NEEDS_RUST | `app/player/songPlaybackStateChange` (`src/main/ipc.ts:131`) | `playerControls.songPlaybackStateChange` (`src/preload/index.ts:35`) | `toggleAudioPlayingState` (`src/main/main.ts:377`) | Updates Windows taskbar thumbbar controls (`src/main/core/manageTaskbarPlaybackButtonControls.ts:22-63`). No official Tauri plugin: custom Rust with the `windows` crate/`ITaskbarList3`. |
| NEEDS_RUST | `app/setDiscordRpcActivity` (`src/main/ipc.ts:135`) | `playerControls.setDiscordRpcActivity` (`src/preload/index.ts:44`) | `setDiscordRpcActivity` (`src/main/other/discordRPC.ts:9`) | Talks to Discord's local IPC transport (`src/main/other/discord.ts:44-76`). Use custom Rust with a Discord Rich Presence crate such as `discord-rich-presence`; keep only payload/rate-limit logic in TS. |
| NEEDS_RUST | `app/stopScreenSleeping` (`src/main/ipc.ts:139`) | `appControls.stopScreenSleeping` (`src/preload/index.ts:510`) | `stopScreenSleeping` (`src/main/main.ts:864`) | Starts a native display-sleep blocker (`src/main/main.ts:856-867`). Use custom Rust/platform APIs (or a vetted Tauri v2 keep-awake plugin). |
| NEEDS_RUST | `app/allowScreenSleeping` (`src/main/ipc.ts:140`) | `appControls.allowScreenSleeping` (`src/preload/index.ts:512`) | `allowScreenSleeping` (`src/main/main.ts:856`) | Stops the native display-sleep blocker; same custom Rust keep-awake service. |
| NEEDS_RUST | `app/checkForStartUpSongs` (`src/main/ipc.ts:142`) | `audioLibraryControls.checkForStartUpSongs` (`src/preload/index.ts:62`) | `checkForStartUpSongs` (`src/main/core/checkForStartUpSongs.ts:43`) | Reads `process.argv`, validates an opened file, and parses it (`src/main/core/checkForStartUpSongs.ts:1-21`). File association/single-instance delivery must come from Rust state/events; parse bytes with `plugin-fs` after delivery. |
| NEEDS_RUST | `app/getStorageUsage` (`src/main/ipc.ts:197`) | `storageData.getStorageUsage` (`src/preload/index.ts:297`) | `getStorageUsage` (`src/main/core/getStorageUsage.ts:114`) | Measures Nora folders and root free/total capacity; current root-size helper uses `os` and `node:child_process` (`src/main/utils/getRootSize.ts:1-2`). Use custom Rust with `sysinfo`/`fs2`; app-directory byte counts may still use `plugin-fs`. |
| NEEDS_RUST | `app/exportStatsData` (`src/main/ipc.ts:397`) | `statsData.exportStatsData` (`src/preload/index.ts:418`) | `exportStatsData` (`src/main/core/statsTransfer/exportStats.ts:116`) | Builds JSON in TS but requires a native save dialog and file write (`src/main/core/statsTransfer/exportStats.ts:25-99`). Use `@tauri-apps/plugin-dialog` + `plugin-fs`; no custom command. |
| NEEDS_RUST | `app/importStatsData` (`src/main/ipc.ts:401`) | `statsData.importStatsData` (`src/preload/index.ts:422`) | `importStatsData` (`src/main/core/statsTransfer/importStats.ts:638`) | Requires native file/folder selection, reads/backs up files, then performs TS validation/merge (`src/main/core/statsTransfer/importStats.ts:98-117`, `src/main/core/statsTransfer/importStats.ts:486-503`). Use dialog + fs plugins. |
| NEEDS_RUST | `app/deleteSongsFromSystem` (`src/main/ipc.ts:461`) | `audioLibraryControls.deleteSongsFromSystem` (`src/preload/index.ts:104`) | `deleteSongsFromSystem` (`src/main/core/deleteSongsFromSystem.ts:59`) | Permanently deletes or moves tracks to the OS trash (`src/main/core/deleteSongsFromSystem.ts:1-41`). Use `plugin-fs.remove` for permanent deletion and custom Rust with the `trash` crate for recycle-bin semantics. |
| NEEDS_RUST | `app/getImgFileLocation` (`src/main/ipc.ts:486`) | `songUpdates.getImgFileLocation` (`src/preload/index.ts:259`) | `getImagefileLocation` (`src/main/main.ts:681`) | Opens a native image picker; use `@tauri-apps/plugin-dialog.open`. |
| NEEDS_RUST | `app/getFolderLocation` (`src/main/ipc.ts:488`) | `settingsHelpers.getFolderLocation` (`src/preload/index.ts:499`) | `getFolderLocation` (`src/main/main.ts:691`) | Opens a native directory picker; use `@tauri-apps/plugin-dialog.open({ directory: true })`. |
| NEEDS_RUST | `app/getFolderStructures` (`src/main/ipc.ts:498`) | `folderData.getFolderStructures` (`src/preload/index.ts:313`) | `getFolderStructures` (`src/main/core/getFolderStructures.ts:60`) | Opens a native folder picker, then stats/traverses selected folders (`src/main/core/getFolderStructures.ts:1-67`). Use dialog + fs plugins; keep recursive structure building in TS. |
| NEEDS_RUST | `app/resetApp` (`src/main/ipc.ts:502`) | `appControls.resetApp` (`src/preload/index.ts:506`) | `resetApp` (`src/main/main.ts:700`) | Clears WebView storage, deletes app stores/cache, and restarts/reloads (`src/main/main.ts:700-715`). Use Web Storage APIs + `plugin-fs`, then Tauri process relaunch/window reload. |
| NEEDS_RUST | `app/openLogFile` (`src/main/ipc.ts:504`) | `log.openLogFile` (`src/preload/index.ts:476`) | Electron `shell.openPath(logFilePath)` | Opens a native path; use `@tauri-apps/plugin-opener.openPath`. |
| NEEDS_RUST | `app/revealSongInFileExplorer` (`src/main/ipc.ts:506`) | `songUpdates.revealSongInFileExplorer` (`src/preload/index.ts:261`) | `revealSongInFileExplorer` (`src/main/main.ts:641`) | Resolves a song ID and reveals its file (`src/main/main.ts:641-652`). Use `@tauri-apps/plugin-opener.revealItemInDir` if available in the pinned plugin version; otherwise a tiny custom Rust reveal command. |
| NEEDS_RUST | `app/revealFolderInFileExplorer` (`src/main/ipc.ts:510`) | `folderData.revealFolderInFileExplorer` (`src/preload/index.ts:311`) | Electron `shell.showItemInFolder` | Reveals a folder in the native file manager; same opener/custom reveal path. |
| NEEDS_RUST | `app/saveArtworkToSystem` (`src/main/ipc.ts:514`) | `songUpdates.saveArtworkToSystem` (`src/preload/index.ts:263`) | `saveArtworkToSystem` (`src/main/core/saveArtworkToSystem.ts:64`) | Opens a native save dialog and transcodes/writes artwork (`src/main/core/saveArtworkToSystem.ts:32-60`). Use dialog + fs plugins and browser image codecs. **Existing mismatch:** IPC names the argument `songId`, while the handler expects an artwork path (`src/main/ipc.ts:514-516`, `src/main/core/saveArtworkToSystem.ts:32`). |
| NEEDS_RUST | `app/openInBrowser` (`src/main/ipc.ts:518`) | `settingsHelpers.openInBrowser` (`src/preload/index.ts:488`) | Electron `shell.openExternal` | Opens an external URL; use `@tauri-apps/plugin-opener.openUrl` with an allowlist. |
| NEEDS_RUST | `app/loginToLastFmInBrowser` (`src/main/ipc.ts:520`) | `settingsHelpers.loginToLastFmInBrowser` (`src/preload/index.ts:498`) | Electron `shell.openExternal` | Opens the Last.fm auth URL and depends on the registered `nora://auth` callback (`src/main/ipc.ts:520-524`). Use opener + Tauri deep-link/single-instance plugin or custom protocol Rust glue. |
| NEEDS_RUST | `app/exportAppData` (`src/main/ipc.ts:526`) | `settingsHelpers.exportAppData` (`src/preload/index.ts:494`) | `exportAppData` (`src/main/core/exportAppData.ts:153`) | Opens a directory picker and exports JSON/artwork/localStorage (`src/main/core/exportAppData.ts:44-132`). Use dialog + fs plugins; keep serialization/copy plan in TS. |
| NEEDS_RUST | `app/exportPlaylist` (`src/main/ipc.ts:530`) | `playlistsData.exportPlaylist` (`src/preload/index.ts:380`) | `exportPlaylist` (`src/main/core/exportPlaylist.ts:71`) | Opens a save dialog and writes M3U8 (`src/main/core/exportPlaylist.ts:27-43`). Use dialog + fs plugins. |
| NEEDS_RUST | `app/importAppData` (`src/main/ipc.ts:532`) | `settingsHelpers.importAppData` (`src/preload/index.ts:496`) | `importAppData` (`src/main/core/importAppData.ts:208`) | Opens a directory picker, imports stores/artwork/localStorage, and relaunches (`src/main/core/importAppData.ts:45-158`). Use dialog + fs + process plugins/APIs. |
| NEEDS_RUST | `app/importPlaylist` (`src/main/ipc.ts:534`) | `playlistsData.importPlaylist` (`src/preload/index.ts:382`) | `importPlaylist` (`src/main/core/importPlaylist.ts:160`) | Opens a file picker, reads M3U/M3U8, and mutates playlists (`src/main/core/importPlaylist.ts:48-57`). Use dialog + fs plugins; keep parsing in TS. |
| NEEDS_RUST | `app/getRendererLogs` (`src/main/ipc.ts:536`) | `log.sendLogs` (`src/preload/index.ts:460`) | `getRendererLogs` (`src/main/main.ts:725`) | Writes renderer logs and can reload/relaunch on flags (`src/main/main.ts:725-742`). Use `tauri-plugin-log` (or a scoped fs logger) plus Tauri window/process APIs. |
| NEEDS_RUST | `app/changePlayerType` (`src/main/ipc.ts:552`) | `windowControls.changePlayerType` (`src/preload/index.ts:18`) | `changePlayerType` (`src/main/main.ts:772`) | Changes native size limits, position, fullscreen, aspect ratio, and always-on-top (`src/main/main.ts:772-819`). Use Tauri window/monitor APIs; keep layout policy in TS. |
| NEEDS_RUST | `app/toggleMiniPlayerAlwaysOnTop` (`src/main/ipc.ts:554`) | `miniPlayer.toggleMiniPlayerAlwaysOnTop` (`src/preload/index.ts:481`) | `toggleMiniPlayerAlwaysOnTop` (`src/main/main.ts:718`) | Sets native always-on-top and persists the preference; use Tauri window API plus TS repository. |
| NEEDS_RUST | `app/toggleAutoLaunch` (`src/main/ipc.ts:558`) | `settingsHelpers.toggleAutoLaunch` (`src/preload/index.ts:489`) | `toggleAutoLaunch` (`src/main/main.ts:838`) | Changes OS login-item registration (`src/main/main.ts:838-851`); use `@tauri-apps/plugin-autostart`, then persist state in TS. |
| NEEDS_RUST | `app/openDevTools` (`src/main/ipc.ts:601`) | `settingsHelpers.openDevtools` (`src/preload/index.ts:491`) | Electron `webContents.openDevTools` | Native webview devtools; expose a dev-only custom Rust command calling Tauri WebviewWindow devtools APIs. |
| NEEDS_RUST | `app/restartRenderer` (`src/main/ipc.ts:609`) | `appControls.restartRenderer` (`src/preload/index.ts:504`) | `restartRenderer` (`src/main/main.ts:750`) | Fires pre-quit cleanup, reloads the webview, and normalizes the window (`src/main/main.ts:750-756`). Use the local cleanup bus plus Tauri webview/window reload control. |
| NEEDS_RUST | `app/restartApp` (`src/main/ipc.ts:614`) | `appControls.restartApp` (`src/preload/index.ts:505`) | `restartApp` (`src/main/main.ts:628`) | Saves pending work, relaunches, and exits (`src/main/main.ts:628-638`). Use Tauri process relaunch/exit APIs. |
| DIES | `app/networkStatusChange` (`src/main/ipc.ts:588`) | `settingsHelpers.networkStatusChange` (`src/preload/index.ts:492`) | inline logger only (`src/main/ipc.ts:588-595`) | The renderer already owns `navigator.onLine` and calls this only to log changes (`src/renderer/src/App.tsx:81`). With no main process to notify, log locally and delete the channel/wrapper implementation. |

### Bucket counts

| Bucket | Count | Migration transport |
|---|---:|---|
| PURE_TS | **57** | Direct TypeScript call; no IPC |
| NEEDS_FS | **20** | Direct TypeScript call using `@tauri-apps/plugin-fs`; no IPC |
| NEEDS_RUST | **36** | Tauri JS API/plugin or thin `invoke`/Rust event |
| DIES | **1** | Remove implementation |
| **Total** | **114** | Complete |

The direct-TS majority is 77/114 when `PURE_TS` and `NEEDS_FS` are combined; only 36 request channels remain Rust-backed, and many of those use official JS-facing plugins rather than custom commands.

## `window.api` shape and smallest-diff replacement

`window.api` is one global containing **32 named namespaces**, not a flat method bag. The namespace object is assembled at `src/preload/index.ts:539-571` and exposed with `contextBridge.exposeInMainWorld` at `src/preload/index.ts:574`. Examples are `window.api.audioLibraryControls.getAllSongs`, `window.api.playlistsData.addSongsToPlaylist`, and `window.api.appControls.restartApp`; `utils.path.join` is an additional third level (`src/preload/index.ts:515-536`). The global type is currently coupled to `typeof api` imported from preload (`src/types/app.d.ts:5-14`).

Smallest-diff design:

1. Move the `api` object, with the same namespace and method names, from preload into a renderer-importable module such as `src/renderer/src/api/index.ts`.
2. Before React/i18n startup, assign that exact object to `window.api`. Keep `Window['api'] = typeof api`, but change the type import away from `../preload` (`src/types/app.d.ts:5-14`).
3. A `PURE_TS`/`NEEDS_FS` wrapper calls a TS service directly. Preserve Promise return types with `Promise.resolve` where the moved function is synchronous, because current `ipcRenderer.invoke` always returns a Promise.
4. A Rust-backed wrapper calls the relevant Tauri JS API/plugin directly when one exists; use `invoke` only for custom Rust glue. Preserve the current fire-and-forget `void` signatures by explicitly discarding the Promise where renderer callers do not await it.

Concrete replacement of a real method (`getAllSongs` is currently `ipcRenderer.invoke` at `src/preload/index.ts:72-77`):

```ts
// renderer/api/index.ts
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import getAllSongs from '../services/library/getAllSongs';

const windowControls = {
  // Same public signature as src/preload/index.ts:13-17.
  minimizeApp: (): void => void getCurrentWindow().minimize(),
  closeApp: (): void => void invoke('request_app_quit')
};

const audioLibraryControls = {
  // Same Promise contract and argument order as src/preload/index.ts:72-77.
  getAllSongs: (
    sortType?: SongSortTypes,
    filterType?: SongFilterTypes,
    paginatingData?: PaginatingData
  ): Promise<PaginatedResult<AudioInfo, SongSortTypes>> =>
    Promise.resolve(getAllSongs(sortType, filterType, paginatingData))
};

export const api = {
  // Keep every key from src/preload/index.ts:539-571 unchanged.
  windowControls,
  audioLibraryControls,
  // ...the other existing namespace objects
};

Object.defineProperty(window, 'api', { value: api, configurable: false, writable: false });
```

The 311 renderer call-sites therefore remain untouched. **INFERRED:** `properties.commandLineArgs` (`src/preload/index.ts:7-10`) cannot be populated from `process.argv`; initialize it from the same Rust-held open-URL/file state used by `checkForStartUpSongs`, while `properties.isInDevelopment` becomes `import.meta.env.DEV`.

### Subscription compatibility adapter

Electron invokes listeners as `(event, ...args)`, while Tauri supplies `{ event, payload }` and `listen` resolves to an unlisten function. Preserve the old callback and separate-remove API with a callback-to-unlisten registry:

```ts
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

const tauriUnlisteners = new Map<Function, Promise<UnlistenFn>>();

function onTauri<Args extends unknown[]>(name: string, callback: (e: unknown, ...args: Args) => void) {
  const pending = listen<Args>(name, ({ payload }) => callback(undefined, ...payload));
  tauriUnlisteners.set(callback, pending);
  return undefined; // existing callers do not use ipcRenderer.on's return value
}

function offTauri(callback: Function): void {
  const pending = tauriUnlisteners.get(callback);
  if (pending) void pending.then((unlisten) => unlisten());
  tauriUnlisteners.delete(callback);
}

const theme = {
  // Exact old callback shape from src/preload/index.ts:25-31.
  listenForSystemThemeChanges: (
    callback: (e: unknown, isDark: boolean, usingSystem: boolean) => void
  ) => onTauri<[boolean, boolean]>('app/systemThemeChange', callback),
  stoplisteningForSystemThemeChanges: (callback: Function) => offTauri(callback)
};
```

For TS-originated progress/notification/data streams, avoid routing through Rust at all. A tiny typed callback bus preserves the same signature:

```ts
type LocalEvents = {
  'app/sendMessageToRendererEvent': [MessageCodes, Record<string, unknown>?];
  'app/dataUpdateEvent': [DataUpdateEvent[], string[]?, string?];
};

const localListeners = new Map<keyof LocalEvents, Set<Function>>();

export function emitLocal<K extends keyof LocalEvents>(name: K, ...args: LocalEvents[K]) {
  for (const callback of localListeners.get(name) ?? []) callback(undefined, ...args);
}
```

This directly replaces `sendMessageToRenderer` (`src/main/main.ts:388-391`) and the debounced `dataUpdateEvent` (`src/main/main.ts:394-408`) while retaining `messages.*` and `dataUpdates.*` at `src/preload/index.ts:229-244`.

## Main-to-renderer push channels

These 13 channels are not among the 114 registrations; they are the reverse-direction half of the IPC surface.

| Push channel | Current producer | Current subscription | Port mapping |
|---|---|---|---|
| `app/focused` | Window focus hook (`src/main/ipc.ts:144-147`) | `windowControls.onWindowFocus` (`src/preload/index.ts:20`) | Plain DOM `window.focus` callback or Tauri `onFocusChanged`; adapter supplies the dummy first event argument. |
| `app/blurred` | Window blur hook (`src/main/ipc.ts:148`) | `windowControls.onWindowBlur` (`src/preload/index.ts:21`) | Plain DOM `window.blur` callback or Tauri `onFocusChanged`. |
| `app/enteredFullscreen` | BrowserWindow event (`src/main/ipc.ts:150-153`) | `fullscreen.onEnterFullscreen` (`src/preload/index.ts:178-179`) | **INFERRED:** Tauri window resize/state listener that queries `isFullscreen`, then calls the existing callback; custom Rust event only if platform behavior is insufficient. |
| `app/leftFullscreen` | BrowserWindow event (`src/main/ipc.ts:154-157`) | `fullscreen.onLeaveFullscreen` (`src/preload/index.ts:180-181`) | Same Tauri window-state adapter. |
| `app/systemThemeChange` | Native-theme handler (`src/main/core/changeAppTheme.ts:20-21`) | `theme.listenForSystemThemeChanges` (`src/preload/index.ts:25-31`) | Tauri window theme event (or `matchMedia`) adapted to `[isDarkMode, usingSystemTheme]`; Rust emit only when the setting change originates in glue. |
| `app/player/skipBackward` | Windows thumbbar callback (`src/main/core/manageTaskbarPlaybackButtonControls.ts:34-36`) | `playerControls.skipBackwardToPreviousSong` (`src/preload/index.ts:41-42`) | Custom Rust thumbbar callback emits a Tauri event with no payload. |
| `app/player/toggleSongPlaybackState` | Windows thumbbar callback (`src/main/core/manageTaskbarPlaybackButtonControls.ts:49-51`) | `playerControls.toggleSongPlayback` (`src/preload/index.ts:37-38`) | Custom Rust thumbbar callback emits a Tauri event with no payload. |
| `app/player/skipForward` | Windows thumbbar callback (`src/main/core/manageTaskbarPlaybackButtonControls.ts:58-60`) | `playerControls.skipForwardToNextSong` (`src/preload/index.ts:39-40`) | Custom Rust thumbbar callback emits a Tauri event with no payload. |
| `app/beforeQuitEvent` | Quit/restart paths (`src/main/main.ts:363-370`, `src/main/main.ts:628-638`, `src/main/main.ts:750-752`) | `quitEvent.beforeQuitEvent` (`src/preload/index.ts:161-164`) | Prefer a local cleanup callback invoked before TS-requested reload/relaunch; native close uses Tauri `onCloseRequested`, prevents close until cleanup finishes, then exits. |
| `app/isOnBatteryPower` | Electron power monitor (`src/main/main.ts:383-385`) | `battery.listenForBatteryPowerStateChanges` (`src/preload/index.ts:169-173`) | Custom Rust battery watcher emits a Tauri boolean event. |
| `app/sendMessageToRendererEvent` | `sendMessageToRenderer` (`src/main/main.ts:388-391`) | `messages.getMessageFromMain` (`src/preload/index.ts:231-236`) | Plain in-process typed callback bus for TS-originated notifications/progress; Tauri event only for a message originating in Rust glue. |
| `app/dataUpdateEvent` | Debounced repository notifier (`src/main/main.ts:394-408`) | `dataUpdates.dataUpdateEvent` (`src/preload/index.ts:241-243`) | Plain in-process typed callback bus; retain the one-second coalescing behavior in TS. |
| `app/playSongFromUnknownSource` | Second-instance/open-file handling (`src/main/main.ts:610-618`) | `unknownSource.playSongFromUnknownSource` (`src/preload/index.ts:150-156`) | Rust deep-link/single-instance handler emits a Tauri event containing metadata/path only; TS parses the file via `plugin-fs`. |

## Binary/Buffer signatures and transport

`AudioPlayerData.artwork` is declared as `string | Buffer | Uint8Array` (`src/types/app.d.ts:137-155`), and `UpdateSongDataResult.updatedData` nests `AudioPlayerData` (`src/types/app.d.ts:1551-1555`). Therefore every IPC signature using either type must be treated as binary-capable even when a particular branch currently converts bytes to base64.

| Channel | Direction/signature | Evidence and actual behavior | Recommendation |
|---|---|---|---|
| `app/checkForStartUpSongs` | request/response: `AudioPlayerData \| undefined` (`src/preload/index.ts:62-63`) | Can reach `sendAudioData`, whose production branch returns the `Uint8Array` artwork unchanged (`src/main/core/sendAudioData.ts:17-21`, `src/main/core/sendAudioData.ts:73-89`). | Rust delivers only the startup path. TS reads metadata/artwork with `plugin-fs`; expose artwork through the `nora` protocol/`convertFileSrc`, never `invoke<Vec<u8>>`. |
| `app/getSong` | request/response: `AudioPlayerData` (`src/preload/index.ts:70-71`) | Directly returns embedded picture bytes in packaged builds (`src/main/core/sendAudioData.ts:17-21`, `src/main/core/sendAudioData.ts:73-89`). | Direct TS call; remove `artwork` bytes from the cross-layer DTO and use existing `artworkPath` through `nora://`/`convertFileSrc`. |
| `app/getSongFromUnknownSource` | request/response: `AudioPlayerData` (`src/preload/index.ts:152-153`) | Current unknown-only branch base64-encodes artwork (`src/main/core/sendAudioDataFromPath.ts:53-62`), but the known-path branch delegates to `sendAudioData` (`src/main/core/sendAudioDataFromPath.ts:23-29`) and can return bytes. | Direct TS + `plugin-fs`; normalize all branches to an artwork URL/path, not base64 or JSON byte arrays. |
| `app/resolveArtistDuplicates` | response: `UpdateSongDataResult \| undefined` (`src/preload/index.ts:123-127`) | Returns `updateSongId3Tags` output (`src/main/core/resolveDuplicates.ts:75-95`); updated artwork is currently base64 in returned data (`src/main/updateSongId3Tags.ts:884-897`). | Direct TS call. Keep returned metadata JSON-only and return an artwork path/version token. |
| `app/resolveSeparateArtists` | response: `UpdateSongDataResult \| undefined` (`src/preload/index.ts:129-133`) | Returns `updateSongId3Tags` output (`src/main/core/resolveSeparateArtists.ts:76-124`); binary-capable by type. | Same direct-TS/path-only DTO rule. |
| `app/resolveFeaturingArtists` | response: `UpdateSongDataResult \| undefined` (`src/preload/index.ts:135-145`) | Returns `updateSongId3Tags` output (`src/main/core/resolveFeaturingArtists.ts:29-54`); binary-capable by type. | Same direct-TS/path-only DTO rule. |
| `app/updateSongId3Tags` | response: `UpdateSongDataResult` (`src/preload/index.ts:248-254`) | Type is binary-capable; current known/unknown branches explicitly base64-encode artwork (`src/main/updateSongId3Tags.ts:725-750`, `src/main/updateSongId3Tags.ts:884-897`). | Direct TS + `plugin-fs`; do not retain base64. Return `artworkPath` and invalidate caches with `app/dataUpdateEvent`. |
| `app/playSongFromUnknownSource` | push: callback receives `AudioPlayerData` (`src/preload/index.ts:150-156`) | Second-instance handler pushes `checkForStartUpSongs()` result (`src/main/main.ts:610-618`), so a known-library path can carry the same artwork bytes as `app/getSong`. | Tauri event carries only opened path/small metadata. Parse/read in TS via `plugin-fs`; artwork loads via custom protocol. |

No other preload method has a `Buffer`, `Uint8Array`, `ArrayBuffer`, `Blob`, `AudioPlayerData`, or `UpdateSongDataResult` in its public signature (`src/preload/index.ts:1-574`). Artwork aggregation/tierlist/SongGuessr responses already return paths or strings (`src/preload/index.ts:378-379`, `src/preload/index.ts:406-407`, `src/types/song_guessr.d.ts:16-49`) and should stay that way.

## Migration implications

- Implement the renderer-side repository and local event bus first. That immediately removes 57 request channels and converts 20 more to direct functions with `plugin-fs`.
- Preserve the `api` object literally, including method argument order, Promise-vs-void behavior, callback first arguments, and explicit remove-listener methods (`src/preload/index.ts:7-574`).
- Keep only OS glue in Rust: native window/process/theme, thumbbar, Discord IPC, power/battery, autostart, dialogs/openers/trash, storage capacity, and startup/deep-link delivery. This matches the thin-glue boundary already documented at `docs/tauri-port/00-PLAN.md:63-68`.
- Treat the two existing signature mismatches (`compareEncryptedData`, `saveArtworkToSystem`) as explicit migration decisions, not accidental compatibility behavior.

# App-data compatibility audit and migration design

> Rebrand note: this report was written during the Electron→Tauri port, when the
> app was still Nora (`com.sandakannipunajith.nora`, `%APPDATA%\Nora`, `nora://`).
> The port has since become its own player, Nemora (`com.cmrdevs.nemora`,
> `%APPDATA%\Nemora`, `nemora://`, repo `Nikenmar/Nemora`). The rebrand superseded
> its in-place-upgrade framing: the bridge-export-first migration (findings 5–6,
> Option A) is gone because Electron was deleted, and Nora's profile is now a
> read-only import source rather than something migrated in place. The data
> inventory and the snapshot LevelDB fallback (Option B) remain the basis of the
> import; the rest of this report still explains why the code looks the way it does.

Date: 2026-08-11  
Scope: Electron `port/tauri-v2` source and the existing install at `%APPDATA%\Nora`  
Requirement: an in-place Electron-to-Tauri v2 upgrade must preserve every authoritative value, including upgrades which never launched a bridge Electron release.

## Ten top findings

1. All eleven application JSON files are JSON **objects**, never bare arrays; each payload is nested below a named key such as `songs`, `userData`, or `cmrStats`.
2. Eight migration-backed stores contain a sibling `__internal__.migrations.version` key added by `electron-store`/`conf`; it is metadata, not an envelope around the application payload.
3. The live files total roughly 5.3 MiB, but `song_covers/` is roughly 283 MiB and includes authoritative custom artwork, so treating that entire directory as disposable would lose data.
4. The renderer uses exactly three physical Chromium localStorage keys: `version`, `localStorage`, and `nora_song_guessr`; `localStorage` itself contains a large typed object with playback, preferences, duel, sorting, and editor state.
5. A bridge-only migration is insufficient: users who install Tauri directly over an older Electron build still need their Chromium LevelDB read without having launched an exporter first.
6. The recommended localStorage migration is bridge-export first, then a mandatory read-only, snapshot-based Chromium LevelDB fallback, with schema validation and an idempotent completion marker.
7. Tauri `appDataDir()` would resolve to `%APPDATA%\com.sandakannipunajith.nora`, not `%APPDATA%\Nora`; application stores must explicitly use `dataDir()/Nora`.
8. `palettes.json` is derived data with persistent IDs referenced by songs and genres. It must be preserved unless a coordinated referential rebuild is performed.
9. Historical Electron migrations include destructive clears/resets. Tauri must not replay them and must fail closed instead of reproducing `clearInvalidConfig: true` overwrite behavior.
10. The highest-risk silent failures are wrong-root initialization, incomplete localStorage import, selection of stale LevelDB records, destructive invalid-file recovery, and incompatible decryption of optional stored service credentials.

## Evidence and terminology

“VERIFIED (live install)” means inspected in `%APPDATA%\Nora` on a real install, 2026-08-11. Sizes are file lengths on disk, not estimated serialized object sizes. No live file was modified. “INFERRED” marks conclusions not directly demonstrated by either current code or the inspected install.

The source declares `electron-store` `^10.0.0` (`package.json:115`); the installed module is 10.0.1 (`node_modules/electron-store/package.json:2`). `electron-store` selects `app.getPath('userData')` as its default `cwd` and forwards `name` as the `conf` config name (`node_modules/electron-store/index.js:16-19`, `node_modules/electron-store/index.js:53-69`). `conf` defaults to `.json`, `clearInvalidConfig: false`, tab-indented `JSON.stringify`, and `JSON.parse` (`node_modules/conf/dist/source/index.js:41-50`, `node_modules/conf/readme.md:281-300`). Therefore every omitted option below has a known effective value:

- `cwd`: `%APPDATA%\Nora` in the current Electron application.
- `fileExtension`: `json`.
- `serialize`: `value => JSON.stringify(value, null, '\t')`.
- `clearInvalidConfig`: `false`, unless explicitly listed as `true`.

`conf` constructs a root schema of `type: object` and places the supplied store schema under `properties`; it does not set `additionalProperties: false` (`node_modules/conf/dist/source/index.js:62-73`). Unknown root keys are therefore currently accepted and must not be discarded by a replacement adapter.

## Complete JSON-store inventory

### Constructor options and resulting disk shape

All constructors are in `src/main/filesystem.ts:101-281`. “Default” below is the value of the constructor's `defaults` option. No constructor sets `cwd`, `fileExtension`, or `serialize`, so the effective values stated above apply to every row.

| File / `name` option | Default and schema | `clearInvalidConfig` | `migrations` option | Resulting top-level disk shape |
|---|---|---:|---|---|
| `songs.json` / `songs` | `{ version, songs: [] }`; `version: string|null`, `songs: array` | omitted → `false` | `beforeEachMigration`, plus `songMigrations` | `{ version, songs, __internal__ }` |
| `artists.json` / `artists` | `{ version, artists: [] }`; `version: string|null`, `artists: array` | omitted → `false` | `beforeEachMigration`, plus `artistMigrations` | `{ version, artists, __internal__ }` |
| `genres.json` / `genres` | `{ version, genres: [] }`; `version: string|null`, `genres: array` | omitted → `false` | `beforeEachMigration`, plus `genreMigrations` | `{ version, genres, __internal__ }` |
| `albums.json` / `albums` | `{ version, albums: [] }`; `version: string|null`, `albums: array` | omitted → `false` | `beforeEachMigration`, plus `albumMigrations` | `{ version, albums, __internal__ }` |
| `playlists.json` / `playlists` | `{ version, playlists: PLAYLIST_DATA_TEMPLATE }`; the template is `[History, Favorites, Rediscover]`; `version: string|null`, `playlists: array` | omitted → `false` | `beforeEachMigration`, plus `playlistMigrations` | `{ version, playlists, __internal__ }` |
| `userData.json` / `userData` | `{ version, userData: USER_DATA_TEMPLATE }`; `version: string|null`, `userData: object` | omitted → `false` | `beforeEachMigration`, plus `userDataMigrations` | `{ version, userData, __internal__ }` |
| `listening_data.json` / `listening_data` | `{ version, listeningData: [] }`; `version: string|null`, `listeningData: array` | **`true`** | `beforeEachMigration`, plus `listeningDataMigrations` | `{ version, listeningData, __internal__ }` |
| `blacklist.json` / `blacklist` | `{ version, blacklist: BLACKLIST_TEMPLATE }`, where the template is `{ songBlacklist: [], folderBlacklist: [] }`; schema is `version: string|null` and a `blacklist` object with both array properties | **`true`** | `beforeEachMigration`, plus `blacklistMigrations` | `{ version, blacklist, __internal__ }` |
| `tierlists.json` / `tierlists` | `{ version, tierlists: [] }`; `version: string|null`, `tierlists: array` | **`true`** | none | `{ version, tierlists }` |
| `cmr_stats.json` / `cmr_stats` | `{ version, cmrStats: CMR_STATS_TEMPLATE }`, where the template is `{ elo: { ratings: {}, history: [], totalDuels: 0 }, importedStatsExportIds: [], duelMatchmaking: { skippedPairs: [] } }`; schema is `version: string|null`, `cmrStats: object` | **`true`** | none | `{ version, cmrStats }` |
| `palettes.json` / `palettes` | `{ version, palettes: [] }`; `version: string|null`, `palettes: array` | omitted → `false` | none | `{ version, palettes }` |

The default templates are defined at `src/main/filesystem.ts:28-99`; the constructors and schemas are at `src/main/filesystem.ts:101-281`. `version` in every default is the package version imported at `src/main/filesystem.ts:7`. Each migration-backed constructor's `beforeEachMigration` is `(_, context) => generateMigrationMessage('<that file>', context)` (`src/main/filesystem.ts:113-235`). Note that `PALETTE_DATA_TEMPLATE` actually contains `[DEFAULT_SONG_PALETTE]`, but the palette constructor does **not** use it: it explicitly defaults `palettes` to an empty array (`src/main/filesystem.ts:99`, `src/main/filesystem.ts:267-281`).

The application-facing cache confirms the payload mappings: `SavableSongData[]`, `SavableArtist[]`, `SavableAlbum[]`, `SavableGenre[]`, `SavablePlaylist[]`, `UserData`, `SongListeningData[]`, `Blacklist`, `PaletteData[]`, `SavableTierlist[]`, and `CmrStatsData` (`src/main/filesystem.ts:288-304`). Store setters write the same wrapper properties rather than serializing payload arrays directly; for example, songs use the `songs` property (`src/main/filesystem.ts:422-432`) and palettes use `palettes` (`src/main/filesystem.ts:434-446`).

### `__internal__` semantics

`conf` reserves the literal root key `__internal__` and the migration version path `__internal__.migrations.version` (`node_modules/conf/dist/source/index.js:32-33`). With a `migrations` option, it reads the stored version (default `0.0.0`), executes applicable handlers, and stores the target project version below that path (`node_modules/conf/dist/source/index.js:358-386`). Thus:

```json
{
  "version": "3.4.5-CMR-Fork",
  "songs": ["…"],
  "__internal__": {
    "migrations": {
      "version": "3.4.5-CMR-Fork"
    }
  }
}
```

is the expected shape. `__internal__` is an extra sibling property. It does **not** wrap the payload, and there are no other electron-store envelope fields in the inspected files. The application `version` and the internal migration version are distinct values that happen to match in the current install.

The historical migration tables matter because several handlers intentionally clear data: songs (`src/main/migrations.ts:25-64`), artists (`src/main/migrations.ts:66-113`), albums (`src/main/migrations.ts:115-128`), playlists (`src/main/migrations.ts:130-143`), genres (`src/main/migrations.ts:145-158`), user data (`src/main/migrations.ts:160-205`), listening history (`src/main/migrations.ts:207-220`), and blacklist (`src/main/migrations.ts:222-235`). A Tauri adapter must treat those migrations as already consumed and must not decide to replay them from the public `version` field. Preserve `__internal__` as opaque compatibility metadata and use a separate Tauri migration marker.

### Live shapes, types, and sizes

| File | Store name | VERIFIED top-level payload shape | TypeScript payload type | Live size |
|---|---|---|---|---:|
| `albums.json` | `albums` | object: `version`, `albums[1137]`, `__internal__` | `SavableAlbum[]` | 398,591 B (~389 KiB) |
| `artists.json` | `artists` | object: `version`, `artists[594]`, `__internal__` | `SavableArtist[]` | 521,611 B (~509 KiB) |
| `blacklist.json` | `blacklist` | object: `version`, `blacklist{songBlacklist,folderBlacklist}`, `__internal__` | `Blacklist` | 175 B |
| `cmr_stats.json` | `cmr_stats` | object: `version`, `cmrStats{elo,importedStatsExportIds,duelMatchmaking}` | `CmrStatsData` | 67,672 B (~66.1 KiB) |
| `genres.json` | `genres` | object: `version`, `genres[71]`, `__internal__` | `SavableGenre[]` | 120,876 B (~118 KiB) |
| `listening_data.json` | `listening_data` | object: `version`, `listeningData[4926]`, `__internal__` | `SongListeningData[]` | 1,588,817 B (~1.52 MiB) |
| `palettes.json` | `palettes` | object: `version`, `palettes[1755]` | `PaletteData[]` | 1,323,130 B (~1.26 MiB) |
| `playlists.json` | `playlists` | object: `version`, `playlists[4]`, `__internal__` | `SavablePlaylist[]` | 7,105 B (~6.9 KiB) |
| `songs.json` | `songs` | object: `version`, `songs[1745]`, `__internal__` | `SavableSongData[]` | 1,461,415 B (~1.39 MiB) |
| `tierlists.json` | `tierlists` | object: `version`, `tierlists[1]` | `SavableTierlist[]` | 5,934 B (~5.8 KiB) |
| `userData.json` | `userData` | object: `version`, `userData{8 properties}`, `__internal__` | `UserData` | 1,494 B (~1.46 KiB) |

Type declarations are `SavableSongData` at `src/types/app.d.ts:81-102`, `PaletteData` at `src/types/app.d.ts:116-130`, `SongListeningData` at `src/types/app.d.ts:190-215`, `Blacklist` at `src/types/app.d.ts:419-422`, `UserData` at `src/types/app.d.ts:424-456`, `SavablePlaylist` at `src/types/app.d.ts:644-651`, `SavableTierlist` at `src/types/app.d.ts:677-693`, `CmrStatsData` at `src/types/app.d.ts:749-760`, and the savable genre/album/artist types at `src/types/app.d.ts:959-1012`.

VERIFIED live element shapes agree with those types: song records contain IDs, title, artists, duration, album, genres, year, favorite/artwork flags, file path, audio metadata, timestamps, and `paletteId`; palettes contain swatches and IDs; listening entries contain play/listen timing data. One serialization caveat is important: playlist and tier-list `createdDate` values are JSON strings in the live files even though the TypeScript interfaces say `Date`. The replacement adapter needs explicit disk types and the same hydration behavior at API boundaries; blindly validating them as JavaScript `Date` objects would reject valid legacy data.

`tierlists.json.bak` is 857 B in the live directory. No current source reference to that filename or `.bak` recovery was found. **INFERRED:** it is a manual or legacy backup rather than an active store. Preserve it verbatim, do not silently promote it over a valid primary, and do not let an installer or cleanup remove it.

## Chromium localStorage inventory

### Physical keys

The complete grep across `src/renderer` and `src/common` yields three physical localStorage keys:

| Physical key | Stored representation | Read/write evidence | Loss impact |
|---|---|---|---|
| `version` | package-version string | `src/renderer/src/utils/localStorage.ts:13-16`, `src/renderer/src/utils/localStorage.ts:32`, `src/renderer/src/utils/localStorage.ts:63-64`, `src/renderer/src/utils/localStorage.ts:83-84` | Makes the app treat storage as absent/outdated and may reset the composite object. |
| `localStorage` | JSON string encoding the `LocalStorage` interface | `src/renderer/src/utils/localStorage.ts:16`, `src/renderer/src/utils/localStorage.ts:63`, `src/renderer/src/utils/localStorage.ts:83`, `src/renderer/src/utils/localStorage.ts:90-105` | Loses all preferences, playback/queue resume, duel queue, sorting, ignore lists, equalizer, and lyric-editor state. |
| `nora_song_guessr` | JSON string encoding `SongGuessrPersistedState` | key constant `src/renderer/src/utils/songGuessr/constants.ts:5`; loader/writer `src/renderer/src/utils/songGuessr/persistence.ts:73-110` | Resets SongGuessr stats, streaks, distributions, mode records/history, pool, and recent answers. |

No persistent `sessionStorage` or IndexedDB API use was found under those source roots. `App.tsx` creates a runtime Blob/object URL (`src/renderer/src/App.tsx:1001-1002`), but that is not durable storage.

`resetLocalStorage()` calls `localStorage.clear()` (`src/renderer/src/utils/localStorage.ts:12-16`), so it removes the supposedly isolated SongGuessr key as well as the base two keys. `checkLocalStorage()` validates/migrates `version` and the composite value, and resets on invalid state (`src/renderer/src/utils/localStorage.ts:62-86`). Migration/import therefore must run **before** normal renderer initialization calls this function.

### Every field inside physical key `localStorage`

The root schema is declared at `src/types/app.d.ts:629-640`; its component types are at `src/types/app.d.ts:494-627`, with defaults in `src/renderer/src/other/appReducer.tsx:406-486`. The table below is the complete current leaf inventory.

| JSON path under `localStorage` | Type | What is lost if reset |
|---|---|---|
| `preferences.seekbarScrollInterval` | `number` | Seek-wheel interval preference. |
| `preferences.isSongIndexingEnabled` | `boolean` | Indexing preference. |
| `preferences.disableBackgroundArtworks` | `boolean` | Background-artwork preference. |
| `preferences.doNotShowBlacklistSongConfirm` | `boolean` | Blacklist confirmation suppression. |
| `preferences.doNotVerifyWhenOpeningLinks` | `boolean` | External-link verification preference. |
| `preferences.isReducedMotion` | `boolean` | Reduced-motion accessibility preference. |
| `preferences.showArtistArtworkNearSongControls` | `boolean` | Player artwork layout preference. |
| `preferences.showSongRemainingTime` | `boolean` | Time-display preference. |
| `preferences.noUpdateNotificationForNewUpdate` | `string` | Dismissed update-notification version. |
| `preferences.defaultPageOnStartUp` | `DefaultPages` | Startup destination. |
| `preferences.enableArtworkFromSongCovers` | `boolean` | Song-cover artwork behavior. |
| `preferences.shuffleArtworkFromSongCovers` | `boolean` | Cover shuffle preference. |
| `preferences.removeAnimationsOnBatteryPower` | `boolean` | Battery animation policy. |
| `preferences.lyricsAutomaticallySaveState` | `AutomaticallySaveLyricsTypes` | Automatic lyrics-save policy. |
| `preferences.showTrackNumberAsSongIndex` | `boolean` | Track-number display choice. |
| `preferences.allowToPreventScreenSleeping` | `boolean` | Screen-sleep prevention preference. |
| `preferences.enableImageBasedDynamicThemes` | `boolean` | Dynamic palette-theme preference. |
| `preferences.doNotShowHelpPageOnLyricsEditorStartUp` | `boolean` | Lyrics editor onboarding state. |
| `preferences.autoTranslateLyrics` | `boolean` | Automatic lyric translation preference. |
| `preferences.autoConvertLyrics` | `boolean` | Automatic lyric conversion preference. |
| `preferences.tierShuffleIntensity` | optional `number` | Smart/Tier Shuffle intensity resets to the default `0.6`; reads/writes occur at `src/renderer/src/App.tsx:400-402`, `src/renderer/src/App.tsx:1146-1148`, and `src/renderer/src/App.tsx:1258-1260`. |
| `playback.currentSong.songId` | `string|null` | Current/resumable song identity. |
| `playback.currentSong.stoppedPosition` | `number` | Resume position. |
| `playback.currentSong.playlistId` | optional `string` | Playlist context for current song. |
| `playback.isRepeating` | `RepeatTypes` | Repeat mode. |
| `playback.isShuffling` | `boolean` | Shuffle mode. |
| `playback.isTierShuffling` | optional `boolean` | Smart/Tier Shuffle enabled state. |
| `playback.volume.isMuted` | `boolean` | Mute state. |
| `playback.volume.value` | `number` | Volume level. |
| `playback.playbackRate` | `number` | Playback speed. |
| `queue.currentSongIndex` | `number|null` | Queue cursor. |
| `queue.queue` | `string[]` | Queued song IDs. |
| `queue.queueBeforeShuffle` | optional `number[]` | Pre-shuffle ordering needed to undo shuffle. |
| `queue.queueId` | optional `string` | Queue identity/context. |
| `queue.queueType` | `QueueTypes` | Queue source/type. |
| `ignoredSeparateArtists` | `string[]` | Artists dismissed from “separate artist” cleanup. |
| `ignoredSongsWithFeatArtists` | `string[]` | Songs dismissed from featuring-artist cleanup. |
| `ignoredDuplicates.artists` | `string[]` | Artist duplicate suppressions. |
| `ignoredDuplicates.albums` | `string[]` | Album duplicate suppressions. |
| `ignoredDuplicates.genres` | `string[]` | Genre duplicate suppressions. |
| `sortingStates.songsPage` | optional `SongSortTypes` | Song list sort. |
| `sortingStates.artistsPage` | optional `ArtistSortTypes` | Artist list sort. |
| `sortingStates.playlistsPage` | optional `PlaylistSortTypes` | Playlist list sort. |
| `sortingStates.albumsPage` | optional `AlbumSortTypes` | Album list sort. |
| `sortingStates.genresPage` | optional `GenreSortTypes` | Genre list sort. |
| `sortingStates.musicFoldersPage` | optional `FolderSortTypes` | Folder list sort. |
| `sortingStates.tierlistsPage` | optional `TierlistSortTypes` | Tier-list sort. |
| `equalizerPreset.thirtyTwoHertzFilter` | `number` | 32 Hz equalizer gain. |
| `equalizerPreset.sixtyFourHertzFilter` | `number` | 64 Hz equalizer gain. |
| `equalizerPreset.hundredTwentyFiveHertzFilter` | `number` | 125 Hz equalizer gain. |
| `equalizerPreset.twoHundredFiftyHertzFilter` | `number` | 250 Hz equalizer gain. |
| `equalizerPreset.fiveHundredHertzFilter` | `number` | 500 Hz equalizer gain. |
| `equalizerPreset.thousandHertzFilter` | `number` | 1 kHz equalizer gain. |
| `equalizerPreset.twoThousandHertzFilter` | `number` | 2 kHz equalizer gain. |
| `equalizerPreset.fourThousandHertzFilter` | `number` | 4 kHz equalizer gain. |
| `equalizerPreset.eightThousandHertzFilter` | `number` | 8 kHz equalizer gain. |
| `equalizerPreset.sixteenThousandHertzFilter` | `number` | 16 kHz equalizer gain. |
| `lyricsEditorSettings.offset` | `number` | Lyrics timing offset. |
| `lyricsEditorSettings.editNextAndCurrentStartAndEndTagsAutomatically` | `boolean` | Lyrics automatic edit mode. |
| `duels.frequency` | `DuelInviteFrequency` (`'off'|'rare'|'normal'|'frequent'`) | Duel invitation cadence preference. |
| `duels.lastInviteAt` | `number` | Legacy last-earned-duel timestamp. |
| `duels.listensSinceInvite` | `number` | Invitation scheduling counter. |
| `duels.pendingDuels` | `number` | Pending-duel count. |
| `duels.pendingDuelTickets` | `DuelTicket[]` | Earned but unvoted duel tickets. |
| `duels.pendingDuelTickets[].anchorSongId` | `string` | Anchor identity for each earned ticket. |
| `duels.pendingDuelTickets[].earnedAt` | `number` | Ticket chronology. |
| `duels.duelAnchorCandidates` | `DuelAnchorCandidate[]` | Pair-generation continuity. |
| `duels.duelAnchorCandidates[].songId` | `string` | Candidate song identity. |
| `duels.duelAnchorCandidates[].listenedAt` | `number` | Candidate listen chronology. |
| `duels.pendingDuelPairs` | `[string,string][]` | Legacy earned pairs pending conversion. |

The sort unions are declared at `src/types/app.d.ts:1296-1354`, queue state at `src/types/app.d.ts:357-374`, and duel persistence at `src/types/app.d.ts:930-955`. `duels.pendingDuelPairs` remains a compatibility input: `src/renderer/src/utils/duelQueue.ts:6-23` converts legacy pairs to tickets and clears the old list. Losing either representation can silently discard earned, unvoted comparisons.

`preferences.isPredictiveSearchEnabled` was a historical field, not a current `Preferences` member. The 3.4.5 localStorage migration explicitly deletes it (`src/renderer/src/other/localStorageMigrations.ts:9-18`). Its loss has no current feature impact, but the importer must accept old objects containing it and allow the normal migration to remove it rather than reject or reset the entire object.

`SongGuessrPersistedState` is declared at `src/types/song_guessr.d.ts:106-113`, with statistics and records at `src/types/song_guessr.d.ts:69-104`. Its loader validates the stored version/state and substitutes defaults for malformed data (`src/renderer/src/utils/songGuessr/persistence.ts:66-101`). An exact string export/import is preferable to parse-and-reserialize so unknown compatible fields survive.

VERIFIED (live install): `Local Storage\leveldb` occupies 248,953 B. Raw SSTable inspection found the known keys and multiple historical values, which is normal for an append/compaction database. The running Electron process held `LOCK`. This proves a fallback cannot scan strings or select a textual “last occurrence”; it must understand manifests, sequence numbers, tombstones, origin/storage-key prefixes, and Chromium value encoding.

## localStorage migration options

### Option A — final Electron bridge export

Implement in the last Electron release:

1. In the renderer, capture the exact string values returned by `getItem('version')`, `getItem('localStorage')`, and `getItem('nora_song_guessr')`, including `null` if absent.
2. Send the values to the trusted main process and validate them there.
3. Write `%APPDATA%\Nora\localstorage-bridge.v1.json` using same-directory temporary-file + flush/close + atomic rename.
4. Include `formatVersion`, `sourceAppVersion`, `exportedAt`, the three exact strings, and a checksum over a canonical payload.
5. On first Tauri launch, validate the checksum and payload schemas, call WebView2 `localStorage.setItem` for each present key before application initialization, read them back, and only then mark the import complete.

The existing export is not sufficient. It exports the parsed composite `LocalStorage` value only (`src/main/core/exportAppData.ts:98-102`) and therefore omits `version` as an exact value and omits `nora_song_guessr`. Existing import likewise reads only `localStorageData.json` as the composite object (`src/main/core/importAppData.ts:136-145`). The JSON files and artwork export path are handled elsewhere in that flow (`src/main/core/exportAppData.ts:47-132`, `src/main/core/importAppData.ts:89-99`).

Advantages: the owning Chromium engine interprets its own database, so this is the safest and easiest-to-test route. Disadvantage: it cannot help a user who never launches that final Electron version. Consequently this is the preferred fast path but cannot be the only path.

### Option B — direct, read-only Chromium LevelDB recovery

Chromium's current DOM-storage implementation uses a LevelDB-backed local-storage schema with encoded storage keys and metadata records; this is an implementation detail, not a stable interchange format. See Chromium's [DOM storage LevelDB source directory](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/components/services/storage/dom_storage/leveldb/) and [current local-storage database implementation](https://chromium.googlesource.com/chromium/src/+/5980162e8b05f062c896d01bad07686a1813d976/components/services/storage/dom_storage/leveldb/local_storage_leveldb.cc).

Candidate Rust readers exist, but none supplies “Chromium localStorage import” as a safe high-level operation:

- [`rusty-leveldb` 4.0.1](https://docs.rs/rusty-leveldb/latest/rusty_leveldb/) is pure Rust and LevelDB-compatible, but its own documentation cautions against relying on it for valuable data.
- [`leveldb` 0.8.6](https://docs.rs/leveldb/0.8.6/leveldb/) binds native LevelDB. It can interpret database state on a snapshot, but adds a C++ dependency and still does not decode Chromium DOM-storage keys/values.
- [`leveldb_core` 0.1.0](https://docs.rs/leveldb-core/latest/leveldb_core/) is read-only and can enumerate tables without taking the normal database lock, but exposes raw superseded/deleted records. Production code would still need correct sequence/tombstone reconstruction and its maturity is low.

Required safe procedure:

1. Ensure Electron is fully stopped. Never open the user's source LevelDB writable.
2. Copy the **entire** `Local Storage\leveldb` directory, including `CURRENT`, manifest, log, and table files, to an application-owned temporary snapshot. A live arbitrary file-by-file copy is not accepted as consistent.
3. Use a version-pinned LevelDB implementation against the snapshot. Decode the Chromium schema for the Electron/Chromium versions supported by Nora.
4. Select only the production renderer origin/storage key. Production loads a packaged file while development loads a URL (`src/main/main.ts:185-189`); importing a development-origin record would be wrong.
5. Resolve current values using LevelDB sequence numbers and tombstones. Extract only the three expected physical keys.
6. Validate `version`, `LocalStorage`, and `SongGuessrPersistedState` with TypeScript-compatible validators before placing them in WebView2 localStorage.
7. Compare read-back values/checksums and retain the untouched Electron database for rollback.
8. If the database/schema is unsupported or validation fails, stop with a recoverable migration error. Do not initialize defaults over it.

This native code is bounded migration plumbing, not a Rust rewrite of business logic. The schema validators and all continuing application behavior remain TypeScript. Production acceptance must compare the fallback result byte-for-byte with an Electron renderer bridge reading the same version-pinned fixture after updates, deletes, and compactions.

### Option C — declare Chromium state non-critical

This option is incompatible with the stated zero-loss requirement. It preserves the JSON library, listening history, ELO statistics, and tier lists, but loses:

- current song, stopped position, queue, shuffle/repeat, volume, playback rate, and equalizer;
- all preferences, accessibility state, sorting, ignored-duplicate decisions, and lyrics-editor settings;
- Smart/Tier Shuffle intensity and enabled state;
- duel invitation state plus earned pending tickets/pairs;
- all SongGuessr statistics, streaks, records/history, pool, and recent-answer state.

Calling this “non-critical” would be a product-policy exception, not full compatibility.

### Recommendation and direct-upgrade behavior

Use **A first, B as a mandatory fallback**:

```text
bridge file valid ──yes──> import exact values ─┐
       │ no                                     │
       v                                        v
legacy LevelDB exists ─yes─> snapshot + decode + validate
       │ no                                     │
       v                                        v
genuinely new install                    read back + checksum
                                                │
                                                v
                                      commit migration marker
```

The Tauri first-run bootstrap must complete this decision before normal renderer storage checks. A user who installs over an old build without launching a bridge goes through the LevelDB fallback. A user with neither bridge nor legacy database is a genuine new install and may receive defaults. A user with an unreadable legacy database is **not** a new install and must see a retry/recovery path.

Store an idempotent marker such as `%APPDATA%\Nora\tauri-migration-v1.json` only after all JSON audits and all three localStorage keys have either been imported or proved absent in a valid source database. Record source hashes, selected path (`bridge` or `leveldb`), destination checksums, application versions, and timestamp. Never delete the bridge, source LevelDB, or Electron JSON during migration.

## Non-JSON and adjacent persistence

| Path | Writer / naming | Authority | Required handling |
|---|---|---|---|
| `song_covers/` | Artwork code creates the directory and writes `<id>.webp` plus `<id>-optimized.webp` (`src/main/other/artworks.ts:38-68`, `src/main/other/artworks.ts:78-102`). Tier-list thumbnails are lazily generated as `<id>-tl.webp` (`src/main/core/getTierlistArtworks.ts:9-46`). Resolution uses song/playlist IDs (`src/main/core/resolveFilePaths.ts:50-74`, `src/main/core/resolveFilePaths.ts:155-179`). | Mixed. Full/optimized files include metadata-derived song covers **and authoritative custom playlist artwork**. `-tl` is derived. | Preserve the entire directory in place. It need not be copied when the app keeps the same root. Regenerate missing `-optimized`/`-tl` files lazily, but never bulk-delete full images. |
| `blob_storage/` | No application source reference found. The only Blob usage found is an in-memory object URL (`src/renderer/src/App.tsx:1001-1002`). | **INFERRED:** Chromium-managed ephemeral backing data. Live directory is empty apart from one empty GUID directory. | Tauri may ignore it, but leave it untouched for Electron rollback. Do not count it as migrated authoritative state. |
| `palettes.json` | Palette extraction creates swatches and IDs, then writes `paletteId` references into songs/genres (`src/main/utils/generatePalette.ts:17-95`, `src/main/utils/generatePalette.ts:98-145`, `src/main/utils/generatePalette.ts:149-209`). | Derived pixels, but persistent referential IDs. | Preserve exactly. Regeneration is safe only as a coordinated transaction that rebuilds palettes and all referring song/genre IDs. |
| `logs/` | Logger joins `app.getPath('userData')` with `logs` and emits daily `YYYY-MM-DD.dev.log.txt` / `.prod.log.txt` files (`src/main/logger.ts:41-57`, `src/main/logger.ts:73-81`). | Diagnostic, non-authoritative. | May be ignored by business-data migration; leave old logs intact and optionally continue new Tauri logs in the same directory. |
| `Local Storage/leveldb/` | Chromium localStorage backend. | Authoritative for the three keys above until verified import. | Preserve and read only through bridge/snapshot fallback. Never delete on success; retain for rollback. |
| `Session Storage/`, `Preferences`, `Local State` | Chromium runtime profile data; no application `sessionStorage` use was found. | **INFERRED:** not Nora business state, except possible browser/runtime preferences. | Tauri may ignore; preserve in place for rollback. Do not migrate blindly into WebView2's profile. |
| `tierlists.json.bak` | No current writer/reference found. | **INFERRED:** user/legacy recovery copy. | Preserve verbatim; never silently delete or overwrite. |

VERIFIED (live install): `song_covers/` is 297,187,498 B with 3,962 WebP files: 1,737 full, 1,740 `-optimized`, 301 `-tl`, and 184 `-md`. No current source reference to `-md` was found, so those are **INFERRED** legacy cache variants; keeping them is safest. The export/import implementation already recognizes `song_covers` as transferable (`src/main/core/exportAppData.ts:108-132`, `src/main/core/importAppData.ts:89-99`). Logs occupy roughly 9.68 MiB in the inspected install.

## Exact app-data path compatibility

### Every active derivation

| Location | Purpose |
|---|---|
| `src/main/filesystem.ts:25` | `song_covers` root. |
| `node_modules/electron-store/index.js:16-19`, `node_modules/electron-store/index.js:53-69` | Default `cwd` for all eleven stores. |
| `src/main/resetAppData.ts:17`, `src/main/resetAppData.ts:28-40` | Reset/deletion targets. |
| `src/main/other/artworks.ts:159-173` | Temporary artwork directory. |
| `src/main/core/exportAppData.ts:28-29` | Export source root. |
| `src/main/core/getStorageUsage.ts:11-40` | Storage-usage traversal. |
| `src/main/core/statsTransfer/importStats.ts:487-500` | Stats-transfer backup/source paths. |
| `src/main/logger.ts:42` | Log directory. |

`src/main/main.ts:294` contains a commented `crashDumps` path and is not an active derivation. No active `app.setPath('userData', ...)` was found.

The current reset routine deletes songs, artists, albums, genres, playlists, user data, listening data, blacklist, and `song_covers`, but not palettes, tier lists, CMR stats, browser profile data, or logs (`src/main/resetAppData.ts:6-17`, `src/main/resetAppData.ts:28-40`). That behavior should be preserved or changed only as an explicit product decision; a Tauri “reset all app data” that recursively removes the legacy root would be materially more destructive.

Electron's identity is `appId: com.sandakannipunajith.nora`, `productName: Nora`, and `executableName: Nora` (`electron-builder.yml:1-3`). Electron has consequently used the product-name folder `%APPDATA%\Nora`.

Tauri's `identifier` is used for system configuration including the bundle identifier and webview data directory, while `productName` is only the product name ([Tauri v2 config reference](https://v2.tauri.app/reference/config/)). Tauri `appDataDir()` is `${dataDir}/${identifier}`, and on Windows `dataDir()` is Roaming AppData ([Tauri v2 path reference](https://v2.tauri.app/reference/javascript/api/namespacepath/#appdatadir)). Therefore this identity should remain:

```json
{
  "productName": "Nora",
  "identifier": "com.sandakannipunajith.nora",
  "mainBinaryName": "Nora"
}
```

but stores must **not** use `appDataDir()` or `BaseDirectory.AppData`. Those resolve to:

```text
%APPDATA%\com.sandakannipunajith.nora
```

and would silently orphan `%APPDATA%\Nora`. In renderer TypeScript, resolve the legacy root explicitly:

```ts
import { dataDir, join } from '@tauri-apps/api/path';

const legacyNoraRoot = await join(await dataDir(), 'Nora');
```

The plugin-fs capability must scope that exact root. The minimum final permission set depends on which adapter operations are implemented, but the path and access boundary must be explicit, for example:

```json
{
  "identifier": "main",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "path:default",
    "fs:allow-exists",
    "fs:allow-read-text-file",
    "fs:allow-write-text-file",
    "fs:allow-read-file",
    "fs:allow-write-file",
    "fs:allow-read-dir",
    "fs:allow-mkdir",
    "fs:allow-stat",
    "fs:allow-rename",
    "fs:allow-remove",
    {
      "identifier": "fs:scope",
      "allow": [
        { "path": "$DATA/Nora" },
        { "path": "$DATA/Nora/**" }
      ]
    }
  ]
}
```

Use only permissions actually required by the final adapter, but do not broaden the scope above `$DATA/Nora`. Tauri's [plugin-fs documentation](https://v2.tauri.app/plugin/file-system/) documents capability scopes and path variables.

Setting Tauri's identifier to `Nora` would make the derived directory superficially match, but would discard the reverse-domain bundle ID and diverge from the existing application identity. Do not use that workaround. Also do not force the WebView2 user-data/profile directory to `%APPDATA%\Nora`; keep WebView2's identifier-derived profile separate from the legacy Electron profile and deliberately import only the three supported localStorage keys.

Every former `app.getPath('userData')` consumer must receive `legacyNoraRoot`, including stores, artwork, usage reporting, transfer backups, reset behavior, and logs. Centralize this resolution in one module; otherwise one forgotten consumer will split state between two roots.

## JSON adapter and transaction design

Do not substitute Tauri plugin-store directly for electron-store files: a different file layout, wrapper, or metadata policy would break compatibility. Implement a TypeScript repository using plugin-fs with these rules:

1. Resolve `%APPDATA%\Nora` explicitly and canonicalize it before any read or write.
2. First launch begins with a read-only audit of every present file: parse JSON, check expected wrapper/payload types, retain unknown root and nested fields, and compute SHA-256 hashes/counts.
3. Existing but invalid data is a migration error, not evidence of a new install. Never create defaults over an unreadable/truncated file.
4. Preserve `version` and `__internal__` exactly. Store Tauri migration state in a separate marker; never invoke historical Electron handlers.
5. Model disk dates as their serialized strings and hydrate only at the established TypeScript boundary.
6. For writes, serialize a complete new object to a same-directory temporary file, flush and close it, then atomically replace the destination. Keep a first-write backup/manifest with the source hash.
7. Preserve unknown fields during ordinary mutations to support rollback and forward compatibility.
8. Prevent concurrent Electron and Tauri writes using installer shutdown plus a process/single-instance migration lock.
9. Mark migration complete only after JSON hashes/counts, artwork inventory, and WebView localStorage read-back all pass.

The optional `UserData.customMusixmatchUserToken` and `lastFmSessionData` fields are declared at `src/types/app.d.ts:424-455`. Current encryption is AES-256-CBC with a random 16-byte IV, a `scryptSync(secret, 'salt', 32)` key, and concatenated hex IV/ciphertext (`src/main/utils/safeStorage.ts:5-18`, `src/main/utils/safeStorage.ts:26-38`). Last.fm writes the encrypted session key at `src/main/auth/manageLastFmAuth.ts:40`; lyrics and Last.fm paths decrypt stored values before use. VERIFIED: neither optional secret exists in the inspected live `userData.json`. **INFERRED risk:** Web Crypto lacks native scrypt, so a browser-only replacement must use a tested TypeScript/WASM implementation or narrowly scoped native crypto glue while preserving the exact byte format. Never discard a field merely because the new runtime cannot decrypt it yet.

## Ranked silent-compatibility risks and detection tests

| Rank | Risk | Concrete detection / release-gate test |
|---:|---|---|
| 1 | Wrong Tauri base directory initializes an empty library under the identifier folder and appears to “lose” everything. | Seed unique sentinels in all 11 files under `%APPDATA%\Nora`, launch an upgrade, and assert the adapter's canonical root plus every pre-launch hash/count. Fail if `%APPDATA%\com.sandakannipunajith.nora\songs.json` is created. |
| 2 | Bridge-only or partial localStorage migration drops direct-upgrade users, SongGuessr, or one nested composite field. | Build a fixture with a non-default value in every leaf plus all three physical keys; install Tauri directly without launching the bridge and compare normalized destination values field-for-field and the SongGuessr string exactly. |
| 3 | A LevelDB fallback selects stale/superseded data, ignores a tombstone, or reads the dev origin. | In each supported Electron version, repeatedly update/delete all three keys, include a dev-origin database, force compaction, then compare fallback output byte-for-byte with `getItem()` inside that Electron runtime. |
| 4 | Invalid-file handling or premature defaults overwrite recoverable data, especially the four old `clearInvalidConfig: true` stores. | On a cloned profile, truncate/corrupt each file in turn. Assert Tauri stops with recovery guidance, leaves all source hashes unchanged, and never emits a default replacement or migration marker. |
| 5 | Non-atomic or concurrent writes produce zero-byte/mixed JSON after crash, power loss, Electron overlap, antivirus, or disk-full conditions. | Fault-inject termination at temp-write/flush/rename/marker phases and simulate read-only/disk-full. On restart, require either the complete old or new file; launch Electron concurrently and require migration to block without source mutation. |
| 6 | Optional encrypted Musixmatch/Last.fm credentials cannot be decrypted after the Node removal. | Generate golden legacy ciphertext fixtures using the existing helper, verify exact plaintext in the new implementation, then round-trip new ciphertext through the old decryptor. Include non-ASCII secrets and preserve opaque values on failure. |
| 7 | `song_covers/` or `palettes.json` is classified as disposable cache, losing custom playlist art or leaving dangling palette IDs. | Fixture custom playlist covers and non-default dynamic themes; compare every source artwork hash and assert each song/genre `paletteId` resolves after migration. Exercise lazy regeneration only for deliberately removed derived variants. |
| 8 | Replacement serialization strips `__internal__`, unknown future fields, explicit versions, or nested optional data and accidentally retriggers destructive migration logic. | Inject unknown root/nested sentinels into every store, mutate one known field through the adapter, and assert all sentinels plus both version fields survive. Assert no historical migration handler is called. |
| 9 | `Date` declarations cause valid legacy playlist/tier-list date strings to be rejected or semantically changed. | Use timezone-boundary and fractional-second fixtures, round-trip them, and assert byte-equivalent serialized dates plus identical sorting/display behavior. |
| 10 | Renderer initialization calls `checkLocalStorage()` before migration; its recovery path calls `localStorage.clear()` and erases SongGuessr. | Instrument startup ordering. Start with only a valid legacy database, require import/read-back before app initialization, and assert `nora_song_guessr` remains after `checkLocalStorage()`. |
| 11 | Installer/uninstaller cleanup removes the legacy Electron profile, backups, or rollback state. | Snapshot the entire `%APPDATA%\Nora` tree, run upgrade/uninstall/rollback scenarios, and assert old JSON, `.bak`, LevelDB, Preferences, Local State, and unsupported files are untouched unless the user explicitly requests deletion. |
| 12 | Path handling fails for non-ASCII usernames, long paths, separators, or case. | Run the full migration in a Windows account with non-ASCII characters and long artwork/music paths; assert canonical root and content hashes. |
| 13 | Migration is retried after a crash and duplicates/replaces data non-idempotently. | Crash before and after destination import and before marker rename, relaunch repeatedly, and assert stable counts/hashes with exactly one committed marker. |
| 14 | Nonstandard version string `3.4.5-CMR-Fork` is coerced or rejected as strict SemVer. | Test current and older real version strings as opaque persisted values. Never use the application `version` as the new migration transaction state. |
| 15 | Storage-usage, reset, export/import, artwork, or logging code uses a different root after the primary store adapter is fixed. | Integration-test every consumer in the path table and assert no Nora business-data file is created under the identifier-derived directory. Reset tests must operate only on an explicitly confirmed canonical legacy root. |

## Production acceptance criteria

The port is persistence-compatible only when all of the following are true:

- An unchanged real-profile clone opens with identical library counts, listening records, statistics, tier lists, user settings, and artwork.
- All three renderer localStorage keys survive both a bridge upgrade and a direct pre-bridge upgrade.
- Every JSON and source LevelDB file remains available for Electron rollback, with pre-migration hashes recorded.
- Corrupt, locked, unsupported, or partially copied sources fail closed and never become “new install” defaults.
- Re-running migration after any injected interruption is idempotent.
- No Nora business-data file is created under `%APPDATA%\com.sandakannipunajith.nora`.
- Golden tests prove legacy encrypted optional credentials remain usable.
- The installer does not delete `%APPDATA%\Nora`, and Tauri never points WebView2 at the old Electron profile wholesale.

Until the direct LevelDB fixture tests pass for every shipped Electron/Chromium version in the upgrade window, the zero-data-loss requirement is not satisfied even if the bridge path works.

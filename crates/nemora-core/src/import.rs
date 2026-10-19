//! One-way import of a Nemora 1.x profile (vault plan PLAN/05-import.md).
//!
//! Read-only on the source: the JSON stores are never written, so 1.1.9 keeps working and a manual
//! rollback stays possible. Idempotent: importing the same profile again changes nothing, because
//! day counters merge by maximum and documents are replaced by the same content.
//!
//! The library must be scanned first: an old song is found again by its file path, then by its
//! fingerprint. History whose file is not in the library becomes a pending record that is
//! re-attached when the file appears.

use std::collections::{BTreeMap, HashMap};
use std::path::Path;

use rusqlite::{OptionalExtension, Transaction, params};
use serde_json::{Value, json};

use crate::db::{Db, now_ms};
use crate::error::{Error, Result};
use crate::time::parse_iso_ms;

const SOURCE: &str = "nemora-1.x";

/// Playlists 1.x kept for itself: favourites are hearts, history is the play log, Rediscover is
/// computed. None of them is a user playlist.
const SYSTEM_PLAYLISTS: &[&str] = &["Favorites", "History", "Rediscover"];

/// Device setting: when 1.x created its system playlists, `{playlistId: ms}`.
pub const SYSTEM_CREATED: &str = "playlists.systemCreated";

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct ImportReport {
    pub old_songs: usize,
    pub songs_by_path: usize,
    pub songs_by_fingerprint: usize,
    pub pending: usize,
    pub favorites: usize,
    pub playlists: usize,
    pub playlist_items: usize,
    pub playlist_items_pending: usize,
    pub listening_days: usize,
    pub listens_l: i64,
    pub listens_f: i64,
    pub listens_s: i64,
    pub ratings: usize,
    pub ratings_unmapped: usize,
    pub duels: usize,
    pub duels_unmapped: usize,
    pub tierlists: usize,
    pub tier_items_pending: usize,
    pub blacklisted_songs: usize,
}

/// (source id, day, song, pending record) of an imported day counter.
type DayKey = (String, String, Option<String>, Option<i64>);
/// l, f, s and the hour histogram of one imported day.
type DayCounts = (i64, i64, i64, BTreeMap<String, i64>);

/// What an old song id resolves to.
#[derive(Debug, Clone)]
pub(crate) enum Target {
    Song(String),
    Pending(i64),
}

pub(crate) struct Fingerprint {
    pub(crate) title: Option<String>,
    pub(crate) artists: Vec<String>,
    pub(crate) duration_ms: Option<i64>,
    pub(crate) file_name: Option<String>,
}

pub(crate) struct LibraryIndex {
    by_uri: HashMap<String, String>,
    by_uri_folded: HashMap<String, String>,
    /// file name (lower case) -> [(song_id, duration_ms)]
    by_file_name: HashMap<String, Vec<(String, i64)>>,
    /// title (lower case) -> [(song_id, sorted lower-case artists, duration_ms)]
    by_title: HashMap<String, Vec<(String, Vec<String>, i64)>>,
}

pub fn import_nemora_1x(db: &mut Db, profile: &Path) -> Result<ImportReport> {
    let songs = read_store(profile, "songs.json", "songs")?;
    let playlists = read_store(profile, "playlists.json", "playlists")?;
    let events = read_store(profile, "listening_events.json", "listeningEvents")?;
    let cmr = read_optional_store(profile, "cmr_stats.json", "cmrStats")?;
    let tierlists = read_optional_store(profile, "tierlists.json", "tierlists")?;
    let blacklist = read_optional_store(profile, "blacklist.json", "blacklist")?;
    let user_data = read_optional_store(profile, "userData.json", "userData")?;

    let device_id = db.device_id()?;
    let now = now_ms();
    let library = library_index(db)?;
    let mut report = ImportReport::default();

    let tx = db.conn_mut().transaction()?;
    let mut resolver = Resolver { tx: &tx, library: &library, cache: HashMap::new(), source: SOURCE };

    // Old songs: id -> fingerprint and path.
    let mut old_songs: HashMap<String, (Fingerprint, Option<String>)> = HashMap::new();
    for song in songs.as_array().into_iter().flatten() {
        let Some(id) = song["songId"].as_str() else { continue };
        let path = song["path"].as_str().map(str::to_owned);
        old_songs.insert(id.to_owned(), (fingerprint_of_song(song), path));
    }
    // Fingerprints of deleted songs survive in the counter store.
    let event_tracks = events["tracks"].as_object().cloned().unwrap_or_default();
    for fp in event_tracks.values() {
        if let Some(id) = fp["songId"].as_str() {
            old_songs.entry(id.to_owned()).or_insert_with(|| (fingerprint_of_event(fp), None));
        }
    }
    report.old_songs = old_songs.len();

    let mut targets: HashMap<String, Target> = HashMap::new();
    for (id, (fp, path)) in &old_songs {
        let target = resolver.resolve(id, fp, path.as_deref(), &mut report)?;
        targets.insert(id.clone(), target);
    }
    let target_of = |id: &str| targets.get(id).cloned();

    // Hearts.
    let mut hearts: Vec<String> = songs
        .as_array()
        .into_iter()
        .flatten()
        .filter(|s| s["isAFavorite"].as_bool() == Some(true))
        .filter_map(|s| s["songId"].as_str().map(str::to_owned))
        .collect();
    if let Some(fav) = playlists.as_array().into_iter().flatten().find(|p| p["playlistId"] == "Favorites") {
        hearts.extend(fav["songs"].as_array().into_iter().flatten().filter_map(|v| v.as_str().map(str::to_owned)));
    }
    for id in hearts {
        if let Some(Target::Song(song_id)) = target_of(&id) {
            report.favorites += tx.execute(
                "INSERT INTO favorites (song_id, value, updated_at, updated_by) VALUES (?1, 1, ?2, ?3)
                 ON CONFLICT(song_id) DO NOTHING",
                params![song_id, now, device_id],
            )?;
        }
    }

    // User playlists keep their 1.x ids, so tierlists that name them as sources still point right.
    for playlist in playlists.as_array().into_iter().flatten() {
        let Some(id) = playlist["playlistId"].as_str() else { continue };
        if SYSTEM_PLAYLISTS.contains(&id) {
            continue;
        }
        let created = playlist["createdDate"].as_str().and_then(parse_iso_ms).unwrap_or(now);
        tx.execute(
            "INSERT INTO playlists (playlist_id, name, created_at, updated_at, updated_by)
             VALUES (?1, ?2, ?3, ?3, ?4)
             ON CONFLICT(playlist_id) DO UPDATE SET name = excluded.name",
            params![id, playlist["name"].as_str().unwrap_or(id), created, device_id],
        )?;
        tx.execute("DELETE FROM playlist_items WHERE playlist_id = ?1", [id])?;
        for (position, song) in playlist["songs"].as_array().into_iter().flatten().filter_map(Value::as_str).enumerate()
        {
            let target = match target_of(song) {
                Some(t) => t,
                None => Target::Pending(resolver.pending_for_unknown(song)?),
            };
            let (song_id, pending_id) = match &target {
                Target::Song(s) => (Some(s.as_str()), None),
                Target::Pending(p) => (None, Some(*p)),
            };
            tx.execute(
                "INSERT INTO playlist_items (playlist_id, position, song_id, pending_id) VALUES (?1, ?2, ?3, ?4)",
                params![id, position as i64, song_id, pending_id],
            )?;
            report.playlist_items += 1;
            report.playlist_items_pending += usize::from(pending_id.is_some());
        }
        report.playlists += 1;
    }

    let (days, l, f, sk) = write_counters(&tx, &events, &targets)?;
    report.listening_days = days;
    report.listens_l = l;
    report.listens_f = f;
    report.listens_s = sk;

    // ELO: ratings become the baseline; the duel history is kept for display, not replayed.
    let mut unmapped_ratings = serde_json::Map::new();
    for (old_id, r) in cmr["elo"]["ratings"].as_object().into_iter().flatten() {
        match target_of(old_id) {
            Some(Target::Song(song_id)) => {
                tx.execute(
                    "INSERT INTO elo_baseline (song_id, rating, games, wins, losses, draws, imported_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                     ON CONFLICT(song_id) DO UPDATE SET rating = excluded.rating, games = excluded.games,
                       wins = excluded.wins, losses = excluded.losses, draws = excluded.draws",
                    params![
                        song_id,
                        r["rating"].as_f64().unwrap_or(1200.0),
                        r["games"].as_i64().unwrap_or(0),
                        r["wins"].as_i64().unwrap_or(0),
                        r["losses"].as_i64().unwrap_or(0),
                        r["draws"].as_i64().unwrap_or(0),
                        now
                    ],
                )?;
                report.ratings += 1;
            }
            _ => {
                unmapped_ratings.insert(old_id.clone(), r.clone());
                report.ratings_unmapped += 1;
            }
        }
    }
    for (n, duel) in cmr["elo"]["history"].as_array().into_iter().flatten().enumerate() {
        let a = duel["songAId"].as_str().and_then(target_of);
        let b = duel["songBId"].as_str().and_then(target_of);
        let (Some(Target::Song(a)), Some(Target::Song(b))) = (a, b) else {
            report.duels_unmapped += 1;
            continue;
        };
        let outcome = match duel["winner"].as_str() {
            Some("A") => "a",
            Some("B") => "b",
            _ => "draw",
        };
        tx.execute(
            "INSERT INTO duels (duel_id, device_id, at, song_a, song_b, outcome, imported, delta_a, delta_b)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, ?8) ON CONFLICT(duel_id) DO NOTHING",
            params![
                format!("import:{SOURCE}:{n}"),
                device_id,
                duel["at"].as_i64().unwrap_or(0),
                a,
                b,
                outcome,
                duel["deltaA"].as_f64(),
                duel["deltaB"].as_f64()
            ],
        )?;
        report.duels += 1;
    }
    // Skipped pairs become facts like 2.0's own skips; a "too close" draw is already in the history.
    for (n, skip) in cmr["duelMatchmaking"]["skippedPairs"].as_array().into_iter().flatten().enumerate() {
        let a = skip["songAId"].as_str().and_then(target_of);
        let b = skip["songBId"].as_str().and_then(target_of);
        let (Some(Target::Song(a)), Some(Target::Song(b))) = (a, b) else { continue };
        tx.execute(
            "INSERT INTO duels (duel_id, device_id, at, song_a, song_b, outcome, skip_reason, imported)
             VALUES (?1, ?2, ?3, ?4, ?5, 'skip', ?6, 1) ON CONFLICT(duel_id) DO NOTHING",
            params![
                format!("import:{SOURCE}:skip:{n}"),
                device_id,
                skip["at"].as_i64().unwrap_or(0),
                a,
                b,
                skip["reason"].as_str().unwrap_or("cantDecide")
            ],
        )?;
    }
    if let Some(total) = cmr["elo"]["totalDuels"].as_i64() {
        put_shared(&tx, "elo.imported_total_duels", &json!(total.to_string()), now, &device_id)?;
    }
    let remap = |value: &Value| remap_song_ids(value, &targets);
    put_shared(&tx, "elo.tournament", &remap(&cmr["tournament"]), now, &device_id)?;
    if !unmapped_ratings.is_empty() {
        tx.execute(
            "INSERT INTO meta (key, value) VALUES ('import:nemora-1.x:unmapped_ratings', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [serde_json::to_string(&unmapped_ratings)?],
        )?;
    }

    // Tierlists: song ids inside the document are replaced; a pending one is written "pending:<id>".
    for tierlist in tierlists.as_array().into_iter().flatten() {
        let Some(id) = tierlist["tierlistId"].as_str() else { continue };
        let mut doc = tierlist.clone();
        for tier in doc["tiers"].as_array_mut().into_iter().flatten() {
            if let Some(items) = tier["items"].as_array_mut() {
                for item in items.iter_mut() {
                    let Some(old) = item.as_str().map(str::to_owned) else { continue };
                    let target = match target_of(&old) {
                        Some(t) => t,
                        None => Target::Pending(resolver.pending_for_unknown(&old)?),
                    };
                    *item = match target {
                        Target::Song(s) => json!(s),
                        Target::Pending(p) => {
                            report.tier_items_pending += 1;
                            json!(format!("pending:{p}"))
                        }
                    };
                }
            }
        }
        let created = tierlist["createdDate"].as_str().and_then(parse_iso_ms).unwrap_or(now);
        tx.execute(
            "INSERT INTO tierlists (tierlist_id, doc, created_at, updated_at, updated_by) VALUES (?1, ?2, ?3, ?3, ?4)
             ON CONFLICT(tierlist_id) DO UPDATE SET doc = excluded.doc",
            params![id, serde_json::to_string(&doc)?, created, device_id],
        )?;
        report.tierlists += 1;
    }

    // Blacklist.
    for old in blacklist["songBlacklist"].as_array().into_iter().flatten().filter_map(Value::as_str) {
        if let Some(Target::Song(song_id)) = target_of(old) {
            report.blacklisted_songs += tx.execute(
                "INSERT INTO blacklist_songs (song_id, value, updated_at, updated_by) VALUES (?1, 1, ?2, ?3)
                 ON CONFLICT(song_id) DO NOTHING",
                params![song_id, now, device_id],
            )?;
        }
    }
    for folder in blacklist["folderBlacklist"].as_array().into_iter().flatten().filter_map(Value::as_str) {
        tx.execute(
            "INSERT INTO folders (uri, excluded) VALUES (?1, 1) ON CONFLICT(uri) DO UPDATE SET excluded = 1",
            [folder],
        )?;
    }

    // Settings: shared ones may sync later, device ones never leave this installation.
    // 1.x's History (newest first, at most 50) is the "recently played" its user knows; 2.0 builds
    // its own from play events, which start empty, so the old list follows them (`plays::history`).
    // The system playlists' creation dates are kept for their pages.
    let mut history: Vec<String> = Vec::new();
    let mut rediscover: Vec<String> = Vec::new();
    let mut system_created = serde_json::Map::new();
    for playlist in playlists.as_array().into_iter().flatten() {
        let Some(id) = playlist["playlistId"].as_str().filter(|id| SYSTEM_PLAYLISTS.contains(id)) else { continue };
        if let Some(created) = playlist["createdDate"].as_str().and_then(parse_iso_ms) {
            system_created.insert(id.to_owned(), json!(created));
        }
        let list = match id {
            "History" => &mut history,
            "Rediscover" => &mut rediscover,
            _ => continue,
        };
        for song in playlist["songs"].as_array().into_iter().flatten().filter_map(Value::as_str) {
            if let Some(Target::Song(new)) = target_of(song)
                && !list.contains(&new)
            {
                list.push(new);
            }
        }
    }
    // The Rediscover list 1.x last made, until the user refreshes it here; a list made here already
    // is not replaced by importing again.
    tx.execute(
        "INSERT INTO settings_device (key, value) VALUES ('rediscover.songs', ?1) ON CONFLICT(key) DO NOTHING",
        [serde_json::to_string(&rediscover)?],
    )?;
    for (key, value) in
        [(crate::plays::IMPORTED_HISTORY, json!(history)), (SYSTEM_CREATED, Value::Object(system_created))]
    {
        tx.execute(
            "INSERT INTO settings_device (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, serde_json::to_string(&value)?],
        )?;
    }

    for key in ["language", "theme", "preferences"] {
        if !user_data[key].is_null() {
            put_shared(&tx, key, &user_data[key], now, &device_id)?;
        }
    }
    for key in ["windowPositions", "windowDiamensions", "windowState", "recentSearches", "musicFolders"] {
        if !user_data[key].is_null() {
            tx.execute(
                "INSERT INTO settings_device (key, value) VALUES (?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![key, serde_json::to_string(&user_data[key])?],
            )?;
        }
    }

    // Old id -> new id (null while the song is pending), for what 1.x kept outside its stores: the
    // desktop renderer's local storage holds the queue and the current song by old id.
    let ids: serde_json::Map<String, Value> = targets
        .iter()
        .map(|(old, t)| {
            let new = match t {
                Target::Song(id) => json!(id),
                Target::Pending(_) => Value::Null,
            };
            (old.clone(), new)
        })
        .collect();
    tx.execute(
        "INSERT INTO settings_device (key, value) VALUES ('import.songIds', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [serde_json::to_string(&ids)?],
    )?;

    // 1.x knew when each song entered the library; the scan only knows when 2.0 first saw it.
    for song in songs.as_array().into_iter().flatten() {
        let (Some(id), Some(added)) = (song["songId"].as_str(), song["addedDate"].as_i64()) else { continue };
        if let Some(Target::Song(song_id)) = target_of(id) {
            tx.execute(
                "UPDATE tracks SET first_seen_at = min(first_seen_at, ?2) WHERE song_id = ?1",
                params![song_id, added],
            )?;
        }
    }
    crate::plays::recompute_legacy_plays(&tx)?;
    crate::plays::rebuild_song_totals(&tx)?;

    tx.execute(
        "INSERT INTO meta (key, value) VALUES ('import:nemora-1.x', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [now.to_string()],
    )?;
    // A stats export this install made carries the same history: see `transfer`.
    if let Some(install) = events["installId"].as_str().filter(|i| !i.is_empty()) {
        tx.execute(
            "INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO NOTHING",
            params![crate::transfer::install_marker(install), now.to_string()],
        )?;
    }
    drop(resolver);
    tx.commit()?;
    db.touch();
    Ok(report)
}

/// Re-attaches pending history once its file appears: every pending record whose fingerprint now
/// matches exactly one library song is resolved to it, and its day counters, playlist items, tier
/// placements and ELO documents move to the song. Returns how many records were resolved.
pub fn reattach_pending(db: &mut Db) -> Result<usize> {
    let pending: Vec<(i64, Fingerprint)> = {
        let mut stmt = db.conn().prepare(
            "SELECT pending_id, file_name, title, artists, duration_ms FROM pending_tracks WHERE resolved_to IS NULL",
        )?;
        stmt.query_map([], |r| {
            let artists: Option<String> = r.get(3)?;
            Ok((
                r.get(0)?,
                Fingerprint {
                    file_name: r.get(1)?,
                    title: r.get(2)?,
                    artists: artists.and_then(|a| serde_json::from_str(&a).ok()).unwrap_or_default(),
                    duration_ms: r.get(4)?,
                },
            ))
        })?
        .collect::<rusqlite::Result<_>>()?
    };
    if pending.is_empty() {
        return Ok(0);
    }
    let library = library_index(db)?;
    let matches: Vec<(i64, String)> =
        pending.iter().filter_map(|(id, fp)| match_fingerprint(&library, fp).map(|song| (*id, song))).collect();
    if matches.is_empty() {
        return Ok(0);
    }
    let tx = db.conn_mut().transaction()?;
    for (pending_id, song_id) in &matches {
        tx.execute("UPDATE pending_tracks SET resolved_to = ?2 WHERE pending_id = ?1", params![pending_id, song_id])?;
        // Day counters: sum into an existing row of the same source and day, else move the row.
        let rows: Vec<(String, String, i64, i64, i64, Option<String>)> = tx
            .prepare("SELECT source_id, day, l, f, s, hours FROM legacy_daily WHERE pending_id = ?1")?
            .query_map([pending_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)))?
            .collect::<rusqlite::Result<_>>()?;
        tx.execute("DELETE FROM legacy_daily WHERE pending_id = ?1", [pending_id])?;
        for (source, day, l, f, s, hours) in rows {
            tx.execute(
                "INSERT INTO legacy_daily (source_id, song_id, pending_id, day, l, f, s, hours) VALUES (?1, ?2, NULL, ?3, ?4, ?5, ?6, ?7)
                 ON CONFLICT(source_id, day, ifnull(song_id, ''), ifnull(pending_id, 0)) DO UPDATE SET
                   l = l + excluded.l, f = f + excluded.f, s = s + excluded.s, hours = coalesce(hours, excluded.hours)",
                params![source, song_id, day, l, f, s, hours],
            )?;
        }
        tx.execute(
            "UPDATE playlist_items SET song_id = ?2, pending_id = NULL WHERE pending_id = ?1",
            params![pending_id, song_id],
        )?;
    }
    // Documents that name pending records by text.
    let replacements: HashMap<String, String> =
        matches.iter().map(|(p, s)| (format!("pending:{p}"), s.clone())).collect();
    let docs: Vec<(String, String)> = tx
        .prepare("SELECT tierlist_id, doc FROM tierlists")?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?;
    for (id, doc) in docs {
        let value: Value = serde_json::from_str(&doc).unwrap_or_default();
        let replaced = replace_strings(&value, &replacements);
        if replaced != value {
            tx.execute(
                "UPDATE tierlists SET doc = ?2 WHERE tierlist_id = ?1",
                params![id, serde_json::to_string(&replaced)?],
            )?;
        }
    }
    let settings: Vec<(String, String)> = tx
        .prepare("SELECT key, value FROM settings_shared WHERE key LIKE 'elo.%'")?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?;
    for (key, value) in settings {
        let parsed: Value = serde_json::from_str(&value).unwrap_or_default();
        let replaced = replace_strings(&parsed, &replacements);
        if replaced != parsed {
            tx.execute(
                "UPDATE settings_shared SET value = ?2 WHERE key = ?1",
                params![key, serde_json::to_string(&replaced)?],
            )?;
        }
    }
    crate::plays::recompute_legacy_plays(&tx)?;
    crate::plays::rebuild_song_totals(&tx)?;
    tx.commit()?;
    db.touch();
    Ok(matches.len())
}

fn replace_strings(value: &Value, map: &HashMap<String, String>) -> Value {
    match value {
        Value::String(s) => map.get(s).map_or_else(|| value.clone(), |r| json!(r)),
        Value::Array(items) => Value::Array(items.iter().map(|v| replace_strings(v, map)).collect()),
        Value::Object(o) => Value::Object(o.iter().map(|(k, v)| (k.clone(), replace_strings(v, map))).collect()),
        _ => value.clone(),
    }
}

/// Writes a 1.x counter file (`counters[trackKey][sourceId][day] = {l, f, s, h}`) into
/// `legacy_daily`. Track keys that now name one song are summed; the result merges by maximum with
/// what is already there, so the same counters imported twice, or from a profile and from its own
/// export, never double. Returns (rows, l, f, s).
pub(crate) fn write_counters(
    tx: &Transaction<'_>,
    events: &Value,
    targets: &HashMap<String, Target>,
) -> Result<(usize, i64, i64, i64)> {
    let tracks = events["tracks"].as_object().cloned().unwrap_or_default();
    // BTreeMap for the hour histogram: its JSON must come out the same on every import.
    let mut days: HashMap<DayKey, DayCounts> = HashMap::new();
    for (track_key, by_source) in events["counters"].as_object().into_iter().flatten() {
        let Some(old_id) = tracks.get(track_key).and_then(|fp| fp["songId"].as_str()) else { continue };
        let Some(target) = targets.get(old_id).cloned() else { continue };
        let (song_id, pending_id) = match target {
            Target::Song(s) => (Some(s), None),
            Target::Pending(p) => (None, Some(p)),
        };
        for (source_id, by_day) in by_source.as_object().into_iter().flatten() {
            for (day, c) in by_day.as_object().into_iter().flatten() {
                let entry = days
                    .entry((source_id.clone(), day.clone(), song_id.clone(), pending_id))
                    .or_insert_with(|| (0, 0, 0, BTreeMap::new()));
                entry.0 += c["l"].as_i64().unwrap_or(0);
                entry.1 += c["f"].as_i64().unwrap_or(0);
                entry.2 += c["s"].as_i64().unwrap_or(0);
                for (hour, n) in c["h"].as_object().into_iter().flatten() {
                    *entry.3.entry(hour.clone()).or_default() += n.as_i64().unwrap_or(0);
                }
            }
        }
    }
    let (mut rows, mut total_l, mut total_f, mut total_s) = (0, 0, 0, 0);
    for ((source_id, day, song_id, pending_id), (l, f, s, hours)) in days {
        let hours = (!hours.is_empty()).then(|| serde_json::to_string(&hours)).transpose()?;
        tx.execute(
            "INSERT INTO legacy_daily (source_id, song_id, pending_id, day, l, f, s, hours)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(source_id, day, ifnull(song_id, ''), ifnull(pending_id, 0)) DO UPDATE SET
               l = max(l, excluded.l), f = max(f, excluded.f), s = max(s, excluded.s),
               hours = coalesce(excluded.hours, hours)",
            params![source_id, song_id, pending_id, day, l, f, s, hours],
        )?;
        rows += 1;
        total_l += l;
        total_f += f;
        total_s += s;
    }
    Ok((rows, total_l, total_f, total_s))
}

pub(crate) struct Resolver<'t, 'c> {
    pub(crate) tx: &'t Transaction<'c>,
    pub(crate) library: &'t LibraryIndex,
    pub(crate) cache: HashMap<String, i64>,
    /// The `pending_tracks.source` of records this resolver creates.
    pub(crate) source: &'static str,
}

impl Resolver<'_, '_> {
    pub(crate) fn resolve(
        &mut self,
        old_id: &str,
        fp: &Fingerprint,
        path: Option<&str>,
        report: &mut ImportReport,
    ) -> Result<Target> {
        if let Some(path) = path {
            let found = self
                .library
                .by_uri
                .get(&path_key(path))
                .or_else(|| self.library.by_uri_folded.get(&path_key(path).to_lowercase()));
            if let Some(song_id) = found {
                report.songs_by_path += 1;
                return Ok(Target::Song(song_id.clone()));
            }
        }
        if let Some(song_id) = match_fingerprint(self.library, fp) {
            report.songs_by_fingerprint += 1;
            return Ok(Target::Song(song_id));
        }
        report.pending += 1;
        Ok(Target::Pending(self.pending(old_id, fp)?))
    }

    /// A song id that neither the song store nor the counters describe: pending with no fingerprint.
    pub(crate) fn pending_for_unknown(&mut self, old_id: &str) -> Result<i64> {
        self.pending(old_id, &Fingerprint { title: None, artists: Vec::new(), duration_ms: None, file_name: None })
    }

    fn pending(&mut self, old_id: &str, fp: &Fingerprint) -> Result<i64> {
        if let Some(id) = self.cache.get(old_id) {
            return Ok(*id);
        }
        let existing: Option<i64> = self
            .tx
            .query_row(
                "SELECT pending_id FROM pending_tracks WHERE source = ?1 AND old_song_id = ?2",
                params![self.source, old_id],
                |r| r.get(0),
            )
            .optional()?;
        let id = match existing {
            Some(id) => id,
            None => {
                self.tx.execute(
                    "INSERT INTO pending_tracks (source, old_song_id, file_name, title, artists, duration_ms)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    params![
                        self.source,
                        old_id,
                        fp.file_name,
                        fp.title,
                        serde_json::to_string(&fp.artists)?,
                        fp.duration_ms
                    ],
                )?;
                self.tx.last_insert_rowid()
            }
        };
        self.cache.insert(old_id.to_owned(), id);
        Ok(id)
    }
}

/// The tiers of 1.x, in order, and a tier with several candidates is skipped: a wrong
/// re-attachment is worse than a pending record.
pub(crate) fn match_fingerprint(library: &LibraryIndex, fp: &Fingerprint) -> Option<String> {
    let duration = fp.duration_ms?;
    let close = |d: i64| (d - duration).abs() <= 1000;
    if let Some(name) = &fp.file_name {
        let candidates: Vec<&String> = library
            .by_file_name
            .get(&name.to_lowercase())
            .into_iter()
            .flatten()
            .filter(|(_, d)| close(*d))
            .map(|(s, _)| s)
            .collect();
        if let [one] = dedup(candidates).as_slice() {
            return Some((*one).clone());
        }
    }
    let title = fp.title.as_ref()?.to_lowercase();
    let mut artists: Vec<String> = fp.artists.iter().map(|a| a.to_lowercase()).collect();
    artists.sort();
    let candidates: Vec<&String> = library
        .by_title
        .get(&title)
        .into_iter()
        .flatten()
        .filter(|(_, a, d)| *a == artists && close(*d))
        .map(|(s, _, _)| s)
        .collect();
    match dedup(candidates).as_slice() {
        [one] => Some((*one).clone()),
        _ => None,
    }
}

fn dedup(mut v: Vec<&String>) -> Vec<&String> {
    v.sort();
    v.dedup();
    v
}

pub(crate) fn library_index(db: &Db) -> Result<LibraryIndex> {
    let mut index = LibraryIndex {
        by_uri: HashMap::new(),
        by_uri_folded: HashMap::new(),
        by_file_name: HashMap::new(),
        by_title: HashMap::new(),
    };
    let conn = db.conn();
    let mut stmt = conn.prepare(
        "SELECT l.uri, v.song_id, t.duration_ms FROM locations l
         JOIN track_variants v USING (variant_id) JOIN tracks t ON t.song_id = v.song_id",
    )?;
    for row in stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?)))? {
        let (uri, song_id, duration) = row?;
        let file_name = uri.rsplit(['\\', '/']).next().unwrap_or(&uri).to_lowercase();
        index.by_file_name.entry(file_name).or_default().push((song_id.clone(), duration));
        index.by_uri_folded.insert(path_key(&uri).to_lowercase(), song_id.clone());
        index.by_uri.insert(path_key(&uri), song_id);
    }
    let mut stmt = conn.prepare(
        "SELECT v.variant_id, v.song_id, v.title, t.duration_ms FROM track_variants v JOIN tracks t USING (song_id)",
    )?;
    let variants: Vec<(i64, String, String, i64)> =
        stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?.collect::<rusqlite::Result<_>>()?;
    let mut artists_of =
        conn.prepare("SELECT name FROM variant_artists WHERE variant_id = ?1 AND role = 'artist' ORDER BY position")?;
    for (variant_id, song_id, title, duration) in variants {
        let mut artists: Vec<String> = artists_of
            .query_map([variant_id], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?
            .into_iter()
            .map(|a| a.to_lowercase())
            .collect();
        artists.sort();
        index.by_title.entry(title.to_lowercase()).or_default().push((song_id, artists, duration));
    }
    Ok(index)
}

/// Paths compared with one separator: 1.x wrote `E:\Music\a.flac`, a folder may have been
/// given as `E:/Music`.
fn path_key(path: &str) -> String {
    path.replace('/', "\\")
}

fn fingerprint_of_song(song: &Value) -> Fingerprint {
    Fingerprint {
        title: song["title"].as_str().map(str::to_owned),
        artists: song["artists"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|a| a["name"].as_str().map(str::to_owned))
            .collect(),
        duration_ms: song["duration"].as_f64().map(|s| (s * 1000.0).round() as i64),
        file_name: song["path"].as_str().map(|p| p.rsplit(['\\', '/']).next().unwrap_or(p).to_owned()),
    }
}

pub(crate) fn fingerprint_of_event(fp: &Value) -> Fingerprint {
    Fingerprint {
        title: fp["title"].as_str().map(str::to_owned),
        artists: fp["artists"].as_array().into_iter().flatten().filter_map(|a| a.as_str().map(str::to_owned)).collect(),
        duration_ms: fp["duration"].as_f64().map(|s| (s * 1000.0).round() as i64),
        file_name: fp["fileName"].as_str().map(str::to_owned),
    }
}

/// Replaces every string that is a known old song id inside `value` with the new id (or
/// `pending:<id>`). Used for documents whose shape this importer does not need to understand.
pub(crate) fn remap_song_ids(value: &Value, targets: &HashMap<String, Target>) -> Value {
    match value {
        Value::String(s) => match targets.get(s) {
            Some(Target::Song(id)) => json!(id),
            Some(Target::Pending(p)) => json!(format!("pending:{p}")),
            None => value.clone(),
        },
        Value::Array(items) => Value::Array(items.iter().map(|v| remap_song_ids(v, targets)).collect()),
        Value::Object(map) => Value::Object(map.iter().map(|(k, v)| (k.clone(), remap_song_ids(v, targets))).collect()),
        _ => value.clone(),
    }
}

pub(crate) fn put_shared(tx: &Transaction<'_>, key: &str, value: &Value, now: i64, device_id: &str) -> Result<()> {
    if value.is_null() {
        return Ok(());
    }
    tx.execute(
        "INSERT INTO settings_shared (key, value, updated_at, updated_by) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, serde_json::to_string(value)?, now, device_id],
    )?;
    Ok(())
}

/// Reads a 1.x store. A file that exists but does not parse stops the import: substituting an empty
/// store would silently drop the user's data.
fn read_store(profile: &Path, file: &str, key: &str) -> Result<Value> {
    let path = profile.join(file);
    let text = std::fs::read_to_string(&path)
        .map_err(|e| Error::LegacyStore { store: file.to_owned(), reason: e.to_string() })?;
    let mut root: Value = serde_json::from_str(&text)
        .map_err(|e| Error::LegacyStore { store: file.to_owned(), reason: e.to_string() })?;
    Ok(root.get_mut(key).map(Value::take).unwrap_or(Value::Null))
}

fn read_optional_store(profile: &Path, file: &str, key: &str) -> Result<Value> {
    if profile.join(file).exists() { read_store(profile, file, key) } else { Ok(Value::Null) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remap_replaces_only_known_ids() {
        let targets = HashMap::from([
            ("old".to_owned(), Target::Song("new".to_owned())),
            ("gone".to_owned(), Target::Pending(4)),
        ]);
        let doc = json!({"a": ["old", "gone", "other"], "b": {"songAId": "old"}});
        assert_eq!(
            remap_song_ids(&doc, &targets),
            json!({"a": ["new", "pending:4", "other"], "b": {"songAId": "new"}})
        );
    }
}

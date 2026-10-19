//! Stats export files of 1.x (`nora-cmr-stats-export`, format 1): import into 2.0.
//!
//! An export names songs by fingerprint only (song ids are random per install), so songs are found
//! by file name and duration, then title, artists and duration; the unmatched become pending
//! records like a profile import's. Day counters merge by maximum per source and day, so importing
//! the same export twice, or the export of a profile that was itself imported, never doubles a
//! play. ELO merges like 1.x did between two devices (games summed, the rating the games-weighted
//! mean); that merge cannot be repeated safely, so a second import of one export leaves ELO alone.
//! Playlists merge by name, tierlists are created, both with song ids remapped.

use std::collections::HashMap;

use rusqlite::{OptionalExtension, params};
use serde_json::{Value, json};

use crate::db::{Db, now_ms};
use crate::error::{Error, Result};
use crate::import::{
    Fingerprint, Resolver, Target, fingerprint_of_event, library_index, put_shared, remap_song_ids, write_counters,
};
use crate::time::parse_iso_ms;

const FORMAT: &str = "nora-cmr-stats-export";
const SOURCE: &str = "stats-export";

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct TransferReport {
    pub songs: usize,
    pub matched: usize,
    pub pending: usize,
    pub listening_days: usize,
    pub elo_merged: bool,
    pub playlists: usize,
    pub tierlists: usize,
    /// This export was imported before: counters and collections merged harmlessly, ELO skipped.
    pub already_imported: bool,
    /// This device made the export: only what it does not hold already (imported days) is merged.
    pub from_this_device: bool,
    /// The export comes from an install whose history is here already (the 1.x profile this
    /// database started from, or an earlier export of it): its ratings and tierlists are counted,
    /// so only duels and days this database lacks are added.
    pub from_known_install: bool,
}

/// The `meta` key that records an install whose history this database holds.
pub(crate) fn install_marker(install_id: &str) -> String {
    format!("import:install:{install_id}")
}

fn round1(v: f64) -> f64 {
    (v * 10.0 + 0.5).floor() / 10.0
}

pub fn import_stats_export(db: &mut Db, text: &str) -> Result<TransferReport> {
    let data: Value = serde_json::from_str(text)?;
    let bad = |reason: &str| Error::LegacyStore { store: "stats export".into(), reason: reason.into() };
    if data["format"] != FORMAT {
        return Err(bad("not a nora-cmr-stats-export file"));
    }
    if data["formatVersion"].as_i64() != Some(1) {
        return Err(bad("unknown format version"));
    }
    let export_id = data["exportId"].as_str().filter(|s| !s.is_empty()).ok_or_else(|| bad("no exportId"))?.to_owned();
    let marker = format!("import:{SOURCE}:{export_id}");
    let already = db.meta(&marker)?.is_some();
    let device_id = db.device_id()?;
    let now = now_ms();
    let library = library_index(db)?;
    // A device's own export brings back its own ratings and tierlists: merging those would count
    // every game twice and duplicate every tierlist. The same holds for an install already merged.
    let install = data["events"]["installId"].as_str().filter(|i| !i.is_empty()).map(str::to_owned);
    let own = install.as_deref() == Some(device_id.as_str());
    let known_install = match &install {
        Some(i) if !own => db.meta(&install_marker(i))?.is_some(),
        _ => false,
    };
    let mut report = TransferReport {
        already_imported: already,
        from_this_device: own,
        from_known_install: known_install,
        ..Default::default()
    };
    let once_only = !already && !own && !known_install;

    let tx = db.conn_mut().transaction()?;
    let mut resolver = Resolver { tx: &tx, library: &library, cache: HashMap::new(), source: SOURCE };
    let mut scratch = crate::import::ImportReport::default();
    let mut targets: HashMap<String, Target> = HashMap::new();
    for song in data["songs"].as_array().into_iter().flatten() {
        let Some(id) = song["songId"].as_str() else { continue };
        let fp: Fingerprint = fingerprint_of_event(song);
        let target = resolver.resolve(id, &fp, None, &mut scratch)?;
        targets.insert(id.to_owned(), target);
    }
    report.songs = targets.len();
    report.matched = scratch.songs_by_fingerprint;
    report.pending = scratch.pending;

    // Day counters: the counter file of 1.1.0+, else the older per-song listening rows.
    let mut events = if data["events"].is_object() {
        data["events"].clone()
    } else {
        counters_from_rows(&data["listeningData"], &export_id)
    };
    // This device's own days are already here as play events: an export of an export that came
    // from here must not bring them back as imported days.
    if let Some(counters) = events["counters"].as_object_mut() {
        for by_source in counters.values_mut() {
            if let Some(by_source) = by_source.as_object_mut() {
                by_source.remove(&device_id);
            }
        }
    }
    report.listening_days = write_counters(&tx, &events, &targets)?.0;

    if once_only && data["elo"].is_object() {
        report.elo_merged = true;
        for (old_id, r) in data["elo"]["ratings"].as_object().into_iter().flatten() {
            let Some(Target::Song(song)) = targets.get(old_id) else { continue };
            let current: Option<(f64, i64, i64, i64, i64)> = tx
                .query_row(
                    "SELECT rating, games, wins, losses, draws FROM elo_baseline WHERE song_id = ?1",
                    [song],
                    |q| Ok((q.get(0)?, q.get(1)?, q.get(2)?, q.get(3)?, q.get(4)?)),
                )
                .optional()?;
            let foreign = (
                r["rating"].as_f64().unwrap_or(1200.0),
                r["games"].as_i64().unwrap_or(0),
                r["wins"].as_i64().unwrap_or(0),
                r["losses"].as_i64().unwrap_or(0),
                r["draws"].as_i64().unwrap_or(0),
            );
            let merged = match current {
                None => foreign,
                Some(local) => {
                    let weight = local.1 + foreign.1;
                    let rating = if weight > 0 {
                        round1((local.0 * local.1 as f64 + foreign.0 * foreign.1 as f64) / weight as f64)
                    } else {
                        1200.0
                    };
                    (rating, local.1 + foreign.1, local.2 + foreign.2, local.3 + foreign.3, local.4 + foreign.4)
                }
            };
            tx.execute(
                "INSERT INTO elo_baseline (song_id, rating, games, wins, losses, draws, imported_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                 ON CONFLICT(song_id) DO UPDATE SET rating = excluded.rating, games = excluded.games, wins = excluded.wins,
                   losses = excluded.losses, draws = excluded.draws, imported_at = excluded.imported_at",
                params![song, merged.0, merged.1, merged.2, merged.3, merged.4, now],
            )?;
        }
        if let Some(total) = data["elo"]["totalDuels"].as_i64() {
            let current: i64 = tx
                .query_row("SELECT value FROM settings_shared WHERE key = 'elo.imported_total_duels'", [], |q| {
                    q.get::<_, String>(0)
                })
                .optional()?
                .and_then(|v| serde_json::from_str::<String>(&v).ok())
                .and_then(|v| v.parse().ok())
                .unwrap_or(0);
            put_shared(&tx, "elo.imported_total_duels", &json!((current + total).to_string()), now, &device_id)?;
        }
    }
    // Duels are history (ratings come from the baseline and this device's own games), so any this
    // database lacks are added, also from an install merged before; a duel already here, under
    // whatever id, is not added again.
    if !already && !own {
        for (n, duel) in data["elo"]["history"].as_array().into_iter().flatten().enumerate() {
            let (Some(Target::Song(a)), Some(Target::Song(b))) = (
                duel["songAId"].as_str().and_then(|i| targets.get(i)),
                duel["songBId"].as_str().and_then(|i| targets.get(i)),
            ) else {
                continue;
            };
            let outcome = match duel["winner"].as_str() {
                Some("A") => "a",
                Some("B") => "b",
                _ => "draw",
            };
            tx.execute(
                "INSERT INTO duels (duel_id, device_id, at, song_a, song_b, outcome, imported, delta_a, delta_b)
                 SELECT ?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, ?8
                 WHERE NOT EXISTS (SELECT 1 FROM duels WHERE at = ?3 AND song_a = ?4 AND song_b = ?5)
                 ON CONFLICT(duel_id) DO NOTHING",
                params![
                    format!("import:{SOURCE}:{export_id}:{n}"),
                    device_id,
                    duel["at"].as_i64().unwrap_or(0),
                    a,
                    b,
                    outcome,
                    duel["deltaA"].as_f64(),
                    duel["deltaB"].as_f64()
                ],
            )?;
        }
    }

    // Playlists merge by name: missing songs are appended to an existing one, else it is created.
    let mut playlist_ids: HashMap<String, String> = HashMap::new();
    for playlist in data["playlists"].as_array().into_iter().flatten() {
        let (Some(foreign_id), Some(name)) = (playlist["playlistId"].as_str(), playlist["name"].as_str()) else {
            continue;
        };
        let existing: Option<String> = tx
            .query_row(
                "SELECT playlist_id FROM playlists WHERE name = ?1 AND deleted_at IS NULL ORDER BY created_at LIMIT 1",
                [name],
                |q| q.get(0),
            )
            .optional()?;
        let id = match existing {
            Some(id) => id,
            None => {
                let id = crate::ids::random();
                let created = playlist["createdDate"].as_str().and_then(parse_iso_ms).unwrap_or(now);
                tx.execute(
                    "INSERT INTO playlists (playlist_id, name, created_at, updated_at, updated_by) VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![id, name, created, now, device_id],
                )?;
                id
            }
        };
        let mut position: i64 = tx.query_row(
            "SELECT coalesce(max(position) + 1, 0) FROM playlist_items WHERE playlist_id = ?1",
            [&id],
            |q| q.get(0),
        )?;
        for song in playlist["songs"].as_array().into_iter().flatten().filter_map(Value::as_str) {
            let (song_id, pending_id) = match targets.get(song).cloned() {
                Some(Target::Song(s)) => (Some(s), None),
                Some(Target::Pending(p)) => (None, Some(p)),
                None => (None, Some(resolver.pending_for_unknown(song)?)),
            };
            let present: bool = tx.query_row(
                "SELECT EXISTS (SELECT 1 FROM playlist_items WHERE playlist_id = ?1 AND (song_id = ?2 OR pending_id = ?3))",
                params![id, song_id, pending_id],
                |q| q.get(0),
            )?;
            if !present {
                tx.execute(
                    "INSERT INTO playlist_items (playlist_id, position, song_id, pending_id) VALUES (?1, ?2, ?3, ?4)",
                    params![id, position, song_id, pending_id],
                )?;
                position += 1;
            }
        }
        tx.execute(
            "UPDATE playlists SET updated_at = ?2, updated_by = ?3 WHERE playlist_id = ?1",
            params![id, now, device_id],
        )?;
        playlist_ids.insert(foreign_id.to_owned(), id);
        report.playlists += 1;
    }

    // Tierlists are created (once per export), song ids and source playlists remapped.
    if once_only {
        for tierlist in data["tierlists"].as_array().into_iter().flatten() {
            let mut doc = remap_song_ids(tierlist, &targets);
            if let Some(sources) = doc["sourcePlaylistIds"].as_array_mut() {
                for s in sources.iter_mut() {
                    if let Some(local) = s.as_str().and_then(|f| playlist_ids.get(f)) {
                        *s = json!(local);
                    }
                }
            }
            let id = crate::ids::random();
            doc["tierlistId"] = json!(id);
            tx.execute(
                "INSERT INTO tierlists (tierlist_id, doc, created_at, updated_at, updated_by) VALUES (?1, ?2, ?3, ?3, ?4)",
                params![id, serde_json::to_string(&doc)?, now, device_id],
            )?;
            report.tierlists += 1;
        }
    }
    if let Some(intensity) = data["preferences"]["tierShuffleIntensity"].as_f64() {
        put_shared(&tx, "shuffle.intensity", &json!(intensity.clamp(0.0, 1.0)), now, &device_id)?;
    }

    tx.execute(
        "INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![marker, now.to_string()],
    )?;
    if let Some(i) = install.as_deref().filter(|_| !own) {
        tx.execute(
            "INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO NOTHING",
            params![install_marker(i), now.to_string()],
        )?;
    }
    drop(resolver);
    crate::plays::recompute_legacy_plays(&tx)?;
    crate::plays::rebuild_song_totals(&tx)?;
    tx.commit()?;
    db.touch();
    Ok(report)
}

/// Exports from before 1.1.0 carry per-song rows (`listens: [{year, listens: [[dayMs, n]]}]`, an
/// all-time `fullListens` and `skips`) instead of a counter file. They become one source named after
/// the export; the all-time scalars land on each song's last day, as 1.1.0's own migration did.
fn counters_from_rows(rows: &Value, export_id: &str) -> Value {
    let source = format!("{SOURCE}:{export_id}");
    let mut tracks = serde_json::Map::new();
    let mut counters = serde_json::Map::new();
    for row in rows.as_array().into_iter().flatten() {
        let Some(song) = row["songId"].as_str() else { continue };
        let key = format!("row:{song}");
        tracks.insert(key.clone(), json!({ "songId": song }));
        let mut days = serde_json::Map::new();
        for year in row["listens"].as_array().into_iter().flatten() {
            for pair in year["listens"].as_array().into_iter().flatten() {
                let (Some(ms), Some(n)) = (pair[0].as_i64(), pair[1].as_i64()) else { continue };
                // Day stamps were local midnights; half a day later is the same date anywhere
                // between UTC-12 and UTC+12.
                let day = crate::time::local_day(ms + 43_200_000, 0);
                let entry = days.entry(day).or_insert_with(|| json!({ "l": 0 }));
                entry["l"] = json!(entry["l"].as_i64().unwrap_or(0) + n);
            }
        }
        if let Some(last) = days.keys().max().cloned() {
            let entry = &mut days[&last];
            entry["f"] = json!(row["fullListens"].as_i64().unwrap_or(0));
            entry["s"] = json!(row["skips"].as_i64().unwrap_or(0));
        }
        counters.insert(key, json!({ source.clone(): Value::Object(days) }));
    }
    json!({ "version": 1, "tracks": tracks, "counters": counters })
}

// ----- export -----------------------------------------------------------------------------------

/// What an export carries besides the library itself.
pub struct ExportOptions<'a> {
    pub app_version: &'a str,
    pub export_id: &'a str,
    /// ISO timestamp of the export.
    pub exported_at: &'a str,
    pub tier_shuffle_intensity: Option<f64>,
}

/// This profile as a `nora-cmr-stats-export` file (format 1), readable by 1.x, the Android app and
/// [`import_stats_export`].
///
/// Day counters keep their sources: this device's own plays under its device id, imported 1.x days
/// under the id they came with, so an import elsewhere merges them by maximum and never doubles. Own
/// days are written so that 1.x's `l - s` gives back the plays. History still waiting for its file
/// travels too, under its fingerprint.
pub fn export_stats(db: &Db, options: &ExportOptions<'_>) -> Result<String> {
    let conn = db.conn();
    let device_id = db.device_id()?;

    // Fingerprints of every song and pending record the export mentions.
    let mut fingerprints: std::collections::BTreeMap<String, Value> = std::collections::BTreeMap::new();
    let mut stmt = conn.prepare(
        "SELECT v.song_id, v.title, t.duration_ms,
                (SELECT group_concat(name, char(31)) FROM (SELECT name FROM variant_artists a
                   WHERE a.variant_id = v.variant_id AND a.role = 'artist' ORDER BY position)),
                (SELECT uri FROM locations l WHERE l.variant_id = v.variant_id ORDER BY l.missing_since IS NOT NULL, l.uri LIMIT 1)
         FROM track_variants v JOIN tracks t USING (song_id)
         WHERE v.variant_id = (SELECT w.variant_id FROM track_variants w WHERE w.song_id = v.song_id
                               ORDER BY w.present DESC, w.last_seen_at DESC, w.variant_id LIMIT 1)",
    )?;
    let library: HashMap<String, Value> = stmt
        .query_map([], |r| {
            let artists: Option<String> = r.get(3)?;
            let uri: Option<String> = r.get(4)?;
            let file_name = uri.as_deref().map(|u| u.rsplit(['\\', '/']).next().unwrap_or(u).to_owned());
            Ok((
                r.get::<_, String>(0)?,
                json!({
                    "title": r.get::<_, String>(1)?,
                    "artists": artists.map(|a| a.split('\u{1f}').map(str::to_owned).collect::<Vec<_>>()).unwrap_or_default(),
                    "duration": r.get::<_, i64>(2)? as f64 / 1000.0,
                    "fileName": file_name,
                }),
            ))
        })?
        .collect::<rusqlite::Result<_>>()?;
    let mention = |key: &str, fingerprints: &mut std::collections::BTreeMap<String, Value>| {
        if fingerprints.contains_key(key) {
            return;
        }
        let fp = if let Some(pending) = key.strip_prefix("pending:") {
            conn.query_row(
                "SELECT title, artists, duration_ms, file_name FROM pending_tracks WHERE pending_id = ?1",
                [pending],
                |r| {
                    let artists: Option<String> = r.get(1)?;
                    Ok(json!({
                        "title": r.get::<_, Option<String>>(0)?.unwrap_or_default(),
                        "artists": artists.and_then(|a| serde_json::from_str::<Vec<String>>(&a).ok()).unwrap_or_default(),
                        "duration": r.get::<_, Option<i64>>(2)?.unwrap_or(0) as f64 / 1000.0,
                        "fileName": r.get::<_, Option<String>>(3)?,
                    }))
                },
            )
            .optional()
            .ok()
            .flatten()
        } else {
            library.get(key).cloned()
        };
        if let Some(mut fp) = fp {
            fp["songId"] = json!(key);
            fingerprints.insert(key.to_owned(), fp);
        }
    };

    // Day counters by track key, then source, then day.
    let mut counters: std::collections::BTreeMap<
        String,
        std::collections::BTreeMap<String, serde_json::Map<String, Value>>,
    > = std::collections::BTreeMap::new();
    let mut hours: HashMap<(String, String), serde_json::Map<String, Value>> = HashMap::new();
    let mut stmt = conn.prepare("SELECT song_id, day, hour, plays FROM play_hourly")?;
    for row in stmt.query_map([], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?, r.get::<_, i64>(3)?))
    })? {
        let (song, day, hour, plays) = row?;
        hours.entry((song, day)).or_default().insert(hour.to_string(), json!(plays));
    }
    let mut stmt = conn.prepare("SELECT song_id, day, plays, full, skips FROM play_daily")?;
    for row in stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, i64>(2)?,
            r.get::<_, i64>(3)?,
            r.get::<_, i64>(4)?,
        ))
    })? {
        let (song, day, plays, full, skips) = row?;
        let mut c = json!({ "l": plays + skips, "f": full, "s": skips });
        if let Some(h) = hours.remove(&(song.clone(), day.clone())) {
            c["h"] = Value::Object(h);
        }
        counters.entry(song).or_default().entry(device_id.clone()).or_default().insert(day, c);
    }
    let mut stmt = conn.prepare("SELECT source_id, song_id, pending_id, day, l, f, s, hours FROM legacy_daily")?;
    for row in stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, Option<String>>(1)?,
            r.get::<_, Option<i64>>(2)?,
            r.get::<_, String>(3)?,
            r.get::<_, i64>(4)?,
            r.get::<_, i64>(5)?,
            r.get::<_, i64>(6)?,
            r.get::<_, Option<String>>(7)?,
        ))
    })? {
        let (source, song, pending, day, l, f, s, h) = row?;
        let key = match (song, pending) {
            (Some(song), _) => song,
            (None, Some(p)) => format!("pending:{p}"),
            (None, None) => continue,
        };
        let mut c = json!({ "l": l, "f": f, "s": s });
        if let Some(h) = h.and_then(|h| serde_json::from_str::<Value>(&h).ok()) {
            c["h"] = h;
        }
        counters.entry(key).or_default().entry(source).or_default().insert(day, c);
    }
    for key in counters.keys() {
        mention(key, &mut fingerprints);
    }

    // User playlists and tierlists; placements still pending stay home.
    let mut playlists = Vec::new();
    for p in crate::playlists::list(db)? {
        let songs: Vec<String> =
            crate::playlists::items(db, &p.id, true)?.into_iter().filter_map(|i| i.song_id).collect();
        for song in &songs {
            mention(song, &mut fingerprints);
        }
        playlists.push(json!({
            "playlistId": p.id, "name": p.name, "songs": songs, "createdDate": crate::time::iso_ms(p.created_at),
        }));
    }
    let mut tierlists = Vec::new();
    for (id, mut doc) in crate::playlists::tierlists(db)? {
        doc["tierlistId"] = json!(id);
        if let Some(tiers) = doc["tiers"].as_array_mut() {
            for tier in tiers {
                if let Some(items) = tier["items"].as_array_mut() {
                    items.retain(|i| i.as_str().is_some_and(|s| !s.starts_with("pending:")));
                    for song in items.iter().filter_map(|i| i.as_str()) {
                        mention(song, &mut fingerprints);
                    }
                }
            }
        }
        tierlists.push(doc);
    }

    // ELO: current ratings and every decided duel.
    let total_duels = crate::elo::total_duels(db)?;
    let mut ratings = serde_json::Map::new();
    for (song, r) in crate::elo::ratings(db)? {
        if r.games > 0 {
            mention(&song, &mut fingerprints);
            ratings.insert(
                song,
                json!({ "rating": r.rating, "games": r.games, "wins": r.wins, "losses": r.losses, "draws": r.draws }),
            );
        }
    }
    let mut history = Vec::new();
    let mut stmt = conn.prepare(
        "SELECT at, song_a, song_b, outcome, coalesce(delta_a, 0), coalesce(delta_b, 0) FROM duels WHERE outcome <> 'skip' ORDER BY at, duel_id",
    )?;
    for row in stmt.query_map([], |r| {
        Ok((
            r.get::<_, i64>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, String>(3)?,
            r.get::<_, f64>(4)?,
            r.get::<_, f64>(5)?,
        ))
    })? {
        let (at, a, b, outcome, da, db_) = row?;
        let winner = match outcome.as_str() {
            "a" => "A",
            "b" => "B",
            _ => "draw",
        };
        history.push(json!({ "at": at, "songAId": a, "songBId": b, "winner": winner, "deltaA": da, "deltaB": db_ }));
    }

    let tracks: serde_json::Map<String, Value> =
        counters.keys().filter_map(|k| fingerprints.get(k).map(|fp| (k.clone(), fp.clone()))).collect();
    let counters: serde_json::Map<String, Value> = counters
        .into_iter()
        .filter(|(k, _)| tracks.contains_key(k))
        .map(|(k, by_source)| (k, serde_json::to_value(by_source).unwrap_or_default()))
        .collect();
    let mut file = json!({
        "format": FORMAT,
        "formatVersion": 1,
        "exportId": options.export_id,
        "exportedAt": options.exported_at,
        "appVersion": options.app_version,
        "songs": fingerprints.into_values().collect::<Vec<_>>(),
        "listeningData": [],
        "events": { "version": 1, "installId": device_id, "tracks": tracks, "counters": counters },
    });
    if total_duels > 0 {
        file["elo"] = json!({ "ratings": ratings, "history": history, "totalDuels": total_duels });
    }
    if !playlists.is_empty() {
        file["playlists"] = json!(playlists);
    }
    if !tierlists.is_empty() {
        file["tierlists"] = json!(tierlists);
    }
    if let Some(intensity) = options.tier_shuffle_intensity.filter(|i| i.is_finite()) {
        file["preferences"] = json!({ "tierShuffleIntensity": intensity.clamp(0.0, 1.0) });
    }
    Ok(serde_json::to_string_pretty(&file)?)
}

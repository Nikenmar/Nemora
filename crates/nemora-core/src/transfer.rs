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
    let mut report = TransferReport { already_imported: already, ..Default::default() };

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
    let events = if data["events"].is_object() {
        data["events"].clone()
    } else {
        counters_from_rows(&data["listeningData"], &export_id)
    };
    report.listening_days = write_counters(&tx, &events, &targets)?.0;

    if !already && data["elo"].is_object() {
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
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, ?8) ON CONFLICT(duel_id) DO NOTHING",
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
        report.elo_merged = true;
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
    if !already {
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

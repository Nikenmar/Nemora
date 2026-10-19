//! ELO duels, tournaments, tierlists and the Tierlist (Mega Smart) Shuffle, in the shapes the 1.1.9
//! view reads. The decisions are the core's (`elo`, `tournament`, `shuffle`), checked against 1.1.9.

use std::collections::{HashMap, HashSet};
use std::time::{SystemTime, UNIX_EPOCH};

use nemora_core::db::Db;
use nemora_core::elo::{self, Rating, SkipReason, Winner};
use nemora_core::{playlists, tournament};
use serde_json::{Value, json};
use tauri::{AppHandle, State};

use crate::app::App;
use crate::commands::{Res, fail, notify, rows_for, view};
use crate::view::{View, asset_url, parse_view_id};

/// A small xorshift generator: the matchmaker needs uniform draws, not cryptography.
fn random_source() -> impl FnMut() -> f64 {
    let mut state = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0x9e37_79b9, |d| d.as_nanos() as u64) | 1;
    move || {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        (state >> 11) as f64 / (1u64 << 53) as f64
    }
}

/// 1.x `DuelSongEntry`s for songs, in the given order; songs without a file are left out.
fn entries(db: &Db, v: &View, songs: &[String], ratings: &HashMap<String, Rating>) -> nemora_core::Result<Vec<Value>> {
    let rows = rows_for(db, songs)?;
    Ok(rows
        .iter()
        .map(|r| {
            let rating = ratings.get(&r.song_id).cloned().unwrap_or_default();
            json!({
                "songId": r.song_id,
                "title": r.title,
                "artists": r.artists,
                "duration": r.duration_ms as f64 / 1000.0,
                "path": r.path.as_deref().map(|p| asset_url(std::path::Path::new(p))),
                "artworkPaths": v.artwork(r.cover_hash.as_deref(), &v.defaults.song),
                "rating": if rating.games > 0 { rating.rating } else { elo::START_RATING },
                "games": rating.games,
            })
        })
        .collect())
}

fn pair(db: &Db, v: &View, a: &str, b: &str) -> nemora_core::Result<Option<Value>> {
    let ratings = elo::ratings(db)?;
    let found = entries(db, v, &[a.to_owned(), b.to_owned()], &ratings)?;
    Ok(match found.as_slice() {
        [song_a, song_b] => Some(json!({ "songA": song_a, "songB": song_b })),
        _ => None,
    })
}

fn result(r: &elo::DuelResult) -> Value {
    json!({ "deltaA": r.delta_a, "deltaB": r.delta_b, "ratingA": r.rating_a, "ratingB": r.rating_b })
}

// ----- duels ----------------------------------------------------------------------------------

#[tauri::command]
pub fn duel_pair(app: State<'_, App>, pinned_song_id: Option<String>) -> Res<Value> {
    let db = app.read();
    let pinned = pinned_song_id.as_deref().map(|p| parse_view_id(p).0.to_owned());
    let mut random = random_source();
    let Some((a, b)) = elo::next_pair(&db, pinned.as_deref(), &mut random).map_err(fail)? else {
        return Ok(Value::Null);
    };
    let mut found = pair(&db, &view(&app), &a, &b).map_err(fail)?.unwrap_or(Value::Null);
    if let Some(p) = &pinned {
        found["ticketAnchorSongId"] = json!(p);
    }
    Ok(found)
}

#[tauri::command]
pub fn duel_pair_by_ids(app: State<'_, App>, song_a_id: String, song_b_id: String) -> Res<Value> {
    let db = app.read();
    let (a, b) = (parse_view_id(&song_a_id).0, parse_view_id(&song_b_id).0);
    Ok(pair(&db, &view(&app), a, b).map_err(fail)?.unwrap_or(Value::Null))
}

/// The song to build an earned duel around, from songs the user just listened to.
#[tauri::command]
pub fn duel_select_anchor(
    app: State<'_, App>,
    candidates: Vec<Value>,
    excluded: Option<Vec<String>>,
) -> Res<Option<String>> {
    let db = app.read();
    let ratings = elo::ratings(&db).map_err(fail)?;
    let eligible: HashSet<String> = elo::match_songs(&db, &ratings).map_err(fail)?.into_iter().map(|s| s.id).collect();
    let candidates: Vec<(String, i64)> = candidates
        .iter()
        .filter_map(|c| Some((parse_view_id(c["songId"].as_str()?).0.to_owned(), c["listenedAt"].as_i64()?)))
        .collect();
    let excluded: HashSet<String> =
        excluded.unwrap_or_default().iter().map(|e| parse_view_id(e).0.to_owned()).collect();
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64);
    let mut random = random_source();
    Ok(elo::select_anchor(&candidates, &eligible, &excluded, &ratings, now, &mut random))
}

#[tauri::command]
pub fn duel_submit(
    handle: AppHandle,
    app: State<'_, App>,
    song_a_id: String,
    song_b_id: String,
    winner_id: String,
) -> Res<Value> {
    let (a, b, w) = (parse_view_id(&song_a_id).0, parse_view_id(&song_b_id).0, parse_view_id(&winner_id).0);
    let winner = if w == a {
        Winner::A
    } else if w == b {
        Winner::B
    } else {
        Winner::Draw
    };
    let r = app.write(|db| elo::submit(db, a, b, winner)).map_err(fail)?;
    notify(&handle, &["songs"]);
    Ok(result(&r))
}

#[tauri::command]
pub fn duel_skip(app: State<'_, App>, song_a_id: String, song_b_id: String, reason: Option<String>) -> Res<()> {
    let reason = SkipReason::parse(reason.as_deref().unwrap_or("cantDecide"));
    let (a, b) = (parse_view_id(&song_a_id).0, parse_view_id(&song_b_id).0);
    app.write(|db| elo::skip(db, a, b, reason)).map_err(fail)?;
    Ok(())
}

// ----- tournaments ----------------------------------------------------------------------------

fn tournament_error(e: tournament::TournamentError) -> String {
    e.to_string()
}

#[tauri::command]
pub fn tournament_start(app: State<'_, App>, size: u32) -> Res<Value> {
    let state = app.write(|db| tournament::start(db, size)).map_err(fail)?.map_err(tournament_error)?;
    serde_json::to_value(state).map_err(fail)
}

#[tauri::command]
pub fn tournament_resume(app: State<'_, App>) -> Res<Value> {
    let resumed = app.write(|db| tournament::resume(db)).map_err(fail)?;
    Ok(match resumed {
        Some((state, current)) => json!({ "state": state, "currentMatch": current }),
        None => Value::Null,
    })
}

#[tauri::command]
pub fn tournament_overview(app: State<'_, App>) -> Res<Value> {
    let resumed = app.write(|db| tournament::resume(db)).map_err(fail)?;
    let db = app.read();
    let eligible = tournament::eligible(&db).map_err(fail)?.len();
    let Some((state, current)) = resumed else {
        return Ok(json!({ "eligibleTrackCount": eligible, "songs": [] }));
    };
    let ids: Vec<String> = state.participants.iter().map(|p| p.song_id.clone()).collect();
    let ratings = elo::ratings(&db).map_err(fail)?;
    let songs = entries(&db, &view(&app), &ids, &ratings).map_err(fail)?;
    Ok(json!({ "eligibleTrackCount": eligible, "state": state, "currentMatch": current, "songs": songs }))
}

#[tauri::command]
pub fn tournament_submit(
    handle: AppHandle,
    app: State<'_, App>,
    match_id: String,
    winner_song_id: String,
) -> Res<Value> {
    let winner = parse_view_id(&winner_song_id).0.to_owned();
    let (state, r) =
        app.write(|db| tournament::submit(db, &match_id, &winner)).map_err(fail)?.map_err(tournament_error)?;
    notify(&handle, &["songs"]);
    Ok(json!({ "tournament": state, "result": result(&r) }))
}

// ----- tierlists ------------------------------------------------------------------------------

/// Items the import could not place yet are kept as `pending:<n>`; the view never sees them.
fn is_pending(item: &Value) -> bool {
    item.as_str().is_some_and(|s| s.starts_with("pending:"))
}

fn without_pending(mut doc: Value) -> Value {
    if let Some(tiers) = doc["tiers"].as_array_mut() {
        for tier in tiers {
            if let Some(items) = tier["items"].as_array_mut() {
                items.retain(|i| !is_pending(i));
            }
        }
    }
    doc
}

#[tauri::command]
pub fn tierlists_list(app: State<'_, App>, ids: Option<Vec<String>>, sort_type: Option<String>) -> Res<Vec<Value>> {
    let db = app.read();
    let wanted = ids.unwrap_or_default();
    let mut docs: Vec<Value> = playlists::tierlists(&db)
        .map_err(fail)?
        .into_iter()
        .filter(|(id, _)| wanted.is_empty() || wanted.contains(id))
        .map(|(id, mut doc)| {
            doc["tierlistId"] = json!(id);
            without_pending(doc)
        })
        .collect();
    let name = |d: &Value| d["name"].as_str().unwrap_or("").to_lowercase();
    let created = |d: &Value| d["createdDate"].as_str().unwrap_or("").to_owned();
    match sort_type.as_deref() {
        Some("aToZ") => docs.sort_by_key(name),
        Some("zToA") => {
            docs.sort_by_key(name);
            docs.reverse();
        }
        // Oldest first, as 1.x sorted it; the Tierlists page labels the two date sorts to match.
        Some("dateAddedAscending") => docs.sort_by_key(created),
        Some("dateAddedDescending") => {
            docs.sort_by_key(created);
            docs.reverse();
        }
        _ => {}
    }
    Ok(docs)
}

fn random_id(random: &mut impl FnMut() -> f64) -> String {
    const ALPHABET: &[u8] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    (0..10).map(|_| ALPHABET[(random() * ALPHABET.len() as f64) as usize % ALPHABET.len()] as char).collect()
}

#[tauri::command]
pub fn tierlist_add(
    handle: AppHandle,
    app: State<'_, App>,
    name: String,
    source_playlist_ids: Option<Vec<String>>,
    label_mode: Option<String>,
    source_folder_paths: Option<Vec<String>>,
) -> Res<Value> {
    let name = name.trim().to_owned();
    if name.is_empty() {
        return Ok(json!({ "success": false, "message": "Tierlist name cannot be empty." }));
    }
    if playlists::tierlists(&app.read()).map_err(fail)?.iter().any(|(_, d)| d["name"] == name.as_str()) {
        return Ok(json!({ "success": false, "message": format!("A tierlist named '{name}' already exists.") }));
    }
    let mut random = random_source();
    let tiers: Vec<Value> = ["S", "A", "B", "C", "D", "E", "F"]
        .iter()
        .map(|label| json!({ "tierId": random_id(&mut random), "name": label, "items": [] }))
        .collect();
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64);
    let mut doc = json!({
        "name": name,
        "createdDate": crate::view::iso(now),
        "sourcePlaylistIds": source_playlist_ids.unwrap_or_default(),
        "sourceFolderPaths": source_folder_paths.unwrap_or_default(),
        "tiers": tiers,
        "labelMode": label_mode.unwrap_or_else(|| "track".into()),
    });
    let id = app.write(|db| playlists::save_tierlist(db, None, &doc)).map_err(fail)?;
    doc["tierlistId"] = json!(id);
    notify(&handle, &["tierlists/newTierlist"]);
    Ok(json!({ "success": true, "tierlist": doc }))
}

/// Saves the view's tierlist, keeping the pending placements it never saw in their tiers.
#[tauri::command]
pub fn tierlist_save(handle: AppHandle, app: State<'_, App>, tierlist: Value) -> Res<Value> {
    let Some(id) = tierlist["tierlistId"].as_str().map(str::to_owned) else {
        return Ok(json!({ "success": false, "message": "The tierlist has no id." }));
    };
    app.write(|db| {
        let stored = playlists::tierlists(db)?.into_iter().find(|(i, _)| *i == id).map(|(_, d)| d);
        let mut doc = tierlist.clone();
        // Song ids of duplicate rows name the song.
        if let Some(tiers) = doc["tiers"].as_array_mut() {
            for tier in tiers.iter_mut() {
                let tier_id = tier["tierId"].clone();
                let mut items: Vec<Value> = tier["items"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|i| i.as_str().map(|s| json!(parse_view_id(s).0)))
                    .collect();
                let pending = stored
                    .as_ref()
                    .and_then(|s| s["tiers"].as_array()?.iter().find(|t| t["tierId"] == tier_id).cloned())
                    .map(|t| {
                        t["items"]
                            .as_array()
                            .into_iter()
                            .flatten()
                            .filter(|i| is_pending(i))
                            .cloned()
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                items.extend(pending);
                tier["items"] = Value::Array(items);
            }
        }
        playlists::save_tierlist(db, Some(&id), &doc)
    })
    .map_err(fail)?;
    notify(&handle, &["tierlists"]);
    Ok(json!({ "success": true }))
}

#[tauri::command]
pub fn tierlists_remove(handle: AppHandle, app: State<'_, App>, ids: Vec<String>) -> Res<Value> {
    app.write(|db| ids.iter().try_for_each(|id| playlists::delete_tierlist(db, id))).map_err(fail)?;
    notify(&handle, &["tierlists"]);
    Ok(json!({ "success": true }))
}

/// Card pictures for a tierlist: the large cover thumbnail of each song.
#[tauri::command]
pub fn tierlist_artworks(app: State<'_, App>, song_ids: Vec<String>) -> Res<HashMap<String, String>> {
    let db = app.read();
    let v = view(&app);
    let rows = rows_for(&db, &song_ids).map_err(fail)?;
    Ok(rows
        .iter()
        .filter_map(|r| {
            let hash = r.cover_hash.as_deref()?;
            let id = crate::view::view_id(&r.song_id, r.variant_id, r.is_primary);
            Some((id, v.artwork(Some(hash), "")["artworkPath"].as_str()?.to_owned()))
        })
        .collect())
}

// ----- shuffle --------------------------------------------------------------------------------

/// Weights for the songs of a queue and the pairs to keep apart; the view orders the queue.
#[tauri::command]
pub fn shuffle_data(app: State<'_, App>, song_ids: Vec<String>, intensity: Option<f64>) -> Res<Value> {
    let db = app.read();
    let songs: Vec<String> = song_ids.iter().map(|id| parse_view_id(id).0.to_owned()).collect();
    let weights = nemora_core::shuffle::stored_weights(&db, &songs, intensity.unwrap_or(0.6)).map_err(fail)?;
    // Duplicate rows share their song's weight.
    let by_view: HashMap<&String, f64> =
        song_ids.iter().zip(&songs).filter_map(|(view_id, song)| Some((view_id, *weights.get(song)?))).collect();
    let feedback: Vec<Value> = elo::skipped_pairs(&db)
        .map_err(fail)?
        .iter()
        .map(|s| json!({ "at": s.at, "songAId": s.a, "songBId": s.b, "reason": s.reason.as_str() }))
        .collect();
    Ok(json!({ "weights": by_view, "pairFeedback": feedback }))
}

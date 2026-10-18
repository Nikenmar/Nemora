//! Song Guessr: a random song from a pool to guess, and typo-tolerant search for the guess. The
//! rules are 1.1.9's (`songGuessr.ts`): songs of at least 15 s, not blacklisted; pools of at least
//! ten songs; a round avoids the songs already asked while ten others remain.

use std::collections::{HashMap, HashSet};

use nemora_core::db::Db;
use nemora_core::library::{self, Group, NameSort, SongRow, SongScope, SongSort};
use nemora_core::search::fold::{Variant, normalize, query_variants, text_keys};
use nemora_core::search::romanize::{has_romanizable_script, romanize};
use nemora_core::search::score::score;
use serde_json::{Value, json};
use tauri::State;

use crate::app::App;
use crate::commands::{Res, fail, view};
use crate::view::{View, asset_url, view_id};

const MINIMUM_DURATION_MS: i64 = 15_000;
const MINIMUM_POOL: usize = 10;
const DEFAULT_SEARCH_LIMIT: usize = 8;
const MAX_SEARCH_PAGE: usize = 60;

struct Key {
    text: Vec<u16>,
    penalty: f64,
}

struct Entry {
    row: SongRow,
    title: Vec<Key>,
    artists: Vec<Vec<Key>>,
    combined: Vec<Key>,
}

/// The eligible songs (one row per song) and their search keys.
struct Index {
    entries: Vec<Entry>,
}

fn keys(value: &str) -> Vec<Key> {
    let romanized = has_romanizable_script(value).then(|| romanize(value)).flatten();
    text_keys(value, romanized.as_deref())
        .into_iter()
        .map(|v| Key { text: v.text.encode_utf16().collect(), penalty: v.penalty })
        .collect()
}

fn build(db: &Db) -> nemora_core::Result<Index> {
    let page = library::songs(db, &SongScope::NotBlacklisted, &SongSort::TitleAsc, 0, i64::MAX)?;
    let entries = page
        .rows
        .into_iter()
        .filter(|r| r.is_primary && r.path.is_some() && r.duration_ms >= MINIMUM_DURATION_MS)
        .map(|row| {
            let combined = keys(
                &std::iter::once(row.title.clone()).chain(row.artists.iter().cloned()).collect::<Vec<_>>().join(" "),
            );
            Entry { title: keys(&row.title), artists: row.artists.iter().map(|a| keys(a)).collect(), combined, row }
        })
        .collect();
    Ok(Index { entries })
}

fn index(app: &App) -> Res<std::sync::Arc<Index>> {
    app.derived("guessr", build).map_err(fail)
}

fn entry_json(v: &View, r: &SongRow) -> Value {
    json!({
        "songId": view_id(&r.song_id, r.variant_id, r.is_primary),
        "title": r.title,
        "artists": r.artists,
        "album": r.album,
        "duration": r.duration_ms as f64 / 1000.0,
        "path": r.path.as_deref().map(|p| asset_url(std::path::Path::new(p))),
        "artworkPaths": v.artwork(r.cover_hash.as_deref(), &v.defaults.song),
    })
}

/// Song ids of each pool of a type, keyed by pool id, with the pool's name.
fn pools_of(db: &Db, index: &Index, kind: &str) -> nemora_core::Result<Vec<(String, String, HashSet<String>)>> {
    let eligible: HashSet<&str> = index.entries.iter().map(|e| e.row.song_id.as_str()).collect();
    let keep = |songs: Vec<String>| -> HashSet<String> {
        songs.into_iter().filter(|s| eligible.contains(s.as_str())).collect()
    };
    let mut out: Vec<(String, String, HashSet<String>)> = match kind {
        "playlist" => {
            let mut lists = Vec::new();
            for p in nemora_core::playlists::list(db)? {
                let songs =
                    nemora_core::playlists::items(db, &p.id, false)?.into_iter().filter_map(|i| i.song_id).collect();
                lists.push((p.id, p.name, keep(songs)));
            }
            lists
        }
        "genre" | "artist" => {
            let group = if kind == "genre" { Group::Genre } else { Group::Artist };
            library::members(db, group)?
                .into_iter()
                .map(|(name, members)| (name.clone(), name, keep(members.into_iter().map(|m| m.song_id).collect())))
                .collect()
        }
        "album" => {
            let titles: HashMap<String, String> =
                library::albums(db, NameSort::NameAsc)?.into_iter().map(|a| (a.key, a.title)).collect();
            library::members(db, Group::Album)?
                .into_iter()
                .map(|(key, members)| {
                    let name = titles.get(&key).cloned().unwrap_or_default();
                    (key, name, keep(members.into_iter().map(|m| m.song_id).collect()))
                })
                .collect()
        }
        _ => Vec::new(),
    };
    out.retain(|(_, name, songs)| songs.len() >= MINIMUM_POOL && !name.trim().is_empty());
    out.sort_by(|a, b| a.1.cmp(&b.1).then_with(|| a.0.cmp(&b.0)));
    Ok(out)
}

#[tauri::command]
pub fn guessr_pools(app: State<'_, App>) -> Res<Vec<Value>> {
    let index = index(&app)?;
    let db = app.read();
    let mut pools = vec![json!({ "type": "library", "name": "library", "count": index.entries.len() })];
    for kind in ["playlist", "genre", "artist", "album"] {
        for (id, name, songs) in pools_of(&db, &index, kind).map_err(fail)? {
            pools.push(json!({ "type": kind, "id": id, "name": name, "count": songs.len() }));
        }
    }
    Ok(pools)
}

#[tauri::command]
pub fn guessr_round(app: State<'_, App>, options: Value) -> Res<Value> {
    let index = index(&app)?;
    let kind = options["poolType"].as_str().unwrap_or("");
    let pool: Vec<&Entry> = match kind {
        "library" => index.entries.iter().collect(),
        "playlist" | "genre" | "artist" | "album" => {
            let Some(id) = options["poolId"].as_str() else { return Ok(Value::Null) };
            let db = app.read();
            let Some((_, _, songs)) = pools_of(&db, &index, kind).map_err(fail)?.into_iter().find(|(p, _, _)| p == id)
            else {
                return Ok(Value::Null);
            };
            index.entries.iter().filter(|e| songs.contains(&e.row.song_id)).collect()
        }
        _ => return Ok(Value::Null),
    };
    if pool.is_empty() {
        return Ok(Value::Null);
    }
    let excluded: HashSet<&str> =
        options["excludedSongIds"].as_array().into_iter().flatten().filter_map(|v| v.as_str()).collect();
    let fresh: Vec<&&Entry> = pool
        .iter()
        .filter(|e| !excluded.contains(view_id(&e.row.song_id, e.row.variant_id, e.row.is_primary).as_str()))
        .collect();
    let choose: Vec<&Entry> =
        if fresh.len() >= MINIMUM_POOL { fresh.into_iter().copied().collect() } else { pool.clone() };
    let nanos =
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.subsec_nanos() as usize);
    let answer = choose[nanos % choose.len()];
    Ok(json!({ "answer": entry_json(&view(&app), &answer.row), "poolSize": pool.len() }))
}

fn best(queries: &[(Vec<u16>, f64)], keys: &[Key]) -> f64 {
    let mut best = f64::INFINITY;
    for (q, qp) in queries {
        for k in keys {
            let s = score(q, &k.text) + qp + k.penalty;
            if s < best {
                best = s;
            }
        }
    }
    best
}

#[tauri::command]
pub fn guessr_search(app: State<'_, App>, query: String, limit: Option<usize>, offset: Option<usize>) -> Res<Value> {
    if normalize(query.trim()).is_empty() {
        return Ok(json!({ "candidates": [], "total": 0 }));
    }
    let index = index(&app)?;
    let queries: Vec<(Vec<u16>, f64)> = query_variants(&query)
        .into_iter()
        .map(|Variant { text, penalty }| (text.encode_utf16().collect(), penalty))
        .collect();
    let mut ranked: Vec<(f64, usize)> = index
        .entries
        .iter()
        .enumerate()
        .filter_map(|(i, e)| {
            let mut s = best(&queries, &e.title);
            for artist in &e.artists {
                s = s.min(best(&queries, artist) + 1.0);
            }
            s = s.min(best(&queries, &e.combined) + 2.0);
            s.is_finite().then_some((s, i))
        })
        .collect();
    ranked.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal).then(a.1.cmp(&b.1)));
    let page = limit.unwrap_or(DEFAULT_SEARCH_LIMIT).min(MAX_SEARCH_PAGE);
    let v = view(&app);
    let candidates: Vec<Value> = ranked
        .iter()
        .skip(offset.unwrap_or(0))
        .take(page)
        .map(|(_, i)| {
            let r = &index.entries[*i].row;
            json!({
                "songId": view_id(&r.song_id, r.variant_id, r.is_primary),
                "title": r.title,
                "artists": r.artists,
                "artworkPath": v.artwork(r.cover_hash.as_deref(), &v.defaults.song)["artworkPath"],
            })
        })
        .collect();
    Ok(json!({ "candidates": candidates, "total": ranked.len() }))
}

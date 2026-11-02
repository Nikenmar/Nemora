//! The taste map for Stats > Taste map (PLAN/14 C5, PLAN/17): built by `nemora_core::tastemap` on
//! first use, kept in memory and on disk under the profile, and laid out again only when its inputs
//! change (from the previous positions, so it keeps its shape; afresh only on request). Every read
//! annotates it with what changes: the running shuffle's weights, plays, last heard, tiers, names.

use std::sync::Mutex;

use nemora_core::tastemap::TasteMap;
use tauri::State;

use crate::app::App;
use crate::commands::{Res, fail};

const FILE: &str = "tastemap.v2.json";

#[derive(Default)]
pub struct TasteMapCache(Mutex<Option<TasteMap>>);

impl TasteMapCache {
    /// Reads the last map from disk when this session has not built one yet.
    pub fn warm(&self, app: &App) {
        if let Ok(mut map) = self.0.lock()
            && map.is_none()
        {
            *map = from_disk(app);
        }
    }

    /// Like `warm`, and builds the map when none was ever built: following the map (PLAN/15 C3) and
    /// a lens (S2) need one even if the user never opened it.
    /// `db` is the caller's reader: the reader is a mutex, so this must not lock it again.
    pub fn ensure(&self, app: &App, db: &nemora_core::db::Db) {
        self.warm(app);
        let Ok(mut map) = self.0.lock() else { return };
        if map.is_none()
            && let Ok(built) = nemora_core::tastemap::build(db, None, false)
        {
            if let Ok(text) = serde_json::to_string(&built) {
                let _ = std::fs::write(app.profile.join(FILE), text);
            }
            *map = Some(built);
        }
    }

    /// The last map built (this session's, or the one on disk), for Home's lists (PLAN/19).
    pub fn snapshot(&self, app: &App) -> Option<TasteMap> {
        self.warm(app);
        self.0.lock().ok()?.clone()
    }

    /// Every song's neighbours on the last map built, for following the map (PLAN/15 C3).
    pub fn all_neighbours(&self) -> std::collections::HashMap<String, Vec<String>> {
        self.0
            .lock()
            .ok()
            .and_then(|map| {
                map.as_ref().map(|m| m.points.iter().map(|p| (p.song_id.clone(), p.neighbours.clone())).collect())
            })
            .unwrap_or_default()
    }

    /// The neighbours of `song_id` on the last map built, for "More like this" (C2).
    pub fn neighbours(&self, song_id: &str) -> Vec<String> {
        self.0
            .lock()
            .ok()
            .and_then(|map| map.as_ref()?.points.iter().find(|p| p.song_id == song_id).map(|p| p.neighbours.clone()))
            .unwrap_or_default()
    }
}

fn from_disk(app: &App) -> Option<TasteMap> {
    serde_json::from_str(&std::fs::read_to_string(app.profile.join(FILE)).ok()?).ok()
}

/// The map of the library, annotated for the view; `fresh` lays it out again from scratch. Dots
/// are sized by Smart Shuffle as it runs with `options` and `intensity` (the user's settings).
#[tauri::command]
pub async fn taste_map(
    app: State<'_, App>,
    cache: State<'_, TasteMapCache>,
    options: Option<nemora_core::shuffle::Options>,
    intensity: Option<f64>,
    fresh: Option<bool>,
) -> Res<TasteMap> {
    let previous = cache.0.lock().map_err(fail)?.clone().or_else(|| from_disk(&app));
    let prepared = app.derived("shuffle", nemora_core::shuffle::prepare).map_err(fail)?;
    // The inputs under the reader's lock; the layout (up to a second for a fresh map of a large
    // library) without it, so searches and lists are not kept waiting (PLAN/20 D2).
    let inputs = nemora_core::tastemap::stored_inputs(&app.read()).map_err(fail)?;
    let fresh = fresh.unwrap_or(false);
    let (mut map, previous) = tauri::async_runtime::spawn_blocking(move || {
        (nemora_core::tastemap::build_from(&inputs, previous.as_ref(), fresh), previous)
    })
    .await
    .map_err(fail)?;
    let db = app.read();
    if previous.as_ref().is_none_or(|p| p.hash != map.hash || p.points != map.points)
        && let Ok(text) = serde_json::to_string(&map)
    {
        let _ = std::fs::write(app.profile.join(FILE), text);
    }
    *cache.0.lock().map_err(fail)? = Some(map.clone());
    let weights = nemora_core::shuffle::weights_prepared(
        &db,
        &prepared,
        &[],
        intensity.unwrap_or(0.6),
        &options.unwrap_or_default(),
    )
    .map_err(fail)?;
    nemora_core::tastemap::annotate(&db, &mut map, &weights).map_err(fail)?;
    Ok(map)
}

/// Names an island of the last map built (an empty name gives the automatic one back).
#[tauri::command]
pub async fn taste_map_rename(
    app: State<'_, App>,
    cache: State<'_, TasteMapCache>,
    island: usize,
    name: String,
) -> Res<()> {
    let Some(map) = cache.0.lock().map_err(fail)?.clone() else { return Ok(()) };
    app.write_quiet(|db| nemora_core::tastemap::rename(db, &map, island, &name)).map_err(fail)
}

/// The songs heard in the session going on now, oldest first, for the map's trail.
#[tauri::command]
pub async fn taste_map_session(app: State<'_, App>) -> Res<Vec<String>> {
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64);
    nemora_core::listening::session(&app.read(), now).map_err(fail)
}

/// A journey across the last map built, from one song to another, about `length` songs.
#[tauri::command]
pub async fn taste_map_journey(
    cache: State<'_, TasteMapCache>,
    from: String,
    to: String,
    length: Option<usize>,
) -> Res<Vec<String>> {
    let map = cache.0.lock().map_err(fail)?.clone();
    Ok(map.map(|m| nemora_core::tastemap::journey(&m, &from, &to, length.unwrap_or(20))).unwrap_or_default())
}

//! The taste map for Stats > Taste map (PLAN/14 C5): built by `nemora_core::tastemap` on first use,
//! kept in memory and on disk under the profile, and laid out again only when its inputs change.

use std::sync::Mutex;

use nemora_core::tastemap::TasteMap;
use tauri::State;

use crate::app::App;
use crate::commands::{Res, fail};

const FILE: &str = "tastemap.v1.json";

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

/// The map of the library; a layout is reused while the songs, plays, artists and tiers stay the same.
#[tauri::command]
pub async fn taste_map(app: State<'_, App>, cache: State<'_, TasteMapCache>) -> Res<TasteMap> {
    let previous = cache.0.lock().map_err(fail)?.clone().or_else(|| from_disk(&app));
    let map = nemora_core::tastemap::build(&app.read(), previous.as_ref()).map_err(fail)?;
    if previous.as_ref().is_none_or(|p| p.hash != map.hash)
        && let Ok(text) = serde_json::to_string(&map)
    {
        let _ = std::fs::write(app.profile.join(FILE), text);
    }
    *cache.0.lock().map_err(fail)? = Some(map.clone());
    Ok(map)
}

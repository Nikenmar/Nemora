//! PLAN/21 P21.4: one persistence layer for the view's local state, slice by slice, in the core.
//!
//! The view keeps its state in one webview `localStorage` blob. Each slice of it (preferences,
//! playback, the queue, sorting, the equalizer, the lyrics editor, duels, the artist-resolution
//! ignores) is written here as well - a device setting `view.<slice>`, and the queue also as the
//! core's own `queue_items` - and read back by the view to compare (the shadow read). The blob stays
//! the source until the comparison has stayed empty through daily use; the view's flag
//! `nemora.persist.readFromCore` (off) then reads the slices from here instead.
//!
//! A slice is kept as the JSON text the view wrote, not parsed: serde_json's default float parsing
//! is not exact (2.2199999999999998 came back as 2.22, measured on the stand), so a parsed copy
//! would not round-trip. Only the queue is parsed, for `queue_items`, which holds no fractions.
//!
//! Writes are quiet (`App::write_quiet`): nothing the lists or the derived values read changes,
//! so no cache is dropped.

use std::collections::HashMap;

use nemora_core::queue::{Queue, QueueItem};
use serde::Serialize;
use serde_json::Value;
use tauri::State;

use crate::app::App;
use crate::commands::{Res, fail};

const PREFIX: &str = "view.";

/// The slices of the view's `LocalStorage`, by its own names.
pub const SLICES: &[&str] = &[
    "preferences",
    "playback",
    "queue",
    "ignoredSeparateArtists",
    "ignoredSongsWithFeatArtists",
    "ignoredDuplicates",
    "sortingStates",
    "equalizerPreset",
    "lyricsEditorSettings",
    "duels",
];

/// The core's own queue, as `queue_items` and the `queue.*` settings hold it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(specta::Type))]
pub struct CoreQueue {
    pub song_ids: Vec<String>,
    pub index: usize,
    pub position_ms: i64,
}

/// What the core keeps of the view's state: each slice's JSON text as written, and the queue.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(specta::Type))]
pub struct Persisted {
    pub slices: HashMap<String, String>,
    pub core_queue: Option<CoreQueue>,
}

/// The view's queue slice as the core's queue: its songs (a view id `song:variant` as its song;
/// songs `known` does not accept left out, the current index following), the current one and where
/// it stood.
fn core_queue(queue: &Value, playback: Option<&Value>, known: impl Fn(&str) -> bool) -> Queue {
    let songs = queue.get("queue").and_then(Value::as_array).cloned().unwrap_or_default();
    let source_kind = queue.get("queueType").and_then(Value::as_str).map(str::to_owned);
    let source_id = queue.get("queueId").and_then(Value::as_str).map(str::to_owned);
    let current = queue.get("currentSongIndex").and_then(Value::as_u64).unwrap_or(0) as usize;
    let mut items = Vec::new();
    let mut index = 0;
    for (position, id) in songs.iter().enumerate() {
        let Some(id) = id.as_str() else { continue };
        let song_id = crate::view::parse_view_id(id).0;
        if !known(song_id) {
            continue;
        }
        if position < current {
            index = items.len() + 1;
        } else if position == current {
            index = items.len();
        }
        items.push(QueueItem {
            song_id: song_id.to_owned(),
            variant_hint: None,
            source_kind: source_kind.clone(),
            source_id: source_id.clone(),
        });
    }
    let index = index.min(items.len().saturating_sub(1));
    let seconds =
        playback.and_then(|p| p.pointer("/currentSong/stoppedPosition")).and_then(Value::as_f64).unwrap_or(0.0);
    Queue { items, index, position_ms: (seconds * 1000.0).round() as i64 }
}

/// Writes the slices given (any of [`SLICES`], each as its JSON text; other names are ignored),
/// beside the view's blob.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn persist_write(app: State<'_, App>, slices: HashMap<String, String>) -> Res<()> {
    write(&app, &slices).map_err(fail)
}

fn stored_text(db: &nemora_core::db::Db, name: &str) -> nemora_core::Result<Option<String>> {
    Ok(nemora_core::settings::device(db, &format!("{PREFIX}{name}"))?.and_then(|v| match v {
        Value::String(text) => Some(text),
        _ => None,
    }))
}

fn write(app: &App, slices: &HashMap<String, String>) -> nemora_core::Result<()> {
    app.write_quiet(|db| {
        for name in SLICES {
            if let Some(text) = slices.get(*name) {
                nemora_core::settings::set_device(db, &format!("{PREFIX}{name}"), &Value::String(text.clone()))?;
            }
        }
        if let Some(queue) = slices.get("queue").and_then(|text| serde_json::from_str::<Value>(text).ok()) {
            let playback = match slices.get("playback") {
                Some(text) => Some(text.clone()),
                None => stored_text(db, "playback")?,
            }
            .and_then(|text| serde_json::from_str::<Value>(&text).ok());
            // `queue_items` refers to `tracks`: a song the library does not have is left out.
            let ids = queue.get("queue").and_then(Value::as_array).cloned().unwrap_or_default();
            let known = nemora_core::queue::known_songs(
                db,
                ids.iter().filter_map(Value::as_str).map(|id| crate::view::parse_view_id(id).0),
            )?;
            let core = core_queue(&queue, playback.as_ref(), |id| known.contains(id));
            nemora_core::queue::save(db, &core)?;
        }
        Ok(())
    })
}

/// Every slice written so far, as written, and the core's queue, for the view to compare.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn persist_read(app: State<'_, App>) -> Res<Persisted> {
    read(&app).map_err(fail)
}

fn read(app: &App) -> nemora_core::Result<Persisted> {
    let db = app.read();
    let mut slices = HashMap::new();
    for name in SLICES {
        if let Some(text) = stored_text(&db, name)? {
            slices.insert((*name).to_owned(), text);
        }
    }
    let core_queue = nemora_core::queue::load(&db)?.map(|queue| CoreQueue {
        song_ids: queue.items.iter().map(|item| item.song_id.clone()).collect(),
        index: queue.index,
        position_ms: queue.position_ms,
    });
    Ok(Persisted { slices, core_queue })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn the_queue_slice_becomes_the_core_queue() {
        let queue =
            json!({ "currentSongIndex": 1, "queue": ["a", "b", "c"], "queueType": "playlist", "queueId": "p1" });
        let playback = json!({ "currentSong": { "songId": "b", "stoppedPosition": 12.3456 } });
        let core = core_queue(&queue, Some(&playback), |_| true);
        assert_eq!(core.items.iter().map(|i| i.song_id.as_str()).collect::<Vec<_>>(), ["a", "b", "c"]);
        assert_eq!(core.items[0].source_kind.as_deref(), Some("playlist"));
        assert_eq!(core.items[0].source_id.as_deref(), Some("p1"));
        assert_eq!(core.index, 1);
        assert_eq!(core.position_ms, 12346);
        // No current song, no playback: the start.
        let empty = core_queue(&json!({ "currentSongIndex": null, "queue": [] }), None, |_| true);
        assert!(empty.items.is_empty());
        assert_eq!((empty.index, empty.position_ms), (0, 0));
    }

    #[test]
    fn unknown_songs_leave_the_core_queue_and_the_index_follows() {
        let queue = json!({ "currentSongIndex": 3, "queue": ["x", "a:7", "y", "b", "c"], "queueType": "songs" });
        let core = core_queue(&queue, None, |id| id != "x" && id != "y");
        // A version's view id is its song.
        assert_eq!(core.items.iter().map(|i| i.song_id.as_str()).collect::<Vec<_>>(), ["a", "b", "c"]);
        assert_eq!(core.index, 1, "b was at 3 and is at 1");
        // The current song itself unknown: the next known one.
        let core = core_queue(&json!({ "currentSongIndex": 2, "queue": ["a", "b", "y", "c"] }), None, |id| id != "y");
        assert_eq!(core.index, 2);
        // Nothing known: empty.
        assert!(core_queue(&json!({ "currentSongIndex": 0, "queue": ["y"] }), None, |_| false).items.is_empty());
    }

    #[test]
    fn every_slice_comes_back_as_written() {
        let dir = std::env::temp_dir().join(format!("nemora-persist-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let app = App::open(&dir).unwrap();
        let mut slices = HashMap::new();
        for name in SLICES {
            // Text as the view writes it, with a float serde_json would not parse back exactly.
            slices.insert(
                (*name).to_owned(),
                format!(r#"{{"slice":"{name}","at":2.2199999999999998,"list":[1,"x",null]}}"#),
            );
        }
        // Songs an empty library does not have: the slice comes back whole, the core queue stays empty.
        slices
            .insert("queue".to_owned(), r#"{"currentSongIndex":0,"queue":["s1","s2"],"queueType":"songs"}"#.to_owned());
        slices.insert("unknown".to_owned(), "1".to_owned());
        write(&app, &slices).unwrap();
        let back = read(&app).unwrap();
        for name in SLICES {
            assert_eq!(back.slices.get(*name), slices.get(*name), "{name}");
        }
        assert!(!back.slices.contains_key("unknown"));
        assert_eq!(back.core_queue, None);
        drop(app);
        let _ = std::fs::remove_dir_all(&dir);
    }
}

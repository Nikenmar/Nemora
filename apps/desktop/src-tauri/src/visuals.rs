//! A track's visual envelope for the view (PLAN/14 B0): analysed once in the background by
//! `nemora_audio::visuals`, kept on disk under the profile and the last few in memory.

use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use tauri::State;
use tauri::ipc::Response;

use crate::app::App;
use crate::commands::{Res, fail, rows_for};

const KEPT: usize = 20;

#[derive(Default)]
pub struct Visuals(Mutex<VecDeque<(String, Arc<Vec<u8>>)>>);

impl Visuals {
    fn get(&self, song_id: &str) -> Option<Arc<Vec<u8>>> {
        let mut kept = self.0.lock().ok()?;
        let at = kept.iter().position(|(id, _)| id == song_id)?;
        let entry = kept.remove(at)?;
        let bytes = entry.1.clone();
        kept.push_back(entry);
        Some(bytes)
    }

    fn keep(&self, song_id: String, bytes: Arc<Vec<u8>>) {
        let Ok(mut kept) = self.0.lock() else { return };
        kept.retain(|(id, _)| *id != song_id);
        kept.push_back((song_id, bytes));
        while kept.len() > KEPT {
            kept.pop_front();
        }
    }
}

/// The envelope of the song at `path`: its cache file, else a fresh analysis, written to the cache
/// when `keep` (the energy job reads three numbers out of it and keeps none: 50-80 KB a song).
pub fn envelope(profile: &std::path::Path, song_id: &str, path: &str, keep: bool) -> Vec<u8> {
    let file = cached(profile, song_id);
    if let Ok(bytes) = std::fs::read(&file) {
        return bytes;
    }
    let Ok(bytes) = nemora_audio::visuals::analyse(std::path::Path::new(path)) else { return Vec::new() };
    if !keep {
        return bytes;
    }
    if let Some(dir) = file.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let _ = std::fs::write(&file, &bytes);
    bytes
}

fn cached(profile: &std::path::Path, song_id: &str) -> PathBuf {
    let name: String = song_id.chars().filter(char::is_ascii_alphanumeric).collect();
    profile.join("visuals").join(format!("{name}.v{}.bin", nemora_audio::visuals::VERSION))
}

/// The envelope of `song_id` as raw bytes (layout in `nemora_audio::visuals`); empty when the song
/// is unknown or cannot be decoded, so the view simply draws nothing.
#[tauri::command]
pub async fn track_visuals(app: State<'_, App>, visuals: State<'_, Visuals>, song_id: String) -> Res<Response> {
    if let Some(bytes) = visuals.get(&song_id) {
        return Ok(Response::new(bytes.to_vec()));
    }
    let profile = app.profile.clone();
    let id = song_id.clone();
    let path = {
        let db = app.read();
        rows_for(&db, std::slice::from_ref(&song_id)).map_err(fail)?.into_iter().next().and_then(|r| r.path)
    };
    let Some(path) = path else { return Ok(Response::new(Vec::new())) };
    let bytes =
        tauri::async_runtime::spawn_blocking(move || envelope(&profile, &id, &path, true)).await.map_err(fail)?;
    if !bytes.is_empty() {
        visuals.keep(song_id, Arc::new(bytes.clone()));
    }
    Ok(Response::new(bytes))
}

//! Switch version's sound per song (`nemora_core::song_sound`): kept in the library, and - when
//! the view asks - in Nemora's own field of the song's files, so it travels with them.

use std::collections::HashMap;

use nemora_core::song_sound::{self, SongSound};
use serde::Serialize;
use tauri::State;

use crate::app::App;
use crate::commands::{Res, fail};

/// Every song's own sound, by song id.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn song_sounds(app: State<'_, App>) -> Res<HashMap<String, SongSound>> {
    Ok(song_sound::all(&app.read()).map_err(fail)?.into_iter().collect())
}

/// What writing the files did: written, without a place for the field (the library still has the
/// sound), or failed (read-only, locked) with the reason.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(specta::Type))]
pub struct SoundSaved {
    pub written: usize,
    pub unsupported: usize,
    pub failed: Vec<String>,
}

/// Keeps the song's sound (`None`: back to the original) in the library, and with `write_file` in
/// its present files too, the playing song's as well: `write_field` replaces a file with a finished
/// copy, and the engine goes on reading the one it opened. The view sends one write at a time.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn song_sound_set(
    app: State<'_, App>,
    song_id: String,
    sound: Option<SongSound>,
    write_file: bool,
) -> Res<SoundSaved> {
    let song = crate::view::parse_view_id(&song_id).0.to_owned();
    // The library's own setting: nothing the lists or the derived values read.
    app.write_quiet(|db| song_sound::set(db, &song, sound.as_ref())).map_err(fail)?;
    let mut saved = SoundSaved { written: 0, unsupported: 0, failed: Vec::new() };
    if !write_file {
        return Ok(saved);
    }
    let mut files = song_sound::files(&app.read(), &song).map_err(fail)?;
    // A bench or stand run uses a copy of the library but the user's own music files: it never
    // writes into them, only into files inside its own folder.
    if let Some(bench) = crate::bench::dir() {
        files.retain(|path| path.starts_with(bench));
    }
    let text = sound.as_ref().map(song_sound::encode);
    let saved = tauri::async_runtime::spawn_blocking(move || {
        for path in files {
            match song_sound::write_field(&path, text.as_deref()) {
                Ok(true) => saved.written += 1,
                Ok(false) => saved.unsupported += 1,
                Err(error) => saved.failed.push(error.to_string()),
            }
        }
        saved
    })
    .await
    .map_err(fail)?;
    if !saved.failed.is_empty() {
        log::warn!("Switch version: {} file(s) not written: {:?}", saved.failed.len(), saved.failed);
    }
    Ok(saved)
}

//! Versions (PLAN/18 D6): "Make version", rename, change the sound, remove. A version is the song
//! with a sound of its own; the view addresses it as `<song id>:v<version id>`.

use nemora_core::versions::{self, Version};
use tauri::{AppHandle, State};

use crate::app::App;
use crate::commands::{Res, fail, notify};
use crate::view::parse_view_id;

fn changed(handle: &AppHandle) {
    notify(handle, &["songs", "playlists"]);
}

/// Makes a version of the song a view id names; answers the new row's view id.
#[tauri::command]
pub async fn version_create(handle: AppHandle, app: State<'_, App>, song_id: String, version: Version) -> Res<String> {
    let song = parse_view_id(&song_id).0.to_owned();
    let id = app.write(|db| versions::create(db, &song, &version)).map_err(fail)?;
    changed(&handle);
    Ok(format!("{song}:v{id}"))
}

#[tauri::command]
pub async fn version_rename(handle: AppHandle, app: State<'_, App>, version_id: i64, name: String) -> Res<()> {
    app.write(|db| versions::rename(db, version_id, &name)).map_err(fail)?;
    changed(&handle);
    Ok(())
}

/// Changes a version's sound (speed, keep pitch, reverb, size); the name stays.
#[tauri::command]
pub async fn version_update(handle: AppHandle, app: State<'_, App>, version_id: i64, sound: Version) -> Res<()> {
    app.write(|db| versions::set_sound(db, version_id, &sound)).map_err(fail)?;
    changed(&handle);
    Ok(())
}

/// Removes a version and its playlist items; the song and its statistics stay.
#[tauri::command]
pub async fn version_remove(handle: AppHandle, app: State<'_, App>, version_id: i64) -> Res<()> {
    app.write(|db| versions::remove(db, version_id)).map_err(fail)?;
    changed(&handle);
    Ok(())
}

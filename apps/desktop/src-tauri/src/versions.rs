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

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Saved {
    pub seconds: f64,
    /// Samples past full scale: clamped in 24-bit, kept in float.
    pub overs: u64,
}

/// Saves a song played with a sound as a file (PLAN/18 D4): the sound is `sound` when given (the
/// panel's), otherwise the version's the view id names. `format` is "wav24" or "float"; the file
/// carries the song's tags and cover, titled "Title (Name)".
#[tauri::command]
pub async fn version_render(
    app: State<'_, App>,
    song_id: String,
    sound: Option<Version>,
    format: String,
    path: String,
) -> Res<Saved> {
    use nemora_audio::render::{Format, Sound, render};
    use nemora_audio::reverb::Size;

    let row = {
        let db = app.read();
        crate::commands::rows_for(&db, std::slice::from_ref(&song_id)).map_err(fail)?.into_iter().next()
    };
    let Some(row) = row else { return Err(fail("the song is not in the library")) };
    let Some(source) = row.path.clone() else { return Err(fail("the song has no file on this device")) };
    let Some(version) = sound.or_else(|| row.version.clone()) else { return Err(fail("no sound to save")) };
    let base = match &row.version {
        Some(v) => row.title.strip_suffix(&format!(" - {}", v.name)).unwrap_or(&row.title).to_owned(),
        None => row.title.clone(),
    };
    let title = format!("{base} ({})", version.name.trim());
    let sound = Sound {
        semitones: version.semitones,
        keep_pitch: version.keep_pitch,
        reverb: version.reverb,
        size: Size::named(&version.size),
    };
    let format = if format == "float" { Format::WavFloat } else { Format::Wav24 };
    tauri::async_runtime::spawn_blocking(move || {
        let (source, out) = (std::path::Path::new(&source), std::path::Path::new(&path));
        let rendered = render(source, &sound, out, format)?;
        nemora_core::tags::copy_tags(source, out, &title).map_err(|e| e.to_string())?;
        Ok::<_, String>(Saved { seconds: rendered.seconds, overs: rendered.overs })
    })
    .await
    .map_err(fail)?
    .map_err(fail)
}

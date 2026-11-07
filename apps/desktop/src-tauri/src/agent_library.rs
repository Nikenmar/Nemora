//! What an agent may change in the library (PLAN/22 P22.3, P22.4), done the way the app's own
//! commands do it, so the view refreshes as for the user's own edits. Playlist and favourite
//! changes keep an undo (`library.undo`, the latest 50, this session).
//!
//! Files: tag edits and deletes need the `full` level; a tag edit without `dryRun: false` only says
//! what it would change; a delete goes to the recycle bin, never for good.

use std::sync::Mutex;

use nemora_core::library;
use serde_json::{Value, json};
use tauri::{AppHandle, Manager};

use crate::agent::Level;
use crate::app::App;
use crate::commands::{fail, notify};

const UNDO_LIMIT: usize = 50;

#[derive(Debug, Clone)]
pub enum Undo {
    Created { playlist_id: String, name: String },
    Deleted { playlist_id: String, name: String },
    Renamed { playlist_id: String, from: String },
    Added { playlist_id: String, song_ids: Vec<String> },
    Removed { playlist_id: String, song_ids: Vec<String> },
    Favorite { song_ids: Vec<String>, was: bool },
}

#[derive(Default)]
pub struct UndoStack(Mutex<Vec<Undo>>);

impl UndoStack {
    fn push(&self, undo: Undo) {
        let mut stack = self.0.lock().unwrap_or_else(|e| e.into_inner());
        stack.push(undo);
        if stack.len() > UNDO_LIMIT {
            stack.remove(0);
        }
    }

    fn pop(&self) -> Option<Undo> {
        self.0.lock().unwrap_or_else(|e| e.into_inner()).pop()
    }
}

/// What each method needs. `files.tags` is read with `dryRun` (the default) and full without.
pub fn level_of(method: &str) -> Option<Level> {
    Some(match method {
        "library.duel_pair" | "files.tags" => Level::Read,
        "library.playlist_create"
        | "library.playlist_rename"
        | "library.playlist_add"
        | "library.playlist_remove"
        | "library.playlist_delete"
        | "library.favorite"
        | "library.lyrics_save"
        | "library.version_create"
        | "library.switch_version"
        | "library.rescan"
        | "library.spotify_preview"
        | "library.duel_submit"
        | "library.undo" => Level::Control,
        "files.delete" => Level::Full,
        _ => return None,
    })
}

fn string(params: &Value, key: &str) -> Result<String, String> {
    params
        .get(key)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| format!("`{key}` is missing"))
}

fn songs(params: &Value, key: &str) -> Result<Vec<String>, String> {
    let list = params.get(key).and_then(Value::as_array).ok_or_else(|| format!("`{key}` is a list of song ids"))?;
    let ids: Vec<String> =
        list.iter().filter_map(Value::as_str).map(|id| id.split(':').next().unwrap_or(id).to_owned()).collect();
    if ids.is_empty() {
        return Err(format!("`{key}` is empty"));
    }
    Ok(ids)
}

fn playlist_name(app: &App, id: &str) -> Result<String, String> {
    nemora_core::playlists::list(&app.read())
        .map_err(fail)?
        .into_iter()
        .find(|p| p.id == id)
        .map(|p| p.name)
        .ok_or_else(|| format!("No playlist `{id}`; see list_playlists. Favorites is changed with set_favorite."))
}

fn path_of(app: &App, song_id: &str) -> Result<String, String> {
    let db = app.read();
    let variants = library::primary_variants(&db, &[song_id.to_owned()]).map_err(fail)?;
    let variant = variants.get(song_id).ok_or_else(|| format!("No present song `{song_id}`."))?;
    library::rows_by_id(&db, &[*variant])
        .map_err(fail)?
        .into_iter()
        .next()
        .and_then(|r| r.path)
        .ok_or_else(|| format!("The file of `{song_id}` is missing."))
}

/// A bench or stand run uses a copy of the library but the user's own music files: an agent there
/// changes only files inside the run's folder (as `sounds.rs` does for the Switch version field).
fn writable(path: &str) -> Result<(), String> {
    match crate::bench::dir() {
        Some(bench) if !std::path::Path::new(path).starts_with(bench) => {
            Err("This is a test run of Nemora: it changes no music file outside its own folder.".into())
        }
        _ => Ok(()),
    }
}

/// `level` is the user's access level, for what a method allows within its own level.
pub async fn run(handle: &AppHandle, method: &str, params: &Value, level: Level) -> Result<Value, String> {
    let app = handle.state::<App>();
    let undo = handle.state::<UndoStack>();
    match method {
        "library.playlist_create" => {
            let name = string(params, "name")?;
            let ids = params.get("songIds").map(|_| songs(params, "songIds")).transpose()?;
            let made = crate::commands::playlist_create(handle.clone(), app.clone(), name.clone(), ids, None)?;
            if made.get("success") != Some(&Value::Bool(true)) {
                return Err(made
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("The playlist was not created.")
                    .to_owned());
            }
            let id = made["playlist"]["playlistId"].as_str().unwrap_or_default().to_owned();
            undo.push(Undo::Created { playlist_id: id.clone(), name: name.clone() });
            Ok(json!({ "playlistId": id, "name": name }))
        }
        "library.playlist_rename" => {
            let id = string(params, "playlistId")?;
            let name = string(params, "name")?;
            let from = playlist_name(&app, &id)?;
            crate::commands::playlist_rename(handle.clone(), app.clone(), id.clone(), name.clone())?;
            undo.push(Undo::Renamed { playlist_id: id.clone(), from });
            Ok(json!({ "playlistId": id, "name": name }))
        }
        "library.playlist_add" => {
            let id = string(params, "playlistId")?;
            let ids = songs(params, "songIds")?;
            playlist_name(&app, &id)?;
            let before: std::collections::HashSet<String> = nemora_core::playlists::items(&app.read(), &id, false)
                .map_err(fail)?
                .into_iter()
                .filter_map(|i| i.song_id)
                .collect();
            crate::commands::playlist_add_songs(handle.clone(), app.clone(), id.clone(), ids.clone())?;
            let added: Vec<String> = ids.into_iter().filter(|s| !before.contains(s)).collect();
            undo.push(Undo::Added { playlist_id: id.clone(), song_ids: added.clone() });
            Ok(json!({ "playlistId": id, "added": added.len(), "alreadyThere": before.len() }))
        }
        "library.playlist_remove" => {
            let id = string(params, "playlistId")?;
            let ids = songs(params, "songIds")?;
            playlist_name(&app, &id)?;
            for song in &ids {
                crate::commands::playlist_remove_song(handle.clone(), app.clone(), id.clone(), song.clone())?;
            }
            undo.push(Undo::Removed { playlist_id: id.clone(), song_ids: ids.clone() });
            Ok(json!({ "playlistId": id, "removed": ids.len() }))
        }
        "library.playlist_delete" => {
            let id = string(params, "playlistId")?;
            let name = playlist_name(&app, &id)?;
            crate::commands::playlist_remove(handle.clone(), app.clone(), vec![id.clone()])?;
            undo.push(Undo::Deleted { playlist_id: id.clone(), name: name.clone() });
            Ok(json!({ "deleted": name, "undo": "library.undo brings it back with its songs" }))
        }
        "library.favorite" => {
            let ids = songs(params, "songIds")?;
            let like = params.get("favorite").and_then(Value::as_bool).unwrap_or(true);
            let was: std::collections::HashSet<String> =
                nemora_core::playlists::favorites(&app.read()).map_err(fail)?.into_iter().collect();
            let changed: Vec<String> = ids.iter().filter(|s| was.contains(*s) != like).cloned().collect();
            if !changed.is_empty() {
                crate::commands::favorites_toggle(handle.clone(), app.clone(), changed.clone(), Some(like))?;
                undo.push(Undo::Favorite { song_ids: changed.clone(), was: !like });
            }
            Ok(json!({ "changed": changed.len(), "favorite": like }))
        }
        "library.lyrics_save" => {
            let id = string(params, "songId")?;
            let text = string(params, "text")?;
            let path = path_of(&app, &id)?;
            crate::commands::lyrics_save(handle.clone(), app.clone(), path, text)?;
            Ok(
                json!({ "saved": true, "note": "kept in Nemora's library as the user's own edit; the file is not changed" }),
            )
        }
        "library.version_create" => {
            let id = string(params, "songId")?;
            let version = nemora_core::versions::Version {
                id: 0,
                song_id: id.clone(),
                name: string(params, "name")?,
                semitones: params.get("semitones").and_then(Value::as_f64).unwrap_or(0.0).clamp(-12.0, 12.0),
                keep_pitch: params.get("keepPitch").and_then(Value::as_bool).unwrap_or(false),
                reverb: params.get("reverb").and_then(Value::as_f64).unwrap_or(0.0).clamp(0.0, 1.0),
                size: params.get("size").and_then(Value::as_str).unwrap_or("hall").to_owned(),
            };
            let view_id = crate::versions::version_create(handle.clone(), app.clone(), id, version).await?;
            Ok(json!({ "viewId": view_id }))
        }
        "library.switch_version" => {
            let id = string(params, "songId")?;
            let sound = match params.get("sound") {
                None | Some(Value::Null) => None,
                Some(value) => Some(serde_json::from_value(value.clone()).map_err(|e| format!("`sound`: {e}"))?),
            };
            // The file's own field only at the full level, and only when the user keeps it on.
            let write_file = level >= Level::Full && params.get("writeFile").and_then(Value::as_bool).unwrap_or(false);
            let saved = crate::sounds::song_sound_set(app.clone(), id, sound, write_file).await?;
            notify(handle, &["songs"]);
            Ok(json!({ "kept": true, "filesWritten": saved.written, "failed": saved.failed }))
        }
        "library.rescan" => crate::commands::library_rescan(handle.clone(), app.clone()).await,
        "library.spotify_preview" => {
            let preview = crate::spotify_import::spotify_playlist_preview(app.clone(), string(params, "link")?).await?;
            serde_json::to_value(preview).map_err(fail)
        }
        "library.duel_pair" => crate::duels::duel_pair(app.clone(), None, None).await,
        "library.duel_submit" => crate::duels::duel_submit(
            handle.clone(),
            app.clone(),
            string(params, "songAId")?,
            string(params, "songBId")?,
            string(params, "winnerId")?,
        ),
        "library.undo" => {
            let last = undo.pop().ok_or("Nothing an agent did this session is left to undo.")?;
            undo_one(handle, &app, last)
        }
        "files.tags" => edit_tags(handle, &app, params, level).await,
        "files.delete" => {
            if params.get("confirm").and_then(Value::as_bool) != Some(true) {
                return Err(
                    "Deleting needs `confirm: true`, after the user agreed. Files go to the recycle bin.".into()
                );
            }
            let ids = songs(params, "songIds")?;
            let paths = ids.iter().map(|id| path_of(&app, id)).collect::<Result<Vec<_>, _>>()?;
            paths.iter().try_for_each(|path| writable(path))?;
            let outcome =
                crate::commands::songs_delete_files(handle.clone(), app.clone(), paths.clone(), false).await?;
            Ok(json!({ "movedToRecycleBin": paths, "outcome": outcome }))
        }
        other => Err(format!("`{other}` is not served.")),
    }
}

fn undo_one(handle: &AppHandle, app: &tauri::State<'_, App>, undo: Undo) -> Result<Value, String> {
    match undo {
        Undo::Created { playlist_id, name } => {
            crate::commands::playlist_remove(handle.clone(), app.clone(), vec![playlist_id])?;
            Ok(json!({ "undone": format!("created playlist '{name}': deleted") }))
        }
        Undo::Deleted { playlist_id, name } => {
            app.write(|db| nemora_core::playlists::restore(db, &playlist_id)).map_err(fail)?;
            notify(handle, &["playlists"]);
            Ok(json!({ "undone": format!("deleted playlist '{name}': back with its songs") }))
        }
        Undo::Renamed { playlist_id, from } => {
            crate::commands::playlist_rename(handle.clone(), app.clone(), playlist_id, from.clone())?;
            Ok(json!({ "undone": format!("rename: back to '{from}'") }))
        }
        Undo::Added { playlist_id, song_ids } => {
            for song in &song_ids {
                crate::commands::playlist_remove_song(handle.clone(), app.clone(), playlist_id.clone(), song.clone())?;
            }
            Ok(json!({ "undone": format!("{} added songs removed", song_ids.len()) }))
        }
        Undo::Removed { playlist_id, song_ids } => {
            crate::commands::playlist_add_songs(handle.clone(), app.clone(), playlist_id, song_ids.clone())?;
            Ok(json!({ "undone": format!("{} removed songs back (at the end)", song_ids.len()) }))
        }
        Undo::Favorite { song_ids, was } => {
            crate::commands::favorites_toggle(handle.clone(), app.clone(), song_ids.clone(), Some(was))?;
            Ok(json!({ "undone": format!("favourite back to {was} for {} songs", song_ids.len()) }))
        }
    }
}

/// A tag edit: what would change (always), and with `dryRun: false` at the full level, the write.
async fn edit_tags(
    handle: &AppHandle,
    app: &tauri::State<'_, App>,
    params: &Value,
    level: Level,
) -> Result<Value, String> {
    use nemora_core::tags::{TagEdit, read_tags, write_tags};
    let id = string(params, "songId")?;
    let path = path_of(app, &id)?;
    let current = read_tags(std::path::Path::new(&path)).map_err(fail)?;
    let changes = params.get("changes").cloned().unwrap_or(Value::Null);
    let text = |key: &str| changes.get(key).and_then(Value::as_str).map(|s| s.trim().to_owned());
    let list = |key: &str| {
        changes
            .get(key)
            .and_then(Value::as_array)
            .map(|a| a.iter().filter_map(Value::as_str).map(|s| s.trim().to_owned()).collect::<Vec<_>>())
    };
    let edit = TagEdit {
        title: text("title").unwrap_or_else(|| current.title.clone()),
        artists: list("artists").unwrap_or_else(|| current.artists.clone()),
        album_artists: list("albumArtists").unwrap_or_else(|| current.album_artists.clone()),
        album: match changes.get("album") {
            Some(Value::Null) => None,
            Some(_) => text("album").filter(|a| !a.is_empty()),
            None => current.album.clone(),
        },
        genres: list("genres").unwrap_or_else(|| current.genres.clone()),
        year: match changes.get("year") {
            Some(Value::Null) => None,
            Some(v) => v.as_i64(),
            None => current.year,
        },
        track_no: match changes.get("trackNumber") {
            Some(Value::Null) => None,
            Some(v) => v.as_u64().map(|n| n as u32),
            None => current.track_no,
        },
        composer: match changes.get("composer") {
            Some(Value::Null) => None,
            Some(_) => text("composer"),
            None => current.composer.clone(),
        },
        cover: None,
    };
    let before = json!({
        "title": current.title, "artists": current.artists, "albumArtists": current.album_artists, "album": current.album,
        "genres": current.genres, "year": current.year, "trackNumber": current.track_no, "composer": current.composer,
    });
    let after = json!({
        "title": edit.title, "artists": edit.artists, "albumArtists": edit.album_artists, "album": edit.album,
        "genres": edit.genres, "year": edit.year, "trackNumber": edit.track_no, "composer": edit.composer,
    });
    let changed: Vec<&str> = ["title", "artists", "albumArtists", "album", "genres", "year", "trackNumber", "composer"]
        .into_iter()
        .filter(|k| before[*k] != after[*k])
        .collect();
    let dry_run = params.get("dryRun").and_then(Value::as_bool) != Some(false);
    if dry_run || changed.is_empty() {
        return Ok(json!({ "dryRun": true, "file": path, "changes": changed, "before": before, "after": after }));
    }
    if level < Level::Full {
        return Err(format!(
            "Writing tags changes the user's music file and needs the `full` level; Nemora allows `{}`. The dry run above shows what would change.",
            level_name(level)
        ));
    }
    writable(&path)?;
    write_tags(std::path::Path::new(&path), &edit).map_err(fail)?;
    app.scan().map_err(fail)?;
    notify(handle, &["songs/updatedSong", "songs", "artists", "albums", "genres"]);
    Ok(json!({ "dryRun": false, "file": path, "written": changed }))
}

fn level_name(level: Level) -> &'static str {
    match level {
        Level::Off => "off",
        Level::Read => "read",
        Level::Control => "control",
        Level::Full => "full",
    }
}

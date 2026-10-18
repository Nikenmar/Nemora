//! The tag editor: tags read from the file, edits written back. The audio is never touched, so a
//! song keeps its id and statistics through any edit; lyrics go into the library, not the file.

use std::path::Path;

use nemora_core::library::{self, SongRow};
use nemora_core::tags::{TagEdit, read_tags, write_tags};
use serde_json::{Value, json};
use tauri::{AppHandle, State};

use crate::app::App;
use crate::commands::{Res, fail, notify, rows_for, view};

/// The file of a known song (view id), or the path itself for a file outside the library.
fn resolve(app: &App, id_or_path: &str, known: bool) -> Res<(String, Option<SongRow>)> {
    if !known {
        let path = crate::protocol::local_path_from_asset_url(id_or_path).unwrap_or_else(|| id_or_path.to_owned());
        return Ok((path, None));
    }
    let row = rows_for(&app.read(), &[id_or_path.to_owned()]).map_err(fail)?.into_iter().next();
    let row = row.ok_or("SONG_NOT_FOUND")?;
    let path = row.path.clone().ok_or("SONG_NOT_FOUND")?;
    Ok((path, Some(row)))
}

fn names(list: &[String]) -> Vec<Value> {
    list.iter().map(|n| json!({ "artistId": n, "name": n })).collect()
}

/// 1.x `SongTags` for the editor.
#[tauri::command]
pub fn tags_get(app: State<'_, App>, song_id_or_path: String, is_known_source: bool) -> Res<Value> {
    let (path, row) = resolve(&app, &song_id_or_path, is_known_source)?;
    let tags = read_tags(Path::new(&path)).map_err(fail)?;
    let v = view(&app);
    let stored = match &row {
        Some(r) => nemora_core::lyrics::stored(&app.read(), &r.song_id).map_err(fail)?.map(|(text, _)| text),
        None => None,
    };
    let (synced, unsynced) = match stored {
        Some(text) if nemora_core::lyrics::is_synced(&text) => (Some(text), None),
        Some(text) => (None, Some(text)),
        None => (None, None),
    };
    let artwork =
        row.as_ref().and_then(|r| r.cover_hash.as_deref()).map(|h| v.artwork(Some(h), "")["artworkPath"].clone());
    Ok(json!({
        "title": tags.title,
        "artists": names(&tags.artists),
        "albumArtists": names(&tags.album_artists),
        "album": tags.album.as_ref().map(|a| json!({ "title": a, "albumId": a })),
        "trackNumber": tags.track_no,
        "releasedYear": tags.year,
        "genres": tags.genres.iter().map(|g| json!({ "genreId": g, "name": g })).collect::<Vec<_>>(),
        "composer": tags.composer,
        "synchronizedLyrics": synced,
        "unsynchronizedLyrics": unsynced,
        "artworkPath": artwork,
        "duration": tags.duration_ms as f64 / 1000.0,
    }))
}

fn list_of(value: &Value) -> Vec<String> {
    value
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|v| v["name"].as_str().map(|s| s.trim().to_owned()))
        .filter(|s| !s.is_empty())
        .collect()
}

/// The picture the editor names, when it is a new one: a file the user picked. The current cover
/// comes back as its own URL and is kept as it is.
fn new_cover(artwork_path: Option<&str>) -> Option<Vec<u8>> {
    let path = artwork_path.filter(|p| !p.is_empty())?;
    if path.starts_with("http://nemora.localhost/") || path.starts_with("http") || path.starts_with("data:") {
        return None;
    }
    std::fs::read(path).ok()
}

/// Writes the editor's tags into the file, keeps its lyrics in the library, rescans, and answers
/// with the song as the player shows it.
#[tauri::command]
pub async fn tags_update(
    handle: AppHandle,
    app: State<'_, App>,
    song_id_or_path: String,
    tags: Value,
    is_known_source: bool,
) -> Res<Value> {
    let (path, row) = resolve(&app, &song_id_or_path, is_known_source)?;
    let edit = TagEdit {
        title: tags["title"].as_str().unwrap_or("").trim().to_owned(),
        artists: list_of(&tags["artists"]),
        album_artists: list_of(&tags["albumArtists"]),
        album: tags["album"]["title"].as_str().map(|a| a.trim().to_owned()).filter(|a| !a.is_empty()),
        genres: list_of(&tags["genres"]),
        year: tags["releasedYear"].as_i64(),
        track_no: tags["trackNumber"].as_u64().map(|n| n as u32),
        composer: tags["composer"].as_str().map(str::to_owned),
        cover: new_cover(tags["artworkPath"].as_str()),
    };
    if let Err(error) = write_tags(Path::new(&path), &edit) {
        return Ok(json!({ "success": false, "reason": error.to_string() }));
    }
    if let Some(row) = &row {
        let lyrics = tags["synchronizedLyrics"].as_str().or(tags["unsynchronizedLyrics"].as_str());
        if let Some(text) = lyrics.filter(|t| !t.trim().is_empty()) {
            let changed =
                nemora_core::lyrics::stored(&app.read(), &row.song_id).map_err(fail)?.is_none_or(|(s, _)| s != text);
            if changed {
                app.write(|db| nemora_core::lyrics::save(db, &row.song_id, text, "user")).map_err(fail)?;
            }
        }
    }
    app.scan().map_err(fail)?;
    notify(&handle, &["songs/updatedSong", "songs", "artists", "albums", "genres", "songs/lyrics"]);
    let updated = match &row {
        Some(r) => {
            let fresh = rows_for(&app.read(), std::slice::from_ref(&r.song_id)).map_err(fail)?.into_iter().next();
            fresh.map(|r| view(&app).player_data(&r))
        }
        None => None,
    };
    Ok(json!({ "success": true, "updatedData": updated }))
}

/// Reads a file's tags again (after an outside edit) by rescanning; answers with the song.
#[tauri::command]
pub async fn song_reparse(handle: AppHandle, app: State<'_, App>, path: String) -> Res<Value> {
    app.scan().map_err(fail)?;
    notify(&handle, &["songs/updatedSong"]);
    let db = app.read();
    let Some(song) = library::song_at(&db, &path).map_err(fail)? else { return Ok(Value::Null) };
    let row = rows_for(&db, &[song]).map_err(fail)?.into_iter().next();
    Ok(row.map_or(Value::Null, |r| view(&app).song_data(&r)))
}

/// Saves a cover to a file the user chose: the full-size picture from a song that carries it (the
/// store keeps thumbnails only), converted to the format the destination's extension names.
#[tauri::command]
pub fn artwork_save(app: State<'_, App>, source: String, destination: String) -> Res<()> {
    let local = crate::protocol::local_path_from_asset_url(&source).unwrap_or(source);
    let hash = Path::new(&local)
        .file_stem()
        .and_then(|s| s.to_str())
        .and_then(|s| s.split('-').next())
        .filter(|h| h.len() == 64 && h.bytes().all(|b| b.is_ascii_hexdigit()))
        .map(str::to_owned);
    let original = match hash {
        Some(hash) => library::file_with_cover(&app.read(), &hash)
            .map_err(fail)?
            .and_then(|song| read_tags(Path::new(&song)).ok()?.cover.map(|c| c.data)),
        None => None,
    };
    let bytes = match original {
        Some(bytes) => bytes,
        None => std::fs::read(&local).map_err(fail)?,
    };
    let format = image::ImageFormat::from_path(&destination).ok();
    let same = format.is_some_and(|f| image::guess_format(&bytes).ok() == Some(f));
    match format {
        Some(format) if !same => {
            let picture = image::load_from_memory(&bytes).map_err(fail)?;
            picture.save_with_format(&destination, format).map_err(fail)
        }
        _ => std::fs::write(&destination, bytes).map_err(fail),
    }
}

// ----- artist suggestions ---------------------------------------------------------------------

/// A file's current tags as an edit that changes nothing yet.
fn current_edit(path: &str) -> nemora_core::Result<TagEdit> {
    let t = read_tags(Path::new(path))?;
    Ok(TagEdit {
        title: t.title,
        artists: t.artists,
        album_artists: t.album_artists,
        album: t.album,
        genres: t.genres,
        year: t.year,
        track_no: t.track_no,
        composer: t.composer,
        cover: None,
    })
}

/// The files of every song credited to one of `names` (as artist or album artist).
fn files_of_artists(app: &App, names: &[String]) -> Res<Vec<String>> {
    let db = app.read();
    let members = library::members(&db, library::Group::Artist).map_err(fail)?;
    let variants: std::collections::HashSet<i64> =
        names.iter().flat_map(|n| members.get(n).into_iter().flatten().map(|m| m.variant_id)).collect();
    Ok(library::files(&db)
        .map_err(fail)?
        .into_iter()
        .filter(|f| variants.contains(&f.variant_id))
        .map(|f| f.path)
        .collect())
}

/// Applies `change` to the tags of every file, rescans and tells the view.
fn rewrite(handle: &AppHandle, app: &App, files: &[String], change: impl Fn(&mut TagEdit)) -> Res<Value> {
    for path in files {
        let mut edit = current_edit(path).map_err(fail)?;
        change(&mut edit);
        if let Err(error) = write_tags(Path::new(path), &edit) {
            return Ok(json!({ "success": false, "reason": error.to_string() }));
        }
    }
    app.scan().map_err(fail)?;
    notify(handle, &["songs/updatedSong", "songs", "artists", "albums"]);
    Ok(json!({ "success": true }))
}

/// Replaces `from` names with `to` names in a list, keeping order and dropping repeats.
fn replace_names(list: &mut Vec<String>, from: &[String], to: &[String]) {
    let mut out: Vec<String> = Vec::new();
    for name in list.drain(..) {
        let replacement: Vec<String> = if from.contains(&name) { to.to_vec() } else { vec![name] };
        for n in replacement {
            if !out.contains(&n) {
                out.push(n);
            }
        }
    }
    *list = out;
}

/// Artists whose names differ only in case, accents or spacing.
#[tauri::command]
pub fn artist_duplicates(app: State<'_, App>, artist_name: String) -> Res<Vec<Value>> {
    use nemora_core::search::fold::normalize;
    let db = app.read();
    let wanted = normalize(artist_name.trim());
    let names: Vec<String> = library::artists(&db, library::NameSort::NameAsc)
        .map_err(fail)?
        .into_iter()
        .filter(|a| normalize(a.name.trim()) == wanted)
        .map(|a| a.name)
        .collect();
    crate::commands::artists_of(&db, &view(&app), &names, None, 0).map_err(fail)
}

/// Merges duplicate artists into the chosen spelling, in the files of their songs.
#[tauri::command]
pub async fn artist_resolve_duplicates(
    handle: AppHandle,
    app: State<'_, App>,
    selected_artist_id: String,
    duplicate_ids: Vec<String>,
) -> Res<Value> {
    let duplicates: Vec<String> = duplicate_ids.into_iter().filter(|d| *d != selected_artist_id).collect();
    let files = files_of_artists(&app, &duplicates)?;
    let to = [selected_artist_id];
    rewrite(&handle, &app, &files, |edit| {
        replace_names(&mut edit.artists, &duplicates, &to);
        replace_names(&mut edit.album_artists, &duplicates, &to);
    })
}

/// Splits one artist credit ("A & B") into separate artists, in the files of its songs.
#[tauri::command]
pub async fn artist_resolve_separate(
    handle: AppHandle,
    app: State<'_, App>,
    separate_artist_id: String,
    separate_artist_names: Vec<String>,
) -> Res<Value> {
    let from = [separate_artist_id];
    let to: Vec<String> = separate_artist_names.iter().map(|n| n.trim().to_owned()).filter(|n| !n.is_empty()).collect();
    let files = files_of_artists(&app, &from)?;
    rewrite(&handle, &app, &files, |edit| {
        replace_names(&mut edit.artists, &from, &to);
        replace_names(&mut edit.album_artists, &from, &to);
    })
}

/// Adds the artists named in a "feat." credit to a song, optionally taking the credit out of the
/// title (1.x's pattern).
#[tauri::command]
pub async fn artist_resolve_featuring(
    handle: AppHandle,
    app: State<'_, App>,
    song_id: String,
    feat_artist_names: Vec<String>,
    remove_feat_info_in_title: Option<bool>,
) -> Res<Value> {
    let (path, _) = resolve(&app, &song_id, true)?;
    let names: Vec<String> = feat_artist_names.iter().map(|n| n.trim().to_owned()).filter(|n| !n.is_empty()).collect();
    if names.is_empty() {
        return Err("At least one featuring artist is required.".into());
    }
    let feat = regex::Regex::new(r"(?i)\s*\(?\s*feat\.?\s+[^)]+\)?").expect("a valid pattern");
    let strip = remove_feat_info_in_title.unwrap_or(false);
    rewrite(&handle, &app, &[path], |edit| {
        for name in &names {
            if !edit.artists.contains(name) {
                edit.artists.push(name.clone());
            }
        }
        if strip {
            edit.title = feat.replace_all(&edit.title, "").trim().to_owned();
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replaced_names_keep_their_place_once() {
        let mut list = vec!["A & B".to_owned(), "C".to_owned(), "A".to_owned()];
        replace_names(&mut list, &["A & B".to_owned()], &["A".to_owned(), "B".to_owned()]);
        assert_eq!(list, ["A", "B", "C"]);
    }
}

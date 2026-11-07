//! A public Spotify playlist brought in by its link (`nemora_core::spotify`): read from Spotify's
//! embed page, its tracks found in the library (`nemora_core::playlist_match`), shown to the user,
//! who makes the playlist from it. Nothing is kept until then.

use nemora_core::playlist_match::{Confidence, Matcher, library};
use serde::Serialize;
use tauri::State;

use crate::app::App;
use crate::commands::{Res, fail};

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(specta::Type))]
pub struct SpotifyTrack {
    pub title: String,
    pub artists: Vec<String>,
    pub duration_ms: Option<f64>,
    /// The library's song, if found.
    pub song_id: Option<String>,
    /// `exact` or `likely`, with `song_id`.
    pub confidence: Option<String>,
    /// The found song as the library names it, for the user to check.
    pub library_title: Option<String>,
    pub library_artists: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(specta::Type))]
pub struct SpotifyPreview {
    pub id: String,
    pub name: String,
    pub owner: Option<String>,
    pub cover_url: Option<String>,
    /// Spotify's page shows the first 100 tracks: a longer playlist comes cut.
    pub may_be_cut: bool,
    pub tracks: Vec<SpotifyTrack>,
}

/// The playlist behind a link, each track with the library's song if there is one.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn spotify_playlist_preview(app: State<'_, App>, link: String) -> Res<SpotifyPreview> {
    let id = nemora_core::spotify::playlist_id(&link).ok_or_else(|| fail("not a Spotify playlist link"))?;
    let playlist =
        tauri::async_runtime::spawn_blocking(move || nemora_core::spotify::fetch(&id)).await.map_err(fail)??;
    let candidates = library(&app.read()).map_err(fail)?;
    let names: std::collections::HashMap<String, (String, Vec<String>)> =
        candidates.iter().map(|c| (c.song_id.clone(), (c.title.clone(), c.artists.clone()))).collect();
    let matcher = Matcher::new(candidates);
    let tracks = playlist
        .tracks
        .iter()
        .map(|track| {
            let found = matcher.find(track);
            let (library_title, library_artists) = found
                .as_ref()
                .and_then(|f| names.get(&f.song_id))
                .map_or((None, Vec::new()), |(title, artists)| (Some(title.clone()), artists.clone()));
            SpotifyTrack {
                library_title,
                library_artists,
                title: track.title.clone(),
                artists: track.artists.clone(),
                duration_ms: track.duration_ms.map(|d| d as f64),
                confidence: found.as_ref().map(|f| {
                    match f.confidence {
                        Confidence::Exact => "exact",
                        Confidence::Likely => "likely",
                    }
                    .to_owned()
                }),
                song_id: found.map(|f| f.song_id),
            }
        })
        .collect();
    Ok(SpotifyPreview {
        id: playlist.id,
        name: playlist.name,
        owner: playlist.owner,
        cover_url: playlist.cover_url,
        may_be_cut: playlist.may_be_cut,
        tracks,
    })
}

/// The playlist's cover saved to a file for the new playlist (`playlist_create` takes a path).
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn spotify_cover(id: String, url: String) -> Res<String> {
    if !id.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err(fail("not a playlist id"));
    }
    let bytes =
        tauri::async_runtime::spawn_blocking(move || nemora_core::spotify::fetch_cover(&url)).await.map_err(fail)??;
    // A bench or stand run keeps every byte inside its own folder.
    let folder = crate::bench::dir().map_or_else(std::env::temp_dir, std::path::Path::to_path_buf);
    let path = folder.join(format!("nemora-spotify-cover-{id}.jpg"));
    std::fs::write(&path, bytes).map_err(fail)?;
    Ok(path.to_string_lossy().into_owned())
}

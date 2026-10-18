//! The shapes the 1.1.9 view reads (`src/types/app.d.ts`), built from core rows.
//!
//! The view keys songs by one id. A song is one audio stream; when the same stream sits in files
//! with different tags, each set of tags is its own library row sharing the song's statistics.
//! The first row of a song is addressed by the bare song id, every further row by
//! `<song id>:<variant id>`, so the common case reads exactly like a song id everywhere.

use std::path::Path;

use nemora_core::covers::{CoverStore, THUMB_SIZES};
use nemora_core::library::{AlbumRow, Member, NamedRow, SongRow};
use percent_encoding::{AsciiSet, NON_ALPHANUMERIC, utf8_percent_encode};
use serde_json::{Value, json};

use crate::app::DefaultArtwork;

pub fn view_id(song_id: &str, variant_id: i64, is_primary: bool) -> String {
    if is_primary { song_id.to_owned() } else { format!("{song_id}:{variant_id}") }
}

/// The song and, for a duplicate row, its variant.
pub fn parse_view_id(id: &str) -> (&str, Option<i64>) {
    match id.split_once(':') {
        Some((song, variant)) => (song, variant.parse().ok()),
        None => (id, None),
    }
}

/// What `encodeURIComponent` leaves alone.
const COMPONENT: &AsciiSet = &NON_ALPHANUMERIC
    .remove(b'-')
    .remove(b'_')
    .remove(b'.')
    .remove(b'!')
    .remove(b'~')
    .remove(b'*')
    .remove(b'\'')
    .remove(b'(')
    .remove(b')');

/// A local file as the webview loads it: through the `nemora` scheme, which on Windows is reachable
/// only as `http://nemora.localhost/` (protocol.rs).
pub fn asset_url(path: &Path) -> String {
    format!("http://nemora.localhost/{}", utf8_percent_encode(&path.to_string_lossy(), COMPONENT))
}

pub struct View<'a> {
    pub covers: &'a CoverStore,
    pub defaults: DefaultArtwork,
}

impl View<'_> {
    /// 1.x `ArtworkPaths`: the large thumbnail, the small one, or the bundled default.
    pub fn artwork(&self, cover: Option<&str>, default: &str) -> Value {
        match cover {
            Some(hash) => json!({
                "isDefaultArtwork": false,
                "artworkPath": asset_url(&self.covers.thumbnail_path(hash, THUMB_SIZES[1])),
                "optimizedArtworkPath": asset_url(&self.covers.thumbnail_path(hash, THUMB_SIZES[0])),
            }),
            None => json!({ "isDefaultArtwork": true, "artworkPath": default, "optimizedArtworkPath": default }),
        }
    }

    fn song_artwork(&self, r: &SongRow) -> Value {
        self.artwork(r.cover_hash.as_deref(), &self.defaults.song)
    }

    pub fn audio_info(&self, r: &SongRow) -> Value {
        json!({
            "title": r.title,
            "artists": artists(&r.artists),
            "album": album(r),
            "duration": seconds(r.duration_ms),
            "artworkPaths": self.song_artwork(r),
            "path": r.path,
            "songId": view_id(&r.song_id, r.variant_id, r.is_primary),
            "addedDate": r.added_at,
            "isAFavorite": r.is_favorite,
            "year": r.year,
            "isBlacklisted": r.is_blacklisted,
            "trackNo": r.track_no,
        })
    }

    pub fn song_data(&self, r: &SongRow) -> Value {
        json!({
            "songId": view_id(&r.song_id, r.variant_id, r.is_primary),
            "title": r.title,
            "duration": seconds(r.duration_ms),
            "artists": artists(&r.artists),
            "album": album(r),
            "trackNo": r.track_no,
            "discNo": r.disc_no,
            "year": r.year,
            "isAFavorite": r.is_favorite,
            "isArtworkAvailable": r.cover_hash.is_some(),
            "path": r.path,
            "addedDate": r.added_at,
            "artworkPaths": self.song_artwork(r),
            "isBlacklisted": r.is_blacklisted,
        })
    }

    /// What the player needs to start a song; `path` is the URL the audio element loads.
    pub fn player_data(&self, r: &SongRow) -> Value {
        let artwork = self.song_artwork(r);
        json!({
            "songId": view_id(&r.song_id, r.variant_id, r.is_primary),
            "title": r.title,
            "artists": artists(&r.artists),
            "duration": seconds(r.duration_ms),
            "artwork": artwork["artworkPath"],
            "artworkPath": artwork["artworkPath"],
            "path": r.path.as_deref().map(|p| asset_url(Path::new(p))),
            "isAFavorite": r.is_favorite,
            "album": album(r),
            "isKnownSource": true,
            "isBlacklisted": r.is_blacklisted,
        })
    }

    pub fn artist(&self, row: &NamedRow, members: &[Member]) -> Value {
        json!({
            "artistId": row.name,
            "name": row.name,
            "songs": songs(members),
            "isAFavorite": false,
            "artworkPaths": self.artwork(row.cover_hash.as_deref(), &self.defaults.artist),
        })
    }

    pub fn album(&self, row: &AlbumRow, members: &[Member]) -> Value {
        json!({
            "albumId": row.key,
            "title": row.title,
            "artists": row.artists.iter().map(|a| json!({ "artistId": a, "name": a })).collect::<Vec<_>>(),
            "songs": songs(members),
            "year": row.year,
            "artworkPaths": self.artwork(row.cover_hash.as_deref(), &self.defaults.album),
        })
    }

    pub fn genre(&self, row: &NamedRow, members: &[Member]) -> Value {
        json!({
            "genreId": row.name,
            "name": row.name,
            "songs": songs(members),
            "artworkPaths": self.artwork(row.cover_hash.as_deref(), &self.defaults.genre),
        })
    }

    pub fn playlist(&self, id: &str, name: &str, songs: Vec<String>, created_at: i64, cover: Option<&str>) -> Value {
        let default = match id {
            "Favorites" => &self.defaults.favorites,
            "History" => &self.defaults.history,
            "Rediscover" => &self.defaults.rediscover,
            _ => &self.defaults.playlist,
        };
        let artwork = match id {
            "Favorites" | "History" | "Rediscover" => self.artwork(None, default),
            _ => self.artwork(cover, default),
        };
        json!({
            "playlistId": id,
            "name": name,
            "songs": songs,
            "createdDate": iso(created_at),
            "isArtworkAvailable": cover.is_some(),
            "artworkPaths": artwork,
        })
    }
}

fn seconds(ms: i64) -> f64 {
    ms as f64 / 1000.0
}

fn artists(names: &[String]) -> Value {
    if names.is_empty() {
        return Value::Null;
    }
    Value::Array(names.iter().map(|a| json!({ "artistId": a, "name": a })).collect())
}

/// The album as a song row knows it: by title. `getAlbums` accepts titles as well as keys.
fn album(r: &SongRow) -> Value {
    r.album.as_ref().map_or(Value::Null, |a| json!({ "albumId": a, "name": a }))
}

fn songs(members: &[Member]) -> Vec<Value> {
    members
        .iter()
        .map(|m| json!({ "title": m.title, "songId": view_id(&m.song_id, m.variant_id, m.is_primary) }))
        .collect()
}

/// Milliseconds since the epoch as the ISO string `JSON.stringify(new Date(ms))` gives.
pub fn iso(ms: i64) -> String {
    nemora_core::time::iso_ms(ms)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn duplicate_rows_get_their_own_ids() {
        assert_eq!(view_id("abc", 7, true), "abc");
        assert_eq!(view_id("abc", 7, false), "abc:7");
        assert_eq!(parse_view_id("abc:7"), ("abc", Some(7)));
        assert_eq!(parse_view_id("abc"), ("abc", None));
    }

    #[test]
    fn urls_match_convert_file_src() {
        assert_eq!(
            asset_url(Path::new(r"E:\Музыка\a b(1).flac")),
            "http://nemora.localhost/E%3A%5C%D0%9C%D1%83%D0%B7%D1%8B%D0%BA%D0%B0%5Ca%20b(1).flac"
        );
    }

    #[test]
    fn iso_dates_read_like_javascript() {
        assert_eq!(iso(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(iso(1_760_000_000_123), "2025-10-09T08:53:20.123Z");
    }
}

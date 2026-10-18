//! Playlists, hearts, the blacklist, tierlists and settings: the documents a user makes. Each is
//! last-writer-wins (`updated_at`, `updated_by`) and deletions are tombstones, so sync can merge
//! them later. Items reference songs by audio id; a song whose file is gone stays in place and is
//! hidden unless the user asked to see missing songs (decision of 2026-10-18).

use std::collections::HashMap;

use rusqlite::{OptionalExtension, params};

use crate::db::{Db, now_ms};
use crate::error::Result;
use crate::m3u;

/// Settings keys of the two "show missing songs" switches.
pub const SHOW_MISSING_IN_PLAYLISTS: &str = "show_missing.playlists";
pub const SHOW_MISSING_IN_TIERLISTS: &str = "show_missing.tierlists";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlaylistRow {
    pub id: String,
    pub name: String,
    pub song_count: i64,
    pub pinned_position: Option<i64>,
    /// A picture the user chose for the playlist.
    pub custom_cover: Option<String>,
    /// Up to four distinct covers for a mosaic.
    pub covers: Vec<String>,
    pub created_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ItemRow {
    pub position: i64,
    pub song_id: Option<String>,
    pub variant_id: Option<i64>,
    pub title: String,
    pub artists: Vec<String>,
    pub duration_ms: i64,
    pub cover_hash: Option<String>,
    /// The file is gone (or the song was never found: an imported pending item).
    pub missing: bool,
}

fn device(db: &Db) -> Result<String> {
    db.device_id()
}

fn touch_playlist(db: &Db, id: &str) -> Result<()> {
    db.conn().execute(
        "UPDATE playlists SET updated_at = ?2, updated_by = ?3 WHERE playlist_id = ?1",
        params![id, now_ms(), device(db)?],
    )?;
    db.touch();
    Ok(())
}

/// Live playlists: pinned first in their order, then by name.
pub fn list(db: &Db) -> Result<Vec<PlaylistRow>> {
    let conn = db.conn();
    let mut stmt = conn.prepare(
        "SELECT p.playlist_id, p.name, p.pinned_position, p.created_at,
                (SELECT count(*) FROM playlist_items i WHERE i.playlist_id = p.playlist_id AND i.song_id IS NOT NULL),
                p.cover_hash
         FROM playlists p WHERE p.deleted_at IS NULL",
    )?;
    let mut rows: Vec<PlaylistRow> = stmt
        .query_map([], |r| {
            Ok(PlaylistRow {
                id: r.get(0)?,
                name: r.get(1)?,
                pinned_position: r.get(2)?,
                created_at: r.get(3)?,
                song_count: r.get(4)?,
                custom_cover: r.get(5)?,
                covers: Vec::new(),
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    let mut covers = conn.prepare(
        "SELECT DISTINCT v.cover_hash FROM playlist_items i JOIN track_variants v ON v.song_id = i.song_id
         WHERE i.playlist_id = ?1 AND v.cover_hash IS NOT NULL ORDER BY i.position LIMIT 4",
    )?;
    for row in &mut rows {
        row.covers = covers.query_map([&row.id], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
    }
    use crate::search::fold::normalize;
    rows.sort_by(|a, b| match (a.pinned_position, b.pinned_position) {
        (Some(x), Some(y)) => x.cmp(&y),
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => normalize(&a.name).cmp(&normalize(&b.name)).then_with(|| a.id.cmp(&b.id)),
    });
    Ok(rows)
}

pub fn create(db: &Db, name: &str) -> Result<String> {
    let id = crate::ids::random();
    let now = now_ms();
    db.conn().execute(
        "INSERT INTO playlists (playlist_id, name, created_at, updated_at, updated_by) VALUES (?1, ?2, ?3, ?3, ?4)",
        params![id, name, now, device(db)?],
    )?;
    db.touch();
    Ok(id)
}

pub fn rename(db: &Db, id: &str, name: &str) -> Result<()> {
    db.conn().execute("UPDATE playlists SET name = ?2 WHERE playlist_id = ?1", params![id, name])?;
    touch_playlist(db, id)
}

/// A tombstone: the playlist disappears everywhere once synced, its items stay for undo.
pub fn delete(db: &Db, id: &str) -> Result<()> {
    db.conn().execute("UPDATE playlists SET deleted_at = ?2 WHERE playlist_id = ?1", params![id, now_ms()])?;
    touch_playlist(db, id)
}

pub fn set_pinned(db: &Db, id: &str, position: Option<i64>) -> Result<()> {
    db.conn().execute("UPDATE playlists SET pinned_position = ?2 WHERE playlist_id = ?1", params![id, position])?;
    touch_playlist(db, id)
}

/// The items in order. Missing and pending items are left out unless `include_missing`.
pub fn items(db: &Db, id: &str, include_missing: bool) -> Result<Vec<ItemRow>> {
    let conn = db.conn();
    let mut stmt = conn.prepare(
        "SELECT i.position, i.song_id, i.variant_hint, p.title, p.file_name
         FROM playlist_items i LEFT JOIN pending_tracks p ON p.pending_id = i.pending_id
         WHERE i.playlist_id = ?1 ORDER BY i.position",
    )?;
    let raw: Vec<(i64, Option<String>, Option<String>, Option<String>, Option<String>)> = stmt
        .query_map([id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)))?
        .collect::<rusqlite::Result<_>>()?;
    let mut out = Vec::new();
    for (position, song_id, hint, pending_title, pending_file) in raw {
        let row = match &song_id {
            Some(song) => display_row(db, position, song, hint.as_deref())?,
            None => ItemRow {
                position,
                song_id: None,
                variant_id: None,
                title: pending_title.or(pending_file).unwrap_or_default(),
                artists: Vec::new(),
                duration_ms: 0,
                cover_hash: None,
                missing: true,
            },
        };
        if include_missing || !row.missing {
            out.push(row);
        }
    }
    Ok(out)
}

/// The variant to show for a song: the hinted one if its file is there, else any present one,
/// else the last known.
fn display_row(db: &Db, position: i64, song: &str, hint: Option<&str>) -> Result<ItemRow> {
    let conn = db.conn();
    let variant: Option<(i64, String, Option<String>, bool)> = conn
        .query_row(
            "SELECT variant_id, title, cover_hash, present FROM track_variants WHERE song_id = ?1
             ORDER BY present DESC, tag_signature = ?2 DESC, last_seen_at DESC, variant_id LIMIT 1",
            params![song, hint.unwrap_or("")],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()?;
    let duration: i64 = conn
        .query_row("SELECT duration_ms FROM tracks WHERE song_id = ?1", [song], |r| r.get(0))
        .optional()?
        .unwrap_or(0);
    let (variant_id, title, cover, present) =
        variant.map_or((None, String::new(), None, false), |(v, t, c, p)| (Some(v), t, c, p));
    let artists = match variant_id {
        Some(v) => conn
            .prepare_cached(
                "SELECT name FROM variant_artists WHERE variant_id = ?1 AND role = 'artist' ORDER BY position",
            )?
            .query_map([v], |r| r.get(0))?
            .collect::<rusqlite::Result<_>>()?,
        None => Vec::new(),
    };
    Ok(ItemRow {
        position,
        song_id: Some(song.to_owned()),
        variant_id,
        title,
        artists,
        duration_ms: duration,
        cover_hash: cover,
        missing: !present,
    })
}

/// Rewrites a playlist's items in the given order (positions 0..n).
fn write_items(db: &mut Db, id: &str, items: &[(Option<String>, Option<i64>, Option<String>)]) -> Result<()> {
    let tx = db.conn_mut().transaction()?;
    tx.execute("DELETE FROM playlist_items WHERE playlist_id = ?1", [id])?;
    for (position, (song, pending, hint)) in items.iter().enumerate() {
        tx.execute(
            "INSERT INTO playlist_items (playlist_id, position, song_id, pending_id, variant_hint) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, position as i64, song, pending, hint],
        )?;
    }
    tx.commit()?;
    touch_playlist(db, id)
}

fn read_items(db: &Db, id: &str) -> Result<Vec<(Option<String>, Option<i64>, Option<String>)>> {
    let mut stmt = db.conn().prepare(
        "SELECT song_id, pending_id, variant_hint FROM playlist_items WHERE playlist_id = ?1 ORDER BY position",
    )?;
    let items = stmt.query_map([id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?.collect::<rusqlite::Result<_>>()?;
    Ok(items)
}

/// Adds songs (with the variant the user picked, if any) at `at`, or at the end.
pub fn add(db: &mut Db, id: &str, songs: &[(String, Option<String>)], at: Option<usize>) -> Result<()> {
    let mut items = read_items(db, id)?;
    let at = at.unwrap_or(items.len()).min(items.len());
    let new: Vec<_> = songs.iter().map(|(s, hint)| (Some(s.clone()), None, hint.clone())).collect();
    items.splice(at..at, new);
    write_items(db, id, &items)
}

/// Removes the items at the given positions (positions as stored, including hidden items).
pub fn remove(db: &mut Db, id: &str, positions: &[i64]) -> Result<()> {
    let items: Vec<_> = read_items(db, id)?
        .into_iter()
        .enumerate()
        .filter(|(i, _)| !positions.contains(&(*i as i64)))
        .map(|(_, item)| item)
        .collect();
    write_items(db, id, &items)
}

pub fn move_item(db: &mut Db, id: &str, from: usize, to: usize) -> Result<()> {
    let mut items = read_items(db, id)?;
    if from >= items.len() {
        return Ok(());
    }
    let item = items.remove(from);
    items.insert(to.min(items.len()), item);
    write_items(db, id, &items)
}

/// The songs of an M3U/M3U8 file found in the present library, before they go anywhere.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct M3uMatch {
    /// (song, tag signature of the matched file), in file order.
    pub songs: Vec<(String, Option<String>)>,
    pub entries: usize,
    pub by_method: Vec<(String, usize)>,
    /// The lines nothing in the library matched (as written in the file).
    pub unresolved: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct M3uImport {
    pub playlist_id: String,
    pub entries: usize,
    pub resolved: usize,
    pub by_method: Vec<(String, usize)>,
    /// The lines nothing in the library matched (as written in the file).
    pub unresolved: Vec<String>,
}

/// Creates a playlist from an M3U/M3U8 file written by any player. Unmatched entries are reported,
/// not added.
pub fn import_m3u(db: &mut Db, name: &str, text: &str) -> Result<M3uImport> {
    let found = match_m3u(db, text)?;
    let playlist_id = create(db, name)?;
    add(db, &playlist_id, &found.songs, None)?;
    Ok(M3uImport {
        playlist_id,
        entries: found.entries,
        resolved: found.songs.len(),
        by_method: found.by_method,
        unresolved: found.unresolved,
    })
}

/// Matches each entry of an M3U/M3U8 file against the present library by path, file name, folder
/// and tags.
pub fn match_m3u(db: &Db, text: &str) -> Result<M3uMatch> {
    let mut stmt = db.conn().prepare(
        "SELECT v.song_id, l.uri, v.title, t.duration_ms,
                (SELECT group_concat(name, char(31)) FROM variant_artists a WHERE a.variant_id = v.variant_id AND a.role = 'artist'),
                v.tag_signature
         FROM locations l JOIN track_variants v USING (variant_id) JOIN tracks t ON t.song_id = v.song_id
         WHERE l.missing_since IS NULL ORDER BY l.uri",
    )?;
    let mut hints: HashMap<String, String> = HashMap::new();
    let tracks: Vec<m3u::LibraryTrack> = stmt
        .query_map([], |r| {
            let artists: Option<String> = r.get(4)?;
            Ok((
                m3u::LibraryTrack {
                    song_id: r.get(0)?,
                    path: r.get(1)?,
                    title: r.get(2)?,
                    duration_sec: r.get::<_, i64>(3)? as f64 / 1000.0,
                    artists: artists.map(|a| a.split('\u{1f}').map(str::to_owned).collect()).unwrap_or_default(),
                    file_name: None,
                    folder_name: None,
                },
                r.get::<_, String>(5)?,
            ))
        })?
        .map(|row| {
            row.map(|(track, signature)| {
                hints.entry(track.song_id.clone()).or_insert(signature);
                track
            })
        })
        .collect::<rusqlite::Result<_>>()?;
    drop(stmt);
    let resolver = m3u::Resolver::new(tracks);
    let entries = m3u::parse(text);
    let mut songs = Vec::new();
    let mut by_method: HashMap<&'static str, usize> = HashMap::new();
    let mut unresolved = Vec::new();
    for entry in &entries {
        match resolver.resolve(entry) {
            Some((song, method)) => {
                *by_method.entry(method.as_str()).or_default() += 1;
                let hint = hints.get(&song).cloned();
                songs.push((song, hint));
            }
            None => unresolved.push(entry.location.clone()),
        }
    }
    let mut by_method: Vec<(String, usize)> = by_method.into_iter().map(|(m, n)| (m.to_owned(), n)).collect();
    by_method.sort();
    Ok(M3uMatch { songs, entries: entries.len(), by_method, unresolved })
}

/// Sets a picture the user chose as the playlist's cover: stored once in the cover store like any
/// other picture, with origin `custom`. Returns its hash.
pub fn set_custom_cover(db: &Db, covers: &crate::covers::CoverStore, id: &str, picture: &[u8]) -> Result<String> {
    let hash = crate::covers::cover_hash(picture);
    let size = if covers.has_thumbnails(&hash) { None } else { Some(covers.write_thumbnails(&hash, picture)?) };
    db.conn().execute(
        "INSERT INTO covers (cover_hash, width, height, mime, origin, created_at) VALUES (?1, ?2, ?3, NULL, 'custom', ?4)
         ON CONFLICT(cover_hash) DO NOTHING",
        params![hash, size.map(|s| s.width), size.map(|s| s.height), now_ms()],
    )?;
    db.conn().execute("UPDATE playlists SET cover_hash = ?2 WHERE playlist_id = ?1", params![id, hash])?;
    touch_playlist(db, id)?;
    Ok(hash)
}

/// The playlist as M3U8, with the path of each present song.
pub fn export_m3u(db: &Db, id: &str) -> Result<String> {
    let mut tracks = Vec::new();
    for item in items(db, id, false)? {
        let Some(variant) = item.variant_id else { continue };
        let path: Option<String> = db
            .conn()
            .query_row(
                "SELECT uri FROM locations WHERE variant_id = ?1 AND missing_since IS NULL ORDER BY uri LIMIT 1",
                [variant],
                |r| r.get(0),
            )
            .optional()?;
        if let Some(path) = path {
            tracks.push((item.title, item.artists, item.duration_ms, path));
        }
    }
    Ok(m3u::write(&tracks))
}

// ----- hearts and the blacklist -----------------------------------------------------------------

fn set_mark(db: &Db, table: &str, song: &str, value: bool) -> Result<()> {
    db.conn().execute(
        &format!(
            "INSERT INTO {table} (song_id, value, updated_at, updated_by) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(song_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by"
        ),
        params![song, i64::from(value), now_ms(), device(db)?],
    )?;
    db.touch();
    Ok(())
}

pub fn set_favorite(db: &Db, song: &str, value: bool) -> Result<()> {
    set_mark(db, "favorites", song, value)
}

pub fn set_blacklisted(db: &Db, song: &str, value: bool) -> Result<()> {
    set_mark(db, "blacklist_songs", song, value)
}

/// Hearted songs, most recently hearted first.
pub fn favorites(db: &Db) -> Result<Vec<String>> {
    marked(db, "favorites")
}

/// Blacklisted songs, most recently blacklisted first.
pub fn blacklisted(db: &Db) -> Result<Vec<String>> {
    marked(db, "blacklist_songs")
}

fn marked(db: &Db, table: &str) -> Result<Vec<String>> {
    let mut stmt =
        db.conn().prepare(&format!("SELECT song_id FROM {table} WHERE value = 1 ORDER BY updated_at DESC, song_id"))?;
    let ids = stmt.query_map([], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
    Ok(ids)
}

// ----- tierlists --------------------------------------------------------------------------------

/// Live tierlists as (id, document).
pub fn tierlists(db: &Db) -> Result<Vec<(String, serde_json::Value)>> {
    let mut stmt = db
        .conn()
        .prepare("SELECT tierlist_id, doc FROM tierlists WHERE deleted_at IS NULL ORDER BY created_at, tierlist_id")?;
    let rows: Vec<(String, String)> =
        stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<rusqlite::Result<_>>()?;
    Ok(rows.into_iter().map(|(id, doc)| (id, serde_json::from_str(&doc).unwrap_or_default())).collect())
}

/// Creates or replaces a tierlist document; returns its id.
pub fn save_tierlist(db: &Db, id: Option<&str>, doc: &serde_json::Value) -> Result<String> {
    let id = id.map_or_else(crate::ids::random, str::to_owned);
    let now = now_ms();
    db.conn().execute(
        "INSERT INTO tierlists (tierlist_id, doc, created_at, updated_at, updated_by) VALUES (?1, ?2, ?3, ?3, ?4)
         ON CONFLICT(tierlist_id) DO UPDATE SET doc = excluded.doc, updated_at = excluded.updated_at,
           updated_by = excluded.updated_by, deleted_at = NULL",
        params![id, serde_json::to_string(doc)?, now, device(db)?],
    )?;
    db.touch();
    Ok(id)
}

pub fn delete_tierlist(db: &Db, id: &str) -> Result<()> {
    db.conn().execute(
        "UPDATE tierlists SET deleted_at = ?2, updated_at = ?2 WHERE tierlist_id = ?1",
        params![id, now_ms()],
    )?;
    db.touch();
    Ok(())
}

// ----- settings ---------------------------------------------------------------------------------

/// A shared setting (synced later); `None` when unset.
pub fn shared_setting(db: &Db, key: &str) -> Result<Option<serde_json::Value>> {
    let value: Option<String> =
        db.conn().query_row("SELECT value FROM settings_shared WHERE key = ?1", [key], |r| r.get(0)).optional()?;
    Ok(value.and_then(|v| serde_json::from_str(&v).ok()))
}

pub fn set_shared_setting(db: &Db, key: &str, value: &serde_json::Value) -> Result<()> {
    db.conn().execute(
        "INSERT INTO settings_shared (key, value, updated_at, updated_by) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by",
        params![key, serde_json::to_string(value)?, now_ms(), device(db)?],
    )?;
    Ok(())
}

/// Whether missing songs are shown in playlists (default: hidden).
pub fn show_missing_in_playlists(db: &Db) -> Result<bool> {
    Ok(shared_setting(db, SHOW_MISSING_IN_PLAYLISTS)?.and_then(|v| v.as_bool()).unwrap_or(false))
}

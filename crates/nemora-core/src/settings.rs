//! Device settings and music folders. Shared settings (which may sync later) live in
//! [`crate::playlists::shared_setting`] beside the other documents.

use std::path::{Path, PathBuf};

use rusqlite::{OptionalExtension, params};

use crate::db::Db;
use crate::error::Result;

/// A device setting as JSON; `None` when unset or unreadable.
pub fn device(db: &Db, key: &str) -> Result<Option<serde_json::Value>> {
    let value: Option<String> =
        db.conn().query_row("SELECT value FROM settings_device WHERE key = ?1", [key], |r| r.get(0)).optional()?;
    Ok(value.and_then(|v| serde_json::from_str(&v).ok()))
}

/// Every device setting, in key order.
pub fn all_device(db: &Db) -> Result<Vec<(String, serde_json::Value)>> {
    let mut stmt = db.conn().prepare("SELECT key, value FROM settings_device ORDER BY key")?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows.into_iter().filter_map(|(k, v)| serde_json::from_str(&v).ok().map(|v| (k, v))).collect())
}

pub fn set_device(db: &Db, key: &str, value: &serde_json::Value) -> Result<()> {
    db.conn().execute(
        "INSERT INTO settings_device (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, serde_json::to_string(value)?],
    )?;
    Ok(())
}

/// A music folder and how many files of it are in the library.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MusicFolder {
    pub folder_id: i64,
    pub path: PathBuf,
    pub files: i64,
}

/// The music folders the scan walks.
pub fn music_folders(db: &Db) -> Result<Vec<MusicFolder>> {
    let mut stmt = db.conn().prepare(
        "SELECT f.folder_id, f.uri,
                (SELECT count(*) FROM locations l WHERE l.folder_id = f.folder_id AND l.missing_since IS NULL)
         FROM folders f WHERE f.excluded = 0 AND f.parent_id IS NULL ORDER BY f.uri",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok(MusicFolder { folder_id: r.get(0)?, path: PathBuf::from(r.get::<_, String>(1)?), files: r.get(2)? })
        })?
        .collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}

/// Adds a music folder; scanning it is the caller's next step. Spelled as the scan spells it.
pub fn add_music_folder(db: &Db, path: &Path) -> Result<()> {
    let path: PathBuf = path.components().collect();
    db.conn().execute(
        "INSERT INTO folders (uri) VALUES (?1) ON CONFLICT(uri) DO UPDATE SET excluded = 0",
        [path.to_string_lossy().as_ref()],
    )?;
    Ok(())
}

/// Takes a music folder out of the library: its files are forgotten by this device, their songs
/// and statistics stay (a song never dies with its file).
pub fn remove_music_folder(db: &mut Db, path: &Path) -> Result<()> {
    let path: PathBuf = path.components().collect();
    let tx = db.conn_mut().transaction()?;
    let id: Option<i64> = tx
        .query_row("SELECT folder_id FROM folders WHERE uri = ?1", [path.to_string_lossy().as_ref()], |r| r.get(0))
        .optional()?;
    if let Some(id) = id {
        tx.execute("DELETE FROM locations WHERE folder_id = ?1", [id])?;
        tx.execute("DELETE FROM folders WHERE folder_id = ?1", [id])?;
        tx.execute(
            "UPDATE track_variants SET present = EXISTS (SELECT 1 FROM locations l
               WHERE l.variant_id = track_variants.variant_id AND l.missing_since IS NULL)",
            [],
        )?;
    }
    tx.commit()?;
    db.touch();
    Ok(())
}

/// Folders whose songs are blacklisted (1.x folder blacklist).
pub fn excluded_folders(db: &Db) -> Result<Vec<String>> {
    let mut stmt = db.conn().prepare("SELECT uri FROM folders WHERE excluded = 1 ORDER BY uri")?;
    let rows = stmt.query_map([], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}

pub fn set_folder_excluded(db: &Db, path: &str, excluded: bool) -> Result<()> {
    db.conn().execute(
        "INSERT INTO folders (uri, excluded) VALUES (?1, ?2) ON CONFLICT(uri) DO UPDATE SET excluded = excluded.excluded",
        params![path, i64::from(excluded)],
    )?;
    db.touch();
    Ok(())
}

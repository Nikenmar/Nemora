//! The library scan: music folders on disk -> tracks, variants and locations.
//!
//! Incremental by construction: a file whose size and modification time match its location row is
//! not opened again. New and changed files are identified, read and given cover thumbnails in
//! parallel; the database is then updated in one transaction.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;

use rayon::prelude::*;
use rusqlite::{OptionalExtension, Transaction, params};

use crate::covers::{CoverStore, PictureSize, cover_hash};
use crate::db::{Db, now_ms};
use crate::error::Result;
use crate::identity::{Identity, identify_path};
use crate::search::fold::normalize;
use crate::tags::{TrackTags, read_tags};

/// The extensions 1.1.9 accepted.
pub const SUPPORTED_EXTENSIONS: &[&str] = &["mp3", "wav", "ogg", "aac", "m4r", "m4a", "opus", "flac"];

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct ScanReport {
    pub files: usize,
    pub unchanged: usize,
    pub added: usize,
    pub updated: usize,
    /// Files that were missing and are back unchanged.
    pub restored: usize,
    /// Locations whose file is gone since the last scan.
    pub missing: usize,
    pub covers_written: usize,
    /// Imported history re-attached to songs whose files appeared.
    pub reattached: usize,
    pub failed: Vec<(String, String)>,
}

struct FoundFile {
    uri: String,
    path: PathBuf,
    size: i64,
    mtime: i64,
    folder_id: i64,
}

struct Processed {
    file: FoundFile,
    identity: Identity,
    tags: TrackTags,
    cover: Option<NewCover>,
}

struct NewCover {
    hash: String,
    mime: Option<String>,
    /// Present when this scan wrote the thumbnails (the picture was new to the store).
    size: Option<PictureSize>,
}

/// Pictures shared by many tracks (an album cover) are processed in parallel: the first thread to
/// claim a hash writes its thumbnails, the others only reference it.
#[derive(Default)]
struct CoverClaims {
    claimed: Mutex<HashSet<String>>,
    /// Claimed pictures that did not decode: nobody may reference them.
    failed: Mutex<HashSet<String>>,
}

struct KnownLocation {
    size: i64,
    mtime: i64,
    missing: bool,
}

/// Scans `roots` (music folders) and brings the database in line with them.
pub fn scan_folders(db: &mut Db, covers: &CoverStore, roots: &[PathBuf]) -> Result<ScanReport> {
    let mut report = ScanReport::default();
    let now = now_ms();
    // One spelling per folder: `E:/Music` and `E:\Music` must give the same location uris, or a
    // rescan with the other spelling would see every file as new and every old row as missing.
    let roots: Vec<PathBuf> = roots.iter().map(|r| r.components().collect()).collect();
    let roots = roots.as_slice();

    let mut found = Vec::new();
    for root in roots {
        let folder_id = ensure_folder(db, root)?;
        walk(root, folder_id, &mut found);
    }
    report.files = found.len();

    let known = known_locations(db)?;
    let mut to_process = Vec::new();
    let mut to_restore = Vec::new();
    let mut seen = HashSet::with_capacity(found.len());
    for file in found {
        seen.insert(file.uri.clone());
        match known.get(&file.uri) {
            Some(k) if k.size == file.size && k.mtime == file.mtime => {
                if k.missing {
                    to_restore.push(file.uri);
                } else {
                    report.unchanged += 1;
                }
            }
            Some(_) => to_process.push((file, true)),
            None => to_process.push((file, false)),
        }
    }

    let claims = CoverClaims::default();
    let results: Vec<_> = to_process
        .into_par_iter()
        .map(|(file, existed)| (process(file, covers, &claims), existed))
        .collect();
    let failed_covers = claims.failed.into_inner().unwrap_or_default();

    let tx = db.conn_mut().transaction()?;
    for (result, existed) in results {
        match result {
            Ok(mut processed) => {
                if processed.cover.as_ref().is_some_and(|c| failed_covers.contains(&c.hash)) {
                    processed.cover = None;
                }
                if processed.cover.as_ref().is_some_and(|c| c.size.is_some()) {
                    report.covers_written += 1;
                }
                write_processed(&tx, &processed, now)?;
                if existed { report.updated += 1 } else { report.added += 1 }
            }
            Err((uri, reason)) => report.failed.push((uri, reason)),
        }
    }
    for uri in &to_restore {
        tx.execute("UPDATE locations SET missing_since = NULL, scanned_at = ?2 WHERE uri = ?1", params![uri, now])?;
    }
    report.restored = to_restore.len();
    report.missing = mark_missing(&tx, roots, &seen, now)?;
    drop_superseded_variants(&tx)?;
    let changed = report.added + report.updated + report.restored + report.missing > 0;
    if changed {
        tx.execute(
            "UPDATE track_variants SET present = EXISTS (SELECT 1 FROM locations l
               WHERE l.variant_id = track_variants.variant_id AND l.missing_since IS NULL)",
            [],
        )?;
    }
    tx.commit()?;
    if changed {
        db.touch();
    }
    if report.added + report.updated + report.restored > 0 {
        report.reattached = crate::import::reattach_pending(db)?;
    }
    Ok(report)
}

fn ensure_folder(db: &Db, root: &Path) -> Result<i64> {
    let uri = root.to_string_lossy();
    db.conn().execute("INSERT INTO folders (uri) VALUES (?1) ON CONFLICT(uri) DO NOTHING", [uri.as_ref()])?;
    Ok(db.conn().query_row("SELECT folder_id FROM folders WHERE uri = ?1", [uri.as_ref()], |r| r.get(0))?)
}

fn walk(dir: &Path, folder_id: i64, out: &mut Vec<FoundFile>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else { continue };
        let path = entry.path();
        if file_type.is_dir() {
            walk(&path, folder_id, out);
            continue;
        }
        if !file_type.is_file() || !is_supported(&path) {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        let mtime = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map_or(0, |d| d.as_millis() as i64);
        out.push(FoundFile { uri: path.to_string_lossy().into_owned(), path, size: meta.len() as i64, mtime, folder_id });
    }
}

fn is_supported(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| SUPPORTED_EXTENSIONS.iter().any(|s| s.eq_ignore_ascii_case(e)))
}

fn known_locations(db: &Db) -> Result<HashMap<String, KnownLocation>> {
    let mut stmt = db.conn().prepare("SELECT uri, size, mtime, missing_since IS NOT NULL FROM locations")?;
    let rows = stmt.query_map([], |r| {
        Ok((r.get::<_, String>(0)?, KnownLocation { size: r.get(1)?, mtime: r.get(2)?, missing: r.get(3)? }))
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

fn process(
    file: FoundFile,
    covers: &CoverStore,
    claims: &CoverClaims,
) -> std::result::Result<Processed, (String, String)> {
    let fail = |e: &dyn std::fmt::Display| (file.uri.clone(), e.to_string());
    let identity = identify_path(&file.path).map_err(|e| fail(&e))?;
    let mut tags = read_tags(&file.path).map_err(|e| fail(&e))?;
    let cover = tags.cover.take().and_then(|picture| {
        let hash = cover_hash(&picture.data);
        let first = claims.claimed.lock().unwrap().insert(hash.clone());
        let size = if first && !covers.has_thumbnails(&hash) {
            match covers.write_thumbnails(&hash, &picture.data) {
                Ok(size) => Some(size),
                // A picture that does not decode is not worth losing the song over.
                Err(_) => {
                    claims.failed.lock().unwrap().insert(hash);
                    return None;
                }
            }
        } else {
            None
        };
        Some(NewCover { hash, mime: picture.mime, size })
    });
    Ok(Processed { file, identity, tags, cover })
}

fn write_processed(tx: &Transaction<'_>, p: &Processed, now: i64) -> Result<()> {
    let song_id = p.identity.song_id.to_string();
    tx.execute(
        "INSERT INTO tracks (song_id, codec, sample_rate, bit_depth, channels, duration_ms, bitrate, first_seen_at, last_seen_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
         ON CONFLICT(song_id) DO UPDATE SET last_seen_at = excluded.last_seen_at",
        params![
            song_id,
            p.identity.codec,
            p.tags.sample_rate.unwrap_or(p.identity.sample_rate),
            p.tags.bit_depth,
            p.tags.channels.unwrap_or(p.identity.channels),
            p.tags.duration_ms as i64,
            p.tags.bitrate_kbps.map(|k| i64::from(k) * 1000),
            now,
        ],
    )?;

    if let Some(cover) = &p.cover {
        tx.execute(
            "INSERT INTO covers (cover_hash, width, height, mime, origin, created_at)
             VALUES (?1, ?2, ?3, ?4, 'embedded', ?5)
             ON CONFLICT(cover_hash) DO UPDATE SET width = coalesce(covers.width, excluded.width),
               height = coalesce(covers.height, excluded.height), mime = coalesce(covers.mime, excluded.mime)",
            params![cover.hash, cover.size.map(|s| s.width), cover.size.map(|s| s.height), cover.mime, now],
        )?;
    }
    let cover_hash = p.cover.as_ref().map(|c| c.hash.as_str());

    let signature = p.tags.signature();
    let existing: Option<i64> = tx
        .query_row(
            "SELECT variant_id FROM track_variants WHERE song_id = ?1 AND tag_signature = ?2",
            params![song_id, signature],
            |r| r.get(0),
        )
        .optional()?;
    let variant_id = match existing {
        Some(id) => {
            tx.execute(
                "UPDATE track_variants SET last_seen_at = ?2, cover_hash = ?3 WHERE variant_id = ?1",
                params![id, now, cover_hash],
            )?;
            id
        }
        None => insert_variant(tx, &song_id, &signature, &p.tags, cover_hash, now)?,
    };

    tx.execute(
        "INSERT INTO locations (variant_id, uri, folder_id, size, mtime, scanned_at, missing_since)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL)
         ON CONFLICT(uri) DO UPDATE SET variant_id = excluded.variant_id, folder_id = excluded.folder_id,
           size = excluded.size, mtime = excluded.mtime, scanned_at = excluded.scanned_at, missing_since = NULL",
        params![variant_id, p.file.uri, p.file.folder_id, p.file.size, p.file.mtime, now],
    )?;
    Ok(())
}

fn insert_variant(
    tx: &Transaction<'_>,
    song_id: &str,
    signature: &str,
    tags: &TrackTags,
    cover_hash: Option<&str>,
    now: i64,
) -> Result<i64> {
    tx.execute(
        "INSERT INTO track_variants (song_id, tag_signature, title, title_sort, artist_sort, album, album_sort, year,
           track_no, disc_no, cover_hash, last_seen_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        params![
            song_id,
            signature,
            tags.title,
            normalize(&tags.title),
            normalize(&tags.artists.join(", ")),
            tags.album,
            tags.album.as_deref().map(normalize),
            tags.year,
            tags.track_no,
            tags.disc_no,
            cover_hash,
            now
        ],
    )?;
    let variant_id = tx.last_insert_rowid();
    let mut artist = tx.prepare_cached(
        "INSERT INTO variant_artists (variant_id, role, position, name) VALUES (?1, ?2, ?3, ?4)",
    )?;
    for (position, name) in tags.artists.iter().enumerate() {
        artist.execute(params![variant_id, "artist", position as i64, name])?;
    }
    for (position, name) in tags.album_artists.iter().enumerate() {
        artist.execute(params![variant_id, "album_artist", position as i64, name])?;
    }
    let mut genre =
        tx.prepare_cached("INSERT INTO variant_genres (variant_id, position, name) VALUES (?1, ?2, ?3)")?;
    for (position, name) in tags.genres.iter().enumerate() {
        genre.execute(params![variant_id, position as i64, name])?;
    }
    let mut people = tags.artists.clone();
    people.extend(tags.album_artists.iter().filter(|a| !tags.artists.contains(a)).cloned());
    tx.execute(
        "INSERT INTO search_fts (rowid, title, artists, album) VALUES (?1, ?2, ?3, ?4)",
        params![variant_id, tags.title, people.join(", "), tags.album.as_deref().unwrap_or("")],
    )?;
    Ok(variant_id)
}

/// Marks the locations under the scanned roots whose file was not found.
fn mark_missing(tx: &Transaction<'_>, roots: &[PathBuf], seen: &HashSet<String>, now: i64) -> Result<usize> {
    let prefixes: Vec<String> = roots
        .iter()
        .map(|r| {
            let mut s = r.to_string_lossy().into_owned();
            if !s.ends_with(['\\', '/']) {
                s.push(std::path::MAIN_SEPARATOR);
            }
            s
        })
        .collect();
    let mut stmt = tx.prepare("SELECT location_id, uri FROM locations WHERE missing_since IS NULL")?;
    let gone: Vec<i64> = stmt
        .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?
        .filter_map(|row| row.ok())
        .filter(|(_, uri)| !seen.contains(uri) && prefixes.iter().any(|p| uri.starts_with(p.as_str())))
        .map(|(id, _)| id)
        .collect();
    for id in &gone {
        tx.execute("UPDATE locations SET missing_since = ?2 WHERE location_id = ?1", params![id, now])?;
    }
    Ok(gone.len())
}

/// A retag moves a file to a new variant and leaves the old one without locations. It is dropped
/// when its song still has another variant; the last variant of a song stays as its last known tags.
fn drop_superseded_variants(tx: &Transaction<'_>) -> Result<()> {
    let orphans: Vec<i64> = tx
        .prepare(
            "SELECT v.variant_id FROM track_variants v
             WHERE NOT EXISTS (SELECT 1 FROM locations l WHERE l.variant_id = v.variant_id)
               AND EXISTS (SELECT 1 FROM track_variants o WHERE o.song_id = v.song_id AND o.variant_id <> v.variant_id
                           AND EXISTS (SELECT 1 FROM locations l2 WHERE l2.variant_id = o.variant_id))",
        )?
        .query_map([], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    for id in orphans {
        tx.execute("DELETE FROM search_fts WHERE rowid = ?1", [id])?;
        tx.execute("DELETE FROM track_variants WHERE variant_id = ?1", [id])?;
    }
    Ok(())
}

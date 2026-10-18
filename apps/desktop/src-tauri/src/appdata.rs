//! The profile as a whole: how much room it takes, a backup of it, restoring one, resetting it, and
//! songs opened from outside the library.
//!
//! Restoring and resetting replace the database, which the running app holds open, so both are
//! staged and carried out at the next start, before anything opens it. The database they replace
//! is kept beside it, never deleted.

use std::path::{Path, PathBuf};

use nemora_core::library;
use nemora_core::tags::read_tags;
use serde_json::{Value, json};
use tauri::{AppHandle, Manager, State};

use crate::app::App;
use crate::commands::{Res, fail, rows_for, view};
use crate::view::asset_url;

const DB: &str = "nemora.db";
/// A backup waiting to become the database at the next start.
const STAGED_RESTORE: &str = "nemora.db.restore";
/// Present when the next start should begin with an empty library.
const STAGED_RESET: &str = "nemora.db.reset";
const BACKUP_DB: &str = "nemora-backup.db";
const BACKUP_LOCAL_STORAGE: &str = "local-storage.json";

/// Carries out a restore or a reset staged by the previous run. Called before the database opens.
pub fn apply_staged(profile: &Path) -> std::io::Result<()> {
    let db = profile.join(DB);
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs());
    let set_aside = |reason: &str| -> std::io::Result<()> {
        if db.exists() {
            std::fs::rename(&db, profile.join(format!("nemora.db.before-{reason}-{stamp}")))?;
        }
        for suffix in ["-wal", "-shm"] {
            let side = profile.join(format!("{DB}{suffix}"));
            if side.exists() {
                std::fs::remove_file(side)?;
            }
        }
        Ok(())
    };
    if profile.join(STAGED_RESTORE).exists() {
        set_aside("restore")?;
        std::fs::rename(profile.join(STAGED_RESTORE), &db)?;
    } else if profile.join(STAGED_RESET).exists() {
        set_aside("reset")?;
        std::fs::remove_file(profile.join(STAGED_RESET))?;
        // The app opens on an empty library; a 1.x profile in the same folder is not imported again.
        let fresh = nemora_core::db::Db::open(&db).map_err(std::io::Error::other)?;
        fresh.set_meta("import:nemora-1.x", "reset").map_err(std::io::Error::other)?;
    }
    Ok(())
}

fn size_of(path: &Path) -> u64 {
    match std::fs::metadata(path) {
        Ok(m) if m.is_file() => m.len(),
        Ok(m) if m.is_dir() => {
            std::fs::read_dir(path).into_iter().flatten().flatten().map(|e| size_of(&e.path())).sum()
        }
        _ => 0,
    }
}

#[cfg(windows)]
fn disk(path: &Path) -> (u64, u64) {
    use std::os::windows::ffi::OsStrExt;
    use windows::{Win32::Storage::FileSystem::GetDiskFreeSpaceExW, core::PCWSTR};
    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    let (mut free, mut total) = (0u64, 0u64);
    // SAFETY: `wide` is NUL-terminated and lives across the call; both outputs are initialised u64s.
    let ok = unsafe { GetDiskFreeSpaceExW(PCWSTR::from_raw(wide.as_ptr()), Some(&mut free), Some(&mut total), None) };
    if ok.is_ok() { (free, total) } else { (0, 0) }
}

#[cfg(not(windows))]
fn disk(_path: &Path) -> (u64, u64) {
    (0, 0)
}

/// 1.x `StorageMetrics`, from the 2.0 profile: the database, the cover thumbnails and the logs.
#[tauri::command]
pub async fn storage_usage(handle: AppHandle, app: State<'_, App>) -> Res<Value> {
    let profile = app.profile.clone();
    let logs = handle.path().app_log_dir().ok();
    let exe_dir = std::env::current_exe().ok().and_then(|e| e.parent().map(Path::to_path_buf));
    let library = size_of(&profile.join(DB)) + size_of(&profile.join(format!("{DB}-wal")));
    let covers = size_of(&profile.join("covers"));
    let log = logs.as_deref().map_or(0, size_of);
    let app_data = size_of(&profile);
    let app_folder = exe_dir.as_deref().map_or(0, size_of);
    let (free, total) = disk(&profile);
    let known = library + covers + log;
    let metrics = json!({
        "rootSizes": { "freeSpace": free, "size": total },
        "remainingSize": free,
        "appFolderSize": app_folder,
        "appDataSizes": {
            "appDataSize": app_data,
            "artworkCacheSize": covers,
            "tempArtworkCacheSize": 0,
            "totalArtworkCacheSize": covers,
            "logSize": log,
            "songDataSize": 0, "artistDataSize": 0, "albumDataSize": 0, "genreDataSize": 0,
            "playlistDataSize": 0, "paletteDataSize": 0, "userDataSize": 0,
            "librarySize": library,
            "totalKnownItemsSize": known,
            "otherSize": app_data.saturating_sub(known),
        },
        "totalSize": app_folder + app_data,
        "generatedDate": nemora_core::time::iso_ms(
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64)
        ),
    });
    app.write(|db| crate::user_data::set(db, "storageMetrics", &metrics)).map_err(fail)?;
    Ok(metrics)
}

/// A backup in `folder`: a consistent copy of the database and the view's local storage.
#[tauri::command]
pub fn appdata_export(app: State<'_, App>, folder: String, local_storage: String) -> Res<()> {
    let folder = PathBuf::from(folder);
    std::fs::create_dir_all(&folder).map_err(fail)?;
    let target = folder.join(BACKUP_DB);
    if target.exists() {
        std::fs::remove_file(&target).map_err(fail)?;
    }
    app.read().backup_to(&target).map_err(fail)?;
    std::fs::write(folder.join(BACKUP_LOCAL_STORAGE), local_storage).map_err(fail)?;
    Ok(())
}

/// Stages the backup in `folder` to become the database at the next start; answers with the local
/// storage it carries, for the view to put back.
#[tauri::command]
pub fn appdata_import(app: State<'_, App>, folder: String) -> Res<Option<String>> {
    let folder = PathBuf::from(folder);
    let source = folder.join(BACKUP_DB);
    // Refuse anything that is not a 2.0 database before touching the profile.
    nemora_core::db::Db::open(&source).map_err(|e| format!("Not a Nemora 2.0 backup: {e}"))?;
    std::fs::copy(&source, app.profile.join(STAGED_RESTORE)).map_err(fail)?;
    Ok(std::fs::read_to_string(folder.join(BACKUP_LOCAL_STORAGE)).ok())
}

/// Stages a reset: the next start opens an empty library. The current database is kept aside.
#[tauri::command]
pub fn appdata_reset(app: State<'_, App>) -> Res<()> {
    std::fs::write(app.profile.join(STAGED_RESET), b"").map_err(fail)
}

/// A song from a file path: the library's own if the file is in it, else read from the file for
/// playing without being recorded.
#[tauri::command]
pub fn song_from_path(app: State<'_, App>, path: String) -> Res<Value> {
    let path = crate::protocol::local_path_from_asset_url(&path).unwrap_or(path);
    // One read guard for both lookups: the reader is a mutex, and a second guard taken while the
    // first is still alive would wait on itself.
    let known = {
        let db = app.read();
        match library::song_at(&db, &path).map_err(fail)? {
            Some(song) => rows_for(&db, &[song]).map_err(fail)?.into_iter().next(),
            None => None,
        }
    };
    if let Some(row) = known {
        return Ok(view(&app).player_data(&row));
    }
    let tags = read_tags(Path::new(&path)).map_err(fail)?;
    let v = view(&app);
    let artwork = match &tags.cover {
        Some(cover) => {
            let hash = nemora_core::covers::cover_hash(&cover.data);
            if !app.covers.has_thumbnails(&hash) {
                app.covers.write_thumbnails(&hash, &cover.data).map_err(fail)?;
            }
            v.artwork(Some(&hash), "")["artworkPath"].clone()
        }
        None => json!(v.defaults.song),
    };
    Ok(json!({
        "songId": format!("outside:{path}"),
        "title": tags.title,
        "artists": tags.artists.iter().map(|a| json!({ "artistId": a, "name": a })).collect::<Vec<_>>(),
        "duration": tags.duration_ms as f64 / 1000.0,
        "artwork": artwork,
        "artworkPath": artwork,
        "path": asset_url(Path::new(&path)),
        "isAFavorite": false,
        "album": tags.album.as_ref().map(|a| json!({ "albumId": a, "name": a })),
        "isKnownSource": false,
        "isBlacklisted": false,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn profile(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("nemora-appdata-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn a_staged_restore_replaces_the_database_and_keeps_the_old_one() {
        let dir = profile("restore");
        let current = nemora_core::db::Db::open(&dir.join(DB)).unwrap();
        current.set_meta("which", "current").unwrap();
        let backup_path = dir.join("backup.db");
        let backup = nemora_core::db::Db::open(&backup_path).unwrap();
        backup.set_meta("which", "backup").unwrap();
        drop((current, backup));
        std::fs::copy(&backup_path, dir.join(STAGED_RESTORE)).unwrap();

        apply_staged(&dir).unwrap();
        let restored = nemora_core::db::Db::open(&dir.join(DB)).unwrap();
        assert_eq!(restored.meta("which").unwrap().as_deref(), Some("backup"));
        assert!(!dir.join(STAGED_RESTORE).exists());
        let kept = std::fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .any(|e| e.file_name().to_string_lossy().starts_with("nemora.db.before-restore-"));
        assert!(kept, "the replaced database is kept");
        drop(restored);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_staged_reset_starts_empty_without_importing_1x_again() {
        let dir = profile("reset");
        let current = nemora_core::db::Db::open(&dir.join(DB)).unwrap();
        current.set_meta("which", "current").unwrap();
        drop(current);
        std::fs::write(dir.join(STAGED_RESET), b"").unwrap();

        apply_staged(&dir).unwrap();
        let fresh = nemora_core::db::Db::open(&dir.join(DB)).unwrap();
        assert_eq!(fresh.meta("which").unwrap(), None);
        assert_eq!(fresh.meta("import:nemora-1.x").unwrap().as_deref(), Some("reset"));
        assert!(!dir.join(STAGED_RESET).exists());
        drop(fresh);
        let _ = std::fs::remove_dir_all(&dir);
    }
}

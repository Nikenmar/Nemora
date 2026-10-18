//! The profile the app runs on: the database, the cover store, and first-start import of 1.x.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard, OnceLock};

use nemora_core::covers::CoverStore;
use nemora_core::db::Db;
use serde::Deserialize;
use serde_json::Value;

/// Overrides where the 1.x profile is read from on first start; a release build reads its own
/// profile folder, which is where 1.x kept its stores.
pub const LEGACY_PROFILE_ENV: &str = "NEMORA_LEGACY_PROFILE";

/// Bundled pictures the view shows where there is no cover; their URLs exist only in the bundle.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DefaultArtwork {
    pub song: String,
    pub artist: String,
    pub album: String,
    pub genre: String,
    pub playlist: String,
    pub favorites: String,
    pub history: String,
    pub rediscover: String,
}

pub struct App {
    pub profile: PathBuf,
    pub covers: CoverStore,
    /// Two connections: reads go on while a scan holds the writer. WAL makes this safe; the reader
    /// is told to drop its cached orders after every write.
    read: Mutex<Db>,
    write: Mutex<Db>,
    pub defaults: OnceLock<DefaultArtwork>,
    /// A first-start import of 1.x is running.
    importing: AtomicBool,
}

impl App {
    pub fn open(profile: &Path) -> nemora_core::Result<Self> {
        std::fs::create_dir_all(profile)?;
        let db_path = profile.join("nemora.db");
        let write = Db::open(&db_path)?;
        let read = Db::open(&db_path)?;
        Ok(Self {
            profile: profile.to_owned(),
            covers: CoverStore::new(profile.join("covers")),
            read: Mutex::new(read),
            write: Mutex::new(write),
            defaults: OnceLock::new(),
            importing: AtomicBool::new(false),
        })
    }

    pub fn read(&self) -> MutexGuard<'_, Db> {
        self.read.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Runs a write, then lets the reader see it.
    pub fn write<T>(&self, f: impl FnOnce(&mut Db) -> nemora_core::Result<T>) -> nemora_core::Result<T> {
        let result = {
            let mut db = self.write.lock().unwrap_or_else(|e| e.into_inner());
            f(&mut db)
        };
        self.read().touch();
        result
    }

    pub fn defaults(&self) -> DefaultArtwork {
        self.defaults.get().cloned().unwrap_or_default()
    }

    /// Scans the music folders.
    pub fn scan(&self) -> nemora_core::Result<nemora_core::scan::ScanReport> {
        self.write(|db| {
            let roots: Vec<PathBuf> = nemora_core::settings::music_folders(db)?.into_iter().map(|f| f.path).collect();
            nemora_core::scan::scan_folders(db, &self.covers, &roots)
        })
    }

    /// Whether `legacy` holds 1.x stores this profile has not imported yet. Marks the import as
    /// running, so the view can tell before it starts.
    pub fn needs_first_start(&self, legacy: &Path) -> bool {
        let done = self.read().meta("import:nemora-1.x").ok().flatten().is_some();
        let needed = !done && legacy.join("songs.json").is_file();
        self.importing.store(needed, Ordering::SeqCst);
        needed
    }

    pub fn is_importing(&self) -> bool {
        self.importing.load(Ordering::SeqCst)
    }

    /// The first start of a profile with 1.x stores: adopt 1.x's music folders, scan them, then
    /// import the history, playlists, ratings and settings.
    pub fn first_start(&self, legacy: &Path) -> nemora_core::Result<()> {
        let result = self.import_legacy(legacy);
        self.importing.store(false, Ordering::SeqCst);
        result
    }

    fn import_legacy(&self, legacy: &Path) -> nemora_core::Result<()> {
        self.write(|db| {
            if nemora_core::settings::music_folders(db)?.is_empty() {
                for folder in legacy_music_folders(legacy) {
                    nemora_core::settings::add_music_folder(db, &folder)?;
                }
            }
            Ok(())
        })?;
        self.scan()?;
        self.write(|db| nemora_core::import::import_nemora_1x(db, legacy))?;
        Ok(())
    }
}

/// The top-level music folders of a 1.x `userData.json`.
fn legacy_music_folders(profile: &Path) -> Vec<PathBuf> {
    let Ok(text) = std::fs::read_to_string(profile.join("userData.json")) else { return Vec::new() };
    let Ok(root) = serde_json::from_str::<Value>(&text) else { return Vec::new() };
    root["userData"]["musicFolders"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|f| f["path"].as_str().map(PathBuf::from))
        .collect()
}

//! The view's `UserData`: one JSON object assembled from the settings tables.
//!
//! Language, theme and preferences are shared settings (they may sync later); everything else is
//! this installation's own. Music folders are not stored here at all: they are the core's folder
//! list, which the scan owns.

use nemora_core::db::Db;
use nemora_core::playlists::{set_shared_setting, shared_setting};
use nemora_core::settings;
use serde_json::{Value, json};

const SHARED_KEYS: &[&str] = &["language", "theme", "preferences"];

/// What a profile that has never stored a value reads, as in 1.1.9.
fn defaults() -> Value {
    json!({
        "language": "en",
        "theme": { "isDarkMode": true, "useSystemTheme": false },
        "musicFolders": [],
        "preferences": {
            "autoLaunchApp": false,
            "isMiniPlayerAlwaysOnTop": false,
            "isMusixmatchLyricsEnabled": false,
            "hideWindowOnClose": false,
            "openWindowAsHiddenOnSystemStart": false,
            "openWindowMaximizedOnStart": false,
            "sendSongScrobblingDataToLastFM": false,
            "sendSongFavoritesDataToLastFM": false,
            "sendNowPlayingSongDataToLastFM": false,
            "saveLyricsInLrcFilesForSupportedSongs": false,
            "enableDiscordRPC": true,
            "enableObsWidget": false,
            "saveVerboseLogs": false
        },
        "windowPositions": {},
        "windowDiamensions": {},
        "windowState": "normal",
        "recentSearches": []
    })
}

/// Stored values over the defaults; objects merge one level deep so a preference added in a later
/// version reads its default in an older profile.
pub fn get(db: &Db) -> nemora_core::Result<Value> {
    let mut out = defaults();
    let map = out.as_object_mut().expect("defaults are an object");
    let mut stored: Vec<(String, Value)> = Vec::new();
    for key in SHARED_KEYS {
        if let Some(value) = shared_setting(db, key)? {
            stored.push(((*key).to_owned(), value));
        }
    }
    // The imported 1.x folder tree is history only; queue and import keys are not the view's.
    stored.extend(settings::all_device(db)?.into_iter().filter(|(k, _)| {
        k != "musicFolders" && !k.starts_with("queue.") && !k.starts_with("import.") && !k.starts_with("rediscover.")
    }));
    for (key, value) in stored {
        match (map.get_mut(&key), value) {
            (Some(Value::Object(base)), Value::Object(over)) => base.extend(over),
            (_, value) => {
                map.insert(key, value);
            }
        }
    }
    map.insert("musicFolders".into(), Value::Array(music_folders(db)?));
    Ok(out)
}

/// Replaces one top-level key. Music folders change through their own commands.
pub fn set(db: &Db, key: &str, value: &Value) -> nemora_core::Result<()> {
    match key {
        "musicFolders" => Ok(()),
        _ if SHARED_KEYS.contains(&key) => set_shared_setting(db, key, value),
        _ => settings::set_device(db, key, value),
    }
}

/// The music folders as 1.x `FolderStructure`s, with every subfolder that holds songs.
pub fn music_folders(db: &Db) -> nemora_core::Result<Vec<Value>> {
    Ok(crate::folders::trees(db)?.iter().map(crate::folders::structure).collect())
}

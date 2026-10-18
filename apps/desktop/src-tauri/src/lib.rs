use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::Manager;

/// Overrides where the profile lives; used by tests and by anyone running two builds side by side.
const PROFILE_DIR_ENV: &str = "NEMORA_PROFILE_DIR";

/// The profile folder under the roaming app data directory. A development build must never touch
/// the profile of an installed Nemora: 2.0 imports 1.x data from `%APPDATA%\Nemora`, and a debug
/// build writing there would corrupt the very data the release import reads.
fn profile_dir(roaming: &Path, override_dir: Option<PathBuf>, debug: bool) -> PathBuf {
    override_dir.unwrap_or_else(|| roaming.join(if debug { "Nemora-dev" } else { "Nemora" }))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CoreInfo {
    core_version: &'static str,
    identity_algorithm: &'static str,
    profile_dir: String,
}

#[tauri::command]
fn core_info(app: tauri::AppHandle) -> Result<CoreInfo, String> {
    let roaming = app.path().data_dir().map_err(|e| e.to_string())?;
    let dir = profile_dir(&roaming, std::env::var_os(PROFILE_DIR_ENV).map(PathBuf::from), cfg!(debug_assertions));
    Ok(CoreInfo {
        core_version: nemora_core::VERSION,
        identity_algorithm: nemora_core::identity::ALGORITHM,
        profile_dir: dir.display().to_string(),
    })
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![core_info])
        .run(tauri::generate_context!())
        .expect("error while running Nemora");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn debug_builds_never_use_the_installed_profile() {
        let roaming = Path::new(r"C:\Users\someone\AppData\Roaming");
        assert_eq!(profile_dir(roaming, None, true), roaming.join("Nemora-dev"));
        assert_eq!(profile_dir(roaming, None, false), roaming.join("Nemora"));
        let custom = PathBuf::from(r"D:\nemora-test");
        assert_eq!(profile_dir(roaming, Some(custom.clone()), false), custom);
    }
}

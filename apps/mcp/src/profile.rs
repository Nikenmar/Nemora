//! Where the user's Nemora keeps its library: the profile folder the app itself uses.

use std::path::{Path, PathBuf};

/// The same override the app reads (`NEMORA_PROFILE_DIR`), else `%APPDATA%\Nemora`.
pub fn profile_dir(explicit: Option<PathBuf>) -> PathBuf {
    explicit.or_else(|| std::env::var_os("NEMORA_PROFILE_DIR").map(PathBuf::from)).unwrap_or_else(|| {
        let roaming = std::env::var_os("APPDATA").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("."));
        roaming.join("Nemora")
    })
}

pub fn database(profile: &Path) -> PathBuf {
    profile.join("nemora.db")
}

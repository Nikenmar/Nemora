//! Benchmark mode (tools/bench): `--bench=<folder>` keeps every byte of the run inside that folder
//! and lets the harness drive the app. Nothing here acts without the flag.
//!
//! Nora 3.1.0 carries the same hooks, so both players are driven by the same scenario and write the
//! same marks (tools/bench/app/bench.ts runs inside both views).

use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use serde_json::{Value, json};
use tauri::AppHandle;

pub fn dir() -> Option<&'static Path> {
    static DIR: OnceLock<Option<PathBuf>> = OnceLock::new();
    DIR.get_or_init(|| {
        std::env::args()
            .find_map(|arg| arg.strip_prefix("--bench=").map(PathBuf::from))
            .map(|dir| std::path::absolute(&dir).unwrap_or(dir))
    })
    .as_deref()
}

/// The folders a run writes to: the profile, the webview's own state, the logs.
pub fn profile() -> Option<PathBuf> {
    dir().map(|d| d.join("profile"))
}

pub fn logs() -> Option<PathBuf> {
    dir().map(|d| d.join("logs"))
}

fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64)
}

pub fn mark(name: &str, at: Option<i64>, data: Option<Value>) {
    let Some(dir) = dir() else { return };
    let line = json!({ "at": at.unwrap_or_else(now_ms), "name": name, "data": data });
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(dir.join("marks.jsonl")) {
        let _ = writeln!(file, "{line}");
    }
}

/// First thing in `run()`, before any thread or webview exists.
pub fn prepare() {
    let Some(dir) = dir() else { return };
    let _ = std::fs::create_dir_all(dir);
    mark("main-start", None, None);
    // WebView2 keeps the renderer's state (localStorage, caches, the session) in a folder of its own,
    // which the profile path does not move.
    // SAFETY: no other thread exists yet.
    unsafe { std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", dir.join("webview")) };
}

/// Every location the app writes to, for the harness to check against the folder.
pub fn write_env(profile: &Path, legacy: &Path) {
    let Some(dir) = dir() else { return };
    let env = json!({
        "app": "nemora",
        "paths": {
            "profile": profile,
            "webview": std::env::var_os("WEBVIEW2_USER_DATA_FOLDER").map(PathBuf::from),
            "logs": logs(),
            "legacyImport": legacy,
        }
    });
    let _ = std::fs::write(dir.join("bench-env.json"), serde_json::to_string_pretty(&env).unwrap_or_default());
}

/// The scenario, and the library folder as this app's add-folder call takes it.
#[tauri::command]
pub fn bench_config() -> Option<Value> {
    let dir = dir()?;
    let scenario: Value = serde_json::from_slice(&std::fs::read(dir.join("scenario.json")).ok()?).ok()?;
    let structures: Vec<Value> = scenario["library"].as_str().map(|path| json!({ "path": path })).into_iter().collect();
    Some(json!({ "steps": scenario["steps"], "structures": structures }))
}

#[tauri::command]
pub fn bench_mark(name: String, at: i64, data: Option<Value>) {
    mark(&name, Some(at), data);
}

/// Whether the harness has created the file `name` in the run folder.
#[tauri::command]
pub fn bench_signal(name: String) -> bool {
    let plain = !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    plain && dir().is_some_and(|dir| dir.join(&name).exists())
}

#[tauri::command]
pub fn bench_quit(handle: AppHandle) {
    handle.exit(0);
}

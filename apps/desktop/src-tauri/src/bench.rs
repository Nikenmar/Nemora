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
#[cfg_attr(test, specta::specta)]
pub fn bench_config() -> Option<Value> {
    let dir = dir()?;
    let scenario: Value = serde_json::from_slice(&std::fs::read(dir.join("scenario.json")).ok()?).ok()?;
    let structures: Vec<Value> = scenario["library"].as_str().map(|path| json!({ "path": path })).into_iter().collect();
    Some(json!({ "steps": scenario["steps"], "structures": structures }))
}

#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn bench_mark(name: String, at: i64, data: Option<Value>) {
    mark(&name, Some(at), data);
}

/// Whether the harness has created the file `name` in the run folder.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn bench_signal(name: String) -> bool {
    let plain = !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    plain && dir().is_some_and(|dir| dir.join(&name).exists())
}

#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn bench_quit(handle: AppHandle) {
    handle.exit(0);
}

/// Whether this run belongs to the redesign's screenshot stand (tools/redesign/shots.mjs), which
/// sets `NEMORA_SHOTS_BACKGROUND`: the user keeps working while it runs.
pub fn in_background() -> bool {
    dir().is_some() && std::env::var_os("NEMORA_SHOTS_BACKGROUND").is_some()
}

/// The stand's windows are created without the focus: otherwise the webview takes it the moment it
/// exists, long before the window is shown. The app itself still focuses its window on reveal.
pub fn context<R: tauri::Runtime>(mut context: tauri::Context<R>) -> tauri::Context<R> {
    if in_background() {
        for window in &mut context.config_mut().app.windows {
            window.focus = false;
        }
    }
    context
}

#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn bench_background() -> bool {
    in_background()
}

/// The stand's window has no taskbar button, stays behind every other window and is never
/// activated: showing a window activates it, and even a moment in front minimises a full-screen
/// game. Should Windows activate it by another path, the focus goes straight back.
pub fn keep_in_background(window: &tauri::WebviewWindow) {
    if !in_background() {
        return;
    }
    let _ = window.set_focusable(false);
    let _ = window.set_skip_taskbar(true);
    let _ = window.set_always_on_bottom(true);
    #[cfg(windows)]
    {
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::Shell::SetWindowSubclass;
        use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, IsWindow, SetForegroundWindow};

        let own = window.hwnd().map(|h| h.0 as isize).unwrap_or_default();
        // tao shows the window with SW_SHOW, which activates it; every move, resize and show of
        // this window is made non-activating before it happens.
        let _ = window.run_on_main_thread(move || unsafe {
            let _ = SetWindowSubclass(HWND(own as *mut core::ffi::c_void), Some(no_activate), NO_ACTIVATE_ID, 0);
        });
        // Follows whatever the user has in front for the whole run (they may switch apps while the
        // stand works); the moment this window is in front instead, the focus goes straight back.
        // Polled rather than driven by focus events: a window that cannot take the focus is not
        // told when Windows activates it anyway.
        std::thread::spawn(move || {
            let mut last = unsafe { GetForegroundWindow() }.0 as isize;
            loop {
                let front = unsafe { GetForegroundWindow() }.0 as isize;
                if front == own {
                    let target = HWND(last as *mut core::ffi::c_void);
                    if last != 0 && unsafe { IsWindow(Some(target)) }.as_bool() {
                        let _ = unsafe { SetForegroundWindow(target) };
                    }
                } else if front != 0 {
                    last = front;
                }
                std::thread::sleep(std::time::Duration::from_millis(25));
            }
        });
    }
}

#[cfg(windows)]
const NO_ACTIVATE_ID: usize = 0x4e4f_4143; // "NOAC"

#[cfg(windows)]
unsafe extern "system" fn no_activate(
    hwnd: windows::Win32::Foundation::HWND,
    message: u32,
    wparam: windows::Win32::Foundation::WPARAM,
    lparam: windows::Win32::Foundation::LPARAM,
    _id: usize,
    _data: usize,
) -> windows::Win32::Foundation::LRESULT {
    use windows::Win32::Foundation::LRESULT;
    use windows::Win32::UI::Shell::{DefSubclassProc, RemoveWindowSubclass};
    use windows::Win32::UI::WindowsAndMessaging::{
        MA_NOACTIVATE, SWP_NOACTIVATE, WINDOWPOS, WM_MOUSEACTIVATE, WM_NCDESTROY, WM_WINDOWPOSCHANGING,
    };

    unsafe {
        match message {
            WM_WINDOWPOSCHANGING => {
                if let Some(pos) = (lparam.0 as *mut WINDOWPOS).as_mut() {
                    pos.flags |= SWP_NOACTIVATE;
                }
            }
            WM_MOUSEACTIVATE => return LRESULT(MA_NOACTIVATE as isize),
            WM_NCDESTROY => {
                let _ = RemoveWindowSubclass(hwnd, Some(no_activate), NO_ACTIVATE_ID);
            }
            _ => {}
        }
        DefSubclassProc(hwnd, message, wparam, lparam)
    }
}

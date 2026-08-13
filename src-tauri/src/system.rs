//! Power state, display topology, and lossless second-instance delivery.
//!
//! `tauri-plugin-os` reports OS identity only - it has no battery or power
//! source API - and Tauri exposes no global monitor-topology event, so both
//! live here. The TypeScript side (`src/platform/shell`) is already written
//! against the exact contracts below.

use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

/// Matches the camel-case payload `TauriPowerStatePort` expects.
#[derive(Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PowerState {
    pub is_on_battery_power: bool,
}

#[cfg(windows)]
fn read_power_state() -> Result<PowerState, String> {
    use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};

    let mut status = SYSTEM_POWER_STATUS::default();
    // SAFETY: `status` is a valid, properly aligned, exclusively borrowed
    // out-parameter for the duration of the call.
    unsafe { GetSystemPowerStatus(&mut status) }.map_err(|error| error.to_string())?;

    // ACLineStatus: 0 offline, 1 online, 255 unknown. Unknown is treated as
    // mains power, matching Electron's powerMonitor default rather than
    // pessimistically claiming battery.
    Ok(PowerState {
        is_on_battery_power: status.ACLineStatus == 0,
    })
}

#[cfg(not(windows))]
fn read_power_state() -> Result<PowerState, String> {
    Ok(PowerState {
        is_on_battery_power: false,
    })
}

#[tauri::command]
pub async fn get_power_state() -> Result<PowerState, String> {
    read_power_state()
}

/// A fingerprint of the current monitor layout, used to notice that a display
/// was added, removed, moved or resized.
fn monitor_fingerprint(app: &AppHandle) -> String {
    let Some(window) = app.get_webview_window("main") else {
        return String::new();
    };
    let Ok(monitors) = window.available_monitors() else {
        return String::new();
    };
    monitors
        .iter()
        .map(|monitor| {
            let position = monitor.position();
            let size = monitor.size();
            format!(
                "{},{},{}x{}@{}",
                position.x,
                position.y,
                size.width,
                size.height,
                monitor.scale_factor()
            )
        })
        .collect::<Vec<_>>()
        .join("|")
}

/// Watches power source and monitor topology, emitting only on change.
///
/// This polls rather than hooking `WM_POWERBROADCAST` and `WM_DISPLAYCHANGE`.
/// Subclassing the webview's window procedure to receive those messages is
/// doable, but it is a second owner of that HWND alongside the taskbar module,
/// and a five second poll of two cheap system calls costs less than the risk of
/// two subclasses fighting. Both consumers already coalesce duplicates, so the
/// only observable difference is latency measured in seconds.
pub fn spawn_system_watcher(app: AppHandle) {
    std::thread::spawn(move || {
        let mut last_power = read_power_state().ok();
        let mut last_displays = monitor_fingerprint(&app);

        loop {
            std::thread::sleep(std::time::Duration::from_secs(5));

            if let Ok(current) = read_power_state() {
                if last_power != Some(current) {
                    last_power = Some(current);
                    let _ = app.emit("nemora://power-source-changed", current);
                }
            }

            // The mixer session appears only once audio actually plays, so it
            // is claimed here rather than at startup.
            #[cfg(windows)]
            crate::audio_session::apply();

            let displays = monitor_fingerprint(&app);
            if !displays.is_empty() && displays != last_displays {
                last_displays = displays;
                // The renderer re-clamps its window rectangle on this. A window
                // straddling two monitors stops being painted entirely.
                let _ = app.emit("nemora://display-changed", ());
            }
        }
    });
}

/// Second-instance argv queued in Rust until the renderer says it is listening.
///
/// The single-instance plugin fires as soon as the process starts, which can be
/// before the webview has registered its JavaScript listener. Anything emitted
/// then is lost, and "open with Nora" silently does nothing on a cold start.
#[derive(Default)]
pub struct PendingSecondInstanceArgs(pub Mutex<Vec<Vec<String>>>);

pub fn queue_second_instance_args(app: &AppHandle, argv: Vec<String>) {
    let state = app.state::<PendingSecondInstanceArgs>();
    state
        .0
        .lock()
        .expect("pending argv mutex poisoned")
        .push(argv.clone());
    // Emit as well: a renderer that is already listening handles it immediately,
    // and the drain below is idempotent because it clears what it returns.
    let _ = app.emit("nemora://second-instance", argv);
}

#[tauri::command]
pub fn drain_pending_second_instance_args(
    state: tauri::State<'_, PendingSecondInstanceArgs>,
) -> Vec<Vec<String>> {
    std::mem::take(&mut *state.0.lock().expect("pending argv mutex poisoned"))
}

/// This process's own arguments, without the executable path.
///
/// The single-instance plugin only ever reports SECOND instances, so opening a
/// track while the app is already running worked while opening one from a cold
/// start did not: the file that launched the app was never looked at. Windows
/// passes it here, in our own argv, and nowhere else.
#[tauri::command]
pub fn startup_args() -> Vec<String> {
    std::env::args().skip(1).collect()
}

/// Absolute profile directory override, or `None` for the normal location.
///
/// Exists because Tauri resolves `dataDir()` through the Windows known-folder
/// API, which ignores the `APPDATA` environment variable. A test run that
/// believed it was sandboxed by setting `APPDATA` therefore read and wrote the
/// real user profile - which is exactly the accident this port is supposed to
/// make impossible. `NEMORA_PROFILE_DIR` is the supported way to point a build at
/// a copy.
#[tauri::command]
pub fn profile_dir_override() -> Option<String> {
    std::env::var("NEMORA_PROFILE_DIR")
        .ok()
        .filter(|v| !v.is_empty())
}

/// Where the port self-check should write its report, or `None` for a normal
/// launch. Set by `scripts/port-check.mjs` through `NEMORA_SELFCHECK_OUT`.
#[tauri::command]
pub fn selfcheck_output_path() -> Option<String> {
    std::env::var("NEMORA_SELFCHECK_OUT")
        .ok()
        .filter(|v| !v.is_empty())
}

/// True when the native implementations must stand aside and the TypeScript
/// route must run instead. Set through `NEMORA_FORCE_TS`.
///
/// It exists for two jobs: telling whether a defect belongs to the native side
/// without rebuilding, and running both routes against each other in the
/// benchmark. There is deliberately no setting for it in the interface - one
/// more switch to forget to wire is not what this codebase needs.
#[tauri::command]
pub fn force_typescript() -> bool {
    std::env::var("NEMORA_FORCE_TS")
        .map(|value| !value.is_empty() && value != "0")
        .unwrap_or(false)
}

/// True when the app is being measured and must not reach the network at
/// startup. Set by `scripts/benchmark.mjs` through `NEMORA_BENCHMARK_MODE`.
///
/// The update check runs a few seconds after first paint, and a benchmark that
/// waits for the CPU to go quiet was therefore timing a request to GitHub: the
/// same build measured 3.6 s and 11.8 s on one machine depending on how fast
/// that request came back. A startup metric must measure the app, not the link
/// to it.
#[tauri::command]
pub fn benchmark_mode() -> bool {
    std::env::var("NEMORA_BENCHMARK_MODE")
        .map(|value| !value.is_empty() && value != "0")
        .unwrap_or(false)
}

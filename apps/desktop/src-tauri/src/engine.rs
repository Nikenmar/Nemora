//! The playback engine (`nemora-audio`) behind the view's player. Audio is rendered by this
//! process through WASAPI shared, so the volume mixer and OBS see Nemora itself, not the webview.

use std::sync::Mutex;

use nemora_audio::{Event, Player};
use serde_json::json;
use tauri::{AppHandle, Emitter, State};

use crate::commands::Res;

#[derive(Default)]
pub struct Engine(Mutex<Option<Player>>);

fn event_json(event: &Event) -> serde_json::Value {
    match event {
        Event::Loaded { token, duration } => json!({ "kind": "loaded", "token": token, "duration": duration }),
        Event::Playing { token, position } => json!({ "kind": "playing", "token": token, "position": position }),
        Event::Paused { token, position } => json!({ "kind": "paused", "token": token, "position": position }),
        Event::Position { token, position } => json!({ "kind": "position", "token": token, "position": position }),
        Event::Seeked { token, position } => json!({ "kind": "seeked", "token": token, "position": position }),
        Event::Ended { token } => json!({ "kind": "ended", "token": token }),
        Event::Error { token, message } => json!({ "kind": "error", "token": token, "message": message }),
    }
}

/// Runs `f` on the player, starting it on first use.
fn with_player(handle: &AppHandle, engine: &Engine, f: impl FnOnce(&Player)) -> Res<()> {
    let mut guard = engine.0.lock().unwrap_or_else(|e| e.into_inner());
    if guard.is_none() {
        let events = handle.clone();
        let player = Player::start(move |event| {
            let _ = events.emit("nemora://engine", event_json(&event));
        })?;
        *guard = Some(player);
    }
    if let Some(player) = guard.as_ref() {
        f(player);
    }
    Ok(())
}

/// Loads a file (a path, or its `nemora` URL) under `token`, optionally playing from `at` seconds.
#[tauri::command]
pub fn engine_load(
    handle: AppHandle,
    engine: State<'_, Engine>,
    token: u64,
    source: String,
    play: bool,
    at: f64,
) -> Res<()> {
    let clean = source.split(['?', '#']).next().unwrap_or(&source).to_owned();
    let path = crate::protocol::local_path_from_asset_url(&clean).unwrap_or(clean);
    with_player(&handle, &engine, |p| p.load(token, path.into(), play, at))
}

#[tauri::command]
pub fn engine_play(handle: AppHandle, engine: State<'_, Engine>) -> Res<()> {
    with_player(&handle, &engine, Player::play)
}

#[tauri::command]
pub fn engine_pause(handle: AppHandle, engine: State<'_, Engine>) -> Res<()> {
    with_player(&handle, &engine, Player::pause)
}

#[tauri::command]
pub fn engine_seek(handle: AppHandle, engine: State<'_, Engine>, seconds: f64) -> Res<()> {
    with_player(&handle, &engine, |p| p.seek(seconds))
}

#[tauri::command]
pub fn engine_stop(handle: AppHandle, engine: State<'_, Engine>) -> Res<()> {
    with_player(&handle, &engine, Player::stop)
}

/// The volume slider's value (0..100); the engine applies the 1.x taper.
#[tauri::command]
pub fn engine_volume(handle: AppHandle, engine: State<'_, Engine>, percent: f64, muted: bool) -> Res<()> {
    with_player(&handle, &engine, |p| p.set_volume(percent, muted))
}

/// The ten equalizer bands in dB, 32 Hz first.
#[tauri::command]
pub fn engine_equalizer(handle: AppHandle, engine: State<'_, Engine>, gains: [f64; 10]) -> Res<()> {
    with_player(&handle, &engine, |p| p.set_equalizer(gains))
}

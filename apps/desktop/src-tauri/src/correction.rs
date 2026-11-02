//! Headphone correction (PLAN/18 D5): the AutoEQ index and profiles, fetched only on the user's
//! request, a profile's curve for Settings, and the engine stage on or off.

use nemora_audio::parametric::{self, Profile};
use nemora_core::autoeq::{self, Headphone};
use tauri::{AppHandle, State};

use crate::app::App;
use crate::commands::{Res, fail};
use crate::engine::{Engine, with_player};

const INDEX_FILE: &str = "autoeq-index.md";

/// The headphones AutoEQ has profiles for. Read from the cached index unless `refresh` (or there is
/// none yet), in which case INDEX.md is fetched and cached in the profile folder.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn autoeq_index(app: State<'_, App>, refresh: bool) -> Res<Vec<Headphone>> {
    let cache = app.profile.join(INDEX_FILE);
    tauri::async_runtime::spawn_blocking(move || {
        let text = match std::fs::read_to_string(&cache) {
            Ok(text) if !refresh => text,
            _ => {
                let text = autoeq::fetch_index()?;
                std::fs::write(&cache, &text).map_err(|e| e.to_string())?;
                text
            }
        };
        Ok::<_, String>(autoeq::parse_index(&text))
    })
    .await
    .map_err(fail)?
    .map_err(fail)
}

/// One headphone's `ParametricEQ.txt`, fetched.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn autoeq_profile(headphone: Headphone) -> Res<String> {
    tauri::async_runtime::spawn_blocking(move || autoeq::fetch_profile(&headphone)).await.map_err(fail)?.map_err(fail)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(specta::Type))]
pub struct Preview {
    pub profile: Profile,
    /// (Hz, dB) at 96 points from 20 Hz to 20 kHz, preamp included, as run at 48 kHz.
    pub curve: Vec<[f64; 2]>,
}

/// Reads a profile's text (AutoEQ or Equalizer APO) and draws its curve; an error says why not.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn correction_preview(text: String) -> Res<Preview> {
    let profile = parametric::parse(&text).map_err(fail)?;
    let curve = (0..96)
        .map(|i| {
            let f = 20.0 * 1000f64.powf(i as f64 / 95.0);
            [f, parametric::response_db(&profile, f, 48_000)]
        })
        .collect();
    Ok(Preview { profile, curve })
}

/// Turns the correction on with a profile's text, or off with `None`.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn engine_correction(handle: AppHandle, engine: State<'_, Engine>, text: Option<String>) -> Res<()> {
    let profile = text.map(|t| parametric::parse(&t)).transpose().map_err(fail)?;
    with_player(&handle, &engine, |p| p.set_correction(profile))
}

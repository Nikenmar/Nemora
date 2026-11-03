//! Energy flow's background job (PLAN/15 C2): measures the library's songs one at a time into
//! `track_features`, from the envelopes the visuals already cache (or a fresh analysis), with a
//! pause between songs so the machine stays quiet. Started when the user switches Energy flow on;
//! stops when every song is measured or the user switches it off.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use tauri::{AppHandle, Manager, State};

use crate::app::App;
use crate::commands::{Res, fail, rows_for};

/// A pause between two songs: about a fifth of the time one takes to measure.
const PAUSE: Duration = Duration::from_millis(40);
/// Songs written to the database at once: small, so Settings shows the progress song by song.
const BATCH: usize = 4;

#[derive(Default)]
pub struct EnergyJob {
    running: Arc<AtomicBool>,
}

fn run(handle: AppHandle, running: Arc<AtomicBool>) {
    let app = handle.state::<App>();
    while running.load(Ordering::Relaxed) {
        let Ok(batch) = nemora_core::features::missing(&app.read(), BATCH) else { break };
        if batch.is_empty() {
            break;
        }
        let rows = match rows_for(&app.read(), &batch) {
            Ok(rows) => rows,
            Err(_) => break,
        };
        let mut measured = Vec::new();
        for row in rows {
            if !running.load(Ordering::Relaxed) {
                break;
            }
            let Some(path) = row.path.as_deref() else { continue };
            let bytes = crate::visuals::envelope(&app.profile, &row.song_id, path, false);
            // A file that cannot be decoded still counts as measured (flat), so it is not tried forever.
            let (energy, brightness, dynamics) = nemora_audio::visuals::features(&bytes).unwrap_or((0.5, 0.5, 0.0));
            measured.push((row.song_id.clone(), energy, brightness, dynamics));
            std::thread::sleep(PAUSE);
        }
        // Songs without a readable row are marked flat too.
        for id in &batch {
            if !measured.iter().any(|(m, ..)| m == id) && running.load(Ordering::Relaxed) {
                measured.push((id.clone(), 0.5, 0.5, 0.0));
            }
        }
        let stored = app.write_quiet(|db| {
            for (id, energy, brightness, dynamics) in &measured {
                nemora_core::features::store(db, id, *energy, *brightness, *dynamics)?;
            }
            Ok(())
        });
        if stored.is_err() {
            break;
        }
    }
    running.store(false, Ordering::Relaxed);
}

/// Starts or stops the job and tells how far it got: `{ analysed, total, running }`.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn energy_analysis(
    handle: AppHandle,
    app: State<'_, App>,
    job: State<'_, EnergyJob>,
    start: Option<bool>,
) -> Res<EnergyStatus> {
    match start {
        Some(true) if !job.running.swap(true, Ordering::Relaxed) => {
            let running = job.running.clone();
            std::thread::Builder::new().name("energy-flow".into()).spawn(move || run(handle, running)).map_err(fail)?;
        }
        Some(false) => job.running.store(false, Ordering::Relaxed),
        _ => {}
    }
    let (analysed, total) = nemora_core::features::progress(&app.read()).map_err(fail)?;
    Ok(EnergyStatus { analysed, running: job.running.load(Ordering::Relaxed), total })
}

/// How far the energy analysis got (PLAN/21: typed; fields in the order the untyped answer's keys had).
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(specta::Type))]
pub struct EnergyStatus {
    pub analysed: i64,
    pub running: bool,
    pub total: i64,
}

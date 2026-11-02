//! Lyrics for the whole library (PLAN/19 D5): a background job, on only while the user has it on
//! (Settings > Lyrics). One song at a time; about one LRCLIB request a second; the request is made
//! outside the database lock. Stops when every song has been tried, when switched off, or after
//! several failed requests in a row (offline), saying so.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use nemora_core::lyrics_job::{self, Outcome, Query};
use serde_json::{Value, json};
use tauri::{AppHandle, Manager, State};

use crate::app::App;
use crate::commands::{Res, fail};

/// Between two requests to LRCLIB.
const PACE: Duration = Duration::from_millis(1000);
/// Between two songs found on disk.
const LOCAL_PACE: Duration = Duration::from_millis(20);
/// Failed requests in a row before the job stops (the network is down).
const MAX_FAILURES: u32 = 5;
const DEFER: &str = "\u{0}defer";

#[derive(Default)]
pub struct LyricsJob {
    running: Arc<AtomicBool>,
    error: Arc<Mutex<Option<String>>>,
}

fn now() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64)
}

fn run(handle: AppHandle, running: Arc<AtomicBool>, error: Arc<Mutex<Option<String>>>) {
    let app = handle.state::<App>();
    let mut failures = 0;
    let mut found_any = false;
    'outer: while running.load(Ordering::Relaxed) {
        let Ok(batch) = lyrics_job::pending(&app.read(), now(), 16) else { break };
        if batch.is_empty() {
            break;
        }
        for id in batch {
            if !running.load(Ordering::Relaxed) {
                break 'outer;
            }
            // First on disk only: the request, if one is needed, is made with no lock held.
            let mut query: Option<Query> = None;
            let first = app.write_quiet(|db| {
                lyrics_job::fill(db, &id, now(), &mut |q| {
                    query = Some(q.clone());
                    Err(DEFER.into())
                })
            });
            let outcome = match first {
                Ok(Ok(outcome)) => Ok(outcome),
                Ok(Err(e)) if e == DEFER => {
                    let Some(q) = query else { continue };
                    let answer = lyrics_job::lrclib(&q);
                    std::thread::sleep(PACE);
                    match app.write_quiet(|db| lyrics_job::fill(db, &id, now(), &mut |_| answer.clone())) {
                        Ok(result) => result,
                        Err(e) => Err(e.to_string()),
                    }
                }
                Ok(Err(e)) => Err(e),
                Err(e) => Err(e.to_string()),
            };
            match outcome {
                Ok(Outcome::Found | Outcome::Local(_)) => {
                    failures = 0;
                    found_any = true;
                    std::thread::sleep(LOCAL_PACE);
                }
                Ok(_) => failures = 0,
                Err(e) => {
                    failures += 1;
                    if failures >= MAX_FAILURES {
                        *error.lock().unwrap_or_else(|p| p.into_inner()) = Some(e);
                        break 'outer;
                    }
                }
            }
        }
    }
    if found_any {
        crate::commands::notify(&handle, &["songs/lyrics"]);
    }
    running.store(false, Ordering::Relaxed);
}

/// Starts or stops the job and tells how far it got: `{ done, total, running, error }`.
#[tauri::command]
pub async fn lyrics_library(
    handle: AppHandle,
    app: State<'_, App>,
    job: State<'_, LyricsJob>,
    start: Option<bool>,
) -> Res<Value> {
    match start {
        Some(true) if !job.running.swap(true, Ordering::Relaxed) => {
            *job.error.lock().map_err(fail)? = None;
            let (running, error) = (job.running.clone(), job.error.clone());
            std::thread::Builder::new()
                .name("lyrics-library".into())
                .spawn(move || run(handle, running, error))
                .map_err(fail)?;
        }
        Some(false) => job.running.store(false, Ordering::Relaxed),
        _ => {}
    }
    let (done, total) = nemora_core::lyrics_job::progress(&app.read()).map_err(fail)?;
    let error = job.error.lock().map_err(fail)?.clone();
    Ok(json!({ "done": done, "total": total, "running": job.running.load(Ordering::Relaxed), "error": error }))
}

/// The lyrics index (PLAN/19 D6): rebuilt in the background, in steps, whenever the stored lyrics
/// moved; a search reads whatever is indexed so far and never waits for it.
#[derive(Default)]
pub struct LyricsIndex {
    seen: Mutex<Option<(i64, i64)>>,
    building: Arc<AtomicBool>,
}

/// Songs indexed per step: about half a second of work at most.
const INDEX_STEP: usize = 200;

fn refresh_index(handle: &AppHandle, app: &App, index: &LyricsIndex) {
    let Ok(now) = nemora_core::lyrics_index::fingerprint(&app.read()) else { return };
    let mut seen = index.seen.lock().unwrap_or_else(|p| p.into_inner());
    if *seen == Some(now) || index.building.swap(true, Ordering::Relaxed) {
        return;
    }
    *seen = Some(now);
    let (handle, building) = (handle.clone(), index.building.clone());
    let spawned = std::thread::Builder::new().name("lyrics-index".into()).spawn(move || {
        let app = handle.state::<App>();
        while let Ok(n) = app.write_quiet(|db| nemora_core::lyrics_index::sync(db, INDEX_STEP)) {
            if n == 0 {
                break;
            }
        }
        building.store(false, Ordering::Relaxed);
    });
    if spawned.is_err() {
        index.building.store(false, Ordering::Relaxed);
        *seen = None;
    }
}

/// Songs with a line matching `query`: the line, the lines around it, its time when synced.
#[tauri::command]
pub async fn lyrics_search(
    handle: AppHandle,
    app: State<'_, App>,
    index: State<'_, LyricsIndex>,
    query: String,
    limit: Option<usize>,
) -> Res<Vec<nemora_core::lyrics_index::Hit>> {
    refresh_index(&handle, &app, &index);
    nemora_core::lyrics_index::search(&app.read(), &query, limit.unwrap_or(20)).map_err(fail)
}

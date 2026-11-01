//! Home's "For you" (PLAN/19): the smart lists and the mix of the day, from `nemora_core::smartlists`.
//! The mix is kept for its day in `settings_device` (`home.mix`), so it stays the same until
//! tomorrow or until the user asks for a new one.

use nemora_core::shuffle::Options;
use nemora_core::smartlists::{self, Entry, Inputs, List, Mix};
use tauri::State;

use crate::app::App;
use crate::commands::{Res, fail, stored_rediscover};
use crate::tastemap::TasteMapCache;

const MIX_KEY: &str = "home.mix";

fn inputs(app: &App, cache: &TasteMapCache, options: Option<Options>, intensity: Option<f64>) -> Res<Inputs> {
    let prepared = app.derived("shuffle", nemora_core::shuffle::prepare).map_err(fail)?;
    let map = cache.snapshot(app);
    let db = app.read();
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64);
    let weights = nemora_core::shuffle::weights_prepared(
        &db,
        &prepared,
        &[],
        intensity.unwrap_or(0.6),
        &options.unwrap_or_default(),
    )
    .map_err(fail)?;
    smartlists::stored_inputs(&db, weights, map.as_ref(), stored_rediscover(&db), now).map_err(fail)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartList {
    pub id: List,
    pub entries: Vec<Entry>,
}

/// The smart lists that have songs, in their order (Rediscover first).
#[tauri::command]
pub async fn smart_lists(
    app: State<'_, App>,
    cache: State<'_, TasteMapCache>,
    options: Option<Options>,
    intensity: Option<f64>,
) -> Res<Vec<SmartList>> {
    let inputs = inputs(&app, &cache, options, intensity)?;
    Ok(List::ALL
        .into_iter()
        .map(|id| SmartList { id, entries: smartlists::list(&inputs, id) })
        .filter(|l| !l.entries.is_empty())
        .collect())
}

/// The mix of `today` (the view's local day): the one kept for the day, or a new one when there is
/// none yet or `fresh` (New mix).
#[tauri::command]
pub async fn mix_of_day(
    app: State<'_, App>,
    cache: State<'_, TasteMapCache>,
    today: String,
    fresh: Option<bool>,
    options: Option<Options>,
    intensity: Option<f64>,
) -> Res<Mix> {
    let kept: Option<Mix> =
        nemora_core::settings::device(&app.read(), MIX_KEY).ok().flatten().and_then(|v| serde_json::from_value(v).ok());
    let fresh = fresh.unwrap_or(false);
    if let Some(mix) = &kept
        && mix.day == today
        && !fresh
        && !mix.songs.is_empty()
    {
        return Ok(mix.clone());
    }
    let round = kept.as_ref().filter(|m| m.day == today).map_or(0, |m| m.round + 1);
    let inputs = inputs(&app, &cache, options, intensity)?;
    let mix = smartlists::mix(&inputs, &today, round);
    let value = serde_json::to_value(&mix).map_err(fail)?;
    // Kept quietly: nothing else reads it, so no list or derived value has to be dropped.
    app.write_quiet(|db| nemora_core::settings::set_device(db, MIX_KEY, &value)).map_err(fail)?;
    Ok(mix)
}

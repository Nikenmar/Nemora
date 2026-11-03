//! PLAN/21 P21.6: Smart Shuffle's queue order, ported from the view's `megaShuffleQueue.ts`, which
//! stays its oracle: the same rules, step for step, so that one random draw per song gives the same
//! order on both sides (the equivalence suite, `tests/mega_order.rs`, runs the oracle's own cases).
//!
//! Per-song weights choose the broad order (`draw^(1/weight)`, best first, held songs after every
//! other one). Each next song is then the best key that is not a too-different neighbour of the one
//! before and, while another can come, shares no artist with it and makes no jump in energy; the
//! current song's taste-map neighbours lean ahead. Last, a song's other rows (its versions) wait
//! after everything else: one song, one turn.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

/// How far past the best key the order looks for a song by another artist.
const ARTIST_SEARCH: usize = 300;
/// A jump larger than this in energy between neighbours is avoided while it can be.
const ENERGY_JUMP: f64 = 0.35;
/// The current song's map neighbours weigh this much more...
const FOLLOW_LIFT: f64 = 1.5;
/// ...among the best this many candidates.
const FOLLOW_WINDOW: usize = 50;
/// The weight of a song the data does not know.
const DEFAULT_WEIGHT: f64 = 0.4;

/// One pair the user marked in duels; only `tooDifferent` keeps two songs apart.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct PairFeedback {
    /// Absent on records from before reasoned feedback: not `tooDifferent`.
    #[serde(default)]
    pub reason: Option<String>,
    pub song_a_id: String,
    pub song_b_id: String,
}

/// What the order reads, as the view's `MegaShuffleData` (Smart Shuffle's `shuffle_data` answer).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct MegaData {
    pub weights: HashMap<String, f64>,
    #[serde(default)]
    pub pair_feedback: Vec<PairFeedback>,
    #[serde(default)]
    pub held: Option<Vec<String>>,
    #[serde(default)]
    pub artists: Option<HashMap<String, Vec<i64>>>,
    #[serde(default)]
    pub energy: Option<HashMap<String, f64>>,
    #[serde(default)]
    pub neighbours: Option<HashMap<String, Vec<String>>>,
}

/// The new order, and for each original position where it went (-1: nowhere, which only a
/// duplicate beyond the order's copies would be).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct MegaOrder {
    pub shuffled_queue: Vec<String>,
    pub positions: Vec<i64>,
}

/// The song of a row: a version's view id is `song:variant`.
fn song(id: &str) -> &str {
    id.split(':').next().unwrap_or(id)
}

fn lookup<'a, T>(map: Option<&'a HashMap<String, T>>, id: &str) -> Option<&'a T> {
    let map = map?;
    map.get(id).or_else(|| map.get(song(id)))
}

struct Keyed<'a> {
    id: &'a str,
    key: f64,
    held: bool,
    artists: Option<&'a Vec<i64>>,
    energy: Option<f64>,
}

/// The order of `song_ids`; `current_index` stays first. `draws` are the random numbers in 0..1,
/// one per song other than the current one, in queue order (the oracle's `random()` calls); when
/// they run out, 0.5 stands in.
pub fn mega_order(song_ids: &[String], data: &MegaData, current_index: Option<i64>, draws: &[f64]) -> MegaOrder {
    let mut working: Vec<&str> = song_ids.iter().map(String::as_str).collect();
    // As the oracle's `splice(index, 1)`: a negative index counts from the end, one past it takes nothing.
    let len = working.len() as i64;
    let current = match current_index.map(|i| if i < 0 { (len + i).max(0) } else { i }) {
        Some(i) if i < len => Some(working.remove(i as usize)),
        _ => None,
    };

    let mut partners: HashMap<&str, HashSet<&str>> = HashMap::new();
    for pair in &data.pair_feedback {
        if pair.reason.as_deref() == Some("tooDifferent") {
            partners.entry(&pair.song_a_id).or_default().insert(&pair.song_b_id);
            partners.entry(&pair.song_b_id).or_default().insert(&pair.song_a_id);
        }
    }

    let held: HashSet<&str> = data.held.iter().flatten().map(String::as_str).collect();
    let is_held = |id: &str| held.contains(id) || held.contains(song(id));
    let artists_of = |id: &str| lookup(data.artists.as_ref(), id);
    let energy_of = |id: &str| lookup(data.energy.as_ref(), id).copied();
    let near_of = |id: &str| -> Option<HashSet<&str>> {
        let near = lookup(data.neighbours.as_ref(), id)?;
        (!near.is_empty()).then(|| near.iter().map(String::as_str).collect())
    };

    let mut keyed: Vec<Keyed> = working
        .iter()
        .enumerate()
        .map(|(i, &id)| {
            let weight = data.weights.get(id).or_else(|| data.weights.get(song(id))).copied().unwrap_or(DEFAULT_WEIGHT);
            let draw = draws.get(i).copied().unwrap_or(0.5);
            Keyed {
                id,
                key: draw.powf(1.0 / weight),
                held: is_held(id),
                artists: artists_of(id),
                energy: energy_of(id),
            }
        })
        .collect();
    // Best key first, held songs after every other one; equal keys keep queue order (stable).
    keyed.sort_by(|a, b| {
        a.held.cmp(&b.held).then_with(|| b.key.partial_cmp(&a.key).unwrap_or(std::cmp::Ordering::Equal))
    });
    let held_from = keyed.iter().position(|k| k.held).unwrap_or(keyed.len());

    let mut taken = vec![false; keyed.len()];
    let mut shuffled: Vec<&str> = current.into_iter().collect();
    let mut head = 0;
    let mut previous_artists = current.and_then(artists_of);
    let mut previous_energy = current.and_then(energy_of);
    let mut previous_near = current.and_then(near_of);
    for _ in 0..keyed.len() {
        while taken[head] {
            head += 1;
        }
        let avoid = shuffled.last().and_then(|previous| partners.get(previous));
        let same_artist = |k: usize| match (previous_artists, keyed[k].artists) {
            (Some(previous), Some(artists)) => artists.iter().any(|a| previous.contains(a)),
            _ => false,
        };
        let energy_jump = |k: usize| match (previous_energy, keyed[k].energy) {
            (Some(previous), Some(energy)) => (energy - previous).abs() > ENERGY_JUMP,
            _ => false,
        };
        let mut pick = head;
        if avoid.is_some() || previous_artists.is_some() || previous_energy.is_some() || previous_near.is_some() {
            let group_end = if head < held_from { held_from } else { keyed.len() };
            let soft_end = group_end.min(head + ARTIST_SEARCH);
            let mut not_too_different = None;
            let mut best = None;
            let mut best_key = f64::NEG_INFINITY;
            let mut good = 0;
            for k in head..group_end {
                if taken[k] || avoid.is_some_and(|a| a.contains(keyed[k].id)) {
                    continue;
                }
                if not_too_different.is_none() {
                    not_too_different = Some(k);
                }
                if k >= soft_end {
                    break;
                }
                if same_artist(k) || energy_jump(k) {
                    continue;
                }
                let lifted = if previous_near.as_ref().is_some_and(|near| near.contains(keyed[k].id)) {
                    keyed[k].key.powf(1.0 / FOLLOW_LIFT)
                } else {
                    keyed[k].key
                };
                if lifted > best_key {
                    best_key = lifted;
                    best = Some(k);
                }
                good += 1;
                if previous_near.is_none() || good >= FOLLOW_WINDOW {
                    break;
                }
            }
            if let Some(found) = best.or(not_too_different) {
                pick = found;
            }
        }
        taken[pick] = true;
        let id = keyed[pick].id;
        shuffled.push(id);
        previous_artists = keyed[pick].artists;
        previous_energy = keyed[pick].energy;
        previous_near = near_of(id);
    }

    // One song, one turn: a song's other rows wait after everything else.
    let mut first = HashSet::new();
    let (mut turns, mut later) = (Vec::new(), Vec::new());
    for &id in &shuffled {
        if first.insert(song(id)) { turns.push(id) } else { later.push(id) }
    }
    if !later.is_empty() {
        turns.extend(later);
        shuffled = turns;
    }

    // Where each original position went; duplicates are matched in order.
    let mut at: HashMap<&str, std::collections::VecDeque<i64>> = HashMap::new();
    for (index, &id) in shuffled.iter().enumerate() {
        at.entry(id).or_default().push_back(index as i64);
    }
    let positions =
        song_ids.iter().map(|id| at.get_mut(id.as_str()).and_then(|q| q.pop_front()).unwrap_or(-1)).collect();
    MegaOrder { shuffled_queue: shuffled.into_iter().map(str::to_owned).collect(), positions }
}

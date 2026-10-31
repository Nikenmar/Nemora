//! Smart Shuffle (1.1.9 `megaShuffle.ts` and the renderer's `megaShuffleQueue.ts`). It leans, it
//! does not rig: each song gets a weight from its tier placement, its artists' standing, its ELO
//! rating and its full listens, blended with plain randomness by the user's intensity; recently
//! played songs are pushed back. The queue is then ordered by Efraimidis-Spirakis keys, keeping
//! "too different" pairs apart. Checked against the old code by `tests/shuffle_oracle.rs`.

use std::collections::{HashMap, HashSet};

use crate::elo::{Rating, normalized_score};

/// How hard the most recently played song is pushed back (weight x0.4), fading to nothing for the
/// oldest entry of the recent list.
const FRESHNESS_PENALTY: f64 = 0.6;
/// A song with no weight of its own (1.x default).
const DEFAULT_WEIGHT: f64 = 0.4;
/// ELO joins the formula once this many duels exist; below that it is noise.
pub const ELO_MIN_DUELS: i64 = 10;
const DAY_MS: i64 = 86_400_000;
/// Skip-aware (PLAN/14 C3): two early skips this close together push a song back...
const SKIP_PAIR_WINDOW_MS: i64 = 14 * DAY_MS;
/// ...at full strength for this long, then fading back over the next stretch.
const SKIP_HOLD_MS: i64 = 14 * DAY_MS;
const SKIP_RECOVER_MS: i64 = 14 * DAY_MS;
/// The weight factor of a freshly rejected song.
pub const SKIP_FACTOR: f64 = 0.5;

/// S = 1.0 down to the last tier = (1/total)^1.4: the top tiers clearly stand out.
pub fn tier_value(index: usize, total: usize) -> f64 {
    if total == 0 {
        return 0.0;
    }
    ((total - index) as f64 / total as f64).powf(1.4)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Tierlist {
    pub influences_shuffle: bool,
    /// Song ids per tier, best tier first.
    pub tiers: Vec<Vec<String>>,
}

/// Everything the weights depend on.
pub struct Inputs<'a> {
    /// The library in a fixed order (sums depend on it): (song id, artists).
    pub songs: &'a [(String, Vec<String>)],
    pub tierlists: &'a [Tierlist],
    pub full_listens: &'a HashMap<String, i64>,
    /// Recently played song ids, newest first (repeats allowed, as 1.x's History).
    pub recent: &'a [String],
    pub ratings: &'a HashMap<String, Rating>,
    pub total_duels: i64,
}

/// Best placement of each song across the given tierlists.
pub fn tier_scores<'t>(tierlists: impl Iterator<Item = &'t Tierlist>) -> HashMap<String, f64> {
    let mut scores: HashMap<String, f64> = HashMap::new();
    for tierlist in tierlists {
        let total = tierlist.tiers.len();
        for (index, tier) in tierlist.tiers.iter().enumerate() {
            let value = tier_value(index, total);
            for id in tier {
                let entry = scores.entry(id.clone()).or_insert(value);
                if value > *entry {
                    *entry = value;
                }
            }
        }
    }
    scores
}

/// What a song's weight is made of, each part in 0..1 (PLAN/14 C1).
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Parts {
    /// Best tier placement in a tierlist that influences the shuffle (S = 1).
    pub tier: f64,
    /// The best affinity of the song's artists (their tiers and listens across the library).
    pub artist: f64,
    /// Normalised ELO score, once enough duels exist.
    pub elo: Option<f64>,
    /// Full listens against the most listened song.
    pub listens: f64,
    /// 1 unless played recently: the push back of the recent list.
    pub freshness: f64,
    /// The smart score before blending with randomness.
    pub score: f64,
}

/// The parts of every target song (all songs when `targets` is empty), in target order.
pub fn parts(inputs: &Inputs<'_>, targets: &[String]) -> Vec<(String, Parts)> {
    if inputs.songs.is_empty() {
        return Vec::new();
    }
    let all: Vec<String>;
    let targets = if targets.is_empty() {
        all = inputs.songs.iter().map(|(id, _)| id.clone()).collect();
        &all
    } else {
        targets
    };
    let song_tier = tier_scores(inputs.tierlists.iter().filter(|t| t.influences_shuffle));

    let max_song_listen = inputs.full_listens.values().copied().fold(0, i64::max);

    // Artist affinity over the whole library, accumulated in library order as 1.x did.
    let mut artist_order: Vec<&str> = Vec::new();
    let mut artist_tier: HashMap<&str, f64> = HashMap::new();
    let mut artist_listen: HashMap<&str, f64> = HashMap::new();
    for (id, artists) in inputs.songs {
        let t = song_tier.get(id).copied().unwrap_or(0.0);
        let l = inputs.full_listens.get(id).copied().unwrap_or(0) as f64;
        for a in artists {
            if a.is_empty() {
                continue;
            }
            if !artist_tier.contains_key(a.as_str()) {
                artist_order.push(a);
            }
            *artist_tier.entry(a).or_insert(0.0) += t;
            *artist_listen.entry(a).or_insert(0.0) += l;
        }
    }
    let max_artist_tier = artist_tier.values().copied().fold(1.0, f64::max);
    let max_artist_listen = artist_listen.values().copied().fold(1.0, f64::max);
    let affinity: HashMap<&str, f64> = artist_order
        .iter()
        .map(|a| (*a, 0.75 * (artist_tier[a] / max_artist_tier) + 0.25 * (artist_listen[a] / max_artist_listen)))
        .collect();

    let history_len = inputs.recent.len();
    let mut recency: HashMap<&str, usize> = HashMap::new();
    for (i, id) in inputs.recent.iter().enumerate() {
        recency.entry(id.as_str()).or_insert(i);
    }
    let freshness = |id: &str| match recency.get(id) {
        Some(&i) if history_len > 0 => 1.0 - FRESHNESS_PENALTY * ((history_len - i) as f64 / history_len as f64),
        _ => 1.0,
    };

    let has_elo = inputs.total_duels >= ELO_MIN_DUELS;
    let elo_score = |id: &str| match inputs.ratings.get(id) {
        Some(r) if r.games >= 1 => normalized_score(r),
        _ => 0.5,
    };
    let artists_of: HashMap<&str, &Vec<String>> = inputs.songs.iter().map(|(id, a)| (id.as_str(), a)).collect();

    targets
        .iter()
        .map(|id| {
            let t = song_tier.get(id).copied().unwrap_or(0.0);
            let mut a = 0.0f64;
            for artist in artists_of.get(id.as_str()).copied().into_iter().flatten() {
                let value = affinity.get(artist.as_str()).copied().unwrap_or(0.0);
                if value > a {
                    a = value;
                }
            }
            let l = if max_song_listen > 0 {
                inputs.full_listens.get(id).copied().unwrap_or(0) as f64 / max_song_listen as f64
            } else {
                0.0
            };
            let elo = has_elo.then(|| elo_score(id));
            let score = match elo {
                Some(e) => 0.45 * t + 0.35 * a + 0.1 * e + 0.1 * l,
                None => 0.5 * t + 0.4 * a + 0.1 * l,
            };
            (id.clone(), Parts { tier: t, artist: a, elo, listens: l, freshness: freshness(id), score })
        })
        .collect()
}

/// The weight of a song with these parts at this intensity, in [0.001 .. 1].
pub fn weight_of(parts: &Parts, intensity: f64) -> f64 {
    let blend = intensity.clamp(0.0, 1.0);
    (1.0 - blend + blend * parts.score).max(0.001) * parts.freshness
}

/// Weight per target song (all songs when `targets` is empty), in [0.001 .. 1].
pub fn weights(inputs: &Inputs<'_>, targets: &[String], intensity: f64) -> HashMap<String, f64> {
    parts(inputs, targets).into_iter().map(|(id, p)| (id, weight_of(&p, intensity))).collect()
}

/// Skip-aware factor from a song's early skips (times in ms, oldest first): x0.5 for 14 days after
/// the second of two early skips within 14 days, then back to 1 linearly over the next 14 days.
pub fn skip_factor(early_skips: &[i64], now: i64) -> f64 {
    let Some(paired) = early_skips.windows(2).rev().find(|w| w[1] - w[0] <= SKIP_PAIR_WINDOW_MS).map(|w| w[1]) else {
        return 1.0;
    };
    let age = (now - paired).max(0);
    if age < SKIP_HOLD_MS {
        SKIP_FACTOR
    } else {
        let recovered = ((age - SKIP_HOLD_MS) as f64 / SKIP_RECOVER_MS as f64).min(1.0);
        SKIP_FACTOR + (1.0 - SKIP_FACTOR) * recovered
    }
}

fn pair_key(a: &str, b: &str) -> (String, String) {
    if a < b { (a.to_owned(), b.to_owned()) } else { (b.to_owned(), a.to_owned()) }
}

/// The shuffled queue: the current song stays first, the rest go by `random()^(1/weight)`
/// descending, and a song that is "too different" from the one before it waits while another
/// candidate exists. Returns the new order and, for each original position, its new index.
///
/// 1.1.9 re-sorted the whole remainder at every step (quadratic); picking the best key that is not
/// a too-different neighbour is the same choice, made in one pass over keys sorted once.
pub fn weighted_order(
    queue: &[String],
    weights: &HashMap<String, f64>,
    too_different: &[(String, String)],
    current_index: Option<usize>,
    random: &mut dyn FnMut() -> f64,
) -> (Vec<String>, Vec<usize>) {
    let mut working: Vec<(usize, &String)> = queue.iter().enumerate().collect();
    let current = current_index.filter(|&i| i < queue.len()).map(|i| working.remove(i));
    let pairs: HashSet<(String, String)> = too_different.iter().map(|(a, b)| pair_key(a, b)).collect();
    let mut keyed: Vec<(f64, usize, &String)> = working
        .into_iter()
        .map(|(i, id)| {
            let weight = weights.get(id).copied().unwrap_or(DEFAULT_WEIGHT);
            (random().powf(1.0 / weight), i, id)
        })
        .collect();
    // Descending by key; equal keys keep queue order (the stable sort of 1.x).
    keyed.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));

    let mut order: Vec<(usize, &String)> = Vec::with_capacity(queue.len());
    if let Some(c) = current {
        order.push(c);
    }
    let mut taken = vec![false; keyed.len()];
    let mut head = 0;
    for _ in 0..keyed.len() {
        while taken[head] {
            head += 1;
        }
        let previous = order.last().map(|(_, id)| id.as_str());
        let mut pick = head;
        if let Some(prev) = previous
            && pairs.iter().any(|(a, b)| a == prev || b == prev)
        {
            // The best key that is not a too-different neighbour; if every one is, the best key.
            if let Some(free) = (head..keyed.len()).find(|&k| !taken[k] && !pairs.contains(&pair_key(prev, keyed[k].2)))
            {
                pick = free;
            }
        }
        taken[pick] = true;
        order.push((keyed[pick].1, keyed[pick].2));
    }
    let mut positions = vec![0usize; queue.len()];
    for (new_index, (old_index, _)) in order.iter().enumerate() {
        positions[*old_index] = new_index;
    }
    (order.into_iter().map(|(_, id)| id.clone()).collect(), positions)
}

// ----- stored data ------------------------------------------------------------------------------

/// Tierlists as the shuffle sees them; pending items are left out.
pub fn stored_tierlists(db: &crate::db::Db) -> crate::Result<Vec<Tierlist>> {
    let mut stmt =
        db.conn().prepare("SELECT doc FROM tierlists WHERE deleted_at IS NULL ORDER BY created_at, tierlist_id")?;
    let docs: Vec<String> = stmt.query_map([], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
    Ok(docs
        .into_iter()
        .filter_map(|d| serde_json::from_str::<serde_json::Value>(&d).ok())
        .map(|d| tierlist_of(&d))
        .collect())
}

/// A stored tierlist as the shuffle reads it. Songs in its `shuffleExcluded` keep their place in the
/// tierlist (and in playlists and the queue) but feed no tier score from it, so they neither lift
/// nor sink themselves or their artists in Magic Shuffle.
pub fn tierlist_of(doc: &serde_json::Value) -> Tierlist {
    let excluded: HashSet<&str> =
        doc["shuffleExcluded"].as_array().into_iter().flatten().filter_map(|v| v.as_str()).collect();
    Tierlist {
        influences_shuffle: doc["influencesShuffle"].as_bool().unwrap_or(false),
        tiers: doc["tiers"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|t| {
                t["items"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|v| v.as_str())
                    .filter(|s| !s.starts_with("pending:") && !excluded.contains(s))
                    .map(str::to_owned)
                    .collect()
            })
            .collect(),
    }
}

/// The last `limit` distinct songs played, newest first.
pub fn recent_songs(db: &crate::db::Db, limit: usize) -> crate::Result<Vec<String>> {
    let mut stmt = db.conn().prepare("SELECT song_id FROM play_events ORDER BY ended_at DESC, seq DESC LIMIT ?1")?;
    let mut out: Vec<String> = Vec::new();
    for id in stmt.query_map([(limit * 10) as i64], |r| r.get::<_, String>(0))? {
        let id = id?;
        if !out.contains(&id) {
            out.push(id);
            if out.len() == limit {
                break;
            }
        }
    }
    // As 1.x read its History: what it had played before 2.0 follows, unless the history was cleared.
    if out.len() < limit && crate::settings::device(db, "history.clearedAt")?.is_none() {
        let imported = crate::settings::device(db, crate::plays::IMPORTED_HISTORY)?;
        for id in
            imported.as_ref().and_then(serde_json::Value::as_array).into_iter().flatten().filter_map(|v| v.as_str())
        {
            if out.len() == limit {
                break;
            }
            if !out.iter().any(|s| s == id) {
                out.push(id.to_owned());
            }
        }
    }
    Ok(out)
}

/// Skip-aware factors (below 1 only) per song: an early skip is a "next" before 30 s or before a
/// quarter of the song.
pub fn skip_factors(db: &crate::db::Db, now: i64) -> crate::Result<HashMap<String, f64>> {
    let since = now - SKIP_PAIR_WINDOW_MS - SKIP_HOLD_MS - SKIP_RECOVER_MS;
    let mut stmt = db.conn().prepare(
        // By time only, so SQLite walks the recent end of `play_events_ended`; ordering by song made
        // it scan every play through the song index (110 ms at 200 000 plays).
        "SELECT song_id, ended_at FROM play_events
         WHERE ended_at >= ?1 AND end_reason = 'user_next' AND (heard_ms < 30000 OR heard_ms * 4 < duration_ms)",
    )?;
    let mut skips: HashMap<String, Vec<i64>> = HashMap::new();
    for row in stmt.query_map([since], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))? {
        let (id, at) = row?;
        skips.entry(id).or_default().push(at);
    }
    Ok(skips
        .into_iter()
        .map(|(id, mut times)| {
            times.sort_unstable();
            (id, skip_factor(&times, now))
        })
        .filter(|(_, factor)| *factor < 1.0)
        .collect())
}

struct StoredInputs {
    songs: Vec<(String, Vec<String>)>,
    full: HashMap<String, i64>,
    tierlists: Vec<Tierlist>,
    recent: Vec<String>,
    ratings: HashMap<String, crate::elo::Rating>,
    total_duels: i64,
}

impl StoredInputs {
    fn inputs(&self) -> Inputs<'_> {
        Inputs {
            songs: &self.songs,
            tierlists: &self.tierlists,
            full_listens: &self.full,
            recent: &self.recent,
            ratings: &self.ratings,
            total_duels: self.total_duels,
        }
    }
}

/// Shuffle weights for `targets` from the database; `skip_aware` applies the early-skip factors.
pub fn stored_weights(
    db: &crate::db::Db,
    targets: &[String],
    intensity: f64,
    skip_aware: bool,
) -> crate::Result<HashMap<String, f64>> {
    let stored = stored_inputs(db)?;
    let mut out = weights(&stored.inputs(), targets, intensity);
    if skip_aware {
        for (id, factor) in skip_factors(db, crate::db::now_ms())? {
            if let Some(w) = out.get_mut(&id) {
                *w = (*w * factor).max(0.001);
            }
        }
    }
    Ok(out)
}

/// Why a song plays where it does (PLAN/14 C1): its parts and the facts behind them.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Explanation {
    pub song_id: String,
    pub tier: f64,
    /// The tierlist and tier of the best placement, when it has one.
    pub tierlist: Option<String>,
    pub tier_name: Option<String>,
    pub artist: f64,
    pub elo: Option<f64>,
    /// The share of rated songs this one rates above, 0..1, once ELO counts.
    pub elo_percentile: Option<f64>,
    pub listens: f64,
    pub full_listens: i64,
    /// The last day it was heard (`YYYY-MM-DD`), if ever.
    pub last_day: Option<String>,
    pub freshness: f64,
    /// The skip-aware factor, 1 when it does not apply.
    pub skip: f64,
    pub weight: f64,
}

/// Explanations for `targets`, in their order, with the weights the shuffle uses.
pub fn explain(
    db: &crate::db::Db,
    targets: &[String],
    intensity: f64,
    skip_aware: bool,
) -> crate::Result<Vec<Explanation>> {
    let stored = stored_inputs(db)?;
    let skips = if skip_aware { skip_factors(db, crate::db::now_ms())? } else { HashMap::new() };

    // Best placement per song, by tierlist and tier name, among tierlists that influence the shuffle.
    let mut best: HashMap<String, (f64, String, String)> = HashMap::new();
    for (_, doc) in crate::playlists::tierlists(db)? {
        let tierlist = tierlist_of(&doc);
        if !tierlist.influences_shuffle {
            continue;
        }
        let name = doc["name"].as_str().unwrap_or("").to_owned();
        let total = tierlist.tiers.len();
        let tier_names: Vec<String> = doc["tiers"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|t| t["name"].as_str().unwrap_or("").to_owned())
            .collect();
        for (index, tier) in tierlist.tiers.iter().enumerate() {
            let value = tier_value(index, total);
            for id in tier {
                if best.get(id).is_none_or(|b| value > b.0) {
                    let tier_name = tier_names.get(index).cloned().unwrap_or_default();
                    best.insert(id.clone(), (value, name.clone(), tier_name));
                }
            }
        }
    }

    let mut rated: Vec<f64> = stored.ratings.values().filter(|r| r.games >= 1).map(normalized_score).collect();
    rated.sort_by(f64::total_cmp);
    let percentile = |score: f64| {
        let below = rated.partition_point(|s| *s < score);
        if rated.len() > 1 { below as f64 / (rated.len() - 1) as f64 } else { 0.5 }
    };

    let mut last_days: HashMap<String, String> = HashMap::new();
    let mut stmt = db.conn().prepare("SELECT song_id, last_day FROM song_totals WHERE last_day IS NOT NULL")?;
    for row in stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
        let (id, day) = row?;
        last_days.insert(id, day);
    }

    Ok(parts(&stored.inputs(), targets)
        .into_iter()
        .map(|(id, p)| {
            let skip = skips.get(&id).copied().unwrap_or(1.0);
            let placement = best.get(&id);
            let rating = stored.ratings.get(&id).filter(|r| r.games >= 1);
            Explanation {
                tier: p.tier,
                tierlist: placement.map(|b| b.1.clone()),
                tier_name: placement.map(|b| b.2.clone()),
                artist: p.artist,
                elo: p.elo,
                elo_percentile: p.elo.and(rating).map(|r| percentile(normalized_score(r))),
                listens: p.listens,
                full_listens: stored.full.get(&id).copied().unwrap_or(0),
                last_day: last_days.get(&id).cloned(),
                freshness: p.freshness,
                skip,
                weight: (weight_of(&p, intensity) * skip).max(0.001),
                song_id: id,
            }
        })
        .collect())
}

fn stored_inputs(db: &crate::db::Db) -> crate::Result<StoredInputs> {
    let mut stmt = db.conn().prepare(
        "SELECT v.song_id, (SELECT group_concat(name, char(31)) FROM variant_artists a WHERE a.variant_id = v.variant_id AND a.role = 'artist')
         FROM track_variants v GROUP BY v.song_id ORDER BY v.song_id",
    )?;
    let songs: Vec<(String, Vec<String>)> = stmt
        .query_map([], |r| {
            let artists: Option<String> = r.get(1)?;
            Ok((r.get(0)?, artists.map(|a| a.split('\u{1f}').map(str::to_owned).collect()).unwrap_or_default()))
        })?
        .collect::<rusqlite::Result<_>>()?;
    let full: HashMap<String, i64> = db
        .conn()
        .prepare("SELECT song_id, full FROM song_totals")?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?;
    Ok(StoredInputs {
        songs,
        full,
        tierlists: stored_tierlists(db)?,
        recent: recent_songs(db, 50)?,
        ratings: crate::elo::ratings(db)?,
        total_duels: crate::elo::total_duels(db)?,
    })
}

/// "Less of this artist today" (PLAN/14 C2).
pub const LESS_ARTIST: f64 = 0.35;
/// "More like this": the song's artists, and (once the taste map has them) its neighbours.
pub const MORE_ARTIST: f64 = 1.4;
pub const MORE_NEIGHBOUR: f64 = 1.8;
/// "Boost songs added in the last 14 days" (C4).
pub const BOOST_NEW: f64 = 1.6;

/// The user's steering for this session (C2) and session filters (C4); nothing is stored.
#[derive(Debug, Clone, Default, PartialEq, serde::Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Steering {
    /// Artist names to hear less of.
    pub less_artists: Vec<String>,
    /// Song ids to hear more like.
    pub more_like: Vec<String>,
    /// Only songs not heard for 30 days; the others wait at the end of the queue.
    pub only_unheard: bool,
    /// Only songs placed in a tierlist; the others wait at the end.
    pub only_ranked: bool,
    pub boost_new: bool,
}

impl Steering {
    pub fn is_empty(&self) -> bool {
        *self == Self::default()
    }
}

/// Applies `steering` to `weights` (keyed by song id) and returns the songs the filters hold back,
/// which the view puts after the rest. `neighbours` are the taste map's, per song.
pub fn steer(
    db: &crate::db::Db,
    weights: &mut HashMap<String, f64>,
    steering: &Steering,
    neighbours: &dyn Fn(&str) -> Vec<String>,
    now: i64,
) -> crate::Result<HashSet<String>> {
    let mut held = HashSet::new();
    if steering.is_empty() {
        return Ok(held);
    }
    let mut artists: HashMap<String, Vec<String>> = HashMap::new();
    let mut stmt =
        db.conn().prepare("SELECT DISTINCT v.song_id, a.name FROM track_variants v JOIN variant_artists a ON a.variant_id = v.variant_id WHERE a.role = 'artist'")?;
    for row in stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
        let (id, name) = row?;
        artists.entry(id).or_default().push(name.to_lowercase());
    }
    let less: HashSet<String> = steering.less_artists.iter().map(|a| a.to_lowercase()).collect();
    let mut more_artists: HashSet<String> = HashSet::new();
    let mut more_songs: HashSet<String> = HashSet::new();
    for id in &steering.more_like {
        more_artists.extend(artists.get(id).into_iter().flatten().cloned());
        more_songs.extend(neighbours(id));
    }
    let mut new_songs: HashSet<String> = HashSet::new();
    if steering.boost_new {
        let mut stmt = db.conn().prepare("SELECT song_id FROM tracks WHERE first_seen_at >= ?1")?;
        for id in stmt.query_map([now - 14 * DAY_MS], |r| r.get::<_, String>(0))? {
            new_songs.insert(id?);
        }
    }
    let mut heard_lately: HashSet<String> = HashSet::new();
    if steering.only_unheard {
        let since = crate::time::local_day(now - 30 * DAY_MS, 0);
        let mut stmt = db.conn().prepare("SELECT song_id FROM song_totals WHERE last_day >= ?1")?;
        for id in stmt.query_map([since], |r| r.get::<_, String>(0))? {
            heard_lately.insert(id?);
        }
    }
    let ranked: HashSet<String> = if steering.only_ranked {
        stored_tierlists(db)?.into_iter().flat_map(|t| t.tiers.into_iter().flatten()).collect()
    } else {
        HashSet::new()
    };

    for (id, weight) in weights.iter_mut() {
        let own = artists.get(id).map(Vec::as_slice).unwrap_or_default();
        let mut factor = 1.0;
        if own.iter().any(|a| less.contains(a)) {
            factor *= LESS_ARTIST;
        }
        if more_songs.contains(id) {
            factor *= MORE_NEIGHBOUR;
        } else if own.iter().any(|a| more_artists.contains(a)) {
            factor *= MORE_ARTIST;
        }
        if new_songs.contains(id) {
            factor *= BOOST_NEW;
        }
        *weight = (*weight * factor).max(0.001);
        if (steering.only_unheard && heard_lately.contains(id)) || (steering.only_ranked && !ranked.contains(id)) {
            held.insert(id.clone());
        }
    }
    Ok(held)
}

/// "Too different" answers of the last 180 days (at most 100): pairs to keep apart.
pub fn too_different_pairs(db: &crate::db::Db) -> crate::Result<Vec<(String, String)>> {
    let since = crate::db::now_ms() - 180 * 86_400_000;
    let mut stmt = db.conn().prepare(
        "SELECT song_a, song_b FROM duels WHERE skip_reason = 'tooDifferent' AND at >= ?1 ORDER BY at DESC LIMIT 100",
    )?;
    let pairs = stmt.query_map([since], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<rusqlite::Result<_>>()?;
    Ok(pairs)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn excluded_songs_stay_in_the_tierlist_but_feed_no_tier_score() {
        let doc = serde_json::json!({
            "influencesShuffle": true,
            "shuffleExcluded": ["b"],
            "tiers": [{ "items": ["a", "b"] }, { "items": ["c", "pending:x"] }]
        });
        let tierlist = tierlist_of(&doc);
        assert_eq!(tierlist.tiers, vec![vec!["a".to_owned()], vec!["c".to_owned()]]);
        let scores = tier_scores(std::iter::once(&tierlist));
        assert!(scores.contains_key("a") && scores.contains_key("c"));
        assert!(!scores.contains_key("b"));
    }

    #[test]
    fn two_early_skips_push_a_song_back_then_it_recovers() {
        let day = DAY_MS;
        let now = 100 * day;
        // One skip, or two far apart, change nothing.
        assert_eq!(skip_factor(&[now - day], now), 1.0);
        assert_eq!(skip_factor(&[now - 40 * day, now - 20 * day], now), 1.0);
        // Two within 14 days: x0.5 for 14 days after the second...
        assert_eq!(skip_factor(&[now - 5 * day, now - 2 * day], now), SKIP_FACTOR);
        assert_eq!(skip_factor(&[now - 16 * day, now - 13 * day], now), SKIP_FACTOR);
        // ...then halfway back after 21 days, and fully back after 28.
        assert!((skip_factor(&[now - 24 * day, now - 21 * day], now) - 0.75).abs() < 1e-9);
        assert_eq!(skip_factor(&[now - 31 * day, now - 28 * day], now), 1.0);
        // The latest pair counts.
        assert_eq!(skip_factor(&[now - 60 * day, now - 59 * day, now - 3 * day, now - day], now), SKIP_FACTOR);
    }

    fn seeded() -> crate::db::Db {
        let db = crate::db::Db::open_in_memory().unwrap();
        let c = db.conn();
        for (song, artist) in [("a", "X"), ("b", "Y"), ("c", "X")] {
            let id = song.repeat(26);
            c.execute("INSERT INTO tracks VALUES (?1, 'flac', 44100, 16, 2, 200000, NULL, 0, 0)", [&id]).unwrap();
            c.execute(
                "INSERT INTO track_variants (song_id, tag_signature, title, title_sort, artist_sort, album, album_sort, last_seen_at)
                 VALUES (?1, 'sig', ?1, ?1, ?2, NULL, NULL, 0)",
                [&id, artist],
            )
            .unwrap();
            c.execute("INSERT INTO variant_artists VALUES (last_insert_rowid(), 'artist', 0, ?1)", [artist]).unwrap();
        }
        let doc = serde_json::json!({
            "name": "best",
            "influencesShuffle": true,
            "tiers": [{ "name": "S", "items": ["a".repeat(26)] }, { "name": "B", "items": ["b".repeat(26)] }]
        });
        crate::playlists::save_tierlist(&db, None, &doc).unwrap();
        db
    }

    fn skip(db: &crate::db::Db, song: &str, seq: i64, ended_at: i64, heard_ms: i64) {
        db.conn()
            .execute(
                "INSERT INTO play_events (event_id, device_id, seq, song_id, started_at, ended_at, utc_offset_min, heard_ms,
                   duration_ms, max_position_ms, end_reason)
                 VALUES ('D:' || ?1, 'D', ?1, ?2, ?3, ?3, 0, ?4, 200000, ?4, 'user_next')",
                rusqlite::params![seq, song.repeat(26), ended_at, heard_ms],
            )
            .unwrap();
    }

    #[test]
    fn explain_names_the_best_tier_and_the_skip_push_back() {
        let db = seeded();
        let now = crate::db::now_ms();
        let (a, b, c) = ("a".repeat(26), "b".repeat(26), "c".repeat(26));
        // b: two early skips this week; c: two late "next"s, which are not early skips.
        skip(&db, "b", 1, now - 3 * DAY_MS, 5_000);
        skip(&db, "b", 2, now - DAY_MS, 20_000);
        skip(&db, "c", 3, now - 2 * DAY_MS, 150_000);
        skip(&db, "c", 4, now - DAY_MS, 150_000);

        let targets = [a.clone(), b.clone(), c.clone()];
        let explained = explain(&db, &targets, 0.6, true).unwrap();
        assert_eq!(explained.iter().map(|e| e.song_id.as_str()).collect::<Vec<_>>(), [&a, &b, &c]);
        assert_eq!(explained[0].tierlist.as_deref(), Some("best"));
        assert_eq!(explained[0].tier_name.as_deref(), Some("S"));
        assert_eq!(explained[0].tier, 1.0);
        assert_eq!(explained[1].tier_name.as_deref(), Some("B"));
        assert_eq!(explained[1].skip, SKIP_FACTOR);
        assert_eq!(explained[2].skip, 1.0);
        assert_eq!(explained[2].tierlist, None);
        // c shares a with its artist, so it carries X's affinity without a tier of its own.
        assert!(explained[2].artist > 0.0);

        // The weights the shuffle uses are the explained ones, with and without skip-aware.
        let weights = stored_weights(&db, &targets, 0.6, true).unwrap();
        for e in &explained {
            assert!((weights[&e.song_id] - e.weight).abs() < 1e-12);
        }
        let plain = stored_weights(&db, &targets, 0.6, false).unwrap();
        assert!((weights[&b] - plain[&b] * SKIP_FACTOR).abs() < 1e-12);
        assert_eq!(weights[&c], plain[&c]);
    }

    #[test]
    fn steering_leans_on_artists_and_neighbours_and_filters_hold_songs_back() {
        let db = seeded();
        let now = crate::db::now_ms();
        let (a, b, c) = ("a".repeat(26), "b".repeat(26), "c".repeat(26));
        db.conn()
            .execute("UPDATE tracks SET first_seen_at = ?1 WHERE song_id = ?2", rusqlite::params![now, b])
            .unwrap();
        db.conn()
            .execute(
                "INSERT INTO song_totals VALUES (?1, 1, 1, 1, 0, 1000, ?2)",
                rusqlite::params![a, crate::time::local_day(now, 0)],
            )
            .unwrap();
        let base: HashMap<String, f64> = [(a.clone(), 0.5), (b.clone(), 0.5), (c.clone(), 0.5)].into();
        let none = |_: &str| Vec::new();

        let mut w = base.clone();
        let held = steer(&db, &mut w, &Steering::default(), &none, now).unwrap();
        assert_eq!(w, base);
        assert!(held.is_empty());

        // Less of X (a and c), more like b (its artist Y), with c as b's neighbour on the map.
        let mut w = base.clone();
        let steering = Steering { less_artists: vec!["x".into()], more_like: vec![b.clone()], ..Default::default() };
        let near_b = |id: &str| if id == "b".repeat(26) { vec!["c".repeat(26)] } else { Vec::new() };
        steer(&db, &mut w, &steering, &near_b, now).unwrap();
        assert!((w[&a] - 0.5 * LESS_ARTIST).abs() < 1e-12);
        assert!((w[&b] - 0.5 * MORE_ARTIST).abs() < 1e-12);
        assert!((w[&c] - 0.5 * LESS_ARTIST * MORE_NEIGHBOUR).abs() < 1e-12);

        // Filters: a was heard today, c is in no tierlist; b is new.
        let mut w = base.clone();
        let steering = Steering { only_unheard: true, only_ranked: true, boost_new: true, ..Default::default() };
        let held = steer(&db, &mut w, &steering, &none, now).unwrap();
        assert_eq!(held, [a.clone(), c.clone()].into());
        assert!((w[&b] - 0.5 * BOOST_NEW).abs() < 1e-12);
    }

    #[test]
    fn the_current_song_stays_first_and_neighbours_are_kept_apart() {
        let queue: Vec<String> = ["a", "b", "c", "d"].iter().map(|s| s.to_string()).collect();
        let weights = HashMap::new();
        let draws = [0.9, 0.8, 0.1];
        let mut i = 0;
        let mut random = || {
            i += 1;
            draws[i - 1]
        };
        // Current = "a"; keys b > c > d, but "a" and "b" are too different.
        let (order, positions) = weighted_order(&queue, &weights, &[("b".into(), "a".into())], Some(0), &mut random);
        assert_eq!(order, ["a", "c", "b", "d"]);
        assert_eq!(positions, [0, 2, 1, 3]);
    }
}

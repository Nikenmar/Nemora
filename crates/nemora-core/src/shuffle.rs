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

/// Weight per target song (all songs when `targets` is empty), in [0.001 .. 1].
pub fn weights(inputs: &Inputs<'_>, targets: &[String], intensity: f64) -> HashMap<String, f64> {
    let mut out = HashMap::new();
    if inputs.songs.is_empty() {
        return out;
    }
    let all: Vec<String>;
    let targets = if targets.is_empty() {
        all = inputs.songs.iter().map(|(id, _)| id.clone()).collect();
        &all
    } else {
        targets
    };
    let blend = intensity.clamp(0.0, 1.0);
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

    for id in targets {
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
        let score =
            if has_elo { 0.45 * t + 0.35 * a + 0.1 * elo_score(id) + 0.1 * l } else { 0.5 * t + 0.4 * a + 0.1 * l };
        let w = (1.0 - blend + blend * score).max(0.001);
        out.insert(id.clone(), w * freshness(id));
    }
    out
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
        .map(|doc| Tierlist {
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
                        .filter(|s| !s.starts_with("pending:"))
                        .map(str::to_owned)
                        .collect()
                })
                .collect(),
        })
        .collect())
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
    Ok(out)
}

/// Shuffle weights for `targets` from the database.
pub fn stored_weights(db: &crate::db::Db, targets: &[String], intensity: f64) -> crate::Result<HashMap<String, f64>> {
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
    let tierlists = stored_tierlists(db)?;
    let recent = recent_songs(db, 50)?;
    let ratings = crate::elo::ratings(db)?;
    let inputs = Inputs {
        songs: &songs,
        tierlists: &tierlists,
        full_listens: &full,
        recent: &recent,
        ratings: &ratings,
        total_duels: crate::elo::total_duels(db)?,
    };
    Ok(weights(&inputs, targets, intensity))
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

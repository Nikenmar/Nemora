//! Rediscover (1.1.9 `rediscover.ts`): songs you clearly love (tier placement, ELO, full listens)
//! that you have not heard for a while. Derived, recomputed on demand, never stored: in 1.x it was
//! a regenerated system playlist whose manual edits were disposable anyway.

use std::collections::{HashMap, HashSet};

use crate::elo::{Rating, positive_score};
use crate::shuffle::{ELO_MIN_DUELS, Tierlist, tier_scores};

pub const CAP: usize = 50;

pub struct Inputs<'a> {
    pub songs: &'a [String],
    pub tierlists: &'a [Tierlist],
    pub ratings: &'a HashMap<String, Rating>,
    pub total_duels: i64,
    pub full_listens: &'a HashMap<String, i64>,
    /// Last time each song was heard (any comparable unit; 1.x used day timestamps).
    pub last_heard: &'a HashMap<String, i64>,
    pub blacklisted: &'a HashSet<String>,
}

/// Up to `CAP` songs, best first, last heard before `cutoff` (or never).
pub fn pick(inputs: &Inputs<'_>, cutoff: i64) -> Vec<String> {
    let tiers = tier_scores(inputs.tierlists.iter());
    let has_elo = inputs.total_duels >= ELO_MIN_DUELS;
    let max_full = inputs.full_listens.values().copied().fold(1, i64::max) as f64;
    let mut scored: Vec<(String, f64)> = Vec::new();
    for id in inputs.songs {
        if inputs.blacklisted.contains(id) {
            continue;
        }
        let elo = match inputs.ratings.get(id) {
            Some(r) if has_elo && r.games >= 1 => positive_score(r),
            _ => 0.0,
        };
        let score = 0.55 * tiers.get(id).copied().unwrap_or(0.0)
            + 0.35 * elo
            + 0.1 * (inputs.full_listens.get(id).copied().unwrap_or(0) as f64 / max_full);
        if score <= 0.0 || inputs.last_heard.get(id).copied().unwrap_or(0) >= cutoff {
            continue;
        }
        scored.push((id.clone(), score));
    }
    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal).then_with(|| a.0.cmp(&b.0)));
    scored.truncate(CAP);
    scored.into_iter().map(|(id, _)| id).collect()
}

/// Rediscover from the database: present songs, not heard for `threshold_days` before `today`.
pub fn stored(db: &crate::db::Db, threshold_days: i64, today: &str) -> crate::Result<Vec<String>> {
    let conn = db.conn();
    let songs: Vec<String> = conn
        .prepare("SELECT DISTINCT song_id FROM track_variants WHERE present = 1 ORDER BY song_id")?
        .query_map([], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    let full: HashMap<String, i64> = conn
        .prepare("SELECT song_id, full FROM song_totals")?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?;
    // Last heard, as days since the epoch: the last day with a play of either source.
    let mut last_heard: HashMap<String, i64> = HashMap::new();
    let mut stmt = conn.prepare(
        "SELECT song_id, max(day) FROM (SELECT song_id, day FROM play_daily WHERE plays > 0
           UNION ALL SELECT song_id, day FROM legacy_daily WHERE song_id IS NOT NULL AND l > 0) GROUP BY song_id",
    )?;
    for row in stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
        let (id, day) = row?;
        if let Some(d) = crate::time::parse_day(&day) {
            last_heard.insert(id, d);
        }
    }
    let blacklisted: HashSet<String> = conn
        .prepare("SELECT song_id FROM blacklist_songs WHERE value = 1")?
        .query_map([], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    let tierlists = crate::shuffle::stored_tierlists(db)?;
    let ratings = crate::elo::ratings(db)?;
    let cutoff = crate::time::parse_day(today).unwrap_or(0) - threshold_days.max(1);
    // Days count from 1970, so "never heard" (0) is always before the cutoff.
    let inputs = Inputs {
        songs: &songs,
        tierlists: &tierlists,
        ratings: &ratings,
        total_duels: crate::elo::total_duels(db)?,
        full_listens: &full,
        last_heard: &last_heard,
        blacklisted: &blacklisted,
    };
    Ok(pick(&inputs, cutoff))
}

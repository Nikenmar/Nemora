//! Duels and tierlists that help Smart Shuffle (PLAN/15 T1, T2).
//!
//! **Teaching duels** pick, now and then, a song the shuffle plays often but knows little about,
//! so each answer tells it the most. **Tier suggestions** list songs whose duels place them a tier
//! higher or lower than the user did: a list the user reads, applies line by line or dismisses;
//! nothing is ever moved without them.

use std::collections::{HashMap, HashSet};

use serde::Serialize;
use serde_json::{Value, json};

use crate::db::Db;
use crate::elo::{self, Rating, effective};
use crate::error::Result;

/// T1: songs in this top share of Smart Shuffle's scores are the ones worth teaching it about.
const TEACH_TOP_SHARE: f64 = 0.3;
/// T1: the anchor is drawn among this many least-known of them.
const TEACH_POOL: usize = 10;
/// T2: a song needs this many duels before its rating speaks against its tier...
pub const SUGGEST_MIN_GAMES: i64 = 5;
/// ...and a neighbouring tier this many rated songs for its median to mean something.
pub const SUGGEST_MIN_NEIGHBOURS: usize = 3;
const DISMISSED: &str = "tierSuggestions.dismissed";

/// G1: songs Smart Shuffle is least sure about, among the top half of its scores: the pool of Song
/// Guessr's "unsure" mode, least known first.
pub fn unsure_songs(db: &Db, limit: usize) -> Result<Vec<String>> {
    let ratings = elo::ratings(db)?;
    let scores = crate::shuffle::stored_weights(db, &[], 1.0, &crate::shuffle::Options::CLASSIC)?;
    let mut ranked: Vec<(&String, f64)> = scores.iter().map(|(id, w)| (id, *w)).collect();
    ranked.sort_by(|a, b| b.1.total_cmp(&a.1).then_with(|| a.0.cmp(b.0)));
    ranked.truncate(ranked.len().div_ceil(2));
    let full: HashMap<String, i64> = db
        .conn()
        .prepare("SELECT song_id, full FROM song_totals")?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?;
    let mut least: Vec<(&String, i64)> = ranked
        .iter()
        .map(|(id, _)| (*id, ratings.get(*id).map_or(0, |r| r.games) + full.get(*id).copied().unwrap_or(0)))
        .collect();
    least.sort_by(|a, b| a.1.cmp(&b.1).then_with(|| a.0.cmp(b.0)));
    Ok(least.into_iter().take(limit).map(|(id, _)| id.clone()).collect())
}

/// A song Smart Shuffle would like a duel about (T1): high in its scores, least known.
pub fn teaching_anchor(db: &Db, random: &mut elo::Random<'_>) -> Result<Option<String>> {
    let ratings = elo::ratings(db)?;
    let eligible: HashSet<String> = elo::match_songs(db, &ratings)?.into_iter().map(|s| s.id).collect();
    let scores = crate::shuffle::stored_weights(db, &[], 1.0, &crate::shuffle::Options::CLASSIC)?;
    let mut ranked: Vec<(&String, f64)> =
        scores.iter().filter(|(id, _)| eligible.contains(*id)).map(|(id, w)| (id, *w)).collect();
    if ranked.is_empty() {
        return Ok(None);
    }
    ranked.sort_by(|a, b| b.1.total_cmp(&a.1).then_with(|| a.0.cmp(b.0)));
    ranked.truncate(((ranked.len() as f64 * TEACH_TOP_SHARE).ceil() as usize).max(1));

    let full: HashMap<String, i64> = db
        .conn()
        .prepare("SELECT song_id, full FROM song_totals")?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?;
    let known = |id: &str| ratings.get(id).map_or(0, |r| r.games) + full.get(id).copied().unwrap_or(0);
    let mut least: Vec<(&String, i64)> = ranked.iter().map(|(id, _)| (*id, known(id))).collect();
    least.sort_by(|a, b| a.1.cmp(&b.1).then_with(|| a.0.cmp(b.0)));
    least.truncate(TEACH_POOL);
    let pick = ((random() * least.len() as f64) as usize).min(least.len() - 1);
    Ok(Some(least[pick].0.clone()))
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct TierSuggestion {
    pub tierlist_id: String,
    pub tierlist: String,
    pub song_id: String,
    /// The tier it is in and the one its duels point to (indexes, best tier 0), with names.
    pub from: usize,
    pub to: usize,
    pub from_name: String,
    pub to_name: String,
    /// Its duels and its rating against the median of the tier it points to.
    pub games: i64,
    pub rating: f64,
    pub neighbour_median: f64,
}

fn key(s: &TierSuggestion) -> String {
    format!("{}:{}:{}", s.tierlist_id, s.song_id, s.to)
}

fn median(mut values: Vec<f64>) -> Option<f64> {
    if values.is_empty() {
        return None;
    }
    values.sort_by(f64::total_cmp);
    Some(values[values.len() / 2])
}

/// Songs whose duels put them a tier away from where the user placed them (T2), in tierlists that
/// influence the shuffle; a dismissed suggestion is not offered again. Reading changes nothing.
pub fn tier_suggestions(db: &Db) -> Result<Vec<TierSuggestion>> {
    let ratings = elo::ratings(db)?;
    let dismissed: HashSet<String> = crate::settings::device(db, DISMISSED)?
        .and_then(|v| v.as_array().cloned())
        .unwrap_or_default()
        .into_iter()
        .filter_map(|v| v.as_str().map(str::to_owned))
        .collect();
    let rated = |id: &str| -> Option<&Rating> { ratings.get(id).filter(|r| r.games >= 1) };
    let mut out = Vec::new();
    for (tierlist_id, doc) in crate::playlists::tierlists(db)? {
        let tierlist = crate::shuffle::tierlist_of(&doc);
        if !tierlist.influences_shuffle {
            continue;
        }
        let name = doc["name"].as_str().unwrap_or("").to_owned();
        let names: Vec<String> = doc["tiers"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|t| t["name"].as_str().unwrap_or("").to_owned())
            .collect();
        let medians: Vec<Option<f64>> = tierlist
            .tiers
            .iter()
            .map(|tier| {
                let values: Vec<f64> = tier.iter().filter_map(|id| rated(id)).map(effective).collect();
                (values.len() >= SUGGEST_MIN_NEIGHBOURS).then(|| median(values)).flatten()
            })
            .collect();
        for (index, tier) in tierlist.tiers.iter().enumerate() {
            for id in tier {
                let Some(r) = ratings.get(id).filter(|r| r.games >= SUGGEST_MIN_GAMES) else { continue };
                let rating = effective(r);
                // Up when it rates at least the median of the tier above; down when at most the median
                // of the tier below. Never both, and never past one tier at a time.
                let target = if index > 0
                    && let Some(m) = medians[index - 1]
                    && rating >= m
                {
                    Some((index - 1, m))
                } else if index + 1 < tierlist.tiers.len()
                    && let Some(m) = medians[index + 1]
                    && rating <= m
                {
                    Some((index + 1, m))
                } else {
                    None
                };
                let Some((to, neighbour_median)) = target else { continue };
                let suggestion = TierSuggestion {
                    tierlist_id: tierlist_id.clone(),
                    tierlist: name.clone(),
                    song_id: id.clone(),
                    from: index,
                    to,
                    from_name: names.get(index).cloned().unwrap_or_default(),
                    to_name: names.get(to).cloned().unwrap_or_default(),
                    games: r.games,
                    rating,
                    neighbour_median,
                };
                if !dismissed.contains(&key(&suggestion)) {
                    out.push(suggestion);
                }
            }
        }
    }
    out.sort_by(|a, b| {
        a.tierlist.cmp(&b.tierlist).then_with(|| a.from.cmp(&b.from)).then_with(|| a.song_id.cmp(&b.song_id))
    });
    Ok(out)
}

/// The user applied a suggestion: the song moves to the end of the target tier, nothing else.
pub fn apply_tier_suggestion(db: &Db, tierlist_id: &str, song_id: &str, to: usize) -> Result<bool> {
    let Some((_, mut doc)) = crate::playlists::tierlists(db)?.into_iter().find(|(id, _)| id == tierlist_id) else {
        return Ok(false);
    };
    let Some(tiers) = doc["tiers"].as_array_mut() else { return Ok(false) };
    if to >= tiers.len() {
        return Ok(false);
    }
    let mut found = false;
    for tier in tiers.iter_mut() {
        if let Some(items) = tier["items"].as_array_mut() {
            let before = items.len();
            items.retain(|v| v.as_str() != Some(song_id));
            found |= items.len() != before;
        }
    }
    if !found {
        return Ok(false);
    }
    match tiers[to]["items"].as_array_mut() {
        Some(items) => items.push(json!(song_id)),
        None => tiers[to]["items"] = json!([song_id]),
    }
    crate::playlists::save_tierlist(db, Some(tierlist_id), &doc)?;
    Ok(true)
}

/// The user dismissed a suggestion: it is not offered again.
pub fn dismiss_tier_suggestion(db: &Db, tierlist_id: &str, song_id: &str, to: usize) -> Result<()> {
    let mut list: Vec<Value> =
        crate::settings::device(db, DISMISSED)?.and_then(|v| v.as_array().cloned()).unwrap_or_default();
    let entry = json!(format!("{tierlist_id}:{song_id}:{to}"));
    if !list.contains(&entry) {
        list.push(entry);
    }
    crate::settings::set_device(db, DISMISSED, &Value::Array(list))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn song(db: &Db, id: &str) {
        db.conn().execute("INSERT INTO tracks VALUES (?1, 'flac', 44100, 16, 2, 200000, NULL, 0, 0)", [id]).unwrap();
        db.conn()
            .execute(
                "INSERT INTO track_variants (song_id, tag_signature, title, title_sort, artist_sort, album, album_sort, last_seen_at)
                 VALUES (?1, 'sig', ?1, ?1, '', NULL, NULL, 0)",
                [id],
            )
            .unwrap();
    }

    fn baseline(db: &Db, id: &str, rating: f64, games: i64) {
        db.conn()
            .execute(
                "INSERT INTO elo_baseline (song_id, rating, games, wins, losses, draws, imported_at) VALUES (?1, ?2, ?3, 0, 0, 0, 0)",
                rusqlite::params![id, rating, games],
            )
            .unwrap();
    }

    #[test]
    fn a_song_rated_like_the_tier_above_is_suggested_up_and_only_moved_when_applied() {
        let db = Db::open_in_memory().unwrap();
        // S: s1..s3 around 1400. B: b1, b2 around 1100, and "riser" at 1420 with 12 games.
        for id in ["s1", "s2", "s3", "b1", "b2", "riser"] {
            song(&db, id);
        }
        for (id, rating) in [("s1", 1400.0), ("s2", 1380.0), ("s3", 1420.0), ("b1", 1100.0), ("b2", 1120.0)] {
            baseline(&db, id, rating, 15);
        }
        baseline(&db, "riser", 1420.0, 12);
        let doc = json!({
            "name": "best",
            "influencesShuffle": true,
            "tiers": [{ "name": "S", "items": ["s1", "s2", "s3"] }, { "name": "B", "items": ["b1", "b2", "riser"] }]
        });
        let id = crate::playlists::save_tierlist(&db, None, &doc).unwrap();

        let before = crate::playlists::tierlists(&db).unwrap();
        let suggestions = tier_suggestions(&db).unwrap();
        // Reading suggestions changes nothing.
        assert_eq!(crate::playlists::tierlists(&db).unwrap(), before);
        let riser = suggestions.iter().find(|s| s.song_id == "riser").expect("riser is suggested");
        assert_eq!((riser.from, riser.to, riser.to_name.as_str()), (1, 0, "S"));
        // B's songs rated like B, S's like S: no other suggestion up; S has no tier above.
        assert!(suggestions.iter().all(|s| s.song_id == "riser" || s.to > s.from));

        // Dismissed, it is not offered again.
        dismiss_tier_suggestion(&db, &id, "riser", 0).unwrap();
        assert!(tier_suggestions(&db).unwrap().iter().all(|s| s.song_id != "riser"));

        // Applied, exactly that song moves.
        assert!(apply_tier_suggestion(&db, &id, "riser", 0).unwrap());
        let (_, doc) = crate::playlists::tierlists(&db).unwrap().into_iter().next().unwrap();
        let items = |t: usize| -> Vec<&str> {
            doc["tiers"][t]["items"].as_array().unwrap().iter().filter_map(|v| v.as_str()).collect()
        };
        assert_eq!(items(0), ["s1", "s2", "s3", "riser"]);
        assert_eq!(items(1), ["b1", "b2"]);
    }

    #[test]
    fn a_teaching_anchor_is_a_high_scoring_song_with_the_least_evidence() {
        let db = Db::open_in_memory().unwrap();
        // Ten songs: "known" and "unknown" in S, eight in E, each of those heard in full a few times.
        let low: Vec<String> = (0..8).map(|i| format!("e{i}")).collect();
        for id in ["known", "unknown"].iter().map(|s| s.to_string()).chain(low.iter().cloned()) {
            song(&db, &id);
        }
        baseline(&db, "known", 1300.0, 40);
        for id in &low {
            db.conn().execute("INSERT INTO song_totals VALUES (?1, 5, 5, 5, 0, 1000, NULL)", [id]).unwrap();
        }
        let doc = json!({
            "name": "best",
            "influencesShuffle": true,
            "tiers": [{ "name": "S", "items": ["known", "unknown"] }, { "name": "E", "items": low }]
        });
        crate::playlists::save_tierlist(&db, None, &doc).unwrap();
        // Whatever the draw, the top three scores hold "known", "unknown" and one E song, and
        // "unknown" is the least known of them.
        for draw in [0.0, 0.3, 0.99] {
            let mut random = || draw;
            let anchor = teaching_anchor(&db, &mut random).unwrap().unwrap();
            assert!(anchor == "unknown" || low.contains(&anchor) || anchor == "known");
        }
        let mut zero = || 0.0;
        assert_eq!(teaching_anchor(&db, &mut zero).unwrap().as_deref(), Some("unknown"));
    }
}

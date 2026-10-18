//! Single-elimination tournaments (1.1.9 `tournaments.ts`, ported verbatim and checked against the
//! old code by `tests/tournament_oracle.rs`). The state is the same JSON document 1.x stored, so an
//! imported bracket continues where it stopped.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::elo::{Rating, effective};

pub const SIZES: [u32; 3] = [8, 16, 32];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Participant {
    #[serde(rename = "songId")]
    pub song_id: String,
    pub seed: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Match {
    pub id: String,
    /// Zero-based: round 0 is the opening round.
    pub round: u32,
    pub position: u32,
    #[serde(rename = "songAId", skip_serializing_if = "Option::is_none", default)]
    pub song_a: Option<String>,
    #[serde(rename = "songBId", skip_serializing_if = "Option::is_none", default)]
    pub song_b: Option<String>,
    #[serde(rename = "winnerSongId", skip_serializing_if = "Option::is_none", default)]
    pub winner: Option<String>,
    /// `played`, `forfeit`, `bye` or `vacant`.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub resolution: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct State {
    pub version: u32,
    pub size: u32,
    #[serde(rename = "createdAt")]
    pub created_at: i64,
    /// `active` or `completed`.
    pub status: String,
    pub participants: Vec<Participant>,
    pub matches: Vec<Match>,
    #[serde(rename = "championSongId", skip_serializing_if = "Option::is_none", default)]
    pub champion: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum TournamentError {
    #[error("unsupported tournament size {0}")]
    Size(u32),
    #[error("a {0}-track tournament needs at least {0} tracks")]
    TooFewTracks(u32),
    #[error("only the current match can be resolved")]
    NotCurrent,
    #[error("the winner is not part of the current match")]
    NotInMatch,
}

fn match_id(round: u32, position: u32) -> String {
    format!("r{}m{}", round + 1, position + 1)
}

fn seed_order(size: u32) -> Vec<u32> {
    let mut order = vec![1, 2];
    let mut bracket = 4;
    while bracket <= size {
        order = order.iter().flat_map(|&seed| [seed, bracket + 1 - seed]).collect();
        bracket *= 2;
    }
    order
}

/// FNV-1a over the id's UTF-16 units, seeded with the creation time as JavaScript's `^` sees it
/// (an int32), so a bracket varies between tournaments but is reproducible for one `created_at`.
fn shuffle_key(song_id: &str, created_at: i64) -> f64 {
    let mut hash: i32 = (2_166_136_261u32 as i32) ^ (created_at as u32 as i32);
    for unit in song_id.encode_utf16() {
        hash ^= i32::from(unit);
        hash = hash.wrapping_mul(16_777_619);
    }
    f64::from(hash as u32) / 4_294_967_296.0
}

fn rating_of(ratings: &HashMap<String, Rating>, id: &str) -> Rating {
    ratings.get(id).copied().unwrap_or_default()
}

fn ordering(v: f64) -> std::cmp::Ordering {
    v.partial_cmp(&0.0).unwrap_or(std::cmp::Ordering::Equal)
}

/// A deterministic, conventionally seeded bracket. Entry goes to the least-dueled tracks (a
/// tournament exists to rate unrated tracks); seeding among them is by rating.
pub fn create(
    song_ids: &[String],
    ratings: &HashMap<String, Rating>,
    size: u32,
    created_at: i64,
) -> Result<State, TournamentError> {
    if !SIZES.contains(&size) {
        return Err(TournamentError::Size(size));
    }
    let mut unique: Vec<String> = Vec::new();
    for id in song_ids {
        if !unique.contains(id) {
            unique.push(id.clone());
        }
    }
    if unique.len() < size as usize {
        return Err(TournamentError::TooFewTracks(size));
    }
    unique.sort_by(|a, b| {
        let (ra, rb) = (rating_of(ratings, a), rating_of(ratings, b));
        (ra.games - rb.games)
            .cmp(&0)
            .then_with(|| ordering(shuffle_key(a, created_at) - shuffle_key(b, created_at)))
            .then_with(|| a.cmp(b))
    });
    unique.truncate(size as usize);
    unique.sort_by(|a, b| {
        let (ra, rb) = (rating_of(ratings, a), rating_of(ratings, b));
        ordering(effective(&rb) - effective(&ra))
            .then_with(|| ordering(rb.rating - ra.rating))
            .then_with(|| (rb.games - ra.games).cmp(&0))
            .then_with(|| a.cmp(b))
    });
    let participants: Vec<Participant> =
        unique.into_iter().enumerate().map(|(i, song_id)| Participant { song_id, seed: i as u32 + 1 }).collect();
    let by_seed: HashMap<u32, &String> = participants.iter().map(|p| (p.seed, &p.song_id)).collect();
    let opening = seed_order(size);
    let rounds = size.trailing_zeros();
    let mut matches = Vec::new();
    for round in 0..rounds {
        for position in 0..size >> (round + 1) {
            let (song_a, song_b) = if round == 0 {
                let i = position as usize * 2;
                (by_seed.get(&opening[i]).map(|s| (*s).clone()), by_seed.get(&opening[i + 1]).map(|s| (*s).clone()))
            } else {
                (None, None)
            };
            matches.push(Match {
                id: match_id(round, position),
                round,
                position,
                song_a,
                song_b,
                winner: None,
                resolution: None,
            });
        }
    }
    Ok(State { version: 1, size, created_at, status: "active".into(), participants, matches, champion: None })
}

fn parents<'a>(state: &'a State, m: &Match) -> Vec<&'a Match> {
    let mut previous: Vec<&Match> = state.matches.iter().filter(|c| c.round + 1 == m.round).collect();
    previous.sort_by_key(|c| c.position);
    previous.into_iter().skip(m.position as usize * 2).take(2).collect()
}

pub fn is_ready(state: &State, m: &Match) -> bool {
    if m.resolution.is_some() {
        return false;
    }
    if m.round == 0 {
        return true;
    }
    let p = parents(state, m);
    p.len() == 2 && p.iter().all(|x| x.resolution.is_some())
}

fn slots(state: &State, m: &Match) -> (Option<String>, Option<String>) {
    if m.round == 0 {
        return (m.song_a.clone(), m.song_b.clone());
    }
    let p = parents(state, m);
    (p.first().and_then(|x| x.winner.clone()), p.get(1).and_then(|x| x.winner.clone()))
}

fn resolve(state: &State, m: &Match, winner: Option<String>, resolution: &str) -> State {
    let (a, b) = slots(state, m);
    let mut resolved = m.clone();
    if a.is_some() {
        resolved.song_a = a;
    }
    if b.is_some() {
        resolved.song_b = b;
    }
    if winner.is_some() {
        resolved.winner = winner.clone();
    }
    resolved.resolution = Some(resolution.to_owned());
    let mut next = state.clone();
    for c in &mut next.matches {
        if c.id == m.id {
            *c = resolved.clone();
        }
    }
    if m.round + 1 == state.size.trailing_zeros() {
        next.status = "completed".into();
        if winner.is_some() {
            next.champion = winner;
        }
    }
    next
}

/// Resolves every forfeit (a track left the library) and every resulting bye. Idempotent.
pub fn reconcile(state: &State, available: &HashSet<String>) -> State {
    let mut current = state.clone();
    let mut changed = true;
    while changed && current.status == "active" {
        changed = false;
        // JavaScript iterated the array the pass started with; ids are enough to replay that.
        let ids: Vec<String> = current.matches.iter().map(|m| m.id.clone()).collect();
        for id in ids {
            let Some(mut m) = current.matches.iter().find(|c| c.id == id).cloned() else { continue };
            if !is_ready(&current, &m) {
                continue;
            }
            let (a, b) = slots(&current, &m);
            if m.song_a != a || m.song_b != b {
                m.song_a = a.clone();
                m.song_b = b.clone();
                for c in &mut current.matches {
                    if c.id == m.id {
                        *c = m.clone();
                    }
                }
                changed = true;
            }
            let a_ok = a.as_ref().is_some_and(|x| available.contains(x));
            let b_ok = b.as_ref().is_some_and(|x| available.contains(x));
            if a_ok && b_ok {
                continue;
            }
            let (winner, resolution) = if a_ok || b_ok {
                (if a_ok { a.clone() } else { b.clone() }, if a.is_some() && b.is_some() { "forfeit" } else { "bye" })
            } else {
                (None, "vacant")
            };
            current = resolve(&current, &m, winner, resolution);
            changed = true;
        }
    }
    current
}

pub fn current_match(state: &State) -> Option<&Match> {
    if state.status != "active" {
        return None;
    }
    state.matches.iter().find(|m| is_ready(state, m) && m.song_a.is_some() && m.song_b.is_some())
}

/// The bracket after the current match was played. ELO is updated by the caller (a tournament
/// match is an ordinary duel).
pub fn record_winner(
    state: &State,
    match_id: &str,
    winner: &str,
    available: &HashSet<String>,
) -> Result<State, TournamentError> {
    let prepared = reconcile(state, available);
    let current = current_match(&prepared).cloned().ok_or(TournamentError::NotCurrent)?;
    if current.id != match_id {
        return Err(TournamentError::NotCurrent);
    }
    if Some(winner) != current.song_a.as_deref() && Some(winner) != current.song_b.as_deref() {
        return Err(TournamentError::NotInMatch);
    }
    Ok(reconcile(&resolve(&prepared, &current, Some(winner.to_owned()), "played"), available))
}

// ----- stored tournament ------------------------------------------------------------------------

const KEY: &str = "elo.tournament";

/// Tracks a bracket can use: present and not blacklisted.
fn eligible(db: &crate::db::Db) -> crate::Result<Vec<String>> {
    let mut stmt = db.conn().prepare(
        "SELECT DISTINCT song_id FROM track_variants WHERE present = 1
           AND song_id NOT IN (SELECT song_id FROM blacklist_songs WHERE value = 1) ORDER BY song_id",
    )?;
    let ids = stmt.query_map([], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
    Ok(ids)
}

fn save(db: &crate::db::Db, state: &State) -> crate::Result<()> {
    let device = db.device_id()?;
    db.conn().execute(
        "INSERT INTO settings_shared (key, value, updated_at, updated_by) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by",
        rusqlite::params![KEY, serde_json::to_string(state)?, crate::db::now_ms(), device],
    )?;
    Ok(())
}

/// Starts a new bracket of `size` tracks, replacing any previous one.
pub fn start(db: &crate::db::Db, size: u32) -> crate::Result<std::result::Result<State, TournamentError>> {
    let ratings = crate::elo::ratings(db)?;
    let state = match create(&eligible(db)?, &ratings, size, crate::db::now_ms()) {
        Ok(state) => state,
        Err(e) => return Ok(Err(e)),
    };
    save(db, &state)?;
    Ok(Ok(state))
}

/// The stored bracket, reconciled with the library (forfeits for tracks that left), and its
/// current match.
pub fn resume(db: &crate::db::Db) -> crate::Result<Option<(State, Option<Match>)>> {
    let stored: Option<String> = rusqlite::OptionalExtension::optional(db.conn().query_row(
        "SELECT value FROM settings_shared WHERE key = ?1",
        [KEY],
        |r| r.get(0),
    ))?;
    let Some(state) = stored.and_then(|s| serde_json::from_str::<State>(&s).ok()) else { return Ok(None) };
    let available: HashSet<String> = eligible(db)?.into_iter().collect();
    let reconciled = reconcile(&state, &available);
    if reconciled != state {
        save(db, &reconciled)?;
    }
    let current = current_match(&reconciled).cloned();
    Ok(Some((reconciled, current)))
}

/// Plays the current match: an ordinary duel for ELO, then the bracket advances.
pub fn submit(
    db: &mut crate::db::Db,
    match_id: &str,
    winner: &str,
) -> crate::Result<std::result::Result<(State, crate::elo::DuelResult), TournamentError>> {
    let Some((state, Some(current))) = resume(db)? else { return Ok(Err(TournamentError::NotCurrent)) };
    if current.id != match_id {
        return Ok(Err(TournamentError::NotCurrent));
    }
    let (Some(a), Some(b)) = (current.song_a.clone(), current.song_b.clone()) else {
        return Ok(Err(TournamentError::NotCurrent));
    };
    let outcome = if winner == a {
        crate::elo::Winner::A
    } else if winner == b {
        crate::elo::Winner::B
    } else {
        return Ok(Err(TournamentError::NotInMatch));
    };
    let result = crate::elo::submit(db, &a, &b, outcome)?;
    let available: HashSet<String> = eligible(db)?.into_iter().collect();
    let next = match record_winner(&state, match_id, winner, &available) {
        Ok(next) => next,
        Err(e) => return Ok(Err(e)),
    };
    save(db, &next)?;
    Ok(Ok((next, result)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seed_order_is_the_conventional_bracket() {
        assert_eq!(seed_order(8), [1, 8, 4, 5, 2, 7, 3, 6]);
    }

    #[test]
    fn a_bracket_plays_to_a_champion() {
        let ids: Vec<String> = (0..10).map(|i| format!("song{i}")).collect();
        let mut state = create(&ids, &HashMap::new(), 8, 1_790_000_000_000).unwrap();
        let available: HashSet<String> = ids.iter().cloned().collect();
        while let Some(m) = current_match(&state).cloned() {
            state = record_winner(&state, &m.id, m.song_a.as_deref().unwrap(), &available).unwrap();
        }
        assert_eq!(state.status, "completed");
        assert_eq!(state.champion.as_deref(), Some(state.participants[0].song_id.as_str()));
    }
}

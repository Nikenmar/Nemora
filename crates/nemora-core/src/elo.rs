//! ELO duels: ratings, the adaptive matchmaker and the duel log (1.1.9 `duelMatchmaker.ts` and
//! `eloDuels.ts`). The pure half is a verbatim port checked against the old code
//! (`tests/elo_oracle.rs`); the stored half is new: duels are facts in `duels`, and a rating is the
//! imported 1.x baseline plus a replay of this profile's own duels in time order, so two devices'
//! logs merge exactly.

use std::collections::{HashMap, HashSet};

use rusqlite::{OptionalExtension, params};

use crate::db::{Db, now_ms};
use crate::error::Result;

pub const START_RATING: f64 = 1200.0;
pub const CONFIDENCE_GAMES: f64 = 5.0;

const DAY_MS: f64 = 86_400_000.0;
const RECENT_REMATCH_MEMORY: usize = 25;
const OLDER_REPEAT_WINDOW: usize = 50;
const EXPOSURE_HISTORY_SIZE: usize = 24;
const TOP_CANDIDATES: usize = 8;

/// A source of numbers in [0, 1), like JavaScript's `Math.random`.
pub type Random<'a> = dyn FnMut() -> f64 + 'a;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rating {
    pub rating: f64,
    pub games: i64,
    pub wins: i64,
    pub losses: i64,
    pub draws: i64,
    pub last_duel_at: Option<i64>,
}

impl Default for Rating {
    fn default() -> Self {
        Self { rating: START_RATING, games: 0, wins: 0, losses: 0, draws: 0, last_duel_at: None }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Winner {
    A,
    B,
    Draw,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SkipReason {
    TooClose,
    TooDifferent,
    CantDecide,
}

impl SkipReason {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::TooClose => "tooClose",
            Self::TooDifferent => "tooDifferent",
            Self::CantDecide => "cantDecide",
        }
    }

    pub fn parse(s: &str) -> Self {
        match s {
            "tooClose" => Self::TooClose,
            "tooDifferent" => Self::TooDifferent,
            _ => Self::CantDecide,
        }
    }

    fn cooldown_ms(self) -> f64 {
        match self {
            Self::TooClose => 90.0 * DAY_MS,
            Self::TooDifferent => 180.0 * DAY_MS,
            Self::CantDecide => 14.0 * DAY_MS,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct DuelRecord {
    pub at: i64,
    pub a: String,
    pub b: String,
    pub winner: Winner,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SkipRecord {
    pub at: i64,
    pub a: String,
    pub b: String,
    pub reason: SkipReason,
}

/// What the matchmaker knows about a song: its context for similarity.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct MatchSong {
    pub id: String,
    pub artists: Vec<String>,
    pub genres: Vec<String>,
    pub album: Option<String>,
    pub playlists: Vec<String>,
    pub tierlists: Vec<String>,
}

fn clamp01(v: f64) -> f64 {
    v.clamp(0.0, 1.0)
}

/// JavaScript's `Math.round(v * 10) / 10`: halves round up, `-2.25` gives `-2.2`, not `-2.3`.
pub fn round1(v: f64) -> f64 {
    (v * 10.0 + 0.5).floor() / 10.0
}

pub fn confidence(r: &Rating) -> f64 {
    clamp01(r.games as f64 / CONFIDENCE_GAMES)
}

pub fn effective(r: &Rating) -> f64 {
    START_RATING + confidence(r) * (r.rating - START_RATING)
}

/// Neutral 1200 = 0.5; a confirmed +/-200 reaches the edges.
pub fn normalized_score(r: &Rating) -> f64 {
    clamp01(0.5 + (effective(r) - START_RATING) / 400.0)
}

/// Only evidence above neutral, never participation itself (Rediscover).
pub fn positive_score(r: &Rating) -> f64 {
    clamp01((effective(r) - START_RATING) / 200.0)
}

pub fn deltas(rating_a: f64, rating_b: f64, score_a: f64) -> (f64, f64) {
    let expected_a = 1.0 / (1.0 + 10f64.powf((rating_b - rating_a) / 400.0));
    (round1(32.0 * (score_a - expected_a)), round1(32.0 * (1.0 - score_a - (1.0 - expected_a))))
}

/// Applies one outcome to two ratings; returns the deltas.
pub fn apply(ratings: &mut HashMap<String, Rating>, a: &str, b: &str, winner: Winner, at: i64) -> (f64, f64) {
    let ra = ratings.get(a).copied().unwrap_or_default();
    let rb = ratings.get(b).copied().unwrap_or_default();
    let score_a = match winner {
        Winner::A => 1.0,
        Winner::B => 0.0,
        Winner::Draw => 0.5,
    };
    let (da, db) = deltas(ra.rating, rb.rating, score_a);
    let step = |r: Rating, delta: f64, won: bool, lost: bool| Rating {
        rating: round1(r.rating + delta),
        games: r.games + 1,
        wins: r.wins + i64::from(won),
        losses: r.losses + i64::from(lost),
        draws: r.draws + i64::from(winner == Winner::Draw),
        last_duel_at: Some(at),
    };
    ratings.insert(a.to_owned(), step(ra, da, winner == Winner::A, winner == Winner::B));
    ratings.insert(b.to_owned(), step(rb, db, winner == Winner::B, winner == Winner::A));
    (da, db)
}

fn pair_key(a: &str, b: &str) -> (String, String) {
    if a < b { (a.to_owned(), b.to_owned()) } else { (b.to_owned(), a.to_owned()) }
}

fn intersects(left: &[String], right: &[String]) -> bool {
    !left.is_empty() && !right.is_empty() && left.iter().any(|v| right.contains(v))
}

fn context_similarity(anchor: &MatchSong, candidate: &MatchSong) -> f64 {
    clamp01(
        (if intersects(&anchor.genres, &candidate.genres) { 0.4 } else { 0.0 })
            + (if intersects(&anchor.tierlists, &candidate.tierlists) { 0.25 } else { 0.0 })
            + (if intersects(&anchor.playlists, &candidate.playlists) { 0.2 } else { 0.0 })
            + (if intersects(&anchor.artists, &candidate.artists) { 0.1 } else { 0.0 })
            + (if anchor.album.is_some() && anchor.album == candidate.album { 0.05 } else { 0.0 }),
    )
}

struct Scored {
    id: String,
    score: f64,
    jitter: f64,
}

fn weighted_pick(candidates: Vec<Scored>, random: &mut Random<'_>) -> Option<String> {
    let mut top = candidates;
    // Stable sort, as JavaScript's: equal sums keep library order.
    top.sort_by(|l, r| (r.score + r.jitter).partial_cmp(&(l.score + l.jitter)).unwrap_or(std::cmp::Ordering::Equal));
    top.truncate(TOP_CANDIDATES);
    if top.is_empty() {
        return None;
    }
    let minimum = top.iter().map(|c| c.score).fold(f64::INFINITY, f64::min);
    let weights: Vec<f64> = top.iter().map(|c| (c.score - minimum + 0.05).max(0.05).powi(2)).collect();
    let total: f64 = weights.iter().sum();
    let mut roll = random() * total;
    for (candidate, weight) in top.iter().zip(&weights) {
        roll -= weight;
        if roll <= 0.0 {
            return Some(candidate.id.clone());
        }
    }
    top.last().map(|c| c.id.clone())
}

fn rating_of(ratings: &HashMap<String, Rating>, id: &str) -> Rating {
    ratings.get(id).copied().unwrap_or_default()
}

fn freshness(r: &Rating, now: i64) -> f64 {
    r.last_duel_at.map_or(1.0, |at| clamp01((now - at) as f64 / (30.0 * DAY_MS)))
}

/// The song to build a duel around: under-calibrated, not dueled lately, recently heard.
pub fn select_anchor(
    candidates: &[(String, i64)],
    eligible: &HashSet<String>,
    excluded: &HashSet<String>,
    ratings: &HashMap<String, Rating>,
    now: i64,
    random: &mut Random<'_>,
) -> Option<String> {
    // Latest listen per song, in order of first appearance (a JavaScript Map's order).
    let mut order: Vec<String> = Vec::new();
    let mut latest: HashMap<String, i64> = HashMap::new();
    for (id, at) in candidates {
        if !eligible.contains(id) || excluded.contains(id) {
            continue;
        }
        match latest.get_mut(id) {
            Some(current) => {
                if *at > *current {
                    *current = *at;
                }
            }
            None => {
                latest.insert(id.clone(), *at);
                order.push(id.clone());
            }
        }
    }
    if order.is_empty() {
        return None;
    }
    let oldest = order.iter().map(|id| latest[id]).min()?;
    let newest = order.iter().map(|id| latest[id]).max()?;
    let range = ((newest - oldest) as f64).max(1.0);
    let mut best: Option<(String, f64)> = None;
    for id in order {
        let r = rating_of(ratings, &id);
        let score = 0.6 * (1.0 - confidence(&r))
            + 0.3 * freshness(&r, now)
            + 0.1 * clamp01((latest[&id] - oldest) as f64 / range)
            + random() * 0.04;
        if best.as_ref().is_none_or(|(_, b)| score > *b) {
            best = Some((id, score));
        }
    }
    best.map(|(id, _)| id)
}

#[derive(Clone, Copy)]
enum Lane {
    Calibration,
    Refinement,
    Coverage,
    Bridge,
}

fn lane_score(lane: Lane, closeness: f64, context: f64, confidence: f64, freshness: f64) -> f64 {
    match lane {
        Lane::Calibration => 0.45 * closeness + 0.3 * confidence + 0.1 * context + 0.15 * freshness,
        Lane::Coverage => 0.35 * closeness + 0.4 * (1.0 - confidence) + 0.1 * context + 0.15 * freshness,
        Lane::Bridge => 0.45 * closeness + 0.25 * (1.0 - context) + 0.15 * (1.0 - confidence) + 0.15 * freshness,
        Lane::Refinement => 0.4 * closeness + 0.3 * context + 0.15 * (1.0 - confidence) + 0.15 * freshness,
    }
}

/// The opponent for `anchor`. `history` is newest first.
pub fn select_opponent(
    anchor_id: &str,
    songs: &[MatchSong],
    ratings: &HashMap<String, Rating>,
    history: &[DuelRecord],
    skipped: &[SkipRecord],
    now: i64,
    random: &mut Random<'_>,
) -> Option<String> {
    let anchor = songs.iter().find(|s| s.id == anchor_id)?;
    let anchor_rating = rating_of(ratings, anchor_id);
    let anchor_effective = effective(&anchor_rating);
    let lane = if anchor_rating.games < 3 {
        Lane::Calibration
    } else {
        let roll = random();
        if roll < 0.6 {
            Lane::Refinement
        } else if roll < 0.82 {
            Lane::Coverage
        } else {
            Lane::Bridge
        }
    };
    let recent: HashSet<(String, String)> =
        history.iter().take(RECENT_REMATCH_MEMORY).map(|d| pair_key(&d.a, &d.b)).collect();
    let skipped_keys: HashSet<(String, String)> = skipped
        .iter()
        .filter(|s| (now - s.at) as f64 <= s.reason.cooldown_ms())
        .map(|s| pair_key(&s.a, &s.b))
        .collect();
    let mut exposure: HashMap<&str, f64> = HashMap::new();
    for d in history.iter().take(EXPOSURE_HISTORY_SIZE) {
        *exposure.entry(&d.a).or_default() += 1.0;
        *exposure.entry(&d.b).or_default() += 1.0;
    }
    let older: HashSet<(String, String)> = history
        .iter()
        .skip(RECENT_REMATCH_MEMORY)
        .take(OLDER_REPEAT_WINDOW - RECENT_REMATCH_MEMORY)
        .map(|d| pair_key(&d.a, &d.b))
        .collect();

    let score_candidates = |exclude_recent: bool, exclude_skipped: bool, random: &mut Random<'_>| -> Vec<Scored> {
        songs
            .iter()
            .filter(|c| {
                if c.id == anchor_id {
                    return false;
                }
                let key = pair_key(anchor_id, &c.id);
                !(exclude_recent && recent.contains(&key) || exclude_skipped && skipped_keys.contains(&key))
            })
            .map(|c| {
                let r = rating_of(ratings, &c.id);
                let closeness = (-(anchor_effective - effective(&r)).abs() / 180.0).exp();
                let exposure_penalty = 0.35 * clamp01(exposure.get(c.id.as_str()).copied().unwrap_or(0.0) / 4.0);
                let older_penalty = if older.contains(&pair_key(anchor_id, &c.id)) { 0.12 } else { 0.0 };
                Scored {
                    id: c.id.clone(),
                    score: lane_score(lane, closeness, context_similarity(anchor, c), confidence(&r), freshness(&r, now))
                        - exposure_penalty
                        - older_penalty,
                    jitter: random() * 0.035,
                }
            })
            .collect()
    };
    let strict = score_candidates(true, true, random);
    if !strict.is_empty() {
        return weighted_pick(strict, random);
    }
    let allow_recent = score_candidates(false, true, random);
    if !allow_recent.is_empty() {
        return weighted_pick(allow_recent, random);
    }
    let all = score_candidates(false, false, random);
    weighted_pick(all, random)
}

/// Card order, random and independent of which song was the anchor.
pub fn order_pair(anchor: &str, opponent: &str, random: &mut Random<'_>) -> (String, String) {
    if random() < 0.5 { (anchor.to_owned(), opponent.to_owned()) } else { (opponent.to_owned(), anchor.to_owned()) }
}

// ----- stored duels -----------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq)]
pub struct DuelResult {
    pub delta_a: f64,
    pub delta_b: f64,
    pub rating_a: f64,
    pub rating_b: f64,
}

/// Current ratings: the imported baseline plus this profile's own duels, replayed in order.
pub fn ratings(db: &Db) -> Result<HashMap<String, Rating>> {
    let conn = db.conn();
    let mut ratings: HashMap<String, Rating> = HashMap::new();
    let mut stmt = conn.prepare("SELECT song_id, rating, games, wins, losses, draws FROM elo_baseline")?;
    for row in stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            Rating { rating: r.get(1)?, games: r.get(2)?, wins: r.get(3)?, losses: r.get(4)?, draws: r.get(5)?, last_duel_at: None },
        ))
    })? {
        let (id, rating) = row?;
        ratings.insert(id, rating);
    }
    // The last imported duel of a song is its last duel, for freshness.
    let mut stmt = conn.prepare("SELECT song_a, song_b, max(at) FROM duels WHERE imported = 1 AND outcome <> 'skip' GROUP BY song_a, song_b")?;
    for row in stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?)))? {
        let (a, b, at) = row?;
        for id in [a, b] {
            if let Some(r) = ratings.get_mut(&id) {
                r.last_duel_at = Some(r.last_duel_at.map_or(at, |x| x.max(at)));
            }
        }
    }
    let mut stmt = conn.prepare(
        "SELECT song_a, song_b, outcome, at FROM duels WHERE imported = 0 AND outcome <> 'skip' ORDER BY at, duel_id",
    )?;
    for row in stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, i64>(3)?)))? {
        let (a, b, outcome, at) = row?;
        let winner = match outcome.as_str() {
            "a" => Winner::A,
            "b" => Winner::B,
            _ => Winner::Draw,
        };
        apply(&mut ratings, &a, &b, winner, at);
    }
    Ok(ratings)
}

/// Every decided duel, newest first (imported and own).
pub fn history(db: &Db) -> Result<Vec<DuelRecord>> {
    let mut stmt = db.conn().prepare(
        "SELECT at, song_a, song_b, outcome FROM duels WHERE outcome <> 'skip' ORDER BY at DESC, duel_id DESC",
    )?;
    let rows = stmt
        .query_map([], |r| {
            let outcome: String = r.get(3)?;
            Ok(DuelRecord {
                at: r.get(0)?,
                a: r.get(1)?,
                b: r.get(2)?,
                winner: match outcome.as_str() {
                    "a" => Winner::A,
                    "b" => Winner::B,
                    _ => Winner::Draw,
                },
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}

/// Skipped pairs, newest first. A "too close" answer is a draw and a skip at once.
pub fn skipped_pairs(db: &Db) -> Result<Vec<SkipRecord>> {
    let mut stmt = db.conn().prepare(
        "SELECT at, song_a, song_b, skip_reason FROM duels WHERE skip_reason IS NOT NULL ORDER BY at DESC, duel_id DESC",
    )?;
    let rows = stmt
        .query_map([], |r| {
            let reason: String = r.get(3)?;
            Ok(SkipRecord { at: r.get(0)?, a: r.get(1)?, b: r.get(2)?, reason: SkipReason::parse(&reason) })
        })?
        .collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}

fn next_duel_id(db: &Db) -> Result<String> {
    let device = db.device_id()?;
    let seq: i64 = db.conn().query_row(
        "SELECT coalesce(max(CAST(substr(duel_id, length(?1) + 2) AS INTEGER)), 0) + 1 FROM duels WHERE device_id = ?1 AND imported = 0",
        [&device],
        |r| r.get(0),
    )?;
    Ok(format!("{device}:{seq}"))
}

/// Records a decided duel.
pub fn submit(db: &mut Db, a: &str, b: &str, winner: Winner) -> Result<DuelResult> {
    record(db, a, b, winner, None, now_ms())
}

/// Records a skipped pair; "too close" also counts as a draw, as in 1.x.
pub fn skip(db: &mut Db, a: &str, b: &str, reason: SkipReason) -> Result<Option<DuelResult>> {
    if reason == SkipReason::TooClose {
        return record(db, a, b, Winner::Draw, Some(reason), now_ms()).map(Some);
    }
    let id = next_duel_id(db)?;
    let device = db.device_id()?;
    db.conn().execute(
        "INSERT INTO duels (duel_id, device_id, at, song_a, song_b, outcome, skip_reason) VALUES (?1, ?2, ?3, ?4, ?5, 'skip', ?6)",
        params![id, device, now_ms(), a, b, reason.as_str()],
    )?;
    db.touch();
    Ok(None)
}

fn record(db: &mut Db, a: &str, b: &str, winner: Winner, skip: Option<SkipReason>, at: i64) -> Result<DuelResult> {
    let mut current = ratings(db)?;
    let (da, dbb) = apply(&mut current, a, b, winner, at);
    let id = next_duel_id(db)?;
    let device = db.device_id()?;
    let outcome = match winner {
        Winner::A => "a",
        Winner::B => "b",
        Winner::Draw => "draw",
    };
    db.conn().execute(
        "INSERT INTO duels (duel_id, device_id, at, song_a, song_b, outcome, skip_reason, delta_a, delta_b)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![id, device, at, a, b, outcome, skip.map(SkipReason::as_str), da, dbb],
    )?;
    db.touch();
    Ok(DuelResult { delta_a: da, delta_b: dbb, rating_a: current[a].rating, rating_b: current[b].rating })
}

/// Duels ever decided: 1.x's own counter for imported history plus this profile's duels.
pub fn total_duels(db: &Db) -> Result<i64> {
    let imported: Option<String> = db
        .conn()
        .query_row("SELECT value FROM settings_shared WHERE key = 'elo.imported_total_duels'", [], |r| r.get(0))
        .optional()?;
    // Stored as a JSON string by the import.
    let imported: i64 = imported
        .and_then(|v| serde_json::from_str::<String>(&v).ok())
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    let own: i64 = db.conn().query_row("SELECT count(*) FROM duels WHERE imported = 0 AND outcome <> 'skip'", [], |r| r.get(0))?;
    Ok(imported + own)
}

/// Songs that may duel: not blacklisted, and played, hearted, rated, or in a playlist or tierlist.
pub fn match_songs(db: &Db, ratings: &HashMap<String, Rating>) -> Result<Vec<MatchSong>> {
    let conn = db.conn();
    let mut playlists: HashMap<String, Vec<String>> = HashMap::new();
    for row in conn
        .prepare("SELECT i.song_id, i.playlist_id FROM playlist_items i JOIN playlists p USING (playlist_id) WHERE p.deleted_at IS NULL AND i.song_id IS NOT NULL")?
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
    {
        let (song, playlist) = row?;
        playlists.entry(song).or_default().push(playlist);
    }
    let mut tierlists: HashMap<String, Vec<String>> = HashMap::new();
    for row in conn
        .prepare("SELECT tierlist_id, doc FROM tierlists WHERE deleted_at IS NULL")?
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
    {
        let (id, doc) = row?;
        let doc: serde_json::Value = serde_json::from_str(&doc).unwrap_or_default();
        for tier in doc["tiers"].as_array().into_iter().flatten() {
            for item in tier["items"].as_array().into_iter().flatten().filter_map(|v| v.as_str()) {
                tierlists.entry(item.to_owned()).or_default().push(id.clone());
            }
        }
    }
    let mut stmt = conn.prepare(
        "SELECT v.song_id, v.album,
                (SELECT group_concat(name, char(31)) FROM variant_artists a WHERE a.variant_id = v.variant_id AND a.role = 'artist'),
                (SELECT group_concat(name, char(31)) FROM variant_genres g WHERE g.variant_id = v.variant_id),
                coalesce((SELECT plays + full FROM song_totals st WHERE st.song_id = v.song_id), 0) > 0,
                EXISTS (SELECT 1 FROM favorites f WHERE f.song_id = v.song_id AND f.value = 1)
         FROM track_variants v
         WHERE v.present = 1 AND v.song_id NOT IN (SELECT song_id FROM blacklist_songs WHERE value = 1)
         GROUP BY v.song_id ORDER BY v.title_sort, v.song_id",
    )?;
    let split = |s: Option<String>| -> Vec<String> { s.map(|s| s.split('\u{1f}').map(str::to_owned).collect()).unwrap_or_default() };
    let mut out = Vec::new();
    for row in stmt.query_map([], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?, r.get::<_, Option<String>>(2)?, r.get::<_, Option<String>>(3)?, r.get::<_, bool>(4)?, r.get::<_, bool>(5)?))
    })? {
        let (id, album, artists, genres, played, favorite) = row?;
        let rated = ratings.get(&id).is_some_and(|r| r.games > 0);
        if !(played || favorite || rated || playlists.contains_key(&id) || tierlists.contains_key(&id)) {
            continue;
        }
        out.push(MatchSong {
            playlists: playlists.remove(&id).unwrap_or_default(),
            tierlists: tierlists.remove(&id).unwrap_or_default(),
            artists: split(artists),
            genres: split(genres),
            album,
            id,
        });
    }
    Ok(out)
}

/// A pair to show: around `pinned` if given (it must be eligible), else around a recently heard or
/// under-calibrated song. The card order is random.
pub fn next_pair(db: &Db, pinned: Option<&str>, random: &mut Random<'_>) -> Result<Option<(String, String)>> {
    let now = now_ms();
    let ratings = ratings(db)?;
    let songs = match_songs(db, &ratings)?;
    if songs.len() < 2 {
        return Ok(None);
    }
    let eligible: HashSet<String> = songs.iter().map(|s| s.id.clone()).collect();
    let anchor = match pinned {
        Some(p) if !eligible.contains(p) => return Ok(None),
        Some(p) => Some(p.to_owned()),
        None => {
            let mut recent: Vec<String> = Vec::new();
            let mut stmt = db.conn().prepare("SELECT song_id FROM play_events ORDER BY ended_at DESC LIMIT 500")?;
            for id in stmt.query_map([], |r| r.get::<_, String>(0))? {
                let id = id?;
                if eligible.contains(&id) && !recent.contains(&id) {
                    recent.push(id);
                    if recent.len() == 50 {
                        break;
                    }
                }
            }
            let use_recent = !recent.is_empty() && random() < 0.7;
            let pool: Vec<String> = if use_recent { recent } else { songs.iter().map(|s| s.id.clone()).collect() };
            let candidates: Vec<(String, i64)> = pool.into_iter().enumerate().map(|(i, id)| (id, now - i as i64)).collect();
            select_anchor(&candidates, &eligible, &HashSet::new(), &ratings, now, random)
        }
    };
    let Some(anchor) = anchor else { return Ok(None) };
    let history = history(db)?;
    let skipped = skipped_pairs(db)?;
    let Some(opponent) = select_opponent(&anchor, &songs, &ratings, &history, &skipped, now, random) else {
        return Ok(None);
    };
    Ok(Some(order_pair(&anchor, &opponent, random)))
}

#[derive(Debug, Clone, PartialEq)]
pub struct Standing {
    pub song_id: String,
    pub rating: Rating,
    pub effective: f64,
    /// Fewer than `CONFIDENCE_GAMES` games: the rating is still settling.
    pub provisional: bool,
}

/// The dashboard's ELO block: the best rated songs (by effective rating, blacklisted left out) and
/// the latest decided duels whose songs are still known.
pub fn standings(db: &Db, top: usize, recent: usize) -> Result<(Vec<Standing>, Vec<DuelRecord>)> {
    let ratings = ratings(db)?;
    let blacklisted: HashSet<String> = db
        .conn()
        .prepare("SELECT song_id FROM blacklist_songs WHERE value = 1")?
        .query_map([], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    let mut list: Vec<Standing> = ratings
        .into_iter()
        .filter(|(id, r)| r.games > 0 && !blacklisted.contains(id))
        .map(|(song_id, rating)| Standing { effective: effective(&rating), provisional: confidence(&rating) < 1.0, song_id, rating })
        .collect();
    list.sort_by(|a, b| b.effective.partial_cmp(&a.effective).unwrap_or(std::cmp::Ordering::Equal).then_with(|| a.song_id.cmp(&b.song_id)));
    list.truncate(top);
    let known: HashSet<String> =
        db.conn().prepare("SELECT song_id FROM tracks")?.query_map([], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
    let duels = history(db)?.into_iter().filter(|d| known.contains(&d.a) && known.contains(&d.b)).take(recent).collect();
    Ok((list, duels))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn duels_replay_over_the_baseline() {
        let mut db = Db::open_in_memory().unwrap();
        let (a, b) = ("a".repeat(26), "b".repeat(26));
        for id in [&a, &b] {
            db.conn().execute("INSERT INTO tracks VALUES (?1, 'flac', 44100, 16, 2, 1000, NULL, 0, 0)", [id]).unwrap();
        }
        db.conn()
            .execute("INSERT INTO elo_baseline VALUES (?1, 1300.0, 5, 5, 0, 0, 0)", [&a])
            .unwrap();
        let r = submit(&mut db, &a, &b, Winner::B).unwrap();
        // Expected for A at 1300 vs 1200 is 0.64; losing costs 32 * 0.64 = 20.5.
        assert_eq!((r.delta_a, r.delta_b), (-20.5, 20.5));
        assert_eq!((r.rating_a, r.rating_b), (1279.5, 1220.5));
        assert_eq!(skip(&mut db, &a, &b, SkipReason::CantDecide).unwrap(), None);
        let draw = skip(&mut db, &a, &b, SkipReason::TooClose).unwrap().unwrap();
        assert!(draw.delta_a < 0.0, "the stronger song loses points in a draw");
        let replayed = ratings(&db).unwrap();
        assert_eq!(replayed[&a].games, 7);
        assert_eq!(replayed[&b].games, 2);
        assert_eq!(replayed[&a].rating, draw.rating_a);
        assert_eq!(history(&db).unwrap().len(), 2);
        assert_eq!(skipped_pairs(&db).unwrap().len(), 2);
        let (top, recent) = standings(&db, 10, 10).unwrap();
        assert_eq!(top[0].song_id, a);
        assert!(top[1].provisional);
        assert_eq!(recent.len(), 2);
    }

    #[test]
    fn round1_rounds_halves_up_like_javascript() {
        assert_eq!(round1(2.25), 2.3);
        assert_eq!(round1(-2.25), -2.2);
        assert_eq!(round1(-15.25), -15.2);
    }

    #[test]
    fn equal_ratings_move_by_sixteen() {
        assert_eq!(deltas(1200.0, 1200.0, 1.0), (16.0, -16.0));
        assert_eq!(deltas(1200.0, 1200.0, 0.5), (0.0, 0.0));
    }

    #[test]
    fn effective_rating_grows_with_confidence() {
        let r = Rating { rating: 1300.0, games: 1, ..Default::default() };
        assert!((effective(&r) - 1220.0).abs() < 1e-9);
        let r = Rating { rating: 1300.0, games: 10, ..Default::default() };
        assert_eq!(effective(&r), 1300.0);
    }
}

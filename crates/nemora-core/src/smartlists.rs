//! Home's "For you" (PLAN/19): smart lists built on the signals Smart Shuffle already holds, and the
//! mix of the day. Every list is a rule returning songs with a one-line reason each; a list with
//! nothing in it is not shown. Nothing here is a playlist: a list becomes one only when the user
//! saves it. The rules are plain functions over [`Inputs`], so they are tested without a database;
//! [`stored_inputs`] reads them from one.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::listening::Classified;

/// Songs per list, at most.
pub const CAP: usize = 50;
/// Songs in a mix of the day (about two hours).
pub const MIX_SIZE: usize = 40;
/// The mix's parts, in songs: Smart Shuffle's favourites, forgotten favourites, never heard, the
/// island of the day (50 / 20 / 15 / 15 %).
pub const MIX_PARTS: [(Part, usize); 4] =
    [(Part::Favourite, 20), (Part::Forgotten, 8), (Part::New, 6), (Part::Island, 6)];
/// On repeat and Caught you look this far back.
pub const RECENT_DAYS: i64 = 14;
const DAY_MS: i64 = 86_400_000;
/// This hour: a song needs this many plays (heard, not browsed) before its hours mean anything.
pub const HOUR_MIN_PLAYS: u32 = 5;
/// Energetic / Calm: shown once this many songs are measured.
pub const ENERGY_MIN_MEASURED: usize = 50;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum List {
    Rediscover,
    OnRepeat,
    CaughtYou,
    ThisHour,
    Energetic,
    Calm,
    NeverHeard,
}

impl List {
    pub const ALL: [List; 7] = [
        List::Rediscover,
        List::OnRepeat,
        List::CaughtYou,
        List::ThisHour,
        List::Energetic,
        List::Calm,
        List::NeverHeard,
    ];
}

/// Why a song is in a list or the mix: a key for the view's sentence and its numbers.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reason {
    pub key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub count: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

impl Reason {
    fn new(key: &str) -> Self {
        Reason { key: key.to_owned(), count: None, total: None, name: None }
    }
    fn count(mut self, n: i64) -> Self {
        self.count = Some(n);
        self
    }
    fn total(mut self, n: i64) -> Self {
        self.total = Some(n);
        self
    }
    fn name(mut self, name: impl Into<String>) -> Self {
        self.name = Some(name.into());
        self
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub song_id: String,
    pub reason: Reason,
}

/// A part of the day, as Night shuffle counts it: 0-6, 6-12, 12-18, 18-24 local time.
pub fn quarter_of(ms: i64, utc_offset_min: i64) -> usize {
    ((ms / 60_000 + utc_offset_min).rem_euclid(1440) / 360) as usize
}

/// What the rules read.
#[derive(Debug, Clone, Default)]
pub struct Inputs {
    /// Present songs, each with its artists (display names), in a fixed order.
    pub songs: Vec<(String, Vec<String>)>,
    /// Their titles, for reasons that name another song.
    pub titles: HashMap<String, String>,
    /// How much the user loves each song, 0..1 (tiers, ELO, full listens; as Rediscover scores).
    pub loved: HashMap<String, f64>,
    /// Plays of 30 s or more, all time (1.x included).
    pub plays: HashMap<String, i64>,
    /// Rediscover as the shelf shows it today.
    pub rediscover: Vec<String>,
    /// Plays of the last weeks in their context (PLAN/16).
    pub recent: Classified,
    /// Now, and the device's offset from UTC (minutes).
    pub now: i64,
    pub utc_offset_min: i64,
    /// Energy flow's measure (PLAN/15 C2), for measured songs.
    pub energy: HashMap<String, f64>,
    /// The taste map, when one was built: each song's island and neighbours, and island names.
    pub island_of: HashMap<String, usize>,
    pub island_names: HashMap<usize, String>,
    pub neighbours: HashMap<String, Vec<String>>,
    /// Smart Shuffle's weights as it runs now.
    pub weights: HashMap<String, f64>,
}

impl Inputs {
    fn present(&self) -> impl Iterator<Item = &str> {
        self.songs.iter().map(|(id, _)| id.as_str())
    }
    fn artists(&self) -> HashMap<&str, &[String]> {
        self.songs.iter().map(|(id, a)| (id.as_str(), a.as_slice())).collect()
    }
}

fn ranked(mut scored: Vec<(String, f64, Reason)>) -> Vec<Entry> {
    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal).then_with(|| a.0.cmp(&b.0)));
    scored.truncate(CAP);
    scored.into_iter().map(|(song_id, _, reason)| Entry { song_id, reason }).collect()
}

/// One list's songs, best first, each with its reason.
pub fn list(inputs: &Inputs, which: List) -> Vec<Entry> {
    match which {
        List::Rediscover => inputs
            .rediscover
            .iter()
            .take(CAP)
            .map(|id| Entry { song_id: id.clone(), reason: Reason::new("rediscover") })
            .collect(),
        List::OnRepeat => on_repeat(inputs),
        List::CaughtYou => caught_you(inputs),
        List::ThisHour => this_hour(inputs),
        List::Energetic | List::Calm => energy(inputs, which == List::Energetic),
        List::NeverHeard => never_heard(inputs),
    }
}

/// Own picks and replays of the last two weeks: a song picked or replayed at least three times
/// (a replay counting two).
fn on_repeat(inputs: &Inputs) -> Vec<Entry> {
    let since = inputs.now - RECENT_DAYS * DAY_MS;
    let present: HashSet<&str> = inputs.present().collect();
    let mut tally: HashMap<&str, (i64, i64)> = HashMap::new();
    let mut last_end: HashMap<&str, i64> = HashMap::new();
    let c = &inputs.recent;
    for i in 0..c.plays.len() {
        let p = &c.plays[i];
        let replay_soon =
            last_end.get(p.song_id.as_str()).is_some_and(|&end| p.started_at - end < crate::signals::REPLAY_WINDOW_MS);
        last_end.insert(&p.song_id, p.ended_at);
        if p.started_at < since || c.contexts[i].browsing || !present.contains(p.song_id.as_str()) {
            continue;
        }
        let start = p.start_reason.as_deref().unwrap_or("");
        let t = tally.entry(&p.song_id).or_default();
        if start == "user_previous" || replay_soon {
            t.1 += 1;
        } else if start == "user_selected" {
            t.0 += 1;
        }
    }
    ranked(
        tally
            .into_iter()
            .filter(|(_, (picks, replays))| picks + 2 * replays >= 3)
            .map(|(id, (picks, replays))| {
                let reason = if replays > 0 {
                    Reason::new("onRepeatReplayed").count(replays).total(picks)
                } else {
                    Reason::new("onRepeat").count(picks)
                };
                (id.to_owned(), (picks + 2 * replays) as f64, reason)
            })
            .collect(),
    )
}

/// Songs that ended a browse (the user stopped flicking and listened, PLAN/16 D5), and own picks
/// heard to the end, in the last two weeks.
fn caught_you(inputs: &Inputs) -> Vec<Entry> {
    let since = inputs.now - RECENT_DAYS * DAY_MS;
    let present: HashSet<&str> = inputs.present().collect();
    let mut tally: HashMap<&str, (i64, i64)> = HashMap::new();
    let c = &inputs.recent;
    for i in 0..c.plays.len() {
        let p = &c.plays[i];
        if p.started_at < since || c.contexts[i].browsing || !present.contains(p.song_id.as_str()) {
            continue;
        }
        let through = p.end_reason == "finished" || (p.duration_ms > 0 && p.heard_ms * 10 >= p.duration_ms * 9);
        if c.contexts[i].caught {
            tally.entry(&p.song_id).or_default().0 += 1;
        } else if p.start_reason.as_deref() == Some("user_selected") && through {
            tally.entry(&p.song_id).or_default().1 += 1;
        }
    }
    ranked(
        tally
            .into_iter()
            .filter(|(_, (caught, through))| *caught >= 1 || *through >= 2)
            .map(|(id, (caught, through))| {
                let reason = if caught > 0 {
                    Reason::new("caught").count(caught)
                } else {
                    Reason::new("pickedThrough").count(through)
                };
                (id.to_owned(), caught as f64 * 2.0 + through as f64, reason)
            })
            .collect(),
    )
}

/// Songs played mostly at this part of the day: at least [`HOUR_MIN_PLAYS`] plays (heard, not
/// browsed) and half of them in this quarter.
fn this_hour(inputs: &Inputs) -> Vec<Entry> {
    let now_part = quarter_of(inputs.now, inputs.utc_offset_min);
    let present: HashSet<&str> = inputs.present().collect();
    let mut parts: HashMap<&str, [u32; 4]> = HashMap::new();
    let c = &inputs.recent;
    for i in c.heard() {
        let p = &c.plays[i];
        if present.contains(p.song_id.as_str()) {
            parts.entry(&p.song_id).or_insert([0; 4])[quarter_of(p.started_at, p.utc_offset_min)] += 1;
        }
    }
    ranked(
        parts
            .into_iter()
            .filter_map(|(id, counts)| {
                let all: u32 = counts.iter().sum();
                let here = counts[now_part];
                (all >= HOUR_MIN_PLAYS && here * 2 >= all).then(|| {
                    let reason = Reason::new(["night", "morning", "afternoon", "evening"][now_part])
                        .count(here as i64)
                        .total(all as i64);
                    (id.to_owned(), here as f64 + here as f64 / all as f64, reason)
                })
            })
            .collect(),
    )
}

/// The most and least energetic songs (above 0.6, below 0.35), once the library is measured.
fn energy(inputs: &Inputs, high: bool) -> Vec<Entry> {
    let present: HashSet<&str> = inputs.present().collect();
    let measured: Vec<(&String, f64)> =
        inputs.energy.iter().filter(|(id, _)| present.contains(id.as_str())).map(|(id, e)| (id, *e)).collect();
    if measured.len() < ENERGY_MIN_MEASURED {
        return Vec::new();
    }
    ranked(
        measured
            .into_iter()
            .filter(|(_, e)| if high { *e >= 0.6 } else { *e <= 0.35 })
            .map(|(id, e)| {
                let percent = (e * 100.0).round() as i64;
                let score = if high { e } else { 1.0 - e };
                // Within a band of energy, what the user loves first.
                let love = inputs.loved.get(id).copied().unwrap_or(0.0);
                (id.clone(), (score * 10.0).round() + love, Reason::new("energy").count(percent))
            })
            .collect(),
    )
}

/// Songs never heard, by an artist the user loves or next to a loved song on the taste map.
fn never_heard(inputs: &Inputs) -> Vec<Entry> {
    let artists = inputs.artists();
    // An artist's love: the best loved score among their songs.
    let mut artist_love: HashMap<&str, f64> = HashMap::new();
    for (id, love) in &inputs.loved {
        for a in artists.get(id.as_str()).copied().unwrap_or_default() {
            let best = artist_love.entry(a.as_str()).or_insert(0.0);
            *best = best.max(*love);
        }
    }
    // A song next to a loved one on the map: the best loved neighbour.
    let mut near: HashMap<&str, (f64, &str)> = HashMap::new();
    for (id, love) in &inputs.loved {
        if *love < 0.3 {
            continue;
        }
        for n in inputs.neighbours.get(id).into_iter().flatten() {
            let e = near.entry(n.as_str()).or_insert((0.0, id.as_str()));
            if *love > e.0 {
                *e = (*love, id.as_str());
            }
        }
    }
    let title_of = |id: &str| inputs.titles.get(id).cloned().unwrap_or_else(|| id.to_owned());
    ranked(
        inputs
            .present()
            .filter(|id| inputs.plays.get(*id).copied().unwrap_or(0) == 0)
            .filter_map(|id| {
                let by = artists
                    .get(id)
                    .copied()
                    .unwrap_or_default()
                    .iter()
                    .map(|a| (artist_love.get(a.as_str()).copied().unwrap_or(0.0), a))
                    .max_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
                let by_artist = by.filter(|(love, _)| *love >= 0.3);
                let by_map = near.get(id);
                match (by_artist, by_map) {
                    (Some((love, artist)), map) if map.is_none_or(|m| m.0 <= love) => {
                        Some((id.to_owned(), love, Reason::new("newByArtist").name(artist.clone())))
                    }
                    (_, Some((love, neighbour))) => {
                        Some((id.to_owned(), *love * 0.95, Reason::new("newNear").name(title_of(neighbour))))
                    }
                    _ => None,
                }
            })
            .collect(),
    )
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Part {
    Favourite,
    Forgotten,
    New,
    Island,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MixEntry {
    pub song_id: String,
    pub part: Part,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Mix {
    /// The local day it is for (YYYY-MM-DD), and which mix of that day (0 first; New mix counts up).
    pub day: String,
    pub round: u32,
    pub songs: Vec<MixEntry>,
    /// For the card's subtitle: the artist most of the new songs are by, and the island of the day.
    pub new_artist: Option<String>,
    pub island: Option<String>,
}

/// A number from the seed and a song, uniform in 0..1.
fn draw(seed: u64, key: &str) -> f64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325 ^ seed.wrapping_mul(0x9e37_79b9_7f4a_7c15);
    for b in key.bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    h ^= h >> 33;
    h = h.wrapping_mul(0xff51_afd7_ed55_8ccd);
    h ^= h >> 33;
    (h >> 11) as f64 / (1u64 << 53) as f64
}

/// The seed of a day's mix: the date and the round.
pub fn seed_of(day: &str, round: u32) -> u64 {
    (draw(round as u64, day) * u64::MAX as f64) as u64
}

/// `n` songs from `pool` by weight, without repeats (Efraimidis-Spirakis keys from the seed).
fn sample(pool: &[(String, f64)], n: usize, seed: u64, taken: &HashSet<String>) -> Vec<String> {
    let mut keyed: Vec<(f64, &String)> = pool
        .iter()
        .filter(|(id, w)| *w > 0.0 && !taken.contains(id))
        .map(|(id, w)| (draw(seed, id).max(1e-12).ln() / w, id))
        .collect();
    keyed.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal).then_with(|| a.1.cmp(b.1)));
    keyed.into_iter().take(n).map(|(_, id)| id.clone()).collect()
}

/// The mix of `day` (round 0, or a later one after New mix): deterministic for its inputs and seed.
pub fn mix(inputs: &Inputs, day: &str, round: u32) -> Mix {
    let seed = seed_of(day, round);
    let present: HashSet<&str> = inputs.present().collect();
    let artists = inputs.artists();
    let mut taken: HashSet<String> = HashSet::new();
    let mut chosen: Vec<MixEntry> = Vec::new();

    let favourites: Vec<(String, f64)> =
        inputs.weights.iter().filter(|(id, _)| present.contains(id.as_str())).map(|(id, w)| (id.clone(), *w)).collect();
    let forgotten: Vec<(String, f64)> = inputs
        .rediscover
        .iter()
        .enumerate()
        .filter(|(_, id)| present.contains(id.as_str()))
        .map(|(i, id)| (id.clone(), 1.0 / (1.0 + i as f64 / 10.0)))
        .collect();
    let new_list = never_heard(inputs);
    let new: Vec<(String, f64)> =
        new_list.iter().enumerate().map(|(i, e)| (e.song_id.clone(), 1.0 / (1.0 + i as f64 / 10.0))).collect();

    // The island of the day: among the islands with enough songs, the least heard in the last two
    // weeks (three candidates), one drawn by the seed.
    let since = inputs.now - RECENT_DAYS * DAY_MS;
    let mut island_size: HashMap<usize, usize> = HashMap::new();
    for (id, island) in &inputs.island_of {
        if present.contains(id.as_str()) && inputs.island_names.contains_key(island) {
            *island_size.entry(*island).or_default() += 1;
        }
    }
    let mut island_recent: HashMap<usize, usize> = HashMap::new();
    for i in inputs.recent.heard() {
        let p = &inputs.recent.plays[i];
        if p.started_at >= since
            && let Some(island) = inputs.island_of.get(&p.song_id)
        {
            *island_recent.entry(*island).or_default() += 1;
        }
    }
    let mut candidates: Vec<(usize, f64)> = island_size
        .iter()
        .filter(|(_, size)| **size >= 8)
        .map(|(island, size)| (*island, island_recent.get(island).copied().unwrap_or(0) as f64 / *size as f64))
        .collect();
    candidates.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal).then_with(|| a.0.cmp(&b.0)));
    candidates.truncate(3);
    let island = (!candidates.is_empty())
        .then(|| candidates[(draw(seed, "island") * candidates.len() as f64) as usize % candidates.len()].0);
    let island_pool: Vec<(String, f64)> = match island {
        Some(isl) => inputs
            .island_of
            .iter()
            .filter(|(id, i)| **i == isl && present.contains(id.as_str()))
            .map(|(id, _)| (id.clone(), inputs.weights.get(id).copied().unwrap_or(0.0).max(0.01)))
            .collect(),
        None => Vec::new(),
    };

    let pools = [(Part::Forgotten, &forgotten), (Part::New, &new), (Part::Island, &island_pool)];
    for ((part, pool), (_, n)) in pools.into_iter().zip(MIX_PARTS.iter().skip(1)) {
        for id in sample(pool, *n, seed ^ (part as u64 + 1), &taken) {
            taken.insert(id.clone());
            chosen.push(MixEntry { song_id: id, part });
        }
    }
    // Smart Shuffle's favourites take their half and whatever the other parts could not fill.
    let rest = MIX_SIZE.saturating_sub(chosen.len());
    for id in sample(&favourites, rest, seed, &taken) {
        taken.insert(id.clone());
        chosen.push(MixEntry { song_id: id, part: Part::Favourite });
    }

    // Order: by the seed, then no artist twice in a row where another order allows it.
    chosen.sort_by(|a, b| {
        draw(seed ^ 7, &a.song_id).partial_cmp(&draw(seed ^ 7, &b.song_id)).unwrap_or(std::cmp::Ordering::Equal)
    });
    let first_artist = |id: &str| artists.get(id).and_then(|a| a.first()).map(|a| a.to_lowercase());
    let mut ordered: Vec<MixEntry> = Vec::with_capacity(chosen.len());
    while !chosen.is_empty() {
        let last = ordered.last().and_then(|e| first_artist(&e.song_id));
        let at = chosen.iter().position(|e| last.is_none() || first_artist(&e.song_id) != last).unwrap_or(0);
        ordered.push(chosen.remove(at));
    }

    let mut by_artist: HashMap<String, usize> = HashMap::new();
    for e in ordered.iter().filter(|e| e.part == Part::New) {
        if let Some(a) = artists.get(e.song_id.as_str()).and_then(|a| a.first()) {
            *by_artist.entry(a.clone()).or_default() += 1;
        }
    }
    let new_artist = by_artist
        .into_iter()
        .max_by(|a, b| a.1.cmp(&b.1).then_with(|| b.0.cmp(&a.0)))
        .filter(|(_, n)| *n >= 2)
        .map(|(a, _)| a);
    Mix {
        day: day.to_owned(),
        round,
        songs: ordered,
        new_artist,
        island: island.and_then(|i| inputs.island_names.get(&i).cloned()),
    }
}

/// Reads [`Inputs`] from the database. `weights` are Smart Shuffle's as it runs now, `map` the last
/// taste map built (if any), `rediscover` the shelf's list.
pub fn stored_inputs(
    db: &crate::db::Db,
    weights: HashMap<String, f64>,
    map: Option<&crate::tastemap::TasteMap>,
    rediscover: Vec<String>,
    now: i64,
) -> crate::Result<Inputs> {
    let conn = db.conn();
    let mut stmt = conn.prepare(
        "SELECT v.song_id, v.title, (SELECT group_concat(name, char(31)) FROM variant_artists a WHERE a.variant_id = v.variant_id AND a.role = 'artist')
         FROM track_variants v WHERE v.present = 1 GROUP BY v.song_id ORDER BY v.song_id",
    )?;
    let mut titles = HashMap::new();
    let mut songs: Vec<(String, Vec<String>)> = Vec::new();
    for row in stmt.query_map([], |r| {
        let artists: Option<String> = r.get(2)?;
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            artists.map(|a| a.split('\u{1f}').map(str::to_owned).collect::<Vec<_>>()).unwrap_or_default(),
        ))
    })? {
        let (id, title, artists) = row?;
        titles.insert(id.clone(), title);
        songs.push((id, artists));
    }
    let plays: HashMap<String, i64> = conn
        .prepare("SELECT song_id, plays FROM song_totals")?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?;
    let full: HashMap<String, i64> = conn
        .prepare("SELECT song_id, full FROM song_totals")?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?;
    let tiers = crate::shuffle::tier_scores(crate::shuffle::stored_tierlists(db)?.iter());
    let ratings = crate::elo::ratings(db)?;
    let has_elo = crate::elo::total_duels(db)? >= crate::shuffle::ELO_MIN_DUELS;
    let max_full = full.values().copied().fold(1, i64::max) as f64;
    let mut loved: HashMap<String, f64> = HashMap::new();
    for (id, _) in &songs {
        let elo = match ratings.get(id) {
            Some(r) if has_elo && r.games >= 1 => crate::elo::positive_score(r),
            _ => 0.0,
        };
        let score = 0.55 * tiers.get(id).copied().unwrap_or(0.0)
            + 0.35 * elo
            + 0.1 * (full.get(id).copied().unwrap_or(0) as f64 / max_full);
        if score > 0.0 {
            loved.insert(id.clone(), (score / 0.55).min(1.0));
        }
    }
    let recent = Classified::load(conn, now - crate::shuffle::HORIZON_MS)?;
    let utc_offset_min = recent.plays.last().map_or_else(
        || {
            conn.query_row("SELECT utc_offset_min FROM play_events ORDER BY ended_at DESC LIMIT 1", [], |r| r.get(0))
                .unwrap_or(0)
        },
        |p| p.utc_offset_min,
    );
    let mut island_of = HashMap::new();
    let mut island_names = HashMap::new();
    let mut neighbours = HashMap::new();
    if let Some(map) = map {
        let first: HashMap<String, String> =
            songs.iter().filter_map(|(id, a)| Some((id.clone(), a.first()?.clone()))).collect();
        island_names = crate::tastemap::island_names(map, &first);
        for p in &map.points {
            island_of.insert(p.song_id.clone(), p.island);
            neighbours.insert(p.song_id.clone(), p.neighbours.clone());
        }
    }
    Ok(Inputs {
        songs,
        titles,
        loved,
        plays,
        rediscover,
        recent,
        now,
        utc_offset_min,
        energy: crate::features::energy(db)?,
        island_of,
        island_names,
        neighbours,
        weights,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::listening::Listen;

    const NOW: i64 = 1_800_000_000_000;
    const MIN: i64 = 60_000;

    fn listen(song: &str, at: i64, start: &str, end: &str, heard: i64) -> Listen {
        Listen {
            song_id: song.into(),
            started_at: at,
            ended_at: at + heard,
            utc_offset_min: 0,
            heard_ms: heard,
            duration_ms: 3 * MIN,
            end_reason: end.into(),
            start_reason: Some(start.into()),
            source_kind: Some("songs".into()),
            seeks: vec![],
        }
    }

    /// A library of `n` songs by `n / 4` artists, the first quarter loved.
    fn library(n: usize) -> Inputs {
        let songs: Vec<(String, Vec<String>)> =
            (0..n).map(|i| (format!("s{i:03}"), vec![format!("Artist {}", i % (n / 4).max(1))])).collect();
        let loved = songs.iter().take(n / 4).map(|(id, _)| (id.clone(), 0.8)).collect();
        let plays = songs.iter().enumerate().filter(|(i, _)| i % 3 != 0).map(|(_, (id, _))| (id.clone(), 4)).collect();
        let weights = songs.iter().enumerate().map(|(i, (id, _))| (id.clone(), 1.0 + (i % 7) as f64)).collect();
        let island_of: HashMap<String, usize> =
            songs.iter().enumerate().map(|(i, (id, _))| (id.clone(), i % 5)).collect();
        let island_names = (0..5).map(|i| (i, format!("Island {i}"))).collect();
        Inputs {
            rediscover: songs.iter().take(n / 4).map(|(id, _)| id.clone()).collect(),
            songs,
            loved,
            plays,
            now: NOW,
            island_of,
            island_names,
            weights,
            ..Default::default()
        }
    }

    fn classify(plays: Vec<Listen>) -> Classified {
        let contexts = crate::listening::classify(&plays);
        Classified { plays, contexts }
    }

    #[test]
    fn every_rule_returns_only_songs_that_meet_it_with_a_reason() {
        let mut inputs = library(40);
        let day = NOW - 3 * DAY_MS;
        let mut plays = Vec::new();
        // s010: picked four times, two hours apart (On repeat), at night (This hour, if now is night).
        for k in 0..4 {
            plays.push(listen("s010", day + k * 120 * MIN, "user_selected", "finished", 3 * MIN));
        }
        // s011: picked once (not enough).
        plays.push(listen("s011", day + 600 * MIN, "user_selected", "finished", 3 * MIN));
        // s012 replayed at once twice: 1 pick + 2 replays.
        plays.push(listen("s012", day + 900 * MIN, "user_selected", "finished", 3 * MIN));
        plays.push(listen("s012", day + 904 * MIN, "user_previous", "finished", 3 * MIN));
        // An old pick spree (outside two weeks) counts for nothing.
        for k in 0..5 {
            plays.push(listen("s013", NOW - 30 * DAY_MS + k * 60 * MIN, "user_selected", "finished", 3 * MIN));
        }
        inputs.recent = classify(plays);
        let repeat = list(&inputs, List::OnRepeat);
        let ids: Vec<&str> = repeat.iter().map(|e| e.song_id.as_str()).collect();
        assert!(ids.contains(&"s010") && ids.contains(&"s012"), "{ids:?}");
        assert!(!ids.contains(&"s011") && !ids.contains(&"s013"));
        assert_eq!(repeat.iter().find(|e| e.song_id == "s012").unwrap().reason.key, "onRepeatReplayed");

        // Never heard: unplayed songs (i % 3 == 0) by loved artists (Artist 0..9 own s000..s009).
        let new = list(&inputs, List::NeverHeard);
        assert!(!new.is_empty());
        for e in &new {
            assert_eq!(inputs.plays.get(&e.song_id).copied().unwrap_or(0), 0, "{}", e.song_id);
            assert_eq!(e.reason.key, "newByArtist");
        }

        // Energy: hidden until enough songs are measured, then only the band.
        assert!(list(&inputs, List::Energetic).is_empty());
        inputs.energy = inputs.songs.iter().enumerate().map(|(i, (id, _))| (id.clone(), i as f64 / 40.0)).collect();
        inputs.energy.extend((0..20).map(|i| (format!("gone{i}"), 0.9)));
        assert!(list(&inputs, List::Energetic).is_empty(), "absent songs do not count as measured");
        inputs.songs.extend((40..60).map(|i| (format!("s{i:03}"), vec![format!("Artist {}", i % 10)])));
        for i in 40..60 {
            inputs.energy.insert(format!("s{i:03}"), 0.5);
        }
        let high = list(&inputs, List::Energetic);
        assert!(!high.is_empty() && high.iter().all(|e| inputs.energy[&e.song_id] >= 0.6));
        assert!(list(&inputs, List::Calm).iter().all(|e| inputs.energy[&e.song_id] <= 0.35));
    }

    #[test]
    fn this_hour_needs_enough_plays_mostly_at_this_part_of_the_day() {
        let mut inputs = library(20);
        // Now is 20:00 UTC (evening).
        let evening = NOW - NOW.rem_euclid(DAY_MS) + 20 * 60 * MIN;
        inputs.now = evening;
        let mut plays = Vec::new();
        for d in 1..=6 {
            plays.push(listen("s001", evening - d * DAY_MS, "auto", "finished", 3 * MIN));
            plays.push(listen("s002", evening - d * DAY_MS - 12 * 60 * MIN, "auto", "finished", 3 * MIN));
        }
        for d in 1..=3 {
            plays.push(listen("s003", evening - d * DAY_MS + 10 * MIN, "auto", "finished", 3 * MIN));
        }
        plays.sort_by_key(|p| p.started_at);
        inputs.recent = classify(plays);
        let hour = list(&inputs, List::ThisHour);
        assert_eq!(hour.iter().map(|e| e.song_id.as_str()).collect::<Vec<_>>(), ["s001"]);
        assert_eq!(
            (hour[0].reason.key.as_str(), hour[0].reason.count, hour[0].reason.total),
            ("evening", Some(6), Some(6))
        );
    }

    #[test]
    fn caught_you_reads_browses_ended_and_picks_heard_through() {
        let mut inputs = library(20);
        let t = NOW - DAY_MS;
        let mut plays = vec![
            listen("s005", t, "user_next", "user_next", 2_000),
            listen("s006", t + 3_000, "user_next", "user_next", 2_000),
            listen("s007", t + 6_000, "user_next", "user_next", 2_000),
            listen("s008", t + 9_000, "user_next", "finished", 3 * MIN),
        ];
        plays.push(listen("s009", t + 10 * MIN, "user_selected", "finished", 3 * MIN));
        plays.push(listen("s009", t + 300 * MIN, "user_selected", "finished", 3 * MIN));
        inputs.recent = classify(plays);
        let caught = list(&inputs, List::CaughtYou);
        let ids: Vec<&str> = caught.iter().map(|e| e.song_id.as_str()).collect();
        assert!(ids.contains(&"s009"), "{ids:?}");
        assert!(!ids.contains(&"s005"));
        if inputs.recent.contexts[3].caught {
            assert_eq!(caught[0].song_id, "s008");
            assert_eq!(caught[0].reason.key, "caught");
        }
    }

    #[test]
    fn the_mix_is_the_same_for_a_day_differs_the_next_keeps_its_shares_and_spaces_artists() {
        let inputs = library(400);
        let a = mix(&inputs, "2026-11-01", 0);
        assert_eq!(a, mix(&inputs, "2026-11-01", 0), "the same for the day");
        let b = mix(&inputs, "2026-11-02", 0);
        let c = mix(&inputs, "2026-11-01", 1);
        let same = |x: &Mix, y: &Mix| x.songs.iter().filter(|e| y.songs.iter().any(|f| f.song_id == e.song_id)).count();
        assert!(same(&a, &b) < MIX_SIZE / 2, "another day, another mix ({})", same(&a, &b));
        assert!(same(&a, &c) < MIX_SIZE / 2, "New mix makes another ({})", same(&a, &c));
        assert_eq!(a.songs.len(), MIX_SIZE);
        let share = |m: &Mix, p: Part| m.songs.iter().filter(|e| e.part == p).count() as f64 / MIX_SIZE as f64;
        for (part, n) in MIX_PARTS {
            let want = n as f64 / MIX_SIZE as f64;
            assert!((share(&a, part) - want).abs() <= 0.1, "{part:?}: {} vs {want}", share(&a, part));
        }
        let artists = inputs.artists();
        for w in a.songs.windows(2) {
            assert_ne!(
                artists[w[0].song_id.as_str()][0],
                artists[w[1].song_id.as_str()][0],
                "no artist twice in a row"
            );
        }
        let ids: HashSet<&str> = a.songs.iter().map(|e| e.song_id.as_str()).collect();
        assert_eq!(ids.len(), MIX_SIZE, "no song twice");
        assert!(a.island.is_some());
        for e in a.songs.iter().filter(|e| e.part == Part::New) {
            assert_eq!(inputs.plays.get(&e.song_id).copied().unwrap_or(0), 0);
        }
    }

    #[test]
    fn a_thin_library_fills_the_mix_with_favourites_and_hides_empty_lists() {
        let mut inputs = library(24);
        inputs.rediscover.clear();
        inputs.loved.clear();
        inputs.island_names.clear();
        let m = mix(&inputs, "2026-11-01", 0);
        assert_eq!(m.songs.len(), 24, "every song once, all of them favourites");
        assert!(m.songs.iter().all(|e| e.part == Part::Favourite));
        assert!(list(&inputs, List::Rediscover).is_empty());
        assert!(list(&inputs, List::NeverHeard).is_empty());
    }
}

#[cfg(test)]
mod real {
    use super::*;

    /// P19.0: the lists and a mix on a copy of a real profile (`NEMORA_REAL_DB`; the copy is
    /// migrated in place, never the profile itself), printed for the plan.
    #[test]
    #[ignore]
    fn real_profile_counts() {
        let Ok(path) = std::env::var("NEMORA_REAL_DB") else { return };
        let db = crate::db::Db::open(std::path::Path::new(&path)).unwrap();
        let now = crate::db::now_ms();
        let today = crate::time::local_day(now, 180);
        let started = std::time::Instant::now();
        let prepared = crate::shuffle::prepare(&db).unwrap();
        let weights =
            crate::shuffle::weights_prepared(&db, &prepared, &[], 0.6, &crate::shuffle::Options::default()).unwrap();
        let map = crate::tastemap::build(&db, None, false).ok();
        let rediscover = crate::rediscover::stored(&db, 30, &today).unwrap();
        let built = std::time::Instant::now();
        let inputs = stored_inputs(&db, weights, map.as_ref(), rediscover, now).unwrap();
        let read = built.elapsed();
        for which in List::ALL {
            let l = list(&inputs, which);
            println!("{which:?}: {} {:?}", l.len(), l.first().map(|e| &e.reason));
        }
        let t = std::time::Instant::now();
        let m = mix(&inputs, &today, 0);
        let parts: HashMap<Part, usize> = m.songs.iter().fold(HashMap::new(), |mut acc, e| {
            *acc.entry(e.part).or_default() += 1;
            acc
        });
        println!(
            "mix {}: {} songs {parts:?}, new from {:?}, island {:?} | inputs {:?} (+ shuffle and map {:?}), mix {:?}",
            m.day,
            m.songs.len(),
            m.new_artist,
            m.island,
            read,
            built - started,
            t.elapsed()
        );
    }
}

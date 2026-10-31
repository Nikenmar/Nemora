//! The taste map (PLAN/14 C5): the library as a graph of how the user listens, laid out in 2D.
//!
//! Songs are linked when they were played in the same listening session (plays less than 30 min
//! apart; closer in the session, stronger), when they share an artist, and when they sit in the same
//! tier of a tierlist. Each song keeps its 12 strongest links. A force layout with a fixed seed puts
//! linked songs together, so the same library always draws the same map; `hash` names the inputs, so
//! a caller can keep a layout until they change.

use std::collections::{BTreeMap, HashMap};

use serde::{Deserialize, Serialize};

use crate::db::Db;

/// Plays this close together are one session.
const SESSION_GAP_MS: i64 = 30 * 60_000;
/// How far apart in a session two plays may be and still link (1/distance each).
const SESSION_REACH: usize = 3;
pub const NEIGHBOURS: usize = 12;
/// Below this many plays the map leans on artists and tiers, and says so.
pub const FEW_PLAYS: usize = 200;
const ITERATIONS: usize = 300;
const SEED: u64 = 0x5eed_7a57e;

/// One link's weight per kind.
const ARTIST_LINK: f64 = 0.6;
const TIER_LINK: f64 = 0.35;
/// Linked songs rest this close (unlinked ones keep about 1 apart) and pull this hard.
const SPRING_REST: f64 = 0.2;
const SPRING: f64 = 1.5;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Point {
    pub song_id: String,
    /// 0..1 across the map.
    pub x: f64,
    pub y: f64,
    /// 0..1: best tier placement and ELO standing, for the dot's size.
    pub weight: f64,
    pub title: String,
    pub artist: Option<String>,
    /// A swatch of the cover (hex), for the dot's tint.
    pub tone: Option<String>,
    pub neighbours: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TasteMap {
    pub points: Vec<Point>,
    /// Plays the session links came from; under `FEW_PLAYS` the map is mostly artists and tiers.
    pub plays: usize,
    pub hash: String,
}

/// The inputs of a map, as plain data, so the graph and the layout can be tested without a database.
#[derive(Debug, Clone, Default)]
pub struct Inputs {
    /// Song ids in a fixed order (the layout's seed order).
    pub songs: Vec<String>,
    pub artists: HashMap<String, Vec<String>>,
    /// Plays as (song id, started at), oldest first.
    pub plays: Vec<(String, i64)>,
    /// Tiers as lists of song ids, each tierlist's tiers in order.
    pub tiers: Vec<Vec<String>>,
}

/// Each song's strongest links, at most `NEIGHBOURS`, strongest first (ties by id).
pub fn neighbours(inputs: &Inputs) -> BTreeMap<String, Vec<(String, f64)>> {
    let known: HashMap<&str, ()> = inputs.songs.iter().map(|s| (s.as_str(), ())).collect();
    let mut links: HashMap<(String, String), f64> = HashMap::new();
    let mut add = |a: &str, b: &str, w: f64| {
        if a == b || !known.contains_key(a) || !known.contains_key(b) {
            return;
        }
        let key = if a < b { (a.to_owned(), b.to_owned()) } else { (b.to_owned(), a.to_owned()) };
        *links.entry(key).or_insert(0.0) += w;
    };

    // Sessions.
    let mut session: Vec<&str> = Vec::new();
    let mut last_at = i64::MIN;
    let flush = |session: &mut Vec<&str>, add: &mut dyn FnMut(&str, &str, f64)| {
        for i in 0..session.len() {
            for d in 1..=SESSION_REACH {
                if let Some(other) = session.get(i + d) {
                    add(session[i], other, 1.0 / d as f64);
                }
            }
        }
        session.clear();
    };
    for (song, at) in &inputs.plays {
        if at.saturating_sub(last_at) > SESSION_GAP_MS {
            flush(&mut session, &mut add);
        }
        session.push(song);
        last_at = *at;
    }
    flush(&mut session, &mut add);

    // Shared artists: an artist with many songs links each more weakly.
    let mut by_artist: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    for song in &inputs.songs {
        for artist in inputs.artists.get(song).into_iter().flatten() {
            by_artist.entry(artist.as_str()).or_default().push(song);
        }
    }
    for songs in by_artist.values() {
        if songs.len() < 2 || songs.len() > 150 {
            continue;
        }
        let w = ARTIST_LINK / (songs.len() as f64).sqrt();
        for i in 0..songs.len() {
            for j in i + 1..songs.len() {
                add(songs[i], songs[j], w);
            }
        }
    }

    // Same tier.
    for tier in &inputs.tiers {
        if tier.len() < 2 || tier.len() > 150 {
            continue;
        }
        let w = TIER_LINK / (tier.len() as f64).sqrt();
        for i in 0..tier.len() {
            for j in i + 1..tier.len() {
                add(&tier[i], &tier[j], w);
            }
        }
    }

    let mut all: BTreeMap<String, Vec<(String, f64)>> = BTreeMap::new();
    for ((a, b), w) in links {
        all.entry(a.clone()).or_default().push((b.clone(), w));
        all.entry(b).or_default().push((a, w));
    }
    for list in all.values_mut() {
        list.sort_by(|x, y| y.1.total_cmp(&x.1).then_with(|| x.0.cmp(&y.0)));
        list.truncate(NEIGHBOURS);
    }
    all
}

/// SplitMix64: a fixed sequence from a fixed seed, so the layout never changes for the same inputs.
struct Random(u64);

impl Random {
    fn next(&mut self) -> f64 {
        self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        ((z ^ (z >> 31)) >> 11) as f64 / (1u64 << 53) as f64
    }
}

/// Positions in 0..1 for `songs`, from their links: springs pull linked songs together, nearby songs
/// push apart (only within neighbouring grid cells, so a pass is linear), and a weak pull keeps
/// everything near the middle. Deterministic for the same inputs.
pub fn layout(songs: &[String], links: &BTreeMap<String, Vec<(String, f64)>>) -> Vec<(f64, f64)> {
    let n = songs.len();
    if n == 0 {
        return Vec::new();
    }
    let index: HashMap<&str, usize> = songs.iter().enumerate().map(|(i, s)| (s.as_str(), i)).collect();
    let mut edges: Vec<(usize, usize, f64)> = Vec::new();
    for (a, list) in links {
        let Some(&i) = index.get(a.as_str()) else { continue };
        for (b, w) in list {
            if let Some(&j) = index.get(b.as_str())
                && i < j
            {
                edges.push((i, j, *w));
            }
        }
    }
    let side = (n as f64).sqrt();
    let mut random = Random(SEED);
    let mut pos: Vec<(f64, f64)> = (0..n).map(|_| (random.next() * side, random.next() * side)).collect();
    let ideal = 1.0;
    let cell = 2.0 * ideal;

    for step in 0..ITERATIONS {
        let cooling = 1.0 - step as f64 / ITERATIONS as f64;
        let max_move = 0.05 + side * 0.1 * cooling;
        let mut force = vec![(0.0f64, 0.0f64); n];

        // Repulsion within the 3x3 neighbouring cells.
        let mut grid: HashMap<(i64, i64), Vec<usize>> = HashMap::new();
        for (i, p) in pos.iter().enumerate() {
            grid.entry(((p.0 / cell).floor() as i64, (p.1 / cell).floor() as i64)).or_default().push(i);
        }
        let mut cells: Vec<&(i64, i64)> = grid.keys().collect();
        cells.sort();
        for key in cells {
            for &i in &grid[key] {
                for dx in -1..=1 {
                    for dy in -1..=1 {
                        let Some(others) = grid.get(&(key.0 + dx, key.1 + dy)) else { continue };
                        for &j in others {
                            if j <= i {
                                continue;
                            }
                            let (x, y) = (pos[i].0 - pos[j].0, pos[i].1 - pos[j].1);
                            let d2 = (x * x + y * y).max(1e-4);
                            if d2 > cell * cell {
                                continue;
                            }
                            let f = ideal * ideal / d2;
                            force[i].0 += x * f;
                            force[i].1 += y * f;
                            force[j].0 -= x * f;
                            force[j].1 -= y * f;
                        }
                    }
                }
            }
        }
        // Springs.
        for &(i, j, w) in &edges {
            let (x, y) = (pos[j].0 - pos[i].0, pos[j].1 - pos[i].1);
            let d = (x * x + y * y).sqrt().max(1e-6);
            let f = w.min(2.0) * (d - SPRING_REST) / d * SPRING;
            force[i].0 += x * f;
            force[i].1 += y * f;
            force[j].0 -= x * f;
            force[j].1 -= y * f;
        }
        // A weak pull to the middle keeps islands on the map.
        let centre = side / 2.0;
        for (i, p) in pos.iter_mut().enumerate() {
            let (fx, fy) = (force[i].0 + (centre - p.0) * 0.01, force[i].1 + (centre - p.1) * 0.01);
            let len = (fx * fx + fy * fy).sqrt();
            let scale = if len > max_move { max_move / len } else { 1.0 };
            p.0 += fx * scale;
            p.1 += fy * scale;
        }
    }

    let (min_x, max_x) = pos.iter().fold((f64::MAX, f64::MIN), |(a, b), p| (a.min(p.0), b.max(p.0)));
    let (min_y, max_y) = pos.iter().fold((f64::MAX, f64::MIN), |(a, b), p| (a.min(p.1), b.max(p.1)));
    let span = (max_x - min_x).max(max_y - min_y).max(1e-9);
    // Square, centred: the map keeps its proportions.
    let (off_x, off_y) = ((span - (max_x - min_x)) / 2.0, (span - (max_y - min_y)) / 2.0);
    pos.into_iter().map(|(x, y)| ((x - min_x + off_x) / span, (y - min_y + off_y) / span)).collect()
}

/// A name for the inputs: the songs and every link, rounded; equal inputs, equal hash.
pub fn hash(songs: &[String], links: &BTreeMap<String, Vec<(String, f64)>>) -> String {
    let mut hasher = blake3::Hasher::new();
    for song in songs {
        hasher.update(song.as_bytes());
        hasher.update(&[0]);
    }
    for (a, list) in links {
        hasher.update(a.as_bytes());
        for (b, w) in list {
            hasher.update(b.as_bytes());
            hasher.update(&((w * 1000.0).round() as i64).to_le_bytes());
        }
    }
    hasher.finalize().to_hex()[..16].to_owned()
}

/// The inputs from the database: every song with a variant, plays, artists and tierlists.
pub fn stored_inputs(db: &Db) -> crate::Result<Inputs> {
    let conn = db.conn();
    let songs: Vec<String> = conn
        .prepare("SELECT DISTINCT song_id FROM track_variants ORDER BY song_id")?
        .query_map([], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    let mut artists: HashMap<String, Vec<String>> = HashMap::new();
    let mut stmt = conn.prepare(
        "SELECT DISTINCT v.song_id, a.name FROM track_variants v JOIN variant_artists a ON a.variant_id = v.variant_id
         WHERE a.role = 'artist' ORDER BY v.song_id, a.name",
    )?;
    for row in stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
        let (song, name) = row?;
        artists.entry(song).or_default().push(name.to_lowercase());
    }
    let plays: Vec<(String, i64)> = conn
        .prepare("SELECT song_id, started_at FROM play_events ORDER BY started_at, seq")?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?;
    let tiers = crate::shuffle::stored_tierlists(db)?.into_iter().flat_map(|t| t.tiers).collect();
    Ok(Inputs { songs, artists, plays, tiers })
}

/// The map of the library. `cached` is a previous map: when its hash matches, its layout is reused.
pub fn build(db: &Db, cached: Option<&TasteMap>) -> crate::Result<TasteMap> {
    let inputs = stored_inputs(db)?;
    let links = neighbours(&inputs);
    let hash = hash(&inputs.songs, &links);
    if let Some(map) = cached
        && map.hash == hash
    {
        return Ok(map.clone());
    }
    let positions = layout(&inputs.songs, &links);

    // What each dot shows: title, first artist, a cover swatch, and its standing.
    let mut facts: HashMap<String, (String, Option<String>, Option<String>)> = HashMap::new();
    let mut stmt = db.conn().prepare(
        "SELECT v.song_id, v.title,
                (SELECT name FROM variant_artists a WHERE a.variant_id = v.variant_id AND a.role = 'artist' ORDER BY a.position LIMIT 1),
                c.palette
         FROM track_variants v LEFT JOIN covers c ON c.cover_hash = v.cover_hash
         ORDER BY v.song_id, v.variant_id",
    )?;
    for row in stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, Option<String>>(2)?,
            r.get::<_, Option<String>>(3)?,
        ))
    })? {
        let (song, title, artist, palette) = row?;
        let tone = palette.and_then(|p| serde_json::from_str::<serde_json::Value>(&p).ok()).and_then(|p| {
            ["Vibrant", "DarkVibrant", "Muted"].iter().find_map(|k| p[k]["hex"].as_str().map(str::to_owned))
        });
        facts.entry(song).or_insert((title, artist, tone));
    }
    let weights = crate::shuffle::stored_weights(db, &inputs.songs, 1.0, &crate::shuffle::Options::CLASSIC)?;

    let points = inputs
        .songs
        .iter()
        .zip(positions)
        .map(|(song, (x, y))| {
            let (title, artist, tone) = facts.get(song).cloned().unwrap_or_default();
            Point {
                song_id: song.clone(),
                x,
                y,
                weight: weights.get(song).copied().unwrap_or(0.0),
                title,
                artist,
                tone,
                neighbours: links.get(song).map(|l| l.iter().map(|(id, _)| id.clone()).collect()).unwrap_or_default(),
            }
        })
        .collect();
    Ok(TasteMap { points, plays: inputs.plays.len(), hash })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids(n: usize) -> Vec<String> {
        (0..n).map(|i| format!("s{i:03}")).collect()
    }

    /// Two listening habits: s000..s019 played together on one day, s020..s039 on another.
    fn two_habits() -> Inputs {
        let songs = ids(40);
        let mut plays = Vec::new();
        let mut at = 0;
        for round in 0..5 {
            for group in [0..20, 20..40] {
                for i in group {
                    plays.push((songs[(i + round * 3) % 20 + if i >= 20 { 20 } else { 0 }].clone(), at));
                    at += 4 * 60_000;
                }
                at += 24 * 3_600_000;
            }
        }
        Inputs { songs, plays, ..Default::default() }
    }

    #[test]
    fn the_same_inputs_draw_the_same_map() {
        let inputs = two_habits();
        let links = neighbours(&inputs);
        assert_eq!(layout(&inputs.songs, &links), layout(&inputs.songs, &links));
        assert_eq!(hash(&inputs.songs, &links), hash(&inputs.songs, &neighbours(&inputs)));
    }

    #[test]
    fn songs_heard_together_are_neighbours_and_lie_together() {
        let inputs = two_habits();
        let links = neighbours(&inputs);
        for (song, list) in &links {
            assert!(list.len() <= NEIGHBOURS);
            let group = song.as_str() < "s020";
            // Every neighbour comes from the same habit: sessions a day apart never link.
            assert!(list.iter().all(|(other, _)| (other.as_str() < "s020") == group), "{song}: {list:?}");
        }
        let pos = layout(&inputs.songs, &links);
        let centre = |range: std::ops::Range<usize>| {
            let n = range.len() as f64;
            let (x, y) = range.fold((0.0, 0.0), |(x, y), i| (x + pos[i].0, y + pos[i].1));
            (x / n, y / n)
        };
        let spread = |range: std::ops::Range<usize>, c: (f64, f64)| {
            range.map(|i| ((pos[i].0 - c.0).powi(2) + (pos[i].1 - c.1).powi(2)).sqrt()).sum::<f64>() / 20.0
        };
        let (a, b) = (centre(0..20), centre(20..40));
        let apart = ((a.0 - b.0).powi(2) + (a.1 - b.1).powi(2)).sqrt();
        // The two habits are further from each other than their songs are from their own middle.
        assert!(apart > spread(0..20, a) && apart > spread(20..40, b), "apart {apart}");
        assert!(pos.iter().all(|p| (0.0..=1.0).contains(&p.0) && (0.0..=1.0).contains(&p.1)));
    }

    #[test]
    fn artists_and_tiers_link_without_plays() {
        let songs = ids(4);
        let artists = [(songs[0].clone(), vec!["x".to_owned()]), (songs[1].clone(), vec!["x".to_owned()])].into();
        let tiers = vec![vec![songs[2].clone(), songs[3].clone()]];
        let links = neighbours(&Inputs { songs: songs.clone(), artists, plays: Vec::new(), tiers });
        assert_eq!(links[&songs[0]][0].0, songs[1]);
        assert_eq!(links[&songs[2]][0].0, songs[3]);
        assert_eq!(links[&songs[0]].len(), 1);
    }
}

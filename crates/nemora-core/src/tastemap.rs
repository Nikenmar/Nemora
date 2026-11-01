//! The taste map (PLAN/14 C5, PLAN/17): the library as a graph of how the user listens, laid out
//! in 2D.
//!
//! Songs are linked when they were heard in the same listening session (plays less than 30 min
//! apart; closer in the session, stronger; plays made while browsing do not count, PLAN/16), when
//! they share an artist, and when they sit in the same tier of a tierlist. Each song keeps its 12
//! strongest links and what they are made of. A force layout with a fixed seed puts linked songs
//! together; a rebuild starts from the previous positions and only settles the change, so the map
//! keeps its shape as the user listens (a fresh layout only on request). Communities of the graph
//! are its islands. `hash` names the inputs, so a caller can keep a layout until they change.
//!
//! What changes with every play and setting (the shuffle's weight, plays, last heard, tier,
//! energy, names) is not part of the layout: [`annotate`] fills it on every read.

use std::collections::{BTreeMap, BinaryHeap, HashMap, HashSet};

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
/// A rebuild from previous positions: this many gentle steps, each moving a placed song at most
/// [`SETTLE_MOVE`] (layout units, about one song apart).
const SETTLE_ITERATIONS: usize = 40;
const SETTLE_MOVE: f64 = 0.01;
const SEED: u64 = 0x5eed_7a57e;

/// One link's weight per kind.
const ARTIST_LINK: f64 = 0.6;
const TIER_LINK: f64 = 0.35;
/// Linked songs rest this close (unlinked ones keep about 1 apart) and pull this hard.
const SPRING_REST: f64 = 0.2;
const SPRING: f64 = 1.5;

/// What a link is made of, as bits.
pub const LINK_SESSION: u8 = 1;
pub const LINK_ARTIST: u8 = 2;
pub const LINK_TIER: u8 = 4;

/// Islands smaller than this join the island they link to most.
pub const MIN_ISLAND: usize = 4;
/// A user's island name follows the island that shares this much of its songs (Jaccard).
const NAME_MATCH: f64 = 0.4;
/// `settings_device` key of the user's island names: `[{ "name", "songs": [...] }]`.
pub const ISLAND_NAMES: &str = "tasteMap.islands";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Point {
    pub song_id: String,
    /// 0..1 across the map.
    pub x: f64,
    pub y: f64,
    /// 0..1: the song's Smart Shuffle weight as the shuffle runs now, over the library's largest.
    pub weight: f64,
    pub title: String,
    pub artist: Option<String>,
    /// A swatch of the cover (hex), for the dot's tint.
    pub tone: Option<String>,
    pub neighbours: Vec<String>,
    /// What links it to each neighbour, as `LINK_*` bits, in the neighbours' order.
    pub link_kinds: Vec<u8>,
    /// Its island: an index into [`TasteMap::islands`].
    pub island: usize,
    /// Plays of 30 s or more, and time heard over every play, from the totals.
    pub plays: i64,
    pub heard_ms: i64,
    /// The day it was last heard, not browsed (local days since the epoch).
    pub last_day: Option<i64>,
    /// Its best tier among the tierlists that influence the shuffle: name, and value (0..1).
    pub tier: Option<String>,
    pub tier_value: Option<f64>,
    /// Energy flow's measure (PLAN/15 C2), once analysed.
    pub energy: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Island {
    pub id: usize,
    /// Its leading artists, when they lead it; None leaves the name to the view.
    pub name: Option<String>,
    /// The user's own name, kept across rebuilds.
    pub user_name: Option<String>,
    pub size: usize,
    /// Its middle, 0..1.
    pub x: f64,
    pub y: f64,
    /// The songs not linked into any island, scattered over the map: never labelled.
    pub loose: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TasteMap {
    pub points: Vec<Point>,
    pub islands: Vec<Island>,
    /// Plays the session links came from; under `FEW_PLAYS` the map is mostly artists and tiers.
    pub plays: usize,
    pub hash: String,
    /// Layout units per map width, so a rebuild can start from these positions.
    pub span: f64,
}

/// The inputs of a map, as plain data, so the graph and the layout can be tested without a database.
#[derive(Debug, Clone, Default)]
pub struct Inputs {
    /// Song ids in a fixed order (the layout's seed order).
    pub songs: Vec<String>,
    pub artists: HashMap<String, Vec<String>>,
    /// Plays heard (not browsed) as (song id, started at), oldest first.
    pub plays: Vec<(String, i64)>,
    /// Tiers as lists of song ids, each tierlist's tiers in order.
    pub tiers: Vec<Vec<String>>,
}

/// Each song's strongest links with what they are made of, at most `NEIGHBOURS`, strongest first
/// (ties by id).
pub fn links(inputs: &Inputs) -> BTreeMap<String, Vec<(String, f64, u8)>> {
    // By index: string keys made this 3 s at 20 000 songs and 200 000 plays.
    let index: HashMap<&str, u32> = inputs.songs.iter().enumerate().map(|(i, s)| (s.as_str(), i as u32)).collect();
    let mut links: HashMap<(u32, u32), (f64, u8)> = HashMap::new();
    let mut add = |a: u32, b: u32, w: f64, kind: u8| {
        if a == b {
            return;
        }
        let entry = links.entry(if a < b { (a, b) } else { (b, a) }).or_insert((0.0, 0));
        entry.0 += w;
        entry.1 |= kind;
    };

    // Sessions.
    let plays: Vec<(Option<u32>, i64)> =
        inputs.plays.iter().map(|(song, at)| (index.get(song.as_str()).copied(), *at)).collect();
    let mut start = 0;
    for i in 1..=plays.len() {
        if i == plays.len() || plays[i].1.saturating_sub(plays[i - 1].1) > SESSION_GAP_MS {
            let session = &plays[start..i];
            for a in 0..session.len() {
                let Some(x) = session[a].0 else { continue };
                for d in 1..=SESSION_REACH {
                    if let Some((Some(y), _)) = session.get(a + d) {
                        add(x, *y, 1.0 / d as f64, LINK_SESSION);
                    }
                }
            }
            start = i;
        }
    }

    // Shared artists: an artist with many songs links each more weakly.
    let mut by_artist: BTreeMap<&str, Vec<u32>> = BTreeMap::new();
    for (i, song) in inputs.songs.iter().enumerate() {
        for artist in inputs.artists.get(song).into_iter().flatten() {
            by_artist.entry(artist.as_str()).or_default().push(i as u32);
        }
    }
    for songs in by_artist.values() {
        if songs.len() < 2 || songs.len() > 150 {
            continue;
        }
        let w = ARTIST_LINK / (songs.len() as f64).sqrt();
        for i in 0..songs.len() {
            for j in i + 1..songs.len() {
                add(songs[i], songs[j], w, LINK_ARTIST);
            }
        }
    }

    // Same tier.
    for tier in &inputs.tiers {
        if tier.len() < 2 || tier.len() > 150 {
            continue;
        }
        let ids: Vec<u32> = tier.iter().filter_map(|s| index.get(s.as_str()).copied()).collect();
        let w = TIER_LINK / (tier.len() as f64).sqrt();
        for i in 0..ids.len() {
            for j in i + 1..ids.len() {
                add(ids[i], ids[j], w, LINK_TIER);
            }
        }
    }

    let mut all: Vec<Vec<(u32, f64, u8)>> = vec![Vec::new(); inputs.songs.len()];
    for ((a, b), (w, kinds)) in links {
        all[a as usize].push((b, w, kinds));
        all[b as usize].push((a, w, kinds));
    }
    let songs = &inputs.songs;
    all.into_iter()
        .enumerate()
        .filter(|(_, list)| !list.is_empty())
        .map(|(a, mut list)| {
            list.sort_by(|x, y| y.1.total_cmp(&x.1).then_with(|| songs[x.0 as usize].cmp(&songs[y.0 as usize])));
            list.truncate(NEIGHBOURS);
            (songs[a].clone(), list.into_iter().map(|(b, w, k)| (songs[b as usize].clone(), w, k)).collect())
        })
        .collect()
}

/// [`links`] without their kinds.
pub fn neighbours(inputs: &Inputs) -> BTreeMap<String, Vec<(String, f64)>> {
    plain(&links(inputs))
}

pub(crate) fn plain(links: &BTreeMap<String, Vec<(String, f64, u8)>>) -> BTreeMap<String, Vec<(String, f64)>> {
    links.iter().map(|(a, list)| (a.clone(), list.iter().map(|(b, w, _)| (b.clone(), *w)).collect())).collect()
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

/// Each linked pair once, by index into `songs`, with its weight.
pub(crate) fn edges_of(songs: &[String], links: &BTreeMap<String, Vec<(String, f64)>>) -> Vec<(usize, usize, f64)> {
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
    edges
}

/// Steps for a library of `n` songs: all of `steps` up to 2 000 songs, fewer beyond (by the square
/// root, at least `floor`): a step costs more as islands grow dense, and a large map settles enough
/// in fewer (20 000 songs: 7.7 s at 300 steps).
fn scaled(steps: usize, n: usize, floor: usize) -> usize {
    ((steps as f64 * (2000.0 / n.max(1) as f64).sqrt().min(1.0)) as usize).max(floor)
}

/// Islands pull their songs towards their middle this hard, and push apart where they overlap (each
/// a disc of about its songs' area, plus a shore), so they read as land masses rather than
/// interleaved colours (PLAN/17 D6).
const COHESION: f64 = 0.015;
const ISLAND_SHORE: f64 = 1.5;
const ISLANDS_APART: f64 = 0.15;

/// Each song's island and the loose group's number, for an island-aware layout.
pub type Groups<'a> = (&'a [usize], Option<usize>);

/// Where songs were (0..1) and the layout units per map width they were drawn at.
pub type Previous<'a> = (&'a HashMap<String, (f64, f64)>, f64);

/// Positions in 0..1 for `songs`, from their links, and the layout units per map width: springs
/// pull linked songs together, nearby songs push apart (only within neighbouring grid cells, so a
/// pass is linear), and a weak pull keeps everything near the middle. Deterministic for the same
/// inputs. With `previous`, songs start where they were (new ones beside their placed neighbours)
/// and a few gentle steps settle the change: the map keeps its shape.
pub fn layout(
    songs: &[String],
    links: &BTreeMap<String, Vec<(String, f64)>>,
    previous: Option<Previous<'_>>,
    groups: Option<Groups<'_>>,
) -> (Vec<(f64, f64)>, f64) {
    let n = songs.len();
    if n == 0 {
        return (Vec::new(), 1.0);
    }
    let edges = edges_of(songs, links);
    let side = (n as f64).sqrt();
    let mut random = Random(SEED);
    let mut pos: Vec<(f64, f64)> = (0..n).map(|_| (random.next() * side, random.next() * side)).collect();
    let ideal = 1.0;
    let cell = 2.0 * ideal;

    // From the previous map: its songs where they were, in its own units.
    let previous = previous.filter(|(p, span)| !p.is_empty() && *span > 0.0);
    let mut placed = vec![false; n];
    let (iterations, centre) = if let Some((prev, span)) = previous {
        for (i, song) in songs.iter().enumerate() {
            if let Some(&(x, y)) = prev.get(song) {
                pos[i] = (x * span, y * span);
                placed[i] = true;
            }
        }
        for i in 0..n {
            if placed[i] {
                continue;
            }
            let near: Vec<(f64, f64)> = links
                .get(&songs[i])
                .into_iter()
                .flatten()
                .filter_map(|(b, _)| prev.get(b))
                .map(|&(x, y)| (x * span, y * span))
                .collect();
            if !near.is_empty() {
                let k = near.len() as f64;
                let (sx, sy) = near.iter().fold((0.0, 0.0), |(a, b), p| (a + p.0, b + p.1));
                pos[i] = (sx / k + (random.next() - 0.5) * 0.5, sy / k + (random.next() - 0.5) * 0.5);
            } else {
                pos[i] = (random.next() * span, random.next() * span);
            }
        }
        (scaled(SETTLE_ITERATIONS, n, 15), span / 2.0)
    } else {
        (scaled(ITERATIONS, n, 90), side / 2.0)
    };

    for step in 0..iterations {
        let cooling = 1.0 - step as f64 / iterations as f64;
        let max_move = 0.05 + side * 0.1 * cooling;
        let mut force = vec![(0.0f64, 0.0f64); n];

        // Repulsion within the 3x3 neighbouring cells, on a flat grid (nodes in index order, so the
        // result is the same every time; a hash map of cells made this 25 ms a step at 20 000).
        let (min_x, min_y) = pos.iter().fold((f64::MAX, f64::MAX), |(a, b), p| (a.min(p.0), b.min(p.1)));
        let cell_of = |p: &(f64, f64)| (((p.0 - min_x) / cell) as usize, ((p.1 - min_y) / cell) as usize);
        let (mut cols, mut rows) = (1, 1);
        for p in &pos {
            let (cx, cy) = cell_of(p);
            cols = cols.max(cx + 1);
            rows = rows.max(cy + 1);
        }
        let mut start = vec![0usize; cols * rows + 1];
        let cells: Vec<usize> = pos
            .iter()
            .map(|p| {
                let (cx, cy) = cell_of(p);
                cy * cols + cx
            })
            .collect();
        for &c in &cells {
            start[c + 1] += 1;
        }
        for c in 0..cols * rows {
            start[c + 1] += start[c];
        }
        let mut fill = start.clone();
        let mut members = vec![0usize; n];
        for (i, &c) in cells.iter().enumerate() {
            members[fill[c]] = i;
            fill[c] += 1;
        }
        for i in 0..n {
            let (cx, cy) = (cells[i] % cols, cells[i] / cols);
            for ny in cy.saturating_sub(1)..=(cy + 1).min(rows - 1) {
                for nx in cx.saturating_sub(1)..=(cx + 1).min(cols - 1) {
                    let c = ny * cols + nx;
                    for &j in &members[start[c]..start[c + 1]] {
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
        // Islands: each song towards its island's middle, and the islands apart from each other.
        if let Some((group, loose)) = groups {
            let count = group.iter().max().map_or(0, |m| m + 1);
            let mut middle = vec![(0.0f64, 0.0f64, 0usize); count];
            for (i, &g) in group.iter().enumerate() {
                middle[g].0 += pos[i].0;
                middle[g].1 += pos[i].1;
                middle[g].2 += 1;
            }
            for m in &mut middle {
                let n = m.2.max(1) as f64;
                m.0 /= n;
                m.1 /= n;
            }
            let mut push = vec![(0.0f64, 0.0f64); count];
            for a in 0..count {
                if Some(a) == loose || middle[a].2 < MIN_ISLAND {
                    continue;
                }
                for b in a + 1..count {
                    if Some(b) == loose || middle[b].2 < MIN_ISLAND {
                        continue;
                    }
                    let (x, y) = (middle[a].0 - middle[b].0, middle[a].1 - middle[b].1);
                    let d = (x * x + y * y).sqrt().max(1e-6);
                    let (na, nb) = (middle[a].2 as f64, middle[b].2 as f64);
                    let overlap = 0.6 * (na.sqrt() + nb.sqrt()) + ISLAND_SHORE - d;
                    if overlap <= 0.0 {
                        continue;
                    }
                    // The smaller island gives way more.
                    let (ux, uy) = (x / d * overlap * ISLANDS_APART, y / d * overlap * ISLANDS_APART);
                    push[a].0 += ux * nb / (na + nb);
                    push[a].1 += uy * nb / (na + nb);
                    push[b].0 -= ux * na / (na + nb);
                    push[b].1 -= uy * na / (na + nb);
                }
            }
            for (i, &g) in group.iter().enumerate() {
                if Some(g) == loose {
                    continue;
                }
                force[i].0 += (middle[g].0 - pos[i].0) * COHESION + push[g].0;
                force[i].1 += (middle[g].1 - pos[i].1) * COHESION + push[g].1;
            }
        }
        // A weak pull to the middle keeps islands on the map. Placed songs only settle.
        for (i, p) in pos.iter_mut().enumerate() {
            let (fx, fy) = (force[i].0 + (centre - p.0) * 0.01, force[i].1 + (centre - p.1) * 0.01);
            let len = (fx * fx + fy * fy).sqrt();
            let limit = if placed[i] { SETTLE_MOVE } else { max_move };
            let scale = if len > limit { limit / len } else { 1.0 };
            p.0 += fx * scale;
            p.1 += fy * scale;
        }
    }

    if let Some((_, span)) = previous {
        // The previous frame: nothing rescales, so nothing moves but what settled.
        return (
            pos.into_iter().map(|(x, y)| ((x / span).clamp(0.0, 1.0), (y / span).clamp(0.0, 1.0))).collect(),
            span,
        );
    }
    let (min_x, max_x) = pos.iter().fold((f64::MAX, f64::MIN), |(a, b), p| (a.min(p.0), b.max(p.0)));
    let (min_y, max_y) = pos.iter().fold((f64::MAX, f64::MIN), |(a, b), p| (a.min(p.1), b.max(p.1)));
    let span = (max_x - min_x).max(max_y - min_y).max(1e-9);
    // Square, centred: the map keeps its proportions.
    let (off_x, off_y) = ((span - (max_x - min_x)) / 2.0, (span - (max_y - min_y)) / 2.0);
    (pos.into_iter().map(|(x, y)| ((x - min_x + off_x) / span, (y - min_y + off_y) / span)).collect(), span)
}

/// Communities of the link graph (Louvain: local moves, then the communities as nodes, until
/// nothing moves). Deterministic: nodes in index order, ties to the lowest community. One id per
/// song, numbered by size, largest first; communities smaller than [`MIN_ISLAND`] join the one
/// they link to most, and what is still smaller forms one loose group, numbered last (its number is
/// returned too).
pub fn communities(n: usize, edges: &[(usize, usize, f64)]) -> (Vec<usize>, Option<usize>) {
    let mut membership: Vec<usize> = (0..n).collect();
    let mut nodes = n;
    let mut graph: Vec<(usize, usize, f64)> = edges.to_vec();
    for _level in 0..10 {
        let mut adj: Vec<Vec<(usize, f64)>> = vec![Vec::new(); nodes];
        let mut k = vec![0.0f64; nodes];
        for &(a, b, w) in &graph {
            if a == b {
                k[a] += 2.0 * w;
            } else {
                adj[a].push((b, w));
                adj[b].push((a, w));
                k[a] += w;
                k[b] += w;
            }
        }
        let m2: f64 = k.iter().sum();
        if m2 <= 0.0 {
            break;
        }
        let mut comm: Vec<usize> = (0..nodes).collect();
        let mut tot = k.clone();
        let mut moved_any = false;
        let mut towards: BTreeMap<usize, f64> = BTreeMap::new();
        for _pass in 0..20 {
            let mut moved = false;
            for i in 0..nodes {
                let own = comm[i];
                tot[own] -= k[i];
                towards.clear();
                for &(j, w) in &adj[i] {
                    *towards.entry(comm[j]).or_insert(0.0) += w;
                }
                let gain = |c: usize, w: f64| w - tot[c] * k[i] / m2;
                let mut best = own;
                let mut best_gain = gain(own, towards.get(&own).copied().unwrap_or(0.0));
                for (&c, &w) in &towards {
                    let g = gain(c, w);
                    if g > best_gain + 1e-12 {
                        best = c;
                        best_gain = g;
                    }
                }
                tot[best] += k[i];
                if best != own {
                    comm[i] = best;
                    moved = true;
                    moved_any = true;
                }
            }
            if !moved {
                break;
            }
        }
        let mut renumber: HashMap<usize, usize> = HashMap::new();
        for &c in &comm {
            let next = renumber.len();
            renumber.entry(c).or_insert(next);
        }
        let count = renumber.len();
        for m in membership.iter_mut() {
            *m = renumber[&comm[*m]];
        }
        if !moved_any || count == nodes {
            break;
        }
        let mut merged: BTreeMap<(usize, usize), f64> = BTreeMap::new();
        for &(a, b, w) in &graph {
            let (ca, cb) = (renumber[&comm[a]], renumber[&comm[b]]);
            *merged.entry(if ca <= cb { (ca, cb) } else { (cb, ca) }).or_insert(0.0) += w;
        }
        graph = merged.into_iter().map(|((a, b), w)| (a, b, w)).collect();
        nodes = count;
    }

    // Small ones join the community they link to most (once, largest first).
    let mut size: HashMap<usize, usize> = HashMap::new();
    for &m in &membership {
        *size.entry(m).or_insert(0) += 1;
    }
    let mut small: Vec<usize> = size.iter().filter(|(_, s)| **s < MIN_ISLAND).map(|(c, _)| *c).collect();
    small.sort_unstable();
    for c in small {
        let mut towards: BTreeMap<usize, f64> = BTreeMap::new();
        for &(a, b, w) in edges {
            let (ca, cb) = (membership[a], membership[b]);
            if ca == c && cb != c {
                *towards.entry(cb).or_insert(0.0) += w;
            } else if cb == c && ca != c {
                *towards.entry(ca).or_insert(0.0) += w;
            }
        }
        if let Some((&to, _)) = towards.iter().max_by(|x, y| x.1.total_cmp(y.1).then_with(|| y.0.cmp(x.0))) {
            membership.iter_mut().filter(|m| **m == c).for_each(|m| *m = to);
        }
    }

    // Largest first; ties by the first member.
    let mut members: HashMap<usize, (usize, usize)> = HashMap::new();
    for (i, &m) in membership.iter().enumerate() {
        let entry = members.entry(m).or_insert((0, i));
        entry.0 += 1;
    }
    let mut order: Vec<(usize, usize, usize)> = members.into_iter().map(|(c, (s, first))| (c, s, first)).collect();
    order.sort_by(|a, b| b.1.cmp(&a.1).then(a.2.cmp(&b.2)));
    // What is still smaller (songs with no links, pairs linked only to each other) is one loose
    // group, numbered last: not an island one could name.
    let islands = order.iter().filter(|o| o.1 >= MIN_ISLAND).count();
    let rank: HashMap<usize, usize> =
        order.iter().enumerate().map(|(r, (c, size, _))| (*c, if *size >= MIN_ISLAND { r } else { islands })).collect();
    let loose = (islands < order.len()).then_some(islands);
    (membership.iter().map(|m| rank[m]).collect(), loose)
}

/// The user's names for islands: for each island (its songs), the name whose songs it shares most
/// with, if they share at least [`NAME_MATCH`] (Jaccard); each name goes to one island at most.
pub fn match_names(islands: &[Vec<&str>], named: &[(String, Vec<String>)]) -> Vec<Option<String>> {
    let mut out = vec![None; islands.len()];
    let mut taken = vec![false; islands.len()];
    let sets: Vec<HashSet<&str>> = islands.iter().map(|s| s.iter().copied().collect()).collect();
    let mut scored: Vec<(f64, usize, usize)> = Vec::new();
    for (n, (_, songs)) in named.iter().enumerate() {
        let theirs: HashSet<&str> = songs.iter().map(String::as_str).collect();
        for (i, ours) in sets.iter().enumerate() {
            let both = ours.intersection(&theirs).count();
            if both == 0 {
                continue;
            }
            let jaccard = both as f64 / (ours.len() + theirs.len() - both) as f64;
            if jaccard >= NAME_MATCH {
                scored.push((jaccard, n, i));
            }
        }
    }
    scored.sort_by(|a, b| b.0.total_cmp(&a.0).then(a.1.cmp(&b.1)).then(a.2.cmp(&b.2)));
    let mut used = vec![false; named.len()];
    for (_, n, i) in scored {
        if !used[n] && !taken[i] {
            out[i] = Some(named[n].0.clone());
            used[n] = true;
            taken[i] = true;
        }
    }
    out
}

fn stored_names(db: &Db) -> crate::Result<Vec<(String, Vec<String>)>> {
    let value = crate::settings::device(db, ISLAND_NAMES)?.unwrap_or_default();
    Ok(value
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|e| {
            let name = e["name"].as_str()?.to_owned();
            let songs = e["songs"].as_array()?.iter().filter_map(|s| s.as_str().map(str::to_owned)).collect();
            Some((name, songs))
        })
        .collect())
}

/// Names island `island` of `map` (an empty name gives the automatic one back).
pub fn rename(db: &Db, map: &TasteMap, island: usize, name: &str) -> crate::Result<()> {
    let songs: Vec<&str> = map.points.iter().filter(|p| p.island == island).map(|p| p.song_id.as_str()).collect();
    let mut named = stored_names(db)?;
    // Whatever name this island carries now goes.
    let current = match_names(std::slice::from_ref(&songs), &named);
    if let Some(old) = &current[0] {
        named.retain(|(n, _)| n != old);
    }
    let name = name.trim();
    if !name.is_empty() {
        named.retain(|(n, _)| n != name);
        named.push((name.to_owned(), songs.iter().map(|s| (*s).to_owned()).collect()));
    }
    let value: Vec<serde_json::Value> =
        named.into_iter().map(|(name, songs)| serde_json::json!({ "name": name, "songs": songs })).collect();
    crate::settings::set_device(db, ISLAND_NAMES, &serde_json::Value::Array(value))
}

/// The automatic name of an island from its songs' first artists: the leading artist when it holds
/// 30 % of the island, else the two leading ones when they hold 40 %.
fn auto_name(artists: &[Option<&str>]) -> Option<String> {
    let mut counts: BTreeMap<&str, usize> = BTreeMap::new();
    for a in artists.iter().flatten() {
        *counts.entry(a).or_insert(0) += 1;
    }
    let mut ranked: Vec<(&str, usize)> = counts.into_iter().collect();
    ranked.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(b.0)));
    let n = artists.len().max(1) as f64;
    match ranked.as_slice() {
        [(a, x), ..] if *x as f64 >= 0.3 * n => Some((*a).to_owned()),
        [(a, x), (b, y), ..] if (*x + *y) as f64 >= 0.4 * n => Some(format!("{a} & {b}")),
        _ => None,
    }
}

/// A path through the map from `from` to `to`, about `length` songs, no song twice: the shortest
/// walk along links (each step costs its distance on the map), then widened with neighbours of the
/// songs on it, nearest to the way, until it is long enough. Empty when either song is not on the
/// map or no links join them.
pub fn journey(map: &TasteMap, from: &str, to: &str, length: usize) -> Vec<String> {
    let index: HashMap<&str, usize> = map.points.iter().enumerate().map(|(i, p)| (p.song_id.as_str(), i)).collect();
    let (Some(&a), Some(&b)) = (index.get(from), index.get(to)) else { return Vec::new() };
    let n = map.points.len();
    let mut adj: Vec<Vec<usize>> = vec![Vec::new(); n];
    for (i, p) in map.points.iter().enumerate() {
        for other in &p.neighbours {
            if let Some(&j) = index.get(other.as_str()) {
                adj[i].push(j);
                adj[j].push(i);
            }
        }
    }
    for list in &mut adj {
        list.sort_unstable();
        list.dedup();
    }
    let dist = |i: usize, j: usize| {
        let (p, q) = (&map.points[i], &map.points[j]);
        ((p.x - q.x).powi(2) + (p.y - q.y).powi(2)).sqrt() + 0.01
    };
    // Dijkstra on distances (as ordered integers for the heap).
    let mut best = vec![u64::MAX; n];
    let mut back = vec![usize::MAX; n];
    let mut heap = BinaryHeap::new();
    best[a] = 0;
    heap.push(std::cmp::Reverse((0u64, a)));
    while let Some(std::cmp::Reverse((d, i))) = heap.pop() {
        if d > best[i] {
            continue;
        }
        if i == b {
            break;
        }
        for &j in &adj[i] {
            let nd = d + (dist(i, j) * 1e9) as u64;
            if nd < best[j] {
                best[j] = nd;
                back[j] = i;
                heap.push(std::cmp::Reverse((nd, j)));
            }
        }
    }
    if best[b] == u64::MAX {
        return Vec::new();
    }
    let mut path = vec![b];
    while *path.last().unwrap_or(&a) != a {
        path.push(back[*path.last().unwrap_or(&a)]);
    }
    path.reverse();
    let mut used: HashSet<usize> = path.iter().copied().collect();
    // Widen: a neighbour of a song on the way, nearest the middle of it and the next one.
    while path.len() < length {
        let mut grew = false;
        let mut i = 0;
        while i + 1 < path.len() && path.len() < length {
            let (p, q) = (&map.points[path[i]], &map.points[path[i + 1]]);
            let mid = ((p.x + q.x) / 2.0, (p.y + q.y) / 2.0);
            let pick = adj[path[i]].iter().copied().filter(|j| !used.contains(j)).min_by(|x, y| {
                let d = |j: usize| (map.points[j].x - mid.0).powi(2) + (map.points[j].y - mid.1).powi(2);
                d(*x).total_cmp(&d(*y)).then(x.cmp(y))
            });
            if let Some(j) = pick {
                path.insert(i + 1, j);
                used.insert(j);
                grew = true;
                i += 2;
            } else {
                i += 1;
            }
        }
        if !grew {
            break;
        }
    }
    path.into_iter().map(|i| map.points[i].song_id.clone()).collect()
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

/// The inputs from the database: every song with a variant, plays heard (not browsed, PLAN/16),
/// artists and tierlists.
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
    let classified = crate::listening::Classified::load(conn, i64::MIN)?;
    let plays: Vec<(String, i64)> =
        classified.heard().map(|i| (classified.plays[i].song_id.clone(), classified.plays[i].started_at)).collect();
    let tiers = crate::shuffle::stored_tierlists(db)?.into_iter().flat_map(|t| t.tiers).collect();
    Ok(Inputs { songs, artists, plays, tiers })
}

/// The map of the library: its layout, links and islands. `cached` is a previous map: when its hash
/// matches it is reused; otherwise, unless `fresh`, the new layout starts from its positions.
/// [`annotate`] fills what changes with every read.
pub fn build(db: &Db, cached: Option<&TasteMap>, fresh: bool) -> crate::Result<TasteMap> {
    let inputs = stored_inputs(db)?;
    let linked = links(&inputs);
    let links = plain(&linked);
    let hash = hash(&inputs.songs, &links);
    if !fresh
        && let Some(map) = cached
        && map.hash == hash
    {
        return Ok(map.clone());
    }
    let previous: Option<(HashMap<String, (f64, f64)>, f64)> = if fresh {
        None
    } else {
        cached
            .filter(|m| m.span > 0.0)
            .map(|m| (m.points.iter().map(|p| (p.song_id.clone(), (p.x, p.y))).collect(), m.span))
    };
    let (island_of, loose) = communities(inputs.songs.len(), &edges_of(&inputs.songs, &links));
    let (positions, span) =
        layout(&inputs.songs, &links, previous.as_ref().map(|(p, s)| (p, *s)), Some((&island_of, loose)));

    let points: Vec<Point> = inputs
        .songs
        .iter()
        .zip(positions)
        .zip(&island_of)
        .map(|((song, (x, y)), &island)| {
            let list = linked.get(song);
            Point {
                song_id: song.clone(),
                x,
                y,
                weight: 0.0,
                title: String::new(),
                artist: None,
                tone: None,
                neighbours: list.map(|l| l.iter().map(|(id, _, _)| id.clone()).collect()).unwrap_or_default(),
                link_kinds: list.map(|l| l.iter().map(|(_, _, k)| *k).collect()).unwrap_or_default(),
                island,
                plays: 0,
                heard_ms: 0,
                last_day: None,
                tier: None,
                tier_value: None,
                energy: None,
            }
        })
        .collect();
    let count = island_of.iter().max().map_or(0, |m| m + 1);
    let mut islands: Vec<Island> = (0..count)
        .map(|id| Island { id, name: None, user_name: None, size: 0, x: 0.0, y: 0.0, loose: false })
        .collect();
    if let Some(island) = loose.and_then(|l| islands.get_mut(l)) {
        island.loose = true;
    }
    for p in &points {
        let island = &mut islands[p.island];
        island.size += 1;
        island.x += p.x;
        island.y += p.y;
    }
    for island in &mut islands {
        let n = island.size.max(1) as f64;
        island.x /= n;
        island.y /= n;
    }
    Ok(TasteMap { points, islands, plays: inputs.plays.len(), hash, span })
}

/// Fills what changes with every read: each song's title, artist and tint, its Smart Shuffle
/// `weights` (as the shuffle runs now) over the largest, plays, time heard, last heard day, best
/// tier and energy; each island's automatic and user names.
pub fn annotate(db: &Db, map: &mut TasteMap, weights: &HashMap<String, f64>) -> crate::Result<()> {
    let now = crate::db::now_ms();
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
        if facts.contains_key(&song) {
            continue;
        }
        let tone = palette.and_then(|p| serde_json::from_str::<serde_json::Value>(&p).ok()).and_then(|p| {
            ["Vibrant", "DarkVibrant", "Muted"].iter().find_map(|k| p[k]["hex"].as_str().map(str::to_owned))
        });
        facts.insert(song, (title, artist, tone));
    }
    let mut totals: HashMap<String, (i64, i64)> = HashMap::new();
    let mut stmt = db.conn().prepare("SELECT song_id, plays, heard_ms FROM song_totals")?;
    for row in stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?)))? {
        let (song, plays, heard) = row?;
        totals.insert(song, (plays, heard));
    }
    let last_days = crate::shuffle::Listening::load(db, now)?.last_days(db)?;
    let energy = crate::features::energy(db)?;
    // Best placement per song among the tierlists that influence the shuffle.
    let mut tiers: HashMap<String, (f64, String)> = HashMap::new();
    for (_, doc) in crate::playlists::tierlists(db)? {
        let tierlist = crate::shuffle::tierlist_of(&doc);
        if !tierlist.influences_shuffle {
            continue;
        }
        let total = tierlist.tiers.len();
        for (index, tier) in tierlist.tiers.iter().enumerate() {
            let value = crate::shuffle::tier_value(index, total);
            let name = doc["tiers"][index]["name"].as_str().unwrap_or("").to_owned();
            for id in tier {
                if tiers.get(id).is_none_or(|t| value > t.0) {
                    tiers.insert(id.clone(), (value, name.clone()));
                }
            }
        }
    }
    let max = weights.values().copied().fold(0.0, f64::max).max(1e-9);
    for p in &mut map.points {
        let (title, artist, tone) = facts.get(&p.song_id).cloned().unwrap_or_default();
        p.title = title;
        p.artist = artist;
        p.tone = tone;
        p.weight = weights.get(&p.song_id).copied().unwrap_or(0.0) / max;
        let (plays, heard) = totals.get(&p.song_id).copied().unwrap_or((0, 0));
        p.plays = plays;
        p.heard_ms = heard;
        p.last_day = last_days.get(&p.song_id).copied();
        let tier = tiers.get(&p.song_id);
        p.tier = tier.map(|t| t.1.clone());
        p.tier_value = tier.map(|t| t.0);
        p.energy = energy.get(&p.song_id).copied();
    }
    let named = stored_names(db)?;
    let mut members: Vec<Vec<&str>> = vec![Vec::new(); map.islands.len()];
    let mut artists: Vec<Vec<Option<&str>>> = vec![Vec::new(); map.islands.len()];
    for p in &map.points {
        if let Some(list) = members.get_mut(p.island) {
            list.push(&p.song_id);
            artists[p.island].push(p.artist.as_deref());
        }
    }
    let user = match_names(&members, &named);
    let auto: Vec<Option<String>> = artists.iter().map(|a| auto_name(a)).collect();
    for (island, (user, auto)) in map.islands.iter_mut().zip(user.into_iter().zip(auto)) {
        island.user_name = if island.loose { None } else { user };
        island.name = if island.loose { None } else { auto };
    }
    Ok(())
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

    /// A map of `inputs` as `build` makes it, without a database.
    fn map_of(inputs: &Inputs, previous: Option<&TasteMap>) -> TasteMap {
        let linked = links(inputs);
        let plain = plain(&linked);
        let prev: Option<(HashMap<String, (f64, f64)>, f64)> =
            previous.map(|m| (m.points.iter().map(|p| (p.song_id.clone(), (p.x, p.y))).collect(), m.span));
        let (island, loose) = communities(inputs.songs.len(), &edges_of(&inputs.songs, &plain));
        let (pos, span) = layout(&inputs.songs, &plain, prev.as_ref().map(|(p, s)| (p, *s)), Some((&island, loose)));
        let points = inputs
            .songs
            .iter()
            .enumerate()
            .map(|(i, s)| Point {
                song_id: s.clone(),
                x: pos[i].0,
                y: pos[i].1,
                weight: 0.0,
                title: String::new(),
                artist: None,
                tone: None,
                neighbours: linked.get(s).map(|l| l.iter().map(|(b, _, _)| b.clone()).collect()).unwrap_or_default(),
                link_kinds: linked.get(s).map(|l| l.iter().map(|(_, _, k)| *k).collect()).unwrap_or_default(),
                island: island[i],
                plays: 0,
                heard_ms: 0,
                last_day: None,
                tier: None,
                tier_value: None,
                energy: None,
            })
            .collect();
        TasteMap { points, islands: Vec::new(), plays: inputs.plays.len(), hash: hash(&inputs.songs, &plain), span }
    }

    #[test]
    fn the_same_inputs_draw_the_same_map() {
        let inputs = two_habits();
        let links = neighbours(&inputs);
        assert_eq!(layout(&inputs.songs, &links, None, None), layout(&inputs.songs, &links, None, None));
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
        let pos = layout(&inputs.songs, &links, None, None).0;
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
    fn artists_and_tiers_link_without_plays_and_say_so() {
        let songs = ids(4);
        let artists = [(songs[0].clone(), vec!["x".to_owned()]), (songs[1].clone(), vec!["x".to_owned()])].into();
        let tiers = vec![vec![songs[2].clone(), songs[3].clone()]];
        let inputs = Inputs { songs: songs.clone(), artists, plays: Vec::new(), tiers };
        let links = neighbours(&inputs);
        assert_eq!(links[&songs[0]][0].0, songs[1]);
        assert_eq!(links[&songs[2]][0].0, songs[3]);
        assert_eq!(links[&songs[0]].len(), 1);
        let kinds = super::links(&inputs);
        assert_eq!(kinds[&songs[0]][0].2, LINK_ARTIST);
        assert_eq!(kinds[&songs[2]][0].2, LINK_TIER);
    }

    #[test]
    fn a_new_play_moves_no_song_far() {
        let inputs = two_habits();
        let before = map_of(&inputs, None);
        // One more evening: a few songs of each habit heard together.
        let mut more = inputs.clone();
        let at = more.plays.last().unwrap().1 + 86_400_000;
        for (k, i) in [3, 25, 7, 31].into_iter().enumerate() {
            more.plays.push((inputs.songs[i].clone(), at + k as i64 * 240_000));
        }
        let after = map_of(&more, Some(&before));
        assert_ne!(before.hash, after.hash);
        let moved = before
            .points
            .iter()
            .zip(&after.points)
            .map(|(a, b)| ((a.x - b.x).powi(2) + (a.y - b.y).powi(2)).sqrt())
            .fold(0.0, f64::max);
        assert!(moved < 0.08, "a song moved {moved}");
        // A fresh layout of the same inputs is free to move everything.
        let fresh = map_of(&more, None);
        assert_eq!(fresh.points.len(), after.points.len());
    }

    #[test]
    fn islands_never_mix_the_two_habits_and_are_the_same_every_time() {
        let inputs = two_habits();
        let links = neighbours(&inputs);
        let edges = edges_of(&inputs.songs, &links);
        let (a, loose) = communities(40, &edges);
        assert_eq!(a, communities(40, &edges).0);
        assert_eq!(loose, None);
        // No island mixes the two habits, and none is a crumb.
        let first: HashSet<usize> = a[..20].iter().copied().collect();
        let second: HashSet<usize> = a[20..].iter().copied().collect();
        assert!(first.is_disjoint(&second), "{a:?}");
        for c in first.union(&second) {
            assert!(a.iter().filter(|x| *x == c).count() >= MIN_ISLAND, "{a:?}");
        }
    }

    #[test]
    fn a_renamed_island_keeps_its_name_after_a_rebuild() {
        let named = vec![("Night drive".to_owned(), ids(10))];
        // The island grew by two songs and lost one: still the same island.
        let mut grown: Vec<String> = ids(12).into_iter().skip(1).collect();
        grown.push("s099".into());
        let other: Vec<String> = (50..60).map(|i| format!("s{i:03}")).collect();
        let islands: Vec<Vec<&str>> =
            vec![other.iter().map(String::as_str).collect(), grown.iter().map(String::as_str).collect()];
        assert_eq!(match_names(&islands, &named), [None, Some("Night drive".to_owned())]);
        // A different island does not take it.
        let islands: Vec<Vec<&str>> = vec![other.iter().map(String::as_str).collect()];
        assert_eq!(match_names(&islands, &named), [None]);
    }

    #[test]
    fn an_island_is_named_after_its_leading_artists() {
        assert_eq!(auto_name(&[Some("A"), Some("A"), Some("B"), None]), Some("A".to_owned()));
        assert_eq!(
            auto_name(&[Some("A"), Some("B"), Some("C"), Some("D"), Some("E"), Some("A"), Some("B"), None, None, None]),
            Some("A & B".to_owned())
        );
        assert_eq!(auto_name(&[Some("A"), Some("B"), Some("C"), Some("D"), Some("E"), Some("F")]), None);
    }

    #[test]
    fn a_journey_starts_and_ends_where_asked_on_linked_songs() {
        let inputs = two_habits();
        let map = map_of(&inputs, None);
        // Join the habits with one evening, so a way exists.
        let (from, to) = ("s002", "s033");
        let mut joined = inputs.clone();
        let at = joined.plays.last().unwrap().1 + 86_400_000;
        for (k, s) in ["s010", "s030"].into_iter().enumerate() {
            joined.plays.push((s.into(), at + k as i64 * 240_000));
        }
        let map = map_of(&joined, Some(&map));
        let way = journey(&map, from, to, 15);
        assert_eq!(way.first().map(String::as_str), Some(from));
        assert_eq!(way.last().map(String::as_str), Some(to));
        assert!(way.len() >= 10 && way.len() <= 15, "{}", way.len());
        let unique: HashSet<&String> = way.iter().collect();
        assert_eq!(unique.len(), way.len());
        let linked = |a: &str, b: &str| {
            let of = |s: &str| map.points.iter().find(|p| p.song_id == s).unwrap();
            of(a).neighbours.iter().any(|n| n == b) || of(b).neighbours.iter().any(|n| n == a)
        };
        for k in 1..way.len() {
            assert!(
                linked(&way[k - 1], &way[k]) || (k + 1 < way.len() && linked(&way[k], &way[k + 1])),
                "{} is linked to neither side",
                way[k]
            );
        }
        assert!(journey(&map, from, "nowhere", 10).is_empty());
    }
}

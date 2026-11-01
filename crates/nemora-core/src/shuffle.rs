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
    /// 1 unless played recently: the push back of the recent list (by days with V1).
    pub freshness: f64,
    /// V2: up to 1.5 for the song of its tier that waited longest, 1 otherwise or when off.
    pub rotation: f64,
    /// V3: below 1 after several plays of its artist tonight, 1 otherwise or when off.
    pub fatigue: f64,
    /// M1: up to 1.6 for a loved song not heard for long or missed in Song Guessr, 1 otherwise.
    pub memory: f64,
    /// C1: 0.8..1.2 by how much of the song's listening falls in this part of the day, 1 otherwise.
    pub night: f64,
    /// How listening engages with the song (PLAN/15 L1), 0..1 around 0.5; None unless learning is on.
    pub engagement: Option<f64>,
    /// What the tierlist nudge added to the score (PLAN/15 F1), 0 when none.
    pub nudge: f64,
    /// L2: how sure the model is of this song, 0..1; None unless the adaptive model is on.
    pub confidence: Option<f64>,
    /// L2: how far this queue's draw strayed from the song's mean score (within +-0.15).
    pub explored: f64,
    /// The smart score before blending with randomness, the nudge (and L2's draw) included.
    pub score: f64,
}

/// A placed song below the unplaced median gains this share of the gap (PLAN/15 F1)...
pub const NUDGE_SHARE: f64 = 0.5;
/// ...and never more than this much score: placed songs keep a small edge, the other parts decide.
pub const NUDGE_MAX: f64 = 0.05;

/// How the model runs (PLAN/15). The default is the shuffle as shipped; [`Options::CLASSIC`] is
/// 3.0's model, which `tests/shuffle_oracle.rs` pins.
#[derive(Debug, Clone, Copy, PartialEq, serde::Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Options {
    /// F1: a placed song below the unplaced median is nudged up a little.
    pub nudge: bool,
    /// 3.0's skip-aware push back (C3 of PLAN/14).
    pub skip_aware: bool,
    /// L1: learn from how the user listens (own picks, replays, rewinds, scrub-then-skip).
    pub learn: bool,
    /// L2: a confidence per song, evidence weighed by its amount, exploration by sampling.
    pub adaptive: bool,
    /// L4: a skip followed by an own pick as a faint duel (for L2 only).
    pub implicit_duels: bool,
    /// V1: freshness measured in days instead of the last 50 songs.
    pub freshness_by_days: bool,
    /// V2: every song of a tier gets its turn.
    pub fair_rotation: bool,
    /// M1: loved songs not heard for long, or missed in Song Guessr, come up more.
    pub forgotten_favourites: bool,
    /// V3: many plays of one artist tonight slow the next.
    pub artist_fatigue: bool,
    /// C1: lean to what the user plays at this time of day.
    pub night: bool,
    /// C3: the next song leans to the taste map's neighbours of the current one.
    pub follow_map: bool,
    /// C2: the view orders the queue without jumps in energy (the core sends the numbers).
    pub energy_flow: bool,
}

impl Options {
    /// 3.0's model: none of PLAN/15's parts.
    pub const CLASSIC: Options = Options {
        nudge: false,
        skip_aware: false,
        learn: false,
        adaptive: false,
        implicit_duels: false,
        freshness_by_days: false,
        fair_rotation: false,
        forgotten_favourites: false,
        artist_fatigue: false,
        night: false,
        follow_map: false,
        energy_flow: false,
    };
}

impl Default for Options {
    /// As shipped: the new defaults on (PLAN/15, the user's choice), the extraordinary ones off.
    fn default() -> Self {
        Options {
            nudge: true,
            skip_aware: true,
            learn: true,
            adaptive: true,
            implicit_duels: true,
            freshness_by_days: true,
            fair_rotation: true,
            forgotten_favourites: true,
            ..Options::CLASSIC
        }
    }
}

/// What the database knows beyond [`Inputs`] (PLAN/15): kept apart so 3.0's inputs stay as they
/// were for the oracle and Rediscover.
#[derive(Debug, Clone, Default)]
pub struct Signals {
    /// `signals::engagement`, per song; a song missing from it is neutral.
    pub engagement: HashMap<String, f64>,
    /// V1: when each song last ended (recent weeks only), and the time to measure from.
    pub last_played: HashMap<String, i64>,
    pub now: i64,
    /// V2, V3: their factors per song; a song missing from them is at 1.
    pub rotation: HashMap<String, f64>,
    pub fatigue: HashMap<String, f64>,
    /// L2: listening evidence per song (own picks, replays, rewinds, scrub-skips, Guessr rounds).
    pub evidence: HashMap<String, f64>,
    /// L4: net faint duels per song (picked minus left) in the last 90 days.
    pub implicit: HashMap<String, f64>,
    /// L2: the draw's seed; the same for ten minutes, so a queue and its explanations agree.
    pub seed: u64,
    /// M1: days since each song was last heard (1.x history included), and its Song Guessr rounds
    /// (found, missed).
    pub days_unheard: HashMap<String, f64>,
    pub guessr: HashMap<String, (i64, i64)>,
    /// C1: each song's share of plays in the part of the day it is now (songs with enough plays).
    pub day_share: HashMap<String, f64>,
}

/// C1: a song (or failing that its artist) needs this many plays before its hours mean anything.
pub const NIGHT_MIN_PLAYS: u32 = 5;

/// C1: the factor of a song whose plays fall `share` (0..1) in the current quarter of the day.
pub fn night_factor(share: f64) -> f64 {
    0.8 + 0.4 * share.clamp(0.0, 1.0)
}

/// M1: a loved song unheard for this many days starts coming back...
pub const FORGOTTEN_AFTER_DAYS: f64 = 60.0;
/// ...reaching the full lift this many days later; and the most the lift reaches.
pub const FORGOTTEN_RAMP_DAYS: f64 = 120.0;
pub const FORGOTTEN_MAX: f64 = 1.6;

/// M1: the lift of a song that is loved (`loved`), by how long it went unheard and how often it was
/// missed in Song Guessr. Recognition is not liking: a miss only ever lifts, and only a loved song.
pub fn memory_factor(loved: bool, days_unheard: Option<f64>, guessr: (i64, i64)) -> f64 {
    if !loved {
        return 1.0;
    }
    let unheard = days_unheard.map_or(0.0, |d| ((d - FORGOTTEN_AFTER_DAYS) / FORGOTTEN_RAMP_DAYS).clamp(0.0, 1.0));
    let (found, missed) = guessr;
    let forgotten = if missed > found { (0.5 * (missed - found) as f64).min(1.0) } else { 0.0 };
    1.0 + (FORGOTTEN_MAX - 1.0) * unheard.max(forgotten)
}

/// L2: a draw strays at most this far from a song's mean score, and this is its spread when
/// nothing is known about the song.
pub const ADAPTIVE_SPREAD: f64 = 0.15;
/// L2: a song with 20 duels or more gets up to this much more of its ELO than 3.0's 10 %.
pub const ADAPTIVE_ELO: f64 = 0.15;
/// L4: one faint duel moves the mean this much (an eighth of a duel), all of them at most 0.05.
pub const IMPLICIT_STEP: f64 = 0.005;
pub const IMPLICIT_MAX: f64 = 0.05;
const DRAW_WINDOW_MS: i64 = 10 * 60_000;

/// A standard normal number for `song` under `seed` (SplitMix64, then Box-Muller): the same pair
/// always draws the same number.
fn draw(seed: u64, song: &str) -> f64 {
    let mut state =
        seed ^ song.bytes().fold(0xcbf2_9ce4_8422_2325u64, |h, b| (h ^ u64::from(b)).wrapping_mul(0x100_0000_01b3));
    let mut next = || {
        state = state.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = state;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        ((z ^ (z >> 31)) >> 11) as f64 / (1u64 << 53) as f64
    };
    let (u, v) = (next().max(1e-12), next());
    (-2.0 * u.ln()).sqrt() * (2.0 * std::f64::consts::PI * v).cos()
}

/// V1: the push back of a song heard `days` ago: x0.4 just after, half way back in about a day
/// and a half, gone in a week or two.
pub fn freshness_by_days(days: f64) -> f64 {
    1.0 - FRESHNESS_PENALTY * (-days.max(0.0) / 2.0).exp()
}
/// V2: the longest-waiting song of a tier gets up to this factor.
pub const ROTATION_MAX: f64 = 1.5;
/// V3: each play of an artist in the last few hours, on its other songs, and the floor.
pub const FATIGUE_STEP: f64 = 0.85;
pub const FATIGUE_FLOOR: f64 = 0.5;
const FATIGUE_WINDOW_MS: i64 = 6 * 3_600_000;

/// L1: engagement's share of the score; the 3.0 parts share the rest.
pub const ENGAGEMENT_SHARE: f64 = 0.1;

/// The parts of every target song (all songs when `targets` is empty), in target order.
pub fn parts(inputs: &Inputs<'_>, targets: &[String], options: &Options) -> Vec<(String, Parts)> {
    parts_with(inputs, targets, options, &Signals::default())
}

/// [`parts`] with what the database knows beyond the inputs.
pub fn parts_with(
    inputs: &Inputs<'_>,
    targets: &[String],
    options: &Options,
    signals: &Signals,
) -> Vec<(String, Parts)> {
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
    let freshness = |id: &str| {
        if options.freshness_by_days {
            return signals
                .last_played
                .get(id)
                .map_or(1.0, |&at| freshness_by_days((signals.now - at) as f64 / 86_400_000.0));
        }
        match recency.get(id) {
            Some(&i) if history_len > 0 => 1.0 - FRESHNESS_PENALTY * ((history_len - i) as f64 / history_len as f64),
            _ => 1.0,
        }
    };

    let has_elo = inputs.total_duels >= ELO_MIN_DUELS;
    let elo_score = |id: &str| match inputs.ratings.get(id) {
        Some(r) if r.games >= 1 => normalized_score(r),
        _ => 0.5,
    };
    let artists_of: HashMap<&str, &Vec<String>> = inputs.songs.iter().map(|(id, a)| (id.as_str(), a)).collect();

    let classic = |id: &str| {
        let t = song_tier.get(id).copied().unwrap_or(0.0);
        let mut a = 0.0f64;
        for artist in artists_of.get(id).copied().into_iter().flatten() {
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
        let mut score = match elo {
            Some(e) => 0.45 * t + 0.35 * a + 0.1 * e + 0.1 * l,
            None => 0.5 * t + 0.4 * a + 0.1 * l,
        };
        let engagement = options.learn.then(|| signals.engagement.get(id).copied().unwrap_or(0.5));
        if let Some(g) = engagement {
            score = (1.0 - ENGAGEMENT_SHARE) * score + ENGAGEMENT_SHARE * g;
        }
        Parts {
            tier: t,
            artist: a,
            elo,
            listens: l,
            engagement,
            freshness: freshness(id),
            rotation: if options.fair_rotation { signals.rotation.get(id).copied().unwrap_or(1.0) } else { 1.0 },
            fatigue: if options.artist_fatigue { signals.fatigue.get(id).copied().unwrap_or(1.0) } else { 1.0 },
            night: if options.night { night_factor(signals.day_share.get(id).copied().unwrap_or(0.25)) } else { 1.0 },
            memory: if options.forgotten_favourites {
                // Loved: placed in a tierlist, rated above neutral in duels, or listened to gladly.
                let loved = t > 0.0
                    || inputs.ratings.get(id).is_some_and(|r| r.games >= 1 && normalized_score(r) > 0.55)
                    || engagement.is_some_and(|g| g > 0.6);
                memory_factor(
                    loved,
                    signals.days_unheard.get(id).copied(),
                    signals.guessr.get(id).copied().unwrap_or((0, 0)),
                )
            } else {
                1.0
            },
            nudge: 0.0,
            confidence: None,
            explored: 0.0,
            score,
        }
    };

    // The unplaced median: what a song nobody put in an influencing tierlist typically scores.
    let unplaced_median = options
        .nudge
        .then(|| {
            let mut scores: Vec<f64> = inputs
                .songs
                .iter()
                .filter(|(id, _)| !song_tier.contains_key(id))
                .map(|(id, _)| classic(id).score)
                .collect();
            if scores.is_empty() {
                return None;
            }
            let middle = scores.len() / 2;
            let (_, median, _) = scores.select_nth_unstable_by(middle, f64::total_cmp);
            Some(*median)
        })
        .flatten();

    targets
        .iter()
        .map(|id| {
            let mut p = classic(id);
            if let Some(median) = unplaced_median
                && song_tier.contains_key(id)
                && p.score < median
            {
                p.nudge = (NUDGE_SHARE * (median - p.score)).min(NUDGE_MAX);
                p.score += p.nudge;
            }
            if options.adaptive {
                // The mean starts at the score above; duels weigh by their number, faint duels a
                // little; then a draw around the mean, wide when little is known.
                let games = inputs.ratings.get(id).map_or(0, |r| r.games);
                let duels = match (has_elo, inputs.ratings.get(id)) {
                    (true, Some(r)) if r.games >= 1 => {
                        ADAPTIVE_ELO * (games.min(20) as f64 / 20.0) * (normalized_score(r) - 0.5)
                    }
                    _ => 0.0,
                };
                let implicit = if options.implicit_duels {
                    (IMPLICIT_STEP * signals.implicit.get(id).copied().unwrap_or(0.0))
                        .clamp(-IMPLICIT_MAX, IMPLICIT_MAX)
                } else {
                    0.0
                };
                let mean = (p.score + duels + implicit).clamp(0.0, 1.0);
                let known = inputs.full_listens.get(id).copied().unwrap_or(0) as f64
                    + games as f64
                    + signals.evidence.get(id).copied().unwrap_or(0.0)
                    + if song_tier.contains_key(id) { 3.0 } else { 0.0 };
                let spread = ADAPTIVE_SPREAD / (1.0 + known / 3.0).sqrt();
                p.explored = (draw(signals.seed, id) * spread).clamp(-ADAPTIVE_SPREAD, ADAPTIVE_SPREAD);
                p.confidence = Some(1.0 - spread / ADAPTIVE_SPREAD);
                p.score = (mean + p.explored).clamp(0.0, 1.0);
            }
            (id.clone(), p)
        })
        .collect()
}

/// The weight of a song with these parts at this intensity, in [0.001 .. 1].
pub fn weight_of(parts: &Parts, intensity: f64) -> f64 {
    let blend = intensity.clamp(0.0, 1.0);
    (1.0 - blend + blend * parts.score).max(0.001)
        * parts.freshness
        * parts.rotation
        * parts.fatigue
        * parts.memory
        * parts.night
}

/// Weight per target song (all songs when `targets` is empty), in [0.001 .. 1], by 3.0's model.
pub fn weights(inputs: &Inputs<'_>, targets: &[String], intensity: f64) -> HashMap<String, f64> {
    weights_with(inputs, targets, intensity, &Options::CLASSIC)
}

/// [`weights`] with the model's options.
pub fn weights_with(
    inputs: &Inputs<'_>,
    targets: &[String],
    intensity: f64,
    options: &Options,
) -> HashMap<String, f64> {
    parts(inputs, targets, options).into_iter().map(|(id, p)| (id, weight_of(&p, intensity))).collect()
}

/// Weighted skips this heavy within [`SKIP_PAIR_WINDOW_MS`], from at least two sessions, push a
/// song back (PLAN/16: one bad evening proves nothing; every skip is softened by its kind).
pub const SKIP_ENOUGH: f64 = 1.5;

/// Skip-aware factor from a song's weighted skips `(when, weight, session)`, oldest first: x0.5 for
/// 14 days after enough skips within 14 days (from two sessions or more), then back to 1 linearly
/// over the next 14 days.
pub fn skip_factor(skips: &[(i64, f64, usize)], now: i64) -> f64 {
    let enough_at = |end: usize| {
        let t = skips[end].0;
        let window: Vec<&(i64, f64, usize)> =
            skips[..=end].iter().filter(|(at, _, _)| t - at <= SKIP_PAIR_WINDOW_MS).collect();
        let weight: f64 = window.iter().map(|(_, w, _)| w).sum();
        let first = window.first().map(|s| s.2);
        weight >= SKIP_ENOUGH - 1e-9 && window.iter().any(|s| Some(s.2) != first)
    };
    let Some(paired) = (0..skips.len()).rev().find(|&end| enough_at(end)).map(|end| skips[end].0) else {
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
    recent_heard(db, None, limit)
}

/// [`recent_songs`] skipping plays made while browsing (PLAN/16 D4): the classified plays first,
/// then the plays before them unclassified.
fn recent_heard(db: &crate::db::Db, heard: Option<&Listening>, limit: usize) -> crate::Result<Vec<String>> {
    let mut out: Vec<String> = Vec::new();
    let mut before = i64::MAX;
    if let Some(l) = heard {
        before = l.since;
        for i in (0..l.classified.plays.len()).rev() {
            if l.classified.contexts[i].browsing {
                continue;
            }
            let id = &l.classified.plays[i].song_id;
            if !out.contains(id) {
                out.push(id.clone());
                if out.len() == limit {
                    return Ok(out);
                }
            }
        }
    }
    let mut stmt = db
        .conn()
        .prepare("SELECT song_id FROM play_events WHERE ended_at < ?2 ORDER BY ended_at DESC, seq DESC LIMIT ?1")?;
    for id in stmt.query_map(rusqlite::params![(limit * 10) as i64, before], |r| r.get::<_, String>(0))? {
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
/// quarter of the song, weighed in its context (PLAN/16).
pub fn skip_factors(db: &crate::db::Db, now: i64) -> crate::Result<HashMap<String, f64>> {
    Ok(skip_factors_in(&Listening::load(db, now)?, now))
}

fn skip_factors_in(listening: &Listening, now: i64) -> HashMap<String, f64> {
    factors_of(&listening.classified.skips(skips_since(now)), now)
}

fn skips_since(now: i64) -> i64 {
    now - SKIP_PAIR_WINDOW_MS - SKIP_HOLD_MS - SKIP_RECOVER_MS
}

fn factors_of(skips: &HashMap<String, Vec<(i64, f64, usize)>>, now: i64) -> HashMap<String, f64> {
    skips.iter().map(|(id, skips)| (id.clone(), skip_factor(skips, now))).filter(|(_, factor)| *factor < 1.0).collect()
}

/// `YYYY-MM-DD` of a day counted from the epoch.
fn day_string(days: i64) -> String {
    let (y, m, d) = crate::time::civil_from_days(days);
    format!("{y:04}-{m:02}-{d:02}")
}

/// The plays of the last [`HORIZON_MS`] in their context (PLAN/16), read once per [`Prepared`].
pub struct Listening {
    pub classified: crate::listening::Classified,
    /// Where the classified plays start; older plays are read unclassified.
    pub since: i64,
}

/// How far back the shuffle reads plays in their context: the longest look-back of its parts
/// (implicit duels, 90 days).
pub const HORIZON_MS: i64 = 90 * DAY_MS;

impl Listening {
    pub fn load(db: &crate::db::Db, now: i64) -> crate::Result<Self> {
        let since = now - HORIZON_MS;
        Ok(Listening { classified: crate::listening::Classified::load(db.conn(), since)?, since })
    }

    /// The day each song was last heard, not browsed (PLAN/16 D4), as local days since the epoch:
    /// from the classified plays. A song only browsed within the horizon reads its last real play
    /// before it (a day with a play of 30 s or more before the horizon, or a 1.x day); every other
    /// song, its totals (1.x included).
    pub fn last_days(&self, db: &crate::db::Db) -> crate::Result<HashMap<String, i64>> {
        let c = &self.classified;
        let local = |ms: i64, offset: i64| (ms + offset * 60_000).div_euclid(DAY_MS);
        let offset = c.plays.last().map_or(0, |p| p.utc_offset_min);
        let horizon = crate::time::local_day(self.since, offset);
        let mut out: HashMap<String, i64> = HashMap::with_capacity(c.plays.len());
        let mut seen: HashSet<&str> = HashSet::with_capacity(c.plays.len());
        for i in (0..c.plays.len()).rev() {
            let p = &c.plays[i];
            seen.insert(&p.song_id);
            if !c.contexts[i].browsing && !out.contains_key(&p.song_id) {
                out.insert(p.song_id.clone(), local(p.started_at, p.utc_offset_min));
            }
        }
        let browsed: Vec<&str> = seen.iter().copied().filter(|id| !out.contains_key(*id)).collect();
        let browsed_set: HashSet<&str> = browsed.iter().copied().collect();
        let mut stmt = db.conn().prepare("SELECT song_id, last_day FROM song_totals WHERE last_day IS NOT NULL")?;
        let mut rows = stmt.query([])?;
        while let Some(row) = rows.next()? {
            let id = row.get_ref(0)?.as_str().map_err(rusqlite::Error::from)?;
            if out.contains_key(id) || browsed_set.contains(id) {
                continue;
            }
            if let Some(day) = crate::time::parse_day(row.get_ref(1)?.as_str().map_err(rusqlite::Error::from)?) {
                out.insert(id.to_owned(), day);
            }
        }
        if !browsed.is_empty() {
            let list = browsed.iter().map(|id| format!("'{}'", id.replace('\'', "''"))).collect::<Vec<_>>().join(",");
            let mut stmt = db.conn().prepare(&format!(
                "SELECT song_id, max(day) FROM (
                   SELECT song_id, day FROM play_daily WHERE plays > 0 AND day < ?1 AND song_id IN ({list})
                   UNION ALL SELECT song_id, day FROM legacy_daily WHERE plays > 0 AND song_id IN ({list}))
                 GROUP BY song_id"
            ))?;
            for row in stmt.query_map([&horizon], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
                let (id, day) = row?;
                if let Some(day) = crate::time::parse_day(&day) {
                    out.insert(id, day);
                }
            }
        }
        Ok(out)
    }
}

pub(crate) struct StoredInputs {
    songs: Vec<(String, Vec<String>)>,
    full: HashMap<String, i64>,
    tierlists: Vec<Tierlist>,
    recent: Vec<String>,
    ratings: HashMap<String, crate::elo::Rating>,
    total_duels: i64,
}

impl StoredInputs {
    pub(crate) fn inputs(&self) -> Inputs<'_> {
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

/// What the model reads from the database and nothing else, kept by a caller between writes
/// (PLAN/15 performance): the library, tierlists, ratings, V2's rotation, L2's evidence and L4's
/// faint duels, L1's undecayed sums. The parts that follow the clock are computed per call.
pub struct Prepared {
    stored: StoredInputs,
    rotation: HashMap<String, f64>,
    evidence: HashMap<String, f64>,
    implicit: HashMap<String, f64>,
    engagement_sums: Vec<(String, f64, f64, i64)>,
    last_day: HashMap<String, i64>,
    guessr: HashMap<String, (i64, i64)>,
    /// C1's plays per quarter of the day and the device's offset, read on first use: a scan of every
    /// play, which only Night shuffle needs.
    day_parts: std::sync::OnceLock<DayParts>,
    /// The plays of the horizon in their context (PLAN/16), for Night shuffle's day parts.
    listening: Listening,
    /// From them, once: each song's weighted skips, when it was last heard (not browsed), the day
    /// it was last heard, and the plays heard in the last day (for artist fatigue).
    skips: HashMap<String, Vec<(i64, f64, usize)>>,
    last_heard_at: HashMap<String, i64>,
    last_days: HashMap<String, i64>,
    heard_today: Vec<(String, i64)>,
}

/// Plays per quarter of the local day (0-6, 6-12, 12-18, 18-24), per song, and the latest play's
/// offset from UTC in minutes.
type DayParts = (HashMap<String, [u32; 4]>, i64);

fn day_parts(db: &crate::db::Db, listening: &Listening) -> crate::Result<DayParts> {
    // Counted here rather than with GROUP BY: SQLite sorts every play for that (about 250 ms at
    // 200 000 plays), a map does not. Plays of the horizon count unless browsed (PLAN/16).
    let mut parts: HashMap<String, [u32; 4]> = HashMap::new();
    let c = &listening.classified;
    for i in c.heard() {
        let p = &c.plays[i];
        let part = ((p.started_at / 60_000 + p.utc_offset_min).rem_euclid(1440) / 360) as usize;
        parts.entry(p.song_id.clone()).or_insert([0; 4])[part] += 1;
    }
    let mut stmt =
        db.conn().prepare("SELECT song_id, started_at, utc_offset_min FROM play_events WHERE ended_at < ?1")?;
    let mut rows = stmt.query([listening.since])?;
    while let Some(row) = rows.next()? {
        let id = row.get_ref(0)?.as_str().map_err(rusqlite::Error::from)?;
        let minute = row.get::<_, i64>(1)? / 60_000 + row.get::<_, i64>(2)?;
        let part = (minute.rem_euclid(1440) / 360) as usize;
        match parts.get_mut(id) {
            Some(counts) => counts[part] += 1,
            None => {
                let mut counts = [0; 4];
                counts[part] = 1;
                parts.insert(id.to_owned(), counts);
            }
        }
    }
    let offset = db
        .conn()
        .query_row("SELECT utc_offset_min FROM play_events ORDER BY ended_at DESC LIMIT 1", [], |r| r.get(0))
        .unwrap_or(0);
    Ok((parts, offset))
}

/// Reads [`Prepared`] (about 50 ms at 20 000 songs and 200 000 plays).
pub fn prepare(db: &crate::db::Db) -> crate::Result<Prepared> {
    let now = crate::db::now_ms();
    let mut evidence = HashMap::new();
    let mut engagement_sums = Vec::new();
    let mut stmt = db.conn().prepare(
        "SELECT song_id, own_picks + replays + rewinds + scrub_skips + guessed + missed, positive, negative, decayed_to,
                guessed, missed
         FROM song_signals",
    )?;
    let mut guessr = HashMap::new();
    for row in stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, i64>(1)?,
            r.get::<_, f64>(2)?,
            r.get::<_, f64>(3)?,
            r.get::<_, i64>(4)?,
            r.get::<_, i64>(5)?,
            r.get::<_, i64>(6)?,
        ))
    })? {
        let (id, n, positive, negative, at, found, missed) = row?;
        if found + missed > 0 {
            guessr.insert(id.clone(), (found, missed));
        }
        if n > 0 {
            evidence.insert(id.clone(), n as f64);
        }
        if positive != 0.0 || negative != 0.0 {
            engagement_sums.push((id, positive, negative, at));
        }
    }
    let listening = Listening::load(db, now)?;
    let mut implicit = HashMap::new();
    for (picked, left, _, weight) in crate::signals::implicit_duels_in(&listening.classified, now - 90 * DAY_MS) {
        *implicit.entry(picked).or_insert(0.0) += weight;
        *implicit.entry(left).or_insert(0.0) -= weight;
    }
    // When each song was last heard (not browsed), by day (`song_totals` holds 1.x's history too).
    let last_days = listening.last_days(db)?;
    let last_day = last_days.clone();
    let mut stored = stored_inputs(db)?;
    stored.recent = recent_heard(db, Some(&listening), 50)?;
    let skips = listening.classified.skips(skips_since(now));
    let (mut last_heard_at, mut heard_today) = (HashMap::new(), Vec::new());
    let c = &listening.classified;
    for i in c.heard() {
        let p = &c.plays[i];
        last_heard_at.insert(p.song_id.clone(), p.ended_at);
        if p.ended_at >= now - DAY_MS {
            heard_today.push((p.song_id.clone(), p.ended_at));
        }
    }
    Ok(Prepared {
        stored,
        rotation: rotation(db, &last_days)?,
        evidence,
        implicit,
        engagement_sums,
        last_day,
        guessr,
        day_parts: std::sync::OnceLock::new(),
        listening,
        skips,
        last_heard_at,
        last_days,
        heard_today,
    })
}

/// Shuffle weights for `targets` from the database; `skip_aware` applies the early-skip factors.
pub fn stored_weights(
    db: &crate::db::Db,
    targets: &[String],
    intensity: f64,
    options: &Options,
) -> crate::Result<HashMap<String, f64>> {
    weights_prepared(db, &prepare(db)?, targets, intensity, options)
}

/// [`stored_weights`] from a [`Prepared`] the caller kept.
pub fn weights_prepared(
    db: &crate::db::Db,
    prepared: &Prepared,
    targets: &[String],
    intensity: f64,
    options: &Options,
) -> crate::Result<HashMap<String, f64>> {
    let stored = &prepared.stored;
    let signals = stored_signals(db, prepared, options)?;
    let mut out: HashMap<String, f64> = parts_with(&stored.inputs(), targets, options, &signals)
        .into_iter()
        .map(|(id, p)| (id, weight_of(&p, intensity)))
        .collect();
    if options.skip_aware {
        for (id, factor) in factors_of(&prepared.skips, crate::db::now_ms()) {
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
    /// What the tierlist nudge added to the score (PLAN/15 F1).
    pub nudge: f64,
    /// V2, V3: the rotation and fatigue factors, 1 when off.
    pub rotation: f64,
    pub fatigue: f64,
    /// M1: the forgotten-favourite lift, 1 when none.
    pub memory: f64,
    /// C1: the time-of-day factor, 1 when off.
    pub night: f64,
    /// L2: how sure the model is, and how far this queue's draw strayed from the mean.
    pub confidence: Option<f64>,
    pub explored: f64,
    /// L1's engagement, when learning is on; and the plays behind it.
    pub engagement: Option<f64>,
    pub own_picks: i64,
    pub replays: i64,
    pub scrub_skips: i64,
    pub weight: f64,
}

/// Explanations for `targets`, in their order, with the weights the shuffle uses.
pub fn explain(
    db: &crate::db::Db,
    targets: &[String],
    intensity: f64,
    options: &Options,
) -> crate::Result<Vec<Explanation>> {
    explain_prepared(db, &prepare(db)?, targets, intensity, options)
}

/// [`explain`] from a [`Prepared`] the caller kept.
pub fn explain_prepared(
    db: &crate::db::Db,
    prepared: &Prepared,
    targets: &[String],
    intensity: f64,
    options: &Options,
) -> crate::Result<Vec<Explanation>> {
    let stored = &prepared.stored;
    let skips = if options.skip_aware { factors_of(&prepared.skips, crate::db::now_ms()) } else { HashMap::new() };

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

    let last_days = &prepared.last_days;

    let signals = stored_signals(db, prepared, options)?;
    let mut counts: HashMap<String, (i64, i64, i64)> = HashMap::new();
    let mut stmt = db.conn().prepare("SELECT song_id, own_picks, replays, scrub_skips FROM song_signals")?;
    for row in stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))? {
        let (id, picks, replays, scrubs) = row?;
        counts.insert(id, (picks, replays, scrubs));
    }
    Ok(parts_with(&stored.inputs(), targets, options, &signals)
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
                last_day: last_days.get(&id).map(|d| day_string(*d)),
                freshness: p.freshness,
                skip,
                nudge: p.nudge,
                rotation: p.rotation,
                fatigue: p.fatigue,
                memory: p.memory,
                night: p.night,
                confidence: p.confidence,
                explored: p.explored,
                engagement: p.engagement,
                own_picks: counts.get(&id).map_or(0, |c| c.0),
                replays: counts.get(&id).map_or(0, |c| c.1),
                scrub_skips: counts.get(&id).map_or(0, |c| c.2),
                weight: (weight_of(&p, intensity) * skip).max(0.001),
                song_id: id,
            }
        })
        .collect())
}

/// The signals the options ask for: the prepared ones copied, the clock-bound ones read now.
pub(crate) fn stored_signals(db: &crate::db::Db, prepared: &Prepared, options: &Options) -> crate::Result<Signals> {
    let now = crate::db::now_ms();
    let mut signals = Signals { now, ..Signals::default() };
    if options.learn {
        signals.engagement = prepared
            .engagement_sums
            .iter()
            .map(|(id, positive, negative, at)| {
                (id.clone(), crate::signals::engagement_of(*positive, *negative, *at, now))
            })
            .collect();
    }
    if options.freshness_by_days {
        // Three weeks is where the push back has faded to nothing; plays made while browsing do
        // not count (PLAN/16), so the classified plays of the horizon are read.
        signals.last_played.extend(
            prepared.last_heard_at.iter().filter(|(_, at)| **at >= now - 21 * DAY_MS).map(|(id, at)| (id.clone(), *at)),
        );
    }
    if options.fair_rotation {
        signals.rotation = prepared.rotation.clone();
    }
    if options.artist_fatigue {
        signals.fatigue = fatigue(db, &prepared.heard_today, now)?;
    }
    if options.night {
        // The part of the day it is now, at the device's offset; a song with too few plays of its
        // own reads its artist's.
        if prepared.day_parts.get().is_none() {
            let _ = prepared.day_parts.set(day_parts(db, &prepared.listening)?);
        }
        let (day_parts, offset) = prepared.day_parts.get().expect("set above");
        let part = (((now / 60_000 + offset).rem_euclid(1440)) / 360) as usize;
        let mut by_artist: HashMap<&str, [u32; 4]> = HashMap::new();
        for (id, artists) in &prepared.stored.songs {
            if let Some(parts) = day_parts.get(id) {
                for artist in artists {
                    let total = by_artist.entry(artist.as_str()).or_insert([0; 4]);
                    for (t, p) in total.iter_mut().zip(parts) {
                        *t += p;
                    }
                }
            }
        }
        let share = |parts: &[u32; 4]| {
            let total: u32 = parts.iter().sum();
            (total >= NIGHT_MIN_PLAYS).then(|| f64::from(parts[part]) / f64::from(total))
        };
        for (id, artists) in &prepared.stored.songs {
            let own = day_parts.get(id).and_then(share);
            let theirs = || artists.iter().filter_map(|a| by_artist.get(a.as_str()).and_then(share)).reduce(f64::max);
            if let Some(s) = own.or_else(theirs) {
                signals.day_share.insert(id.clone(), s);
            }
        }
    }
    if options.forgotten_favourites {
        let today = now.div_euclid(DAY_MS);
        signals.days_unheard =
            prepared.last_day.iter().map(|(id, day)| (id.clone(), (today - day).max(0) as f64)).collect();
        signals.guessr = prepared.guessr.clone();
    }
    if options.adaptive {
        signals.seed = (now / DRAW_WINDOW_MS) as u64;
        signals.evidence = prepared.evidence.clone();
        if options.implicit_duels {
            signals.implicit = prepared.implicit.clone();
        }
    }
    Ok(signals)
}

/// V2: inside each tier (a song's best placement in a tierlist that influences the shuffle), the
/// songs heard longest ago lean up, to x1.5 for the one that waited longest; never heard counts as
/// longest. Day precision, from the days songs were last heard, not browsed (PLAN/16; 1.x history
/// included).
fn rotation(db: &crate::db::Db, last_day: &HashMap<String, i64>) -> crate::Result<HashMap<String, f64>> {
    let mut best: HashMap<String, (f64, usize, usize)> = HashMap::new();
    for (list, tierlist) in stored_tierlists(db)?.iter().enumerate().filter(|(_, t)| t.influences_shuffle) {
        let total = tierlist.tiers.len();
        for (index, tier) in tierlist.tiers.iter().enumerate() {
            let value = tier_value(index, total);
            for id in tier {
                if best.get(id).is_none_or(|b| value > b.0) {
                    best.insert(id.clone(), (value, list, index));
                }
            }
        }
    }
    let mut groups: HashMap<(usize, usize), Vec<&String>> = HashMap::new();
    for (id, (_, list, tier)) in &best {
        groups.entry((*list, *tier)).or_default().push(id);
    }
    let mut out = HashMap::new();
    for (_, mut songs) in groups {
        if songs.len() < 2 {
            continue;
        }
        // Most recently heard first; never heard last (the longest wait); ties by id.
        songs.sort_by(|a, b| {
            let (da, db_) = (last_day.get(*a), last_day.get(*b));
            match (da, db_) {
                (Some(x), Some(y)) => y.cmp(x),
                (None, Some(_)) => std::cmp::Ordering::Greater,
                (Some(_), None) => std::cmp::Ordering::Less,
                (None, None) => std::cmp::Ordering::Equal,
            }
            .then_with(|| a.cmp(b))
        });
        let last = (songs.len() - 1) as f64;
        for (i, id) in songs.into_iter().enumerate() {
            out.insert(id.clone(), 1.0 + (ROTATION_MAX - 1.0) * i as f64 / last);
        }
    }
    Ok(out)
}

/// V3: every play of an artist in the last six hours slows that artist's songs, x0.85 each, to x0.5.
fn fatigue(db: &crate::db::Db, heard: &[(String, i64)], now: i64) -> crate::Result<HashMap<String, f64>> {
    // The recent plays not browsed (PLAN/16), then the artists from one read of the library: a join
    // over the plays walked all of them (140 ms at 200 000 plays).
    let recent: Vec<&String> =
        heard.iter().filter(|(_, at)| *at >= now - FATIGUE_WINDOW_MS).map(|(id, _)| id).collect();
    if recent.is_empty() {
        return Ok(HashMap::new());
    }
    let artists = artist_names(db)?;
    let mut plays_by_artist: HashMap<&str, u32> = HashMap::new();
    for song in recent {
        for artist in artists.get(song).into_iter().flatten() {
            *plays_by_artist.entry(artist.as_str()).or_insert(0) += 1;
        }
    }
    let mut out: HashMap<String, f64> = HashMap::new();
    for (song, names) in &artists {
        let plays = names.iter().filter_map(|a| plays_by_artist.get(a.as_str())).max().copied().unwrap_or(0);
        if plays > 0 {
            out.insert(song.clone(), FATIGUE_STEP.powi(plays as i32).max(FATIGUE_FLOOR));
        }
    }
    Ok(out)
}

/// Each song's artists, case folded.
fn artist_names(db: &crate::db::Db) -> crate::Result<HashMap<String, Vec<String>>> {
    let mut stmt = db.conn().prepare(
        "SELECT DISTINCT v.song_id, a.name FROM track_variants v JOIN variant_artists a ON a.variant_id = v.variant_id
         WHERE a.role = 'artist'",
    )?;
    let mut out: HashMap<String, Vec<String>> = HashMap::new();
    for row in stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
        let (song, name) = row?;
        out.entry(song).or_default().push(name.to_lowercase());
    }
    Ok(out)
}

pub(crate) fn stored_inputs(db: &crate::db::Db) -> crate::Result<StoredInputs> {
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

/// Each song's artists as small numbers (one per distinct name, case folded), for the view's
/// ordering to keep an artist from playing twice in a row (PLAN/15 F2) without sending names.
pub fn artist_ids(db: &crate::db::Db) -> crate::Result<HashMap<String, Vec<u32>>> {
    let mut stmt = db.conn().prepare(
        "SELECT DISTINCT v.song_id, a.name FROM track_variants v JOIN variant_artists a ON a.variant_id = v.variant_id
         WHERE a.role = 'artist'",
    )?;
    let mut names: HashMap<String, u32> = HashMap::new();
    let mut out: HashMap<String, Vec<u32>> = HashMap::new();
    for row in stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
        let (song, name) = row?;
        let next = names.len() as u32;
        let id = *names.entry(name.to_lowercase()).or_insert(next);
        let list = out.entry(song).or_default();
        if !list.contains(&id) {
            list.push(id);
        }
    }
    Ok(out)
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
    /// S1: the session's mode: `comfort`, `discovery`, `rediscover` or `flow` (Classic when None).
    pub mode: Option<String>,
    /// S2: lean to this tierlist (its id) and its songs' map neighbours.
    pub lens: Option<String>,
    /// PLAN/17: lean to these songs (an island or a selection on the taste map) and their
    /// neighbours, like a tierlist lens.
    pub lens_songs: Vec<String>,
}

/// S1 Comfort: unplaced songs with no evidence at all are pushed back this much.
pub const COMFORT_UNKNOWN: f64 = 0.3;
/// S1 Discovery: songs with little evidence, or outside every tierlist, come up this much more.
pub const DISCOVERY_LIFT: f64 = 2.0;
/// S1 Rediscover: loved songs unheard for a month come up this much more.
pub const REDISCOVER_LIFT: f64 = 1.6;
/// S2: the lens's songs and their map neighbours.
pub const LENS_SONG: f64 = 1.8;
pub const LENS_NEIGHBOUR: f64 = 1.3;

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
    // When songs were last heard, not browsed (PLAN/16), for the filters and the modes that ask.
    let needs_days = steering.only_unheard || steering.mode.as_deref() == Some("rediscover");
    let last_days = if needs_days { Listening::load(db, now)?.last_days(db)? } else { HashMap::new() };
    let mut heard_lately: HashSet<String> = HashSet::new();
    if steering.only_unheard {
        let since = (now - 30 * DAY_MS).div_euclid(DAY_MS);
        heard_lately.extend(last_days.iter().filter(|(_, day)| **day >= since).map(|(id, _)| id.clone()));
    }
    let ranked: HashSet<String> = if steering.only_ranked {
        stored_tierlists(db)?.into_iter().flat_map(|t| t.tiers.into_iter().flatten()).collect()
    } else {
        HashSet::new()
    };

    // S1: what a mode needs: how much is known of each song, which are placed, which are loved.
    let mode = steering.mode.as_deref();
    let (mut known, mut placed, mut loved_unheard) = (HashMap::new(), HashSet::new(), HashSet::new());
    if matches!(mode, Some("comfort" | "discovery" | "rediscover")) {
        let ratings = crate::elo::ratings(db)?;
        for t in stored_tierlists(db)?.into_iter().filter(|t| t.influences_shuffle) {
            placed.extend(t.tiers.into_iter().flatten());
        }
        let month_ago = (now - 30 * DAY_MS).div_euclid(DAY_MS);
        let mut stmt = db.conn().prepare("SELECT song_id, full FROM song_totals")?;
        for row in stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))? {
            let (id, full) = row?;
            let last_day = last_days.get(&id);
            *known.entry(id.clone()).or_insert(0) += full;
            let loved =
                placed.contains(&id) || ratings.get(&id).is_some_and(|r| r.games >= 1 && normalized_score(r) > 0.55);
            if loved && last_day.is_some_and(|d| *d < month_ago) {
                loved_unheard.insert(id);
            }
        }
        for (id, r) in &ratings {
            *known.entry(id.clone()).or_insert(0) += r.games;
        }
    }
    // S2: the lens's songs and their neighbours on the taste map.
    let (mut lens_songs, mut lens_near) = (HashSet::new(), HashSet::new());
    if let Some(lens) = &steering.lens
        && let Some((_, doc)) = crate::playlists::tierlists(db)?.into_iter().find(|(id, _)| id == lens)
    {
        lens_songs.extend(tierlist_of(&doc).tiers.into_iter().flatten());
    }
    lens_songs.extend(steering.lens_songs.iter().cloned());
    for id in &lens_songs {
        lens_near.extend(neighbours(id));
    }

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
        let evidence = known.get(id).copied().unwrap_or(0);
        match mode {
            Some("comfort") if evidence == 0 && !placed.contains(id) => factor *= COMFORT_UNKNOWN,
            Some("discovery") if evidence < 3 || !placed.contains(id) => factor *= DISCOVERY_LIFT,
            Some("rediscover") if loved_unheard.contains(id) => factor *= REDISCOVER_LIFT,
            _ => {}
        }
        if lens_songs.contains(id) {
            factor *= LENS_SONG;
        } else if lens_near.contains(id) {
            factor *= LENS_NEIGHBOUR;
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

    struct SkipKindWeight;
    impl SkipKindWeight {
        const EARLY: f64 = 0.6;
    }

    #[test]
    fn two_early_skips_push_a_song_back_then_it_recovers() {
        let day = DAY_MS;
        let now = 100 * day;
        // Skips at full weight, each from its own session.
        let full =
            |times: &[i64]| -> Vec<(i64, f64, usize)> { times.iter().enumerate().map(|(i, t)| (*t, 1.0, i)).collect() };
        // One skip, or two far apart, change nothing.
        assert_eq!(skip_factor(&full(&[now - day]), now), 1.0);
        assert_eq!(skip_factor(&full(&[now - 40 * day, now - 20 * day]), now), 1.0);
        // Two within 14 days: x0.5 for 14 days after the second...
        assert_eq!(skip_factor(&full(&[now - 5 * day, now - 2 * day]), now), SKIP_FACTOR);
        assert_eq!(skip_factor(&full(&[now - 16 * day, now - 13 * day]), now), SKIP_FACTOR);
        // ...then halfway back after 21 days, and fully back after 28.
        assert!((skip_factor(&full(&[now - 24 * day, now - 21 * day]), now) - 0.75).abs() < 1e-9);
        assert_eq!(skip_factor(&full(&[now - 31 * day, now - 28 * day]), now), 1.0);
        // The latest pair counts.
        assert_eq!(skip_factor(&full(&[now - 60 * day, now - 59 * day, now - 3 * day, now - day]), now), SKIP_FACTOR);
        // PLAN/16: softened skips need more of them, and one session proves nothing.
        let early = SkipKindWeight::EARLY;
        assert_eq!(skip_factor(&[(now - 3 * day, early, 0), (now - day, early, 1)], now), 1.0);
        assert_eq!(
            skip_factor(&[(now - 4 * day, early, 0), (now - 3 * day, early, 1), (now - day, early, 2)], now),
            SKIP_FACTOR
        );
        assert_eq!(skip_factor(&[(now - 2 * day, 1.0, 7), (now - day, 1.0, 7)], now), 1.0);
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

    /// A play with its details: `heard` of a 200 s song from `started`.
    fn play(db: &crate::db::Db, song: &str, seq: i64, started: i64, heard: i64, end: &str, start: &str) {
        db.conn()
            .execute(
                "INSERT INTO play_events (event_id, device_id, seq, song_id, started_at, ended_at, utc_offset_min, heard_ms,
                   duration_ms, max_position_ms, end_reason)
                 VALUES ('D:' || ?1, 'D', ?1, ?2, ?3, ?3 + ?4, 0, ?4, 200000, ?4, ?5)",
                rusqlite::params![seq, song.repeat(26), started, heard, end],
            )
            .unwrap();
        db.conn()
            .execute(
                "INSERT INTO play_details (event_id, start_reason) VALUES ('D:' || ?1, ?2)",
                rusqlite::params![seq, start],
            )
            .unwrap();
    }

    /// An early skip of `song` ending at `ended_at`, after three songs of `a` played through: a skip
    /// made while really listening (PLAN/16).
    fn skip_while_listening(db: &crate::db::Db, song: &str, seq: i64, ended_at: i64, heard: i64) {
        let start = ended_at - heard;
        let mut t = start - 3 * 200_500;
        for k in 0..3 {
            play(db, "a", seq * 10 + k, t, 200_000, "finished", "auto");
            t += 200_500;
        }
        play(db, song, seq * 10 + 3, start, heard, "user_next", "auto");
    }

    #[test]
    fn explain_names_the_best_tier_and_the_skip_push_back() {
        let db = seeded();
        let now = crate::db::now_ms();
        let (a, b, c) = ("a".repeat(26), "b".repeat(26), "c".repeat(26));
        // b: three early skips this week, each while listening (softened, so two are not enough);
        // c: two late "next"s, which are not early skips.
        skip_while_listening(&db, "b", 1, now - 5 * DAY_MS, 5_000);
        skip_while_listening(&db, "b", 2, now - 3 * DAY_MS, 20_000);
        skip_while_listening(&db, "b", 5, now - DAY_MS, 9_000);
        skip(&db, "c", 3, now - 2 * DAY_MS, 150_000);
        skip(&db, "c", 4, now - DAY_MS, 150_000);

        let targets = [a.clone(), b.clone(), c.clone()];
        let explained = explain(&db, &targets, 0.6, &Options::default()).unwrap();
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
        let weights = stored_weights(&db, &targets, 0.6, &Options::default()).unwrap();
        for e in &explained {
            // Freshness by days reads the clock: two calls differ by microseconds.
            assert!((weights[&e.song_id] - e.weight).abs() < 1e-6);
        }
        let plain = stored_weights(&db, &targets, 0.6, &Options { skip_aware: false, ..Options::default() }).unwrap();
        assert!((weights[&b] - plain[&b] * SKIP_FACTOR).abs() < 1e-6);
        assert!((weights[&c] - plain[&c]).abs() < 1e-6);
    }

    #[test]
    fn a_browse_changes_no_weight() {
        let db = seeded();
        let now = crate::db::now_ms();
        let targets = ["a".repeat(26), "b".repeat(26), "c".repeat(26)];
        let before = stored_weights(&db, &targets, 0.6, &Options::default()).unwrap();
        // Flicking through b and c twelve times in two minutes, two days running.
        for day in [2, 1] {
            let mut t = now - day * DAY_MS;
            for k in 0..12 {
                let song = if k % 2 == 0 { "b" } else { "c" };
                play(&db, song, day * 100 + k, t, 2_000, "user_selected", "user_selected");
                t += 9_000;
            }
        }
        let after = stored_weights(&db, &targets, 0.6, &Options::default()).unwrap();
        for id in &targets {
            assert!((before[id] - after[id]).abs() < 1e-6, "{id}: {} -> {}", before[id], after[id]);
        }
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
    fn a_placed_song_below_the_unplaced_median_is_nudged_a_little() {
        // "low": bottom of a six-tier list, by an artist nobody else plays. "loved1..3": unplaced but
        // by an artist with many full listens. "high": S tier.
        let songs: Vec<(String, Vec<String>)> = [
            ("low", "nobody"),
            ("high", "star"),
            ("loved1", "fav"),
            ("loved2", "fav"),
            ("loved3", "fav"),
            ("plain", "other"),
        ]
        .iter()
        .map(|(id, artist)| (id.to_string(), vec![artist.to_string()]))
        .collect();
        let tierlists = vec![Tierlist {
            influences_shuffle: true,
            tiers: vec![vec!["high".into()], vec![], vec![], vec![], vec![], vec!["low".into()]],
        }];
        let full: HashMap<String, i64> =
            [("loved1".to_string(), 40), ("loved2".to_string(), 40), ("loved3".to_string(), 40)].into();
        let ratings = HashMap::new();
        let inputs = Inputs {
            songs: &songs,
            tierlists: &tierlists,
            full_listens: &full,
            recent: &[],
            ratings: &ratings,
            total_duels: 0,
        };
        let get = |options: &Options| -> HashMap<String, Parts> { parts(&inputs, &[], options).into_iter().collect() };
        let classic = get(&Options::CLASSIC);
        let nudged = get(&Options { nudge: true, ..Options::CLASSIC });

        // The unplaced songs, in score order: plain (0) < loved (0.1 + artist) x3: median is a loved one.
        let median = classic["loved1"].score;
        let low = &nudged["low"];
        assert!(classic["low"].score < median);
        let expected = (NUDGE_SHARE * (median - classic["low"].score)).min(NUDGE_MAX);
        assert!((low.nudge - expected).abs() < 1e-12 && low.nudge > 0.0 && low.nudge <= NUDGE_MAX);
        assert!((low.score - classic["low"].score - low.nudge).abs() < 1e-12);
        // Still below the median: tightened a drop, not lifted to it.
        assert!(low.score < median);
        // An S-tier song is above the median already; unplaced songs are never nudged.
        assert_eq!(nudged["high"].nudge, 0.0);
        for id in ["loved1", "plain"] {
            assert_eq!(nudged[id], classic[id], "{id}");
        }
        // CLASSIC is 3.0's model: no nudge anywhere.
        assert!(classic.values().all(|p| p.nudge == 0.0));
    }

    #[test]
    fn learning_moves_a_song_by_how_it_is_listened_to_only_when_on() {
        let songs: Vec<(String, Vec<String>)> =
            ["loved", "scrubbed", "unknown"].iter().map(|id| (id.to_string(), vec!["x".to_string()])).collect();
        let (full, ratings) = (HashMap::new(), HashMap::new());
        let inputs = Inputs {
            songs: &songs,
            tierlists: &[],
            full_listens: &full,
            recent: &[],
            ratings: &ratings,
            total_duels: 0,
        };
        let signals = Signals {
            engagement: [("loved".to_string(), 0.9), ("scrubbed".to_string(), 0.1)].into(),
            ..Signals::default()
        };
        let get = |learn: bool| -> HashMap<String, Parts> {
            let options = Options { learn, ..Options::CLASSIC };
            parts_with(&inputs, &[], &options, &signals).into_iter().collect()
        };
        let (on, off) = (get(true), get(false));
        assert!(on["loved"].score > on["unknown"].score && on["unknown"].score > on["scrubbed"].score);
        assert_eq!(on["unknown"].engagement, Some(0.5));
        // Off, the three are the same song to the model, as in 3.0.
        assert_eq!(off["loved"].score, off["scrubbed"].score);
        assert!(off.values().all(|p| p.engagement.is_none()));
    }

    #[test]
    fn the_adaptive_model_starts_at_the_classic_score_and_explores_what_it_knows_little() {
        let songs: Vec<(String, Vec<String>)> =
            ["known", "unknown", "dueled"].iter().map(|id| (id.to_string(), vec!["x".to_string()])).collect();
        let full: HashMap<String, i64> = [("known".to_string(), 30)].into();
        let ratings: HashMap<String, Rating> =
            [("dueled".to_string(), Rating { rating: 1350.0, games: 25, wins: 20, losses: 5, ..Default::default() })]
                .into();
        let inputs = Inputs {
            songs: &songs,
            tierlists: &[],
            full_listens: &full,
            recent: &[],
            ratings: &ratings,
            total_duels: 25,
        };
        let classic: HashMap<String, Parts> = parts(&inputs, &[], &Options::CLASSIC).into_iter().collect();
        let mut spread_known = 0.0f64;
        let mut spread_unknown = 0.0f64;
        let adaptive = Options { adaptive: true, ..Options::CLASSIC };
        for seed in 0..200 {
            let signals = Signals { seed, ..Signals::default() };
            let p: HashMap<String, Parts> = parts_with(&inputs, &[], &adaptive, &signals).into_iter().collect();
            for id in ["known", "unknown"] {
                // Every draw stays within 0.15 of the classic score.
                assert!((p[id].score - classic[id].score).abs() <= ADAPTIVE_SPREAD + 1e-12, "{id}");
            }
            spread_known += (p["known"].score - classic["known"].score).abs() / 200.0;
            spread_unknown += (p["unknown"].score - classic["unknown"].score).abs() / 200.0;
            // The same seed draws the same.
            let again: HashMap<String, Parts> = parts_with(&inputs, &[], &adaptive, &signals).into_iter().collect();
            assert_eq!(p["unknown"].score, again["unknown"].score);
        }
        // What is little known strays further, on average.
        assert!(spread_unknown > 2.0 * spread_known, "{spread_unknown} vs {spread_known}");
        // A song with 25 duels won mostly gets more of its ELO than 3.0 gave it.
        let mean: f64 = (0..200)
            .map(|seed| {
                let signals = Signals { seed, ..Signals::default() };
                parts_with(&inputs, &[], &adaptive, &signals)
                    .into_iter()
                    .find(|(id, _)| id == "dueled")
                    .unwrap()
                    .1
                    .score
            })
            .sum::<f64>()
            / 200.0;
        assert!(mean > classic["dueled"].score + 0.02, "{mean} vs {}", classic["dueled"].score);
    }

    #[test]
    fn a_forgotten_favourite_comes_back_and_a_missed_guess_never_lowers() {
        // Not loved: nothing, however long unheard or missed.
        assert_eq!(memory_factor(false, Some(400.0), (0, 5)), 1.0);
        // Loved: nothing before 60 days, half way at 120, all of it from 180.
        assert_eq!(memory_factor(true, Some(30.0), (0, 0)), 1.0);
        assert!((memory_factor(true, Some(120.0), (0, 0)) - 1.3).abs() < 1e-12);
        assert!((memory_factor(true, Some(400.0), (0, 0)) - FORGOTTEN_MAX).abs() < 1e-12);
        // Never heard is not forgotten.
        assert_eq!(memory_factor(true, None, (0, 0)), 1.0);
        // Missed in Song Guessr more than found: up; found as often: nothing; never below 1.
        assert!((memory_factor(true, Some(10.0), (0, 2)) - FORGOTTEN_MAX).abs() < 1e-12);
        assert_eq!(memory_factor(true, Some(10.0), (2, 2)), 1.0);
        for found in 0..5 {
            for missed in 0..5 {
                assert!(memory_factor(true, Some(10.0), (found, missed)) >= 1.0);
            }
        }
    }

    #[test]
    fn modes_and_the_lens_lean_where_they_say() {
        let db = seeded();
        let now = crate::db::now_ms();
        let (a, b, c) = ("a".repeat(26), "b".repeat(26), "c".repeat(26));
        let base: HashMap<String, f64> = [(a.clone(), 0.5), (b.clone(), 0.5), (c.clone(), 0.5)].into();
        let none = |_: &str| Vec::new();
        let with = |mode: &str| {
            let mut w = base.clone();
            let steering = Steering { mode: Some(mode.into()), ..Default::default() };
            steer(&db, &mut w, &steering, &none, now).unwrap();
            w
        };
        // a and b are placed ("best"), c is not and nothing is known of it.
        let comfort = with("comfort");
        assert_eq!(comfort[&a], 0.5);
        assert!((comfort[&c] - 0.5 * COMFORT_UNKNOWN).abs() < 1e-12);
        let discovery = with("discovery");
        assert!((discovery[&c] - 0.5 * DISCOVERY_LIFT).abs() < 1e-12);
        // Flow changes no weight (the view orders by energy).
        assert_eq!(with("flow"), base);
        // The lens: its tierlist's songs x1.8, a neighbour of one of them x1.3.
        let (lens, _) = crate::playlists::tierlists(&db).unwrap().into_iter().next().unwrap();
        let near = |id: &str| if id == "a".repeat(26) { vec!["c".repeat(26)] } else { Vec::new() };
        let mut w = base.clone();
        steer(&db, &mut w, &Steering { lens: Some(lens), ..Default::default() }, &near, now).unwrap();
        assert!((w[&a] - 0.5 * LENS_SONG).abs() < 1e-12);
        assert!((w[&c] - 0.5 * LENS_NEIGHBOUR).abs() < 1e-12);
    }

    #[test]
    fn night_leans_to_the_hours_a_song_is_played() {
        assert!((night_factor(0.0) - 0.8).abs() < 1e-12);
        assert!((night_factor(1.0) - 1.2).abs() < 1e-12);
        assert!((night_factor(0.25) - 0.9).abs() < 1e-12);
    }

    #[test]
    fn freshness_by_days_fades_over_days() {
        assert!((freshness_by_days(0.0) - 0.4).abs() < 1e-12);
        assert!(freshness_by_days(1.0) > 0.6 && freshness_by_days(1.0) < 0.7);
        assert!(freshness_by_days(7.0) > 0.98);
        assert!(freshness_by_days(14.0) > 0.999);
    }

    #[test]
    fn fair_rotation_leans_to_the_tier_song_that_waited_longest_and_fatigue_slows_an_artist() {
        let db = seeded();
        let (a, b, c) = ("a".repeat(26), "b".repeat(26), "c".repeat(26));
        // a, b and c in one tier: a heard today, b a month ago, c never.
        let doc = serde_json::json!({
            "name": "flat",
            "influencesShuffle": true,
            "tiers": [{ "name": "S", "items": [a, b, c] }]
        });
        crate::playlists::save_tierlist(&db, None, &doc).unwrap();
        // Only the flat list counts, so all three share one tier.
        db.conn()
            .execute(
                "UPDATE tierlists SET doc = json_set(doc, '$.influencesShuffle', json('false'))
                 WHERE json_extract(doc, '$.name') = 'best'",
                [],
            )
            .unwrap();
        let now = crate::db::now_ms();
        for (song, days) in [(&a, 0), (&b, 30)] {
            db.conn()
                .execute(
                    "INSERT INTO song_totals VALUES (?1, 1, 1, 1, 0, 1000, ?2)",
                    rusqlite::params![song, crate::time::local_day(now - days * DAY_MS, 0)],
                )
                .unwrap();
        }
        let r = rotation(&db, &Listening::load(&db, now).unwrap().last_days(&db).unwrap()).unwrap();
        assert_eq!(r[&a], 1.0);
        assert!((r[&b] - 1.25).abs() < 1e-12);
        assert!((r[&c] - ROTATION_MAX).abs() < 1e-12);

        // Two plays of X (a and c) in the last hours: X's songs x0.85^2; Y's untouched.
        skip(&db, "a", 1, now - 3_600_000, 200_000);
        skip(&db, "c", 2, now - 1_800_000, 200_000);
        let l = Listening::load(&db, now).unwrap();
        let heard: Vec<(String, i64)> = l
            .classified
            .heard()
            .map(|i| (l.classified.plays[i].song_id.clone(), l.classified.plays[i].ended_at))
            .collect();
        let f = fatigue(&db, &heard, now).unwrap();
        assert!((f[&a] - FATIGUE_STEP * FATIGUE_STEP).abs() < 1e-12);
        assert!((f[&c] - FATIGUE_STEP * FATIGUE_STEP).abs() < 1e-12);
        assert!(!f.contains_key(&b));
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

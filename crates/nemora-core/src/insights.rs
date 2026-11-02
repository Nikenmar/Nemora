//! Stats > Insights (PLAN/20 D3): a few sentences that read the history, each with its numbers and
//! the songs or island it is about, on top of everything Stats already shows. An insight appears only
//! when the history supports it. The readings are plain functions over [`History`], so they are
//! tested on synthetic histories; [`stored`] reads one from the database.

use std::collections::{HashMap, HashSet};

use serde::Serialize;

const DAY_MS: i64 = 86_400_000;

/// One heard play (not a browse, PLAN/16): the song, when it started, how long it was heard, and the
/// device's offset from UTC then (minutes).
#[derive(Debug, Clone, PartialEq)]
pub struct Heard {
    pub song_id: String,
    pub at: i64,
    pub heard_ms: i64,
    pub utc_offset_min: i64,
}

#[derive(Debug, Clone, Default)]
pub struct History {
    /// Heard plays of the last 120 days, oldest first.
    pub plays: Vec<Heard>,
    /// Songs heard before those 120 days (1.x history included), for "first time".
    pub heard_before: HashSet<String>,
    /// Duels won per song, by when (ms).
    pub duel_wins: Vec<(String, i64)>,
    /// The taste map's island of each song, and island names.
    pub island_of: HashMap<String, usize>,
    pub island_names: HashMap<usize, String>,
    pub now: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", rename_all_fields = "camelCase", tag = "kind")]
pub enum Insight {
    /// This week against the one before: time heard (ms), songs heard, songs heard for the first time.
    Week { heard_ms: i64, before_ms: i64, songs: usize, songs_before: usize, first_time: usize },
    /// Played a lot one to three months ago, not at all in the last month.
    OutOfRotation { songs: Vec<String>, plays: Vec<i64> },
    /// Played or won duels much more in the last two weeks than before.
    Rising { songs: Vec<String>, recent: Vec<i64>, before: Vec<f64> },
    /// The island heard more this month than the last, and the one heard less.
    Islands { grew: Option<(usize, String, i64, i64)>, faded: Option<(usize, String, i64, i64)> },
    /// The three hours (local) that hold most plays, and their share.
    Hours { from: u32, to: u32, share: f64, plays: usize },
}

fn local_hour(p: &Heard) -> u32 {
    ((p.at / 60_000 + p.utc_offset_min).rem_euclid(1440) / 60) as u32
}

fn plays_in(h: &History, from: i64, to: i64) -> impl Iterator<Item = &Heard> {
    h.plays.iter().filter(move |p| p.at >= from && p.at < to)
}

/// This week against the last: shown once both weeks have plays.
pub fn week(h: &History) -> Option<Insight> {
    let week = 7 * DAY_MS;
    let (this, last): (Vec<&Heard>, Vec<&Heard>) =
        (plays_in(h, h.now - week, h.now + 1).collect(), plays_in(h, h.now - 2 * week, h.now - week).collect());
    if this.is_empty() || last.is_empty() {
        return None;
    }
    let before: HashSet<&str> = h
        .plays
        .iter()
        .filter(|p| p.at < h.now - week)
        .map(|p| p.song_id.as_str())
        .chain(h.heard_before.iter().map(String::as_str))
        .collect();
    let songs: HashSet<&str> = this.iter().map(|p| p.song_id.as_str()).collect();
    let songs_before: HashSet<&str> = last.iter().map(|p| p.song_id.as_str()).collect();
    Some(Insight::Week {
        heard_ms: this.iter().map(|p| p.heard_ms).sum(),
        before_ms: last.iter().map(|p| p.heard_ms).sum(),
        songs: songs.len(),
        songs_before: songs_before.len(),
        first_time: songs.iter().filter(|s| !before.contains(*s)).count(),
    })
}

/// Songs played five times or more 30 to 90 days ago and not once in the last 30 days; the most
/// played first, at most ten.
pub fn out_of_rotation(h: &History) -> Option<Insight> {
    let month = 30 * DAY_MS;
    let recent: HashSet<&str> = plays_in(h, h.now - month, h.now + 1).map(|p| p.song_id.as_str()).collect();
    let mut earlier: HashMap<&str, i64> = HashMap::new();
    for p in plays_in(h, h.now - 3 * month, h.now - month) {
        *earlier.entry(p.song_id.as_str()).or_default() += 1;
    }
    let mut out: Vec<(&str, i64)> = earlier.into_iter().filter(|(s, n)| *n >= 5 && !recent.contains(s)).collect();
    if out.is_empty() {
        return None;
    }
    out.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(b.0)));
    out.truncate(10);
    Some(Insight::OutOfRotation {
        songs: out.iter().map(|(s, _)| s.to_string()).collect(),
        plays: out.iter().map(|(_, n)| *n).collect(),
    })
}

/// Songs whose plays and duel wins of the last 14 days are at least three, and at least twice
/// (plus one) their two-week average over the six weeks before; the steepest first, at most ten.
pub fn rising(h: &History) -> Option<Insight> {
    let fortnight = 14 * DAY_MS;
    let mut recent: HashMap<&str, i64> = HashMap::new();
    let mut before: HashMap<&str, i64> = HashMap::new();
    let events =
        h.plays.iter().map(|p| (p.song_id.as_str(), p.at)).chain(h.duel_wins.iter().map(|(s, at)| (s.as_str(), *at)));
    for (song, at) in events {
        if at >= h.now - fortnight && at <= h.now {
            *recent.entry(song).or_default() += 1;
        } else if at >= h.now - 4 * fortnight && at < h.now - fortnight {
            *before.entry(song).or_default() += 1;
        }
    }
    let mut out: Vec<(&str, i64, f64)> = recent
        .iter()
        .map(|(s, &n)| (*s, n, before.get(s).copied().unwrap_or(0) as f64 / 3.0))
        .filter(|(_, n, b)| *n >= 3 && *n as f64 >= 2.0 * b + 1.0)
        .collect();
    if out.is_empty() {
        return None;
    }
    out.sort_by(|a, b| {
        let growth = |x: &(&str, i64, f64)| x.1 as f64 - x.2;
        growth(b).partial_cmp(&growth(a)).unwrap_or(std::cmp::Ordering::Equal).then_with(|| a.0.cmp(b.0))
    });
    out.truncate(10);
    Some(Insight::Rising {
        songs: out.iter().map(|x| x.0.to_string()).collect(),
        recent: out.iter().map(|x| x.1).collect(),
        before: out.iter().map(|x| (x.2 * 10.0).round() / 10.0).collect(),
    })
}

/// The island played most more this month than the last, and the one played most less (each with
/// a change of five plays or more), from the taste map's islands.
pub fn islands(h: &History) -> Option<Insight> {
    if h.island_names.is_empty() {
        return None;
    }
    let month = 30 * DAY_MS;
    let mut now: HashMap<usize, i64> = HashMap::new();
    let mut then: HashMap<usize, i64> = HashMap::new();
    for p in &h.plays {
        let Some(&island) = h.island_of.get(&p.song_id) else { continue };
        if !h.island_names.contains_key(&island) {
            continue;
        }
        if p.at >= h.now - month {
            *now.entry(island).or_default() += 1;
        } else if p.at >= h.now - 2 * month {
            *then.entry(island).or_default() += 1;
        }
    }
    let all: HashSet<usize> = now.keys().chain(then.keys()).copied().collect();
    let mut change: Vec<(usize, i64, i64)> =
        all.into_iter().map(|i| (i, now.get(&i).copied().unwrap_or(0), then.get(&i).copied().unwrap_or(0))).collect();
    change.sort_by_key(|c| (c.1 - c.2, c.0));
    let named = |c: &(usize, i64, i64)| (c.0, h.island_names[&c.0].clone(), c.1, c.2);
    let faded = change.first().filter(|c| c.2 - c.1 >= 5).map(named);
    let grew = change.last().filter(|c| c.1 - c.2 >= 5).map(named);
    (grew.is_some() || faded.is_some()).then_some(Insight::Islands { grew, faded })
}

/// The three-hour window (local time) with most plays of the last 90 days, once there are 30.
pub fn hours(h: &History) -> Option<Insight> {
    let recent: Vec<&Heard> = plays_in(h, h.now - 90 * DAY_MS, h.now + 1).collect();
    if recent.len() < 30 {
        return None;
    }
    let mut by_hour = [0usize; 24];
    for p in &recent {
        by_hour[local_hour(p) as usize] += 1;
    }
    let (from, plays) = (0..24u32)
        .map(|s| (s, (0..3).map(|k| by_hour[((s + k) % 24) as usize]).sum::<usize>()))
        .max_by_key(|x| (x.1, 24 - x.0))?;
    Some(Insight::Hours { from, to: (from + 3) % 24, share: plays as f64 / recent.len() as f64, plays: recent.len() })
}

/// Every insight the history supports, in the order Stats shows them.
pub fn all(h: &History) -> Vec<Insight> {
    [week(h), out_of_rotation(h), rising(h), islands(h), hours(h)].into_iter().flatten().collect()
}

/// The history from the database: heard plays of the last 120 days in their context, songs heard
/// before, duel wins, and `map`'s islands (named as the map names them, or by their two leading
/// artists, as Home's mix does).
pub fn stored(db: &crate::db::Db, map: Option<&crate::tastemap::TasteMap>, now: i64) -> crate::Result<History> {
    let since = now - 120 * DAY_MS;
    let c = crate::listening::Classified::load(db.conn(), since)?;
    let plays: Vec<Heard> = c
        .heard()
        .map(|i| &c.plays[i])
        .filter(|p| p.heard_ms >= 30_000 || (p.duration_ms > 0 && p.heard_ms * 2 >= p.duration_ms))
        .map(|p| Heard {
            song_id: p.song_id.clone(),
            at: p.started_at,
            heard_ms: p.heard_ms,
            utc_offset_min: p.utc_offset_min,
        })
        .collect();
    let before_day = crate::time::local_day(since, 0);
    let heard_before: HashSet<String> = db
        .conn()
        .prepare(
            "SELECT DISTINCT song_id FROM play_daily WHERE plays > 0 AND day < ?1
             UNION SELECT song_id FROM legacy_daily WHERE song_id IS NOT NULL AND l > 0 AND day < ?1",
        )?
        .query_map([&before_day], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    let duel_wins: Vec<(String, i64)> = db
        .conn()
        .prepare(
            "SELECT CASE outcome WHEN 'a' THEN song_a ELSE song_b END, at FROM duels
             WHERE outcome IN ('a', 'b') AND imported = 0 AND at >= ?1",
        )?
        .query_map([since], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?;
    let mut island_of = HashMap::new();
    let mut island_names = HashMap::new();
    if let Some(map) = map {
        for p in &map.points {
            island_of.insert(p.song_id.clone(), p.island);
        }
        island_names = crate::tastemap::island_names(map, &crate::tastemap::first_artists(db)?);
    }
    Ok(History { plays, heard_before, duel_wins, island_of, island_names, now })
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: i64 = 1_800_000_000_000 - 1_800_000_000_000 % DAY_MS + 12 * 3_600_000; // noon UTC

    fn play(song: &str, days_ago: f64) -> Heard {
        Heard {
            song_id: song.into(),
            at: NOW - (days_ago * DAY_MS as f64) as i64,
            heard_ms: 180_000,
            utc_offset_min: 0,
        }
    }

    fn history(plays: Vec<Heard>) -> History {
        let mut plays = plays;
        plays.sort_by_key(|p| p.at);
        History { plays, now: NOW, ..Default::default() }
    }

    #[test]
    fn this_week_against_the_last_with_songs_heard_for_the_first_time() {
        let h = history(vec![play("a", 1.0), play("b", 2.0), play("c", 3.0), play("a", 9.0), play("b", 10.0)]);
        assert_eq!(
            week(&h),
            Some(Insight::Week { heard_ms: 540_000, before_ms: 360_000, songs: 3, songs_before: 2, first_time: 1 })
        );
        assert_eq!(week(&history(vec![play("a", 1.0)])), None, "no week before: nothing to compare");
    }

    #[test]
    fn out_of_rotation_is_what_was_loved_and_stopped() {
        let mut plays: Vec<Heard> = (0..6).map(|k| play("gone", 40.0 + k as f64 * 5.0)).collect();
        plays.extend((0..6).map(|k| play("kept", 40.0 + k as f64 * 5.0)));
        plays.push(play("kept", 3.0));
        plays.extend((0..3).map(|k| play("light", 45.0 + k as f64)));
        let h = history(plays);
        assert_eq!(out_of_rotation(&h), Some(Insight::OutOfRotation { songs: vec!["gone".into()], plays: vec![6] }));
        assert_eq!(out_of_rotation(&history(vec![play("x", 2.0)])), None);
    }

    #[test]
    fn rising_counts_plays_and_duel_wins_against_the_weeks_before() {
        let mut plays: Vec<Heard> = (0..5).map(|k| play("up", 1.0 + k as f64)).collect();
        plays.extend((0..5).map(|k| play("steady", 1.0 + k as f64)));
        plays.extend((0..9).map(|k| play("steady", 15.0 + k as f64 * 4.0)));
        plays.push(play("duelled", 2.0));
        let mut h = history(plays);
        h.duel_wins = vec![("duelled".into(), NOW - DAY_MS), ("duelled".into(), NOW - 2 * DAY_MS)];
        let Some(Insight::Rising { songs, .. }) = rising(&h) else { panic!("rising") };
        assert_eq!(songs, ["up", "duelled"], "steady (5 against 3 a fortnight) is not rising");
    }

    #[test]
    fn islands_that_grew_and_faded_this_month() {
        let mut plays: Vec<Heard> = (0..8).map(|k| play("x1", 1.0 + k as f64)).collect();
        plays.extend((0..7).map(|k| play("y1", 35.0 + k as f64)));
        plays.extend((0..2).map(|k| play("y1", 5.0 + k as f64)));
        let mut h = history(plays);
        h.island_of = [("x1".to_owned(), 0), ("y1".to_owned(), 1)].into();
        h.island_names = [(0, "Night".to_owned()), (1, "Morning".to_owned())].into();
        assert_eq!(
            islands(&h),
            Some(Insight::Islands { grew: Some((0, "Night".into(), 8, 0)), faded: Some((1, "Morning".into(), 2, 7)) })
        );
        h.island_names.clear();
        assert_eq!(islands(&h), None, "no map, no islands");
    }

    #[test]
    fn hours_need_thirty_plays_and_find_the_busiest_three() {
        let at_hour = |hour: i64, d: i64| Heard {
            song_id: "s".into(),
            at: NOW - 12 * 3_600_000 - d * DAY_MS + hour * 3_600_000,
            heard_ms: 1,
            utc_offset_min: 0,
        };
        let mut plays: Vec<Heard> = (1..=20).map(|d| at_hour(22, d)).collect();
        plays.extend((1..=10).map(|d| at_hour(23, d)));
        plays.extend((1..=5).map(|d| at_hour(9, d)));
        let h = history(plays);
        let Some(Insight::Hours { from, to, plays, .. }) = hours(&h) else { panic!("hours") };
        assert_eq!((from, to, plays), (21, 0, 35));
        assert_eq!(hours(&history((1..=10).map(|d| at_hour(22, d)).collect())), None);
        assert!(all(&history(vec![])).is_empty(), "no history, no insights");
    }
}

#[cfg(test)]
mod real {
    /// P20.2: the insights of a copy of a real profile (`NEMORA_REAL_DB`), printed for the plan.
    #[test]
    #[ignore]
    fn real_profile_insights() {
        let Ok(path) = std::env::var("NEMORA_REAL_DB") else { return };
        let db = crate::db::Db::open(std::path::Path::new(&path)).unwrap();
        let map = crate::tastemap::build(&db, None, false).ok();
        let started = std::time::Instant::now();
        let history = super::stored(&db, map.as_ref(), crate::db::now_ms()).unwrap();
        for insight in super::all(&history) {
            println!("INSIGHT {}", serde_json::to_string(&insight).unwrap());
        }
        println!("INSIGHTS read and made in {:?} from {} plays", started.elapsed(), history.plays.len());
    }
}

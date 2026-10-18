//! Recap: a month or a year of listening as slides (1.1.9 `recap.ts`, on the 2.0 day rows).
//!
//! Plays are counted per local day, as everywhere else. Ties that 1.1.9 broke with the locale's
//! string order break here on the normalised title, the same collation the lists use.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use serde::Serialize;

use crate::db::Db;
use crate::error::Result;
use crate::search::fold::normalize;
use crate::time::{civil_from_days, days_from_civil, parse_day};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Period {
    Month { year: i64, month: i64 },
    Year { year: i64 },
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SongCount {
    pub song_id: String,
    pub title: String,
    pub artists: Vec<String>,
    pub listens: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Slide {
    Listening {
        total_listens: i64,
        approx_listening_time_sec: i64,
        year: i64,
        year_total_listens: i64,
        year_share: f64,
    },
    TopSongs {
        songs: Vec<SongCount>,
    },
    TopArtist {
        artist: String,
        listens: i64,
        peak_month: i64,
        peak_month_listens: i64,
    },
    MostActiveDay {
        date: String,
        listens: i64,
        top_song: SongCount,
    },
    Discovery {
        song: SongCount,
        first_listen_date: String,
    },
    LongestStreak {
        days: i64,
        start_date: String,
        end_date: String,
    },
    Tierlist {
        song: SongCount,
        tierlist_name: String,
        tier_name: String,
    },
    EloClimber {
        song: SongCount,
        rating_gain: f64,
        duels: i64,
    },
}

struct Song {
    title: String,
    artists: Vec<String>,
    duration_sec: f64,
}

fn day_string(days: i64) -> String {
    let (y, m, d) = civil_from_days(days);
    format!("{y:04}-{m:02}-{d:02}")
}

/// Inclusive first day and exclusive end day of the period, and of its year.
fn bounds(period: Period) -> ((i64, i64), (i64, i64), i64) {
    let (year, range) = match period {
        Period::Month { year, month } => {
            let start = days_from_civil(year, month, 1);
            let end = if month == 12 { days_from_civil(year + 1, 1, 1) } else { days_from_civil(year, month + 1, 1) };
            (year, (start, end))
        }
        Period::Year { year } => (year, (days_from_civil(year, 1, 1), days_from_civil(year + 1, 1, 1))),
    };
    (range, (days_from_civil(year, 1, 1), days_from_civil(year + 1, 1, 1)), year)
}

fn compare(a: &SongCount, b: &SongCount) -> std::cmp::Ordering {
    b.listens
        .cmp(&a.listens)
        .then_with(|| normalize(&a.title).cmp(&normalize(&b.title)))
        .then_with(|| a.song_id.cmp(&b.song_id))
}

/// The slides of a period; `utc_offset_min` places duels (stored in UTC) on local days.
pub fn recap(db: &Db, period: Period, utc_offset_min: i64) -> Result<Vec<Slide>> {
    let ((start, end), (year_start, year_end), year) = bounds(period);
    let conn = db.conn();

    let mut songs: HashMap<String, Song> = HashMap::new();
    let mut stmt = conn.prepare(
        "SELECT v.song_id, v.title, t.duration_ms,
                (SELECT group_concat(name, char(31)) FROM (SELECT name FROM variant_artists a
                   WHERE a.variant_id = v.variant_id AND a.role = 'artist' ORDER BY position))
         FROM track_variants v JOIN tracks t USING (song_id)
         WHERE v.present = 1 AND v.variant_id = (SELECT min(w.variant_id) FROM track_variants w WHERE w.song_id = v.song_id AND w.present = 1)",
    )?;
    for row in stmt.query_map([], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?, r.get::<_, Option<String>>(3)?))
    })? {
        let (id, title, duration_ms, artists) = row?;
        let artists = artists.map(|a| a.split('\u{1f}').map(str::to_owned).collect()).unwrap_or_default();
        songs.insert(id, Song { title, artists, duration_sec: duration_ms as f64 / 1000.0 });
    }
    let count = |id: &str, listens: i64| {
        let s = &songs[id];
        SongCount { song_id: id.to_owned(), title: s.title.clone(), artists: s.artists.clone(), listens }
    };

    // (day number, song, plays) of every day with plays, for songs in the library.
    let mut events: Vec<(i64, String, i64)> = Vec::new();
    let mut stmt = conn.prepare(&format!(
        "SELECT day, song_id, sum(plays) FROM ({}) GROUP BY day, song_id HAVING sum(plays) > 0",
        crate::stats::DAY_ROWS
    ))?;
    for row in stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?)))? {
        let (day, song, plays) = row?;
        if let Some(d) = parse_day(&day)
            && songs.contains_key(&song)
        {
            events.push((d, song, plays));
        }
    }
    let in_period: Vec<&(i64, String, i64)> = events.iter().filter(|(d, _, _)| *d >= start && *d < end).collect();
    let year_total: i64 = events.iter().filter(|(d, _, _)| *d >= year_start && *d < year_end).map(|e| e.2).sum();

    let mut by_song: HashMap<&str, i64> = HashMap::new();
    for (_, song, n) in &in_period {
        *by_song.entry(song.as_str()).or_default() += n;
    }
    let total: i64 = in_period.iter().map(|e| e.2).sum();
    let seconds: f64 = by_song.iter().map(|(id, n)| songs[*id].duration_sec * *n as f64).sum();
    let mut slides = vec![Slide::Listening {
        total_listens: total,
        approx_listening_time_sec: seconds.round() as i64,
        year,
        year_total_listens: year_total,
        year_share: if year_total > 0 { total as f64 / year_total as f64 } else { 0.0 },
    }];

    let mut ranked: Vec<SongCount> = by_song.iter().map(|(id, n)| count(id, *n)).collect();
    ranked.sort_by(compare);
    if !ranked.is_empty() {
        slides.push(Slide::TopSongs { songs: ranked.iter().take(5).cloned().collect() });
    }

    // Artists by folded name, with their plays per month.
    let mut artists: HashMap<String, (String, i64, BTreeMap<i64, i64>)> = HashMap::new();
    for (day, song, n) in &in_period {
        let month = civil_from_days(*day).1;
        for name in &songs[song.as_str()].artists {
            let entry = artists.entry(name.trim().to_lowercase()).or_insert_with(|| (name.clone(), 0, BTreeMap::new()));
            entry.1 += n;
            *entry.2.entry(month).or_default() += n;
        }
    }
    let top_artist =
        artists.into_values().max_by(|a, b| a.1.cmp(&b.1).then_with(|| normalize(&b.0).cmp(&normalize(&a.0))));
    if let Some((name, listens, months)) = top_artist {
        let (peak_month, peak) =
            months.into_iter().max_by(|a, b| a.1.cmp(&b.1).then_with(|| b.0.cmp(&a.0))).unwrap_or((1, 0));
        slides.push(Slide::TopArtist { artist: name, listens, peak_month, peak_month_listens: peak });
    }

    let mut by_day: BTreeMap<i64, HashMap<&str, i64>> = BTreeMap::new();
    for (day, song, n) in &in_period {
        *by_day.entry(*day).or_default().entry(song.as_str()).or_default() += n;
    }
    let active = by_day.iter().max_by(|a, b| {
        let (sa, sb): (i64, i64) = (a.1.values().sum(), b.1.values().sum());
        sa.cmp(&sb).then_with(|| b.0.cmp(a.0))
    });
    if let Some((day, counts)) = active {
        let mut day_songs: Vec<SongCount> = counts.iter().map(|(id, n)| count(id, *n)).collect();
        day_songs.sort_by(compare);
        slides.push(Slide::MostActiveDay {
            date: day_string(*day),
            listens: counts.values().sum(),
            top_song: day_songs.remove(0),
        });
    }

    let mut first_heard: HashMap<&str, i64> = HashMap::new();
    for (day, song, _) in &events {
        let first = first_heard.entry(song.as_str()).or_insert(*day);
        *first = (*first).min(*day);
    }
    let discovery = ranked
        .iter()
        .find(|s| s.listens >= 2 && first_heard.get(s.song_id.as_str()).is_some_and(|d| *d >= start && *d < end));
    if let Some(song) = discovery {
        slides.push(Slide::Discovery {
            song: song.clone(),
            first_listen_date: day_string(first_heard[song.song_id.as_str()]),
        });
    }

    let days: BTreeSet<i64> = by_day.keys().copied().collect();
    let mut best: Option<(i64, i64, i64)> = None;
    let (mut run_start, mut previous) = (0, i64::MIN);
    for day in days {
        if previous == i64::MIN || day != previous + 1 {
            run_start = day;
        }
        let length = day - run_start + 1;
        if best.is_none_or(|(l, _, _)| length > l) {
            best = Some((length, run_start, day));
        }
        previous = day;
    }
    if let Some((length, from, to)) = best {
        slides.push(Slide::LongestStreak { days: length, start_date: day_string(from), end_date: day_string(to) });
    }

    // The best placed song of any tierlist that was heard in the period.
    let mut tier_best: Option<(usize, SongCount, String, String)> = None;
    for (_, doc) in crate::playlists::tierlists(db)? {
        let name = doc["name"].as_str().unwrap_or("").to_owned();
        for (index, tier) in doc["tiers"].as_array().into_iter().flatten().enumerate() {
            for id in tier["items"].as_array().into_iter().flatten().filter_map(|v| v.as_str()) {
                let Some(listens) = by_song.get(id).copied() else { continue };
                let candidate =
                    (index, count(id, listens), name.clone(), tier["name"].as_str().unwrap_or("").to_owned());
                let better = match &tier_best {
                    None => true,
                    Some(b) => candidate
                        .0
                        .cmp(&b.0)
                        .then_with(|| compare(&candidate.1, &b.1))
                        .then_with(|| normalize(&candidate.2).cmp(&normalize(&b.2)))
                        .is_lt(),
                };
                if better {
                    tier_best = Some(candidate);
                }
            }
        }
    }
    if let Some((_, song, tierlist_name, tier_name)) = tier_best {
        slides.push(Slide::Tierlist { song, tierlist_name, tier_name });
    }

    // The song that gained the most rating in the period's duels.
    let offset_ms = utc_offset_min * 60_000;
    let (from_ms, to_ms) = (start * 86_400_000 - offset_ms, end * 86_400_000 - offset_ms);
    let mut gains: HashMap<String, (f64, i64)> = HashMap::new();
    let mut stmt = conn.prepare(
        "SELECT song_a, song_b, coalesce(delta_a, 0), coalesce(delta_b, 0) FROM duels
         WHERE outcome <> 'skip' AND at >= ?1 AND at < ?2",
    )?;
    for row in stmt.query_map([from_ms, to_ms], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, f64>(2)?, r.get::<_, f64>(3)?))
    })? {
        let (a, b, da, db_) = row?;
        for (id, delta) in [(a, da), (b, db_)] {
            if songs.contains_key(&id) {
                let entry = gains.entry(id).or_default();
                entry.0 += delta;
                entry.1 += 1;
            }
        }
    }
    let climber = gains.into_iter().filter(|(_, (g, _))| *g > 0.0).max_by(|a, b| {
        a.1.0
            .partial_cmp(&b.1.0)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| normalize(&songs[&b.0].title).cmp(&normalize(&songs[&a.0].title)))
    });
    if let Some((id, (gain, duels))) = climber {
        let listens = by_song.get(id.as_str()).copied().unwrap_or(0);
        slides.push(Slide::EloClimber { song: count(&id, listens), rating_gain: (gain * 10.0).round() / 10.0, duels });
    }
    Ok(slides)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_month_ends_where_the_next_begins() {
        let ((start, end), (ys, ye), year) = bounds(Period::Month { year: 2026, month: 12 });
        assert_eq!((day_string(start), day_string(end), year), ("2026-12-01".into(), "2027-01-01".into(), 2026));
        assert_eq!((day_string(ys), day_string(ye)), ("2026-01-01".into(), "2027-01-01".into()));
    }

    #[test]
    fn slides_serialize_in_the_1x_shape() {
        let s = Slide::LongestStreak { days: 3, start_date: "a".into(), end_date: "b".into() };
        assert_eq!(
            serde_json::to_string(&s).unwrap(),
            r#"{"kind":"longestStreak","days":3,"startDate":"a","endDate":"b"}"#
        );
    }
}

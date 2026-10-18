//! The statistics dashboard (1.1.9 `getStatsData.ts`, on the 2.0 data).
//!
//! Everything is computed from day rows: the roll-ups of this device's own play events and the
//! imported 1.x days (their plays: see `spec/schema-v1.md`, "Imported days"). Differences from 1.1.9, all deliberate:
//! - full listens and skips follow the selected range (1.x stored them as all-time scalars);
//! - listening time of own events is what was actually heard; imported days count plays x length;
//! - songs whose file is gone still count (decision of 2026-10-18), blacklisted ones are left out of
//!   the top lists as before.

use std::collections::{BTreeMap, HashMap};

use rusqlite::params;

use crate::db::Db;
use crate::error::Result;
use crate::search::fold::normalize;
use crate::time::{civil_from_days, parse_day};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Range {
    AllTime,
    Last12Months,
    Last30Days,
    Year(i64),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SongEntry {
    pub song_id: String,
    pub title: String,
    pub artists: Vec<String>,
    pub cover_hash: Option<String>,
    pub plays: i64,
    pub skips: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NameEntry {
    pub name: String,
    pub plays: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Bucket {
    /// `YYYY-MM-DD` of the bucket start.
    pub label: String,
    pub plays: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Calendar {
    /// The trailing 371 days (53 weeks) ending today.
    pub days: Vec<Bucket>,
    pub current_streak: i64,
    pub longest_streak: i64,
    pub most_active_day: Option<Bucket>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Totals {
    pub distinct_songs: i64,
    pub plays: i64,
    pub full: i64,
    pub skips: i64,
    pub listening_ms: i64,
    pub favorites: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Dashboard {
    pub range: Range,
    /// Years with at least one play, newest first.
    pub available_years: Vec<i64>,
    /// 24 local hours.
    pub hours: Vec<i64>,
    /// When hour-level data starts: imported history before 1.1.0 has day resolution only.
    pub hours_since: Option<String>,
    /// Monday first.
    pub weekdays: Vec<i64>,
    pub totals: Totals,
    pub activity: Vec<Bucket>,
    pub calendar: Calendar,
    pub top_songs: Vec<SongEntry>,
    pub top_artists: Vec<NameEntry>,
    pub top_albums: Vec<NameEntry>,
    pub top_genres: Vec<NameEntry>,
    pub most_skipped: Vec<SongEntry>,
}

const TOP_SONGS: usize = 25;
const TOP_NAMES: usize = 10;
const CALENDAR_DAYS: i64 = 371;

/// Day rows of every source: (song_id, day, plays, full, skips, heard_ms or NULL for imported).
const DAY_ROWS: &str = "SELECT song_id, day, plays, full, skips, heard_ms FROM play_daily
     UNION ALL SELECT song_id, day, plays, f, s, NULL FROM legacy_daily WHERE song_id IS NOT NULL";

fn day_string(days: i64) -> String {
    let (y, m, d) = civil_from_days(days);
    format!("{y:04}-{m:02}-{d:02}")
}

/// Monday = 0 (1970-01-01 was a Thursday).
fn weekday(days: i64) -> usize {
    (days + 3).rem_euclid(7) as usize
}

/// Inclusive day bounds of a range, as `YYYY-MM-DD`.
fn bounds(range: Range, today: i64) -> (String, String) {
    match range {
        Range::AllTime => ("0000-00-00".to_owned(), "9999-99-99".to_owned()),
        Range::Last30Days => (day_string(today - 29), day_string(today)),
        Range::Last12Months => (day_string(today - 364), day_string(today)),
        Range::Year(y) => (format!("{y:04}-01-01"), format!("{y:04}-12-31")),
    }
}

/// The dashboard for `range`, with `today` the device's local date (`YYYY-MM-DD`).
pub fn dashboard(db: &Db, range: Range, today: &str) -> Result<Dashboard> {
    let today_days = parse_day(today).unwrap_or(0);
    let (from, to) = bounds(range, today_days);
    let conn = db.conn();

    // Per-day plays of everything, for the calendar, the years and the activity buckets.
    let mut per_day: BTreeMap<String, i64> = BTreeMap::new();
    let mut stmt = conn.prepare(&format!("SELECT day, sum(plays) FROM ({DAY_ROWS}) GROUP BY day"))?;
    for row in stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))? {
        let (day, plays) = row?;
        per_day.insert(day, plays);
    }

    // Per-song figures inside the range.
    let mut per_song: HashMap<String, (i64, i64, i64, i64)> = HashMap::new();
    let mut stmt = conn.prepare(&format!(
        "SELECT d.song_id, sum(d.plays), sum(d.full), sum(d.skips),
                sum(coalesce(d.heard_ms, d.plays * t.duration_ms))
         FROM ({DAY_ROWS}) d JOIN tracks t ON t.song_id = d.song_id
         WHERE d.day BETWEEN ?1 AND ?2 GROUP BY d.song_id"
    ))?;
    for row in stmt
        .query_map(params![from, to], |r| Ok((r.get::<_, String>(0)?, (r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))))?
    {
        let (song, figures) = row?;
        per_song.insert(song, figures);
    }

    let totals = Totals {
        distinct_songs: per_song.values().filter(|f| f.0 > 0).count() as i64,
        plays: per_song.values().map(|f| f.0).sum(),
        full: per_song.values().map(|f| f.1).sum(),
        skips: per_song.values().map(|f| f.2).sum(),
        listening_ms: per_song.values().map(|f| f.3).sum(),
        favorites: conn.query_row("SELECT count(*) FROM favorites WHERE value = 1", [], |r| r.get(0))?,
    };

    let mut weekdays = vec![0i64; 7];
    for (day, plays) in per_day.range(from.clone()..=to.clone()) {
        if let Some(d) = parse_day(day) {
            weekdays[weekday(d)] += plays;
        }
    }

    let (hours, hours_since) = hour_histogram(db, &from, &to)?;
    let available_years = {
        let mut years: Vec<i64> =
            per_day.iter().filter(|(_, p)| **p > 0).filter_map(|(d, _)| d[..4].parse().ok()).collect();
        years.dedup();
        years.reverse();
        years
    };

    let display = song_display(db)?;
    let blacklisted: std::collections::HashSet<String> = conn
        .prepare("SELECT song_id FROM blacklist_songs WHERE value = 1")?
        .query_map([], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    let entry = |song: &str, f: &(i64, i64, i64, i64)| -> Option<SongEntry> {
        let (title, artists, cover) = display.get(song)?.clone();
        Some(SongEntry { song_id: song.to_owned(), title, artists, cover_hash: cover, plays: f.0, skips: f.2 })
    };
    let visible: Vec<(&String, &(i64, i64, i64, i64))> =
        per_song.iter().filter(|(s, _)| !blacklisted.contains(*s)).collect();

    let mut top_songs: Vec<SongEntry> =
        visible.iter().filter(|(_, f)| f.0 > 0).filter_map(|(s, f)| entry(s, f)).collect();
    top_songs.sort_by(|a, b| {
        b.plays
            .cmp(&a.plays)
            .then_with(|| normalize(&a.title).cmp(&normalize(&b.title)))
            .then_with(|| a.song_id.cmp(&b.song_id))
    });
    top_songs.truncate(TOP_SONGS);

    let mut most_skipped: Vec<SongEntry> =
        visible.iter().filter(|(_, f)| f.2 > 0).filter_map(|(s, f)| entry(s, f)).collect();
    most_skipped.sort_by(|a, b| {
        b.skips
            .cmp(&a.skips)
            .then_with(|| normalize(&a.title).cmp(&normalize(&b.title)))
            .then_with(|| a.song_id.cmp(&b.song_id))
    });
    most_skipped.truncate(TOP_NAMES);

    let plays_of = |s: &str| per_song.get(s).map_or(0, |f| f.0);
    let names = |sql: &str| -> Result<Vec<NameEntry>> {
        let mut totals: HashMap<String, i64> = HashMap::new();
        let mut stmt = conn.prepare(sql)?;
        for row in stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
            let (song, name) = row?;
            if !blacklisted.contains(&song) {
                *totals.entry(name).or_default() += plays_of(&song);
            }
        }
        let mut list: Vec<NameEntry> =
            totals.into_iter().filter(|(_, p)| *p > 0).map(|(name, plays)| NameEntry { name, plays }).collect();
        list.sort_by(|a, b| {
            b.plays
                .cmp(&a.plays)
                .then_with(|| normalize(&a.name).cmp(&normalize(&b.name)))
                .then_with(|| a.name.cmp(&b.name))
        });
        list.truncate(TOP_NAMES);
        Ok(list)
    };
    // One credit per song and name, whatever the number of variants.
    let top_artists = names(
        "SELECT DISTINCT v.song_id, a.name FROM variant_artists a JOIN track_variants v USING (variant_id) WHERE a.role = 'artist'",
    )?;
    let top_albums = names("SELECT DISTINCT song_id, album FROM track_variants WHERE album IS NOT NULL")?;
    let top_genres =
        names("SELECT DISTINCT v.song_id, g.name FROM variant_genres g JOIN track_variants v USING (variant_id)")?;

    Ok(Dashboard {
        range,
        available_years,
        hours,
        hours_since,
        weekdays,
        totals,
        activity: activity(&per_day, range, today_days),
        calendar: calendar(&per_day, today_days),
        top_songs,
        top_artists,
        top_albums,
        top_genres,
        most_skipped,
    })
}

/// Own events count plays per hour; imported days carry 1.x's hour histogram of listens.
fn hour_histogram(db: &Db, from: &str, to: &str) -> Result<(Vec<i64>, Option<String>)> {
    let conn = db.conn();
    let mut hours = vec![0i64; 24];
    let mut since: Option<String> = None;
    let mut note = |day: String| {
        if since.as_ref().is_none_or(|s| day < *s) {
            since = Some(day);
        }
    };
    let mut stmt = conn.prepare("SELECT day, hour, plays FROM play_hourly")?;
    for row in stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?)))? {
        let (day, hour, plays) = row?;
        if (from..=to).contains(&day.as_str()) && (0..24).contains(&hour) {
            hours[hour as usize] += plays;
        }
        note(day);
    }
    let mut stmt =
        conn.prepare("SELECT day, hours FROM legacy_daily WHERE song_id IS NOT NULL AND hours IS NOT NULL")?;
    for row in stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
        let (day, json) = row?;
        if (from..=to).contains(&day.as_str())
            && let Ok(map) = serde_json::from_str::<HashMap<String, i64>>(&json)
        {
            for (hour, n) in map {
                if let Ok(h) = hour.parse::<usize>()
                    && h < 24
                {
                    hours[h] += n;
                }
            }
        }
        note(day);
    }
    Ok((hours, since))
}

/// Title, artists and cover of a song, from its most recently seen variant (present ones first).
fn song_display(db: &Db) -> Result<HashMap<String, (String, Vec<String>, Option<String>)>> {
    let mut stmt = db.conn().prepare(
        "SELECT v.song_id, v.title, v.cover_hash,
                (SELECT group_concat(name, char(31)) FROM (SELECT name FROM variant_artists a
                   WHERE a.variant_id = v.variant_id AND a.role = 'artist' ORDER BY position))
         FROM track_variants v ORDER BY v.present, v.last_seen_at, v.variant_id",
    )?;
    let mut out = HashMap::new();
    for row in stmt.query_map([], |r| {
        let artists: Option<String> = r.get(3)?;
        Ok((
            r.get::<_, String>(0)?,
            (
                r.get::<_, String>(1)?,
                artists.map(|a| a.split('\u{1f}').map(str::to_owned).collect()).unwrap_or_default(),
                r.get::<_, Option<String>>(2)?,
            ),
        ))
    })? {
        let (song, display) = row?;
        // Later rows win: present and most recently seen come last in the order above.
        out.insert(song, display);
    }
    Ok(out)
}

fn activity(per_day: &BTreeMap<String, i64>, range: Range, today: i64) -> Vec<Bucket> {
    let plays_between =
        |from: &str, to: &str| -> i64 { per_day.range(from.to_owned()..=to.to_owned()).map(|(_, p)| p).sum() };
    let month_bucket = |y: i64, m: i64| {
        let first = format!("{y:04}-{m:02}-01");
        let last = format!("{y:04}-{m:02}-31");
        Bucket { plays: plays_between(&first, &last), label: first }
    };
    match range {
        Range::Year(y) => (1..=12).map(|m| month_bucket(y, m)).collect(),
        Range::Last30Days => (0..30)
            .map(|i| {
                let day = day_string(today - 29 + i);
                Bucket { plays: per_day.get(&day).copied().unwrap_or(0), label: day }
            })
            .collect(),
        Range::AllTime | Range::Last12Months => {
            let (y, m, _) = civil_from_days(today);
            let now_index = y * 12 + (m - 1);
            (0..12)
                .map(|i| {
                    let index = now_index - 11 + i;
                    month_bucket(index.div_euclid(12), index.rem_euclid(12) + 1)
                })
                .collect()
        }
    }
}

fn calendar(per_day: &BTreeMap<String, i64>, today: i64) -> Calendar {
    let days: Vec<Bucket> = (0..CALENDAR_DAYS)
        .map(|i| {
            let day = day_string(today - (CALENDAR_DAYS - 1) + i);
            Bucket { plays: per_day.get(&day).copied().unwrap_or(0), label: day }
        })
        .collect();
    // The current streak counts back from today; a silent (so far) today does not end it.
    let mut cursor = days.len() as i64 - 1;
    if cursor >= 0 && days[cursor as usize].plays == 0 {
        cursor -= 1;
    }
    let mut current_streak = 0;
    while cursor >= 0 && days[cursor as usize].plays > 0 {
        current_streak += 1;
        cursor -= 1;
    }
    let (mut longest_streak, mut run) = (0, 0);
    let mut most_active_day: Option<Bucket> = None;
    for day in &days {
        run = if day.plays > 0 { run + 1 } else { 0 };
        longest_streak = longest_streak.max(run);
        if day.plays > 0 && most_active_day.as_ref().is_none_or(|m| day.plays > m.plays) {
            most_active_day = Some(day.clone());
        }
    }
    Calendar { days, current_streak, longest_streak, most_active_day }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::time::days_from_civil;

    fn seed(db: &Db) {
        let c = db.conn();
        for (song, title, artist, album, duration) in [
            ("a", "Alpha", "X", Some("One"), 200_000),
            ("b", "Beta", "Y", Some("One"), 100_000),
            ("c", "Gamma", "X", None, 300_000),
        ] {
            let id = song.repeat(26);
            c.execute("INSERT INTO tracks VALUES (?1, 'flac', 44100, 16, 2, ?2, NULL, 0, 0)", params![id, duration])
                .unwrap();
            c.execute(
                "INSERT INTO track_variants (song_id, tag_signature, title, title_sort, artist_sort, album, album_sort, last_seen_at)
                 VALUES (?1, 'sig', ?2, lower(?2), ?3, ?4, ?4, 0)",
                params![id, title, artist, album],
            )
            .unwrap();
            c.execute("INSERT INTO variant_artists VALUES (last_insert_rowid(), 'artist', 0, ?1)", [artist]).unwrap();
        }
        let a = "a".repeat(26);
        let b = "b".repeat(26);
        let c_ = "c".repeat(26);
        // Columns: song, day, starts, plays, full, skips, heard_ms.
        // Own events: a played 3 times on 2026-10-17 (a Saturday) and once on the 18th; b started
        // three times on the 16th (a Friday): one play, two skips.
        c.execute("INSERT INTO play_daily VALUES (?1, '2026-10-17', 3, 3, 3, 0, 500000)", [&a]).unwrap();
        c.execute("INSERT INTO play_daily VALUES (?1, '2026-10-18', 1, 1, 0, 0, 100000)", [&a]).unwrap();
        c.execute("INSERT INTO play_daily VALUES (?1, '2026-10-16', 3, 1, 0, 2, 40000)", [&b]).unwrap();
        c.execute("INSERT INTO play_hourly VALUES (?1, '2026-10-17', 21, 3)", [&a]).unwrap();
        // Imported 1.x days for c: l=5, s=1 -> 4 plays, with an hour histogram of listens.
        c.execute("INSERT INTO legacy_daily VALUES ('DEV', ?1, NULL, '2025-12-31', 5, 2, 1, '{\"9\": 5}', 0)", [&c_])
            .unwrap();
        crate::plays::recompute_legacy_plays(c).unwrap();
        c.execute("INSERT INTO favorites VALUES (?1, 1, 0, 'x')", [&a]).unwrap();
    }

    #[test]
    fn figures_follow_the_range() {
        let db = Db::open_in_memory().unwrap();
        seed(&db);
        let all = dashboard(&db, Range::AllTime, "2026-10-18").unwrap();
        assert_eq!(
            all.totals,
            Totals {
                distinct_songs: 3,
                plays: 9,
                full: 5,
                skips: 3,
                listening_ms: 500_000 + 100_000 + 40_000 + 4 * 300_000,
                favorites: 1
            }
        );
        assert_eq!(all.available_years, [2026, 2025]);
        assert_eq!(
            all.top_songs.iter().map(|s| (s.title.as_str(), s.plays)).collect::<Vec<_>>(),
            [("Alpha", 4), ("Gamma", 4), ("Beta", 1)]
        );
        assert_eq!(
            all.most_skipped.iter().map(|s| (s.title.as_str(), s.skips)).collect::<Vec<_>>(),
            [("Beta", 2), ("Gamma", 1)]
        );
        assert_eq!(
            all.top_artists,
            [NameEntry { name: "X".into(), plays: 8 }, NameEntry { name: "Y".into(), plays: 1 }]
        );
        assert_eq!(all.top_albums, [NameEntry { name: "One".into(), plays: 5 }]);
        assert_eq!(all.hours[21], 3);
        assert_eq!(all.hours[9], 5);
        assert_eq!(all.hours_since.as_deref(), Some("2025-12-31"));
        // 2025-12-31 was a Wednesday (2), 2026-10-16 a Friday (4), the 17th a Saturday, the 18th a Sunday.
        assert_eq!(all.weekdays, [0, 0, 4, 0, 1, 3, 1]);

        let month = dashboard(&db, Range::Last30Days, "2026-10-18").unwrap();
        assert_eq!(month.totals.plays, 5);
        assert_eq!(month.totals.distinct_songs, 2);
        assert_eq!(month.activity.len(), 30);
        assert_eq!(month.activity.last().unwrap(), &Bucket { label: "2026-10-18".into(), plays: 1 });

        let year = dashboard(&db, Range::Year(2025), "2026-10-18").unwrap();
        assert_eq!(year.totals.plays, 4);
        assert_eq!(year.activity[11], Bucket { label: "2025-12-01".into(), plays: 4 });
        assert_eq!(year.hours[21], 0);

        let months = dashboard(&db, Range::Last12Months, "2026-10-18").unwrap();
        assert_eq!(months.activity.first().unwrap().label, "2025-11-01");
        assert_eq!(months.activity.last().unwrap(), &Bucket { label: "2026-10-01".into(), plays: 5 });
    }

    #[test]
    fn streaks_tolerate_a_silent_today() {
        let db = Db::open_in_memory().unwrap();
        seed(&db);
        let d = dashboard(&db, Range::AllTime, "2026-10-19").unwrap();
        assert_eq!(d.calendar.days.len(), 371);
        // 16, 17, 18 October in a row; the 19th is silent so far.
        assert_eq!(d.calendar.current_streak, 3);
        assert_eq!(d.calendar.longest_streak, 3);
        // The imported 2025-12-31 (4 plays) is inside the trailing 53 weeks and beats the 17th.
        assert_eq!(d.calendar.most_active_day, Some(Bucket { label: "2025-12-31".into(), plays: 4 }));
        let later = dashboard(&db, Range::AllTime, "2026-10-21").unwrap();
        assert_eq!(later.calendar.current_streak, 0);
    }

    #[test]
    fn blacklisted_songs_leave_the_top_lists_only() {
        let db = Db::open_in_memory().unwrap();
        seed(&db);
        db.conn().execute("INSERT INTO blacklist_songs VALUES (?1, 1, 0, 'x')", ["a".repeat(26)]).unwrap();
        let d = dashboard(&db, Range::AllTime, "2026-10-18").unwrap();
        assert_eq!(d.totals.plays, 9);
        assert!(d.top_songs.iter().all(|s| s.title != "Alpha"));
        assert_eq!(d.top_artists[0], NameEntry { name: "X".into(), plays: 4 });
    }

    #[test]
    fn weekdays_start_on_monday() {
        assert_eq!(weekday(days_from_civil(2026, 10, 19)), 0, "2026-10-19 is a Monday");
        assert_eq!(weekday(0), 3, "1970-01-01 was a Thursday");
    }
}

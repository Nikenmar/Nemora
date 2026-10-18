//! Playback facts and listening definitions 2.0 (`spec/schema-v1.md`, "Derived values").
//!
//! The player reports what happened (play, pause, seek, end and why) with the media position at
//! each moment; the core decides what was heard and whether it was a play, a skip or a full listen.
//! Both platforms therefore count the same way. Facts are stored raw in `play_events`; the daily
//! and hourly roll-ups are a cache that `rebuild_rollups` can recompute after a definition change.

use rusqlite::{Connection, Transaction, params};

use crate::db::Db;
use crate::error::Result;
use crate::time::{local_day, local_hour};

/// A play needs this much heard, or half the track if it is shorter.
pub const PLAY_MIN_MS: i64 = 30_000;
/// A full listen needs this share of the track heard (or a natural end).
pub const FULL_SHARE: f64 = 0.9;
/// Seek targets this close together form one hot spot ...
pub const SEEK_WINDOW_MS: i64 = 5_000;
/// ... once this many seeks landed in it (1.x rule).
pub const SEEK_HOT_SPOT_MIN: i64 = 3;
/// Last.fm: a track must be longer than 30 s, and is scrobbled after half of it or 4 minutes.
const SCROBBLE_MIN_TRACK_MS: i64 = 30_000;
const SCROBBLE_CAP_MS: i64 = 240_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EndReason {
    Finished,
    UserNext,
    UserPrevious,
    UserSelected,
    Stopped,
    AppClosed,
    SleepTimer,
    QueueCleared,
    Error,
}

impl EndReason {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Finished => "finished",
            Self::UserNext => "user_next",
            Self::UserPrevious => "user_previous",
            Self::UserSelected => "user_selected",
            Self::Stopped => "stopped",
            Self::AppClosed => "app_closed",
            Self::SleepTimer => "sleep_timer",
            Self::QueueCleared => "queue_cleared",
            Self::Error => "error",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "finished" => Self::Finished,
            "user_next" => Self::UserNext,
            "user_previous" => Self::UserPrevious,
            "user_selected" => Self::UserSelected,
            "stopped" => Self::Stopped,
            "app_closed" => Self::AppClosed,
            "sleep_timer" => Self::SleepTimer,
            "queue_cleared" => Self::QueueCleared,
            "error" => Self::Error,
            _ => return None,
        })
    }

    /// Only the user leaving a track is a skip; stopping, closing or a timer is not.
    pub fn is_user_skip(self) -> bool {
        matches!(self, Self::UserNext | Self::UserPrevious | Self::UserSelected)
    }
}

/// One thing the player observed, with the media position at that moment.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Fact {
    Play { at_ms: i64, position_ms: i64 },
    Pause { at_ms: i64, position_ms: i64 },
    Seek { at_ms: i64, from_ms: i64, to_ms: i64 },
    End { at_ms: i64, position_ms: i64, reason: EndReason },
}

impl Fact {
    fn at(&self) -> i64 {
        match *self {
            Fact::Play { at_ms, .. }
            | Fact::Pause { at_ms, .. }
            | Fact::Seek { at_ms, .. }
            | Fact::End { at_ms, .. } => at_ms,
        }
    }
}

/// Everything the player knows about one session of one song.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Session {
    pub song_id: String,
    pub started_at: i64,
    pub utc_offset_min: i64,
    pub duration_ms: i64,
    pub source_kind: Option<String>,
    pub source_id: Option<String>,
    pub facts: Vec<Fact>,
}

/// What a session amounts to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Evaluation {
    pub ended_at: i64,
    pub heard_ms: i64,
    pub max_position_ms: i64,
    pub end_reason: EndReason,
    /// Seek hot spots: (position_ms, seeks).
    pub seeks: Vec<(i64, i64)>,
    pub is_play: bool,
    pub is_full: bool,
    pub is_skip: bool,
    pub scrobble: bool,
}

/// Applies the definitions to a session's facts. A session without an end fact ended at its last
/// fact (a crash), for reason `app_closed`.
pub fn evaluate(session: &Session) -> Evaluation {
    let mut facts = session.facts.clone();
    facts.sort_by_key(Fact::at);

    let mut heard = 0i64;
    let mut max_position = 0i64;
    let mut playing_from: Option<i64> = None;
    let mut seek_targets = Vec::new();
    let mut end = (facts.last().map_or(session.started_at, Fact::at), EndReason::AppClosed);

    let close_stretch = |playing_from: &mut Option<i64>, position: i64, heard: &mut i64| {
        if let Some(from) = playing_from.take() {
            *heard += (position - from).max(0);
        }
    };
    for fact in &facts {
        match *fact {
            Fact::Play { position_ms, .. } => {
                max_position = max_position.max(position_ms);
                if playing_from.is_none() {
                    playing_from = Some(position_ms);
                }
            }
            Fact::Pause { position_ms, .. } => {
                max_position = max_position.max(position_ms);
                close_stretch(&mut playing_from, position_ms, &mut heard);
            }
            Fact::Seek { from_ms, to_ms, .. } => {
                max_position = max_position.max(from_ms).max(to_ms);
                let was_playing = playing_from.is_some();
                close_stretch(&mut playing_from, from_ms, &mut heard);
                if was_playing {
                    playing_from = Some(to_ms);
                }
                seek_targets.push(to_ms);
            }
            Fact::End { at_ms, position_ms, reason } => {
                max_position = max_position.max(position_ms);
                close_stretch(&mut playing_from, position_ms, &mut heard);
                end = (at_ms, reason);
                break;
            }
        }
    }

    let duration = session.duration_ms.max(0);
    let threshold = if duration > 0 { PLAY_MIN_MS.min(duration / 2) } else { PLAY_MIN_MS };
    let is_play = heard >= threshold;
    let is_full = end.1 == EndReason::Finished || (duration > 0 && heard as f64 >= FULL_SHARE * duration as f64);
    let is_skip = !is_play && end.1.is_user_skip();
    let scrobble = duration > SCROBBLE_MIN_TRACK_MS && heard >= SCROBBLE_CAP_MS.min(duration / 2);
    Evaluation {
        ended_at: end.0,
        heard_ms: heard,
        max_position_ms: max_position,
        end_reason: end.1,
        seeks: hot_spots(&seek_targets),
        is_play,
        is_full,
        is_skip,
        scrobble,
    }
}

/// 1.x clustering: a target joins the first cluster whose centre is within the window, clusters
/// with at least `SEEK_HOT_SPOT_MIN` seeks are kept.
fn hot_spots(targets: &[i64]) -> Vec<(i64, i64)> {
    let mut clusters: Vec<(i64, i64)> = Vec::new();
    for &target in targets {
        match clusters.iter_mut().find(|(centre, _)| (target - *centre).abs() < SEEK_WINDOW_MS) {
            Some(cluster) => cluster.1 += 1,
            None => clusters.push((target, 1)),
        }
    }
    clusters.retain(|(_, n)| *n >= SEEK_HOT_SPOT_MIN);
    clusters
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Recorded {
    pub event_id: String,
    pub evaluation: Evaluation,
}

/// Stores a finished session and updates the roll-ups, in one transaction.
pub fn record(db: &mut Db, session: &Session) -> Result<Recorded> {
    let device_id = db.device_id()?;
    let evaluation = evaluate(session);
    let tx = db.conn_mut().transaction()?;
    let seq: i64 =
        tx.query_row("SELECT coalesce(max(seq), 0) + 1 FROM play_events WHERE device_id = ?1", [&device_id], |r| {
            r.get(0)
        })?;
    let event_id = format!("{device_id}:{seq}");
    let seeks = (!evaluation.seeks.is_empty()).then(|| serde_json::to_string(&evaluation.seeks)).transpose()?;
    tx.execute(
        "INSERT INTO play_events (event_id, device_id, seq, song_id, started_at, ended_at, utc_offset_min, heard_ms,
           duration_ms, max_position_ms, end_reason, source_kind, source_id, seeks)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        params![
            event_id,
            device_id,
            seq,
            session.song_id,
            session.started_at,
            evaluation.ended_at,
            session.utc_offset_min,
            evaluation.heard_ms,
            session.duration_ms,
            evaluation.max_position_ms,
            evaluation.end_reason.as_str(),
            session.source_kind,
            session.source_id,
            seeks
        ],
    )?;
    add_to_rollups(&tx, &session.song_id, session.started_at, session.utc_offset_min, &evaluation)?;
    tx.commit()?;
    db.touch();
    Ok(Recorded { event_id, evaluation })
}

fn add_to_rollups(tx: &Connection, song_id: &str, started_at: i64, offset: i64, e: &Evaluation) -> Result<()> {
    let day = local_day(started_at, offset);
    tx.execute(
        "INSERT INTO play_daily (song_id, day, starts, plays, full, skips, heard_ms) VALUES (?1, ?2, 1, ?3, ?4, ?5, ?6)
         ON CONFLICT(song_id, day) DO UPDATE SET starts = starts + 1, plays = plays + excluded.plays,
           full = full + excluded.full, skips = skips + excluded.skips, heard_ms = heard_ms + excluded.heard_ms",
        params![song_id, day, i64::from(e.is_play), i64::from(e.is_full), i64::from(e.is_skip), e.heard_ms],
    )?;
    tx.execute(
        "INSERT INTO song_totals (song_id, starts, plays, full, skips, heard_ms, last_day) VALUES (?1, 1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(song_id) DO UPDATE SET starts = starts + 1, plays = plays + excluded.plays, full = full + excluded.full,
           skips = skips + excluded.skips, heard_ms = heard_ms + excluded.heard_ms,
           last_day = max(coalesce(last_day, ''), excluded.last_day)",
        params![song_id, i64::from(e.is_play), i64::from(e.is_full), i64::from(e.is_skip), e.heard_ms, day],
    )?;
    if e.is_play {
        tx.execute(
            "INSERT INTO play_hourly (song_id, day, hour, plays) VALUES (?1, ?2, ?3, 1)
             ON CONFLICT(song_id, day, hour) DO UPDATE SET plays = plays + 1",
            params![song_id, day, local_hour(started_at, offset)],
        )?;
    }
    Ok(())
}

/// Songs by their latest session, newest first, each once: the listening history.
pub fn recent_songs(db: &Db, limit: usize) -> Result<Vec<String>> {
    let mut stmt = db
        .conn()
        .prepare("SELECT song_id FROM play_events GROUP BY song_id ORDER BY max(started_at) DESC, song_id LIMIT ?1")?;
    let ids = stmt.query_map([limit as i64], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
    Ok(ids)
}

/// Recomputes the roll-ups from the stored facts: after a definition change, or to check the cache.
pub fn rebuild_rollups(db: &mut Db) -> Result<()> {
    let tx = db.conn_mut().transaction()?;
    rebuild_in(&tx)?;
    tx.commit()?;
    db.touch();
    Ok(())
}

fn rebuild_in(tx: &Transaction<'_>) -> Result<()> {
    tx.execute("DELETE FROM play_daily", [])?;
    tx.execute("DELETE FROM play_hourly", [])?;
    tx.execute("DELETE FROM song_totals", [])?;
    let mut stmt = tx.prepare(
        "SELECT song_id, started_at, ended_at, utc_offset_min, heard_ms, duration_ms, max_position_ms, end_reason
         FROM play_events",
    )?;
    let rows: Vec<(String, i64, i64, i64, i64, i64, i64, String)> = stmt
        .query_map([], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?))
        })?
        .collect::<rusqlite::Result<_>>()?;
    drop(stmt);
    for (song_id, started_at, ended_at, offset, heard, duration, max_position, reason) in rows {
        let reason = EndReason::parse(&reason).unwrap_or(EndReason::AppClosed);
        let e = judge(heard, duration, reason, ended_at, max_position);
        add_to_rollups(tx, &song_id, started_at, offset, &e)?;
    }
    add_legacy_totals(tx)?;
    Ok(())
}

/// Recomputes the plays of imported days (`spec/schema-v1.md`, "Imported days"): per source and
/// song, `l - s` per day, with skips that had no start of their own that day taken from the oldest
/// days, so the song's total is `max(sum(l) - sum(s), 0)`.
pub(crate) fn recompute_legacy_plays(conn: &Connection) -> Result<()> {
    let rows: Vec<(i64, String, String, i64, i64)> = conn
        .prepare(
            "SELECT rowid, source_id, coalesce(song_id, 'pending:' || pending_id), l, s FROM legacy_daily
             ORDER BY source_id, coalesce(song_id, 'pending:' || pending_id), day, rowid",
        )?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)))?
        .collect::<rusqlite::Result<_>>()?;
    let mut update = conn.prepare_cached("UPDATE legacy_daily SET plays = ?2 WHERE rowid = ?1")?;
    let mut start = 0;
    while start < rows.len() {
        let mut end = start;
        while end < rows.len() && rows[end].1 == rows[start].1 && rows[end].2 == rows[start].2 {
            end += 1;
        }
        let group = &rows[start..end];
        let mut excess: i64 = group.iter().map(|r| (r.4 - r.3).max(0)).sum();
        for row in group {
            let mut plays = (row.3 - row.4).max(0);
            let taken = plays.min(excess);
            plays -= taken;
            excess -= taken;
            update.execute(rusqlite::params![row.0, plays])?;
        }
        start = end;
    }
    Ok(())
}

/// Recomputes `song_totals` from the roll-ups and the imported days.
pub(crate) fn rebuild_song_totals(conn: &Connection) -> Result<()> {
    conn.execute("DELETE FROM song_totals", [])?;
    conn.execute(
        "INSERT INTO song_totals (song_id, starts, plays, full, skips, heard_ms, last_day)
         SELECT song_id, sum(starts), sum(plays), sum(full), sum(skips), sum(heard_ms), max(day)
         FROM play_daily GROUP BY song_id",
        [],
    )?;
    add_legacy_totals(conn)
}

fn add_legacy_totals(conn: &Connection) -> Result<()> {
    conn.execute(
        "INSERT INTO song_totals (song_id, starts, plays, full, skips, heard_ms, last_day)
         SELECT song_id, sum(l), sum(plays), sum(f), sum(s), 0, max(day)
         FROM legacy_daily WHERE song_id IS NOT NULL GROUP BY song_id
         ON CONFLICT(song_id) DO UPDATE SET starts = starts + excluded.starts, plays = plays + excluded.plays,
           full = full + excluded.full, skips = skips + excluded.skips,
           last_day = max(coalesce(last_day, ''), excluded.last_day)",
        [],
    )?;
    Ok(())
}

/// The definitions applied to stored values (what `evaluate` derives from facts).
fn judge(heard: i64, duration: i64, reason: EndReason, ended_at: i64, max_position: i64) -> Evaluation {
    let session = Session {
        song_id: String::new(),
        started_at: 0,
        utc_offset_min: 0,
        duration_ms: duration,
        source_kind: None,
        source_id: None,
        facts: vec![Fact::Play { at_ms: 0, position_ms: 0 }, Fact::End { at_ms: ended_at, position_ms: heard, reason }],
    };
    Evaluation { max_position_ms: max_position, ..evaluate(&session) }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session(duration_ms: i64, facts: Vec<Fact>) -> Session {
        Session {
            song_id: "s".repeat(26),
            started_at: 0,
            utc_offset_min: 0,
            duration_ms,
            source_kind: None,
            source_id: None,
            facts,
        }
    }

    fn played(duration: i64, heard: i64, reason: EndReason) -> Evaluation {
        evaluate(&session(
            duration,
            vec![Fact::Play { at_ms: 0, position_ms: 0 }, Fact::End { at_ms: heard, position_ms: heard, reason }],
        ))
    }

    #[test]
    fn a_play_is_thirty_seconds_or_half_a_short_track() {
        assert!(!played(200_000, 29_999, EndReason::Stopped).is_play);
        assert!(played(200_000, 30_000, EndReason::Stopped).is_play);
        // A 40 s track counts at 20 s.
        assert!(played(40_000, 20_000, EndReason::Stopped).is_play);
        assert!(!played(40_000, 19_999, EndReason::Stopped).is_play);
        // An hour-long mix counts at 30 s, not at 6 minutes.
        assert!(played(3_600_000, 30_000, EndReason::Stopped).is_play);
    }

    #[test]
    fn only_the_user_leaving_early_is_a_skip() {
        assert!(played(200_000, 5_000, EndReason::UserNext).is_skip);
        assert!(played(200_000, 5_000, EndReason::UserSelected).is_skip);
        for reason in
            [EndReason::Stopped, EndReason::AppClosed, EndReason::SleepTimer, EndReason::QueueCleared, EndReason::Error]
        {
            assert!(!played(200_000, 5_000, reason).is_skip, "{reason:?}");
        }
        // Leaving after the play threshold is a play, not a skip.
        let e = played(200_000, 60_000, EndReason::UserNext);
        assert!(e.is_play && !e.is_skip);
    }

    #[test]
    fn full_is_ninety_percent_or_a_natural_end() {
        assert!(played(100_000, 90_000, EndReason::UserNext).is_full);
        assert!(!played(100_000, 89_999, EndReason::UserNext).is_full);
        assert!(played(100_000, 10_000, EndReason::Finished).is_full);
    }

    #[test]
    fn heard_excludes_pauses_and_seek_jumps() {
        let e = evaluate(&session(
            300_000,
            vec![
                Fact::Play { at_ms: 0, position_ms: 0 },
                Fact::Pause { at_ms: 10_000, position_ms: 10_000 },
                // Ten minutes paused count for nothing.
                Fact::Play { at_ms: 610_000, position_ms: 10_000 },
                // Jumping 100 s ahead counts for nothing either.
                Fact::Seek { at_ms: 615_000, from_ms: 15_000, to_ms: 115_000 },
                Fact::End { at_ms: 625_000, position_ms: 125_000, reason: EndReason::Stopped },
            ],
        ));
        assert_eq!(e.heard_ms, 25_000);
        assert_eq!(e.max_position_ms, 125_000);
        assert!(!e.is_play);
    }

    #[test]
    fn a_session_without_an_end_closed_with_the_app() {
        let e = evaluate(&session(
            200_000,
            vec![Fact::Play { at_ms: 0, position_ms: 0 }, Fact::Pause { at_ms: 40_000, position_ms: 40_000 }],
        ));
        assert_eq!(e.end_reason, EndReason::AppClosed);
        assert_eq!(e.ended_at, 40_000);
        assert!(e.is_play && !e.is_skip);
    }

    #[test]
    fn seek_hot_spots_need_three_seeks_in_a_window() {
        assert_eq!(hot_spots(&[60_000, 62_000, 58_000, 120_000]), vec![(60_000, 3)]);
        assert!(hot_spots(&[60_000, 70_000, 80_000]).is_empty());
    }

    #[test]
    fn scrobbles_follow_lastfm() {
        assert!(!played(30_000, 30_000, EndReason::Finished).scrobble, "a 30 s track is too short");
        assert!(played(200_000, 100_000, EndReason::Stopped).scrobble);
        assert!(played(3_600_000, 240_000, EndReason::Stopped).scrobble, "4 minutes are enough for a long track");
        assert!(!played(3_600_000, 239_999, EndReason::Stopped).scrobble);
    }

    #[test]
    fn undated_skips_come_off_the_oldest_imported_days() {
        let db = Db::open_in_memory().unwrap();
        let c = db.conn();
        let a = "a".repeat(26);
        c.execute("INSERT INTO tracks VALUES (?1, 'flac', 44100, 16, 2, 200000, NULL, 0, 0)", [&a]).unwrap();
        // One source: 3 starts, then 2 starts with 1 skip, then the migration day holding 3 skips
        // that have no starts of their own. Another source is untouched by the first one's skips.
        for (source, day, l, s) in
            [("m", "2026-01-01", 3, 0), ("m", "2026-01-02", 2, 1), ("m", "2026-08-14", 0, 3), ("d", "2026-01-01", 2, 0)]
        {
            c.execute(
                "INSERT INTO legacy_daily (source_id, song_id, day, l, f, s) VALUES (?1, ?2, ?3, ?4, 0, ?5)",
                params![source, a, day, l, s],
            )
            .unwrap();
        }
        recompute_legacy_plays(c).unwrap();
        let plays: Vec<(String, String, i64)> = c
            .prepare("SELECT source_id, day, plays FROM legacy_daily ORDER BY source_id DESC, day")
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        // Source m: 5 starts - 4 skips = 1 play. January 1st (3) loses the 3 undated skips first,
        // January 2nd keeps its 2 - 1.
        assert_eq!(
            plays,
            [
                ("m".into(), "2026-01-01".into(), 0),
                ("m".into(), "2026-01-02".into(), 1),
                ("m".into(), "2026-08-14".into(), 0),
                ("d".into(), "2026-01-01".into(), 2)
            ]
        );
    }

    #[test]
    fn recorded_rollups_equal_a_rebuild() {
        let mut db = Db::open_in_memory().unwrap();
        let song = "a".repeat(26);
        db.conn().execute("INSERT INTO tracks VALUES (?1, 'flac', 44100, 16, 2, 200000, NULL, 0, 0)", [&song]).unwrap();
        // 23:50 UTC on Jan 1st: Jan 2nd at 02:50 for a device at +3.
        let base = crate::time::parse_iso_ms("2026-01-01T23:50:00.000Z").unwrap();
        let mut s = session(200_000, vec![]);
        s.song_id = song.clone();
        s.utc_offset_min = 180;
        for (i, (heard, reason)) in
            [(60_000, EndReason::Finished), (5_000, EndReason::UserNext), (31_000, EndReason::Stopped)]
                .into_iter()
                .enumerate()
        {
            s.started_at = base + i as i64 * 1000;
            s.facts = vec![
                Fact::Play { at_ms: s.started_at, position_ms: 0 },
                Fact::End { at_ms: s.started_at + heard, position_ms: heard, reason },
            ];
            let r = record(&mut db, &s).unwrap();
            assert!(r.event_id.ends_with(&format!(":{}", i + 1)));
        }
        let snapshot = |db: &Db| -> Vec<(String, i64, i64, i64, i64, i64)> {
            db.conn()
                .prepare("SELECT day, starts, plays, full, skips, heard_ms FROM play_daily")
                .unwrap()
                .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)))
                .unwrap()
                .map(Result::unwrap)
                .collect()
        };
        let incremental = snapshot(&db);
        assert_eq!(incremental, vec![("2026-01-02".to_owned(), 3, 2, 1, 1, 96_000)]);
        let hour: i64 = db.conn().query_row("SELECT hour FROM play_hourly", [], |r| r.get(0)).unwrap();
        assert_eq!(hour, 2);
        rebuild_rollups(&mut db).unwrap();
        assert_eq!(snapshot(&db), incremental);
    }
}

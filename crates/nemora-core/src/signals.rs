//! What listening says about a song beyond full listens (PLAN/15 L1, L4): own picks, replays,
//! rewinds to a moment, scrubbing then skipping. Read from `play_details` (schema v2) with each
//! play's `play_events` row; plays from before v2 have no details and count only through full
//! listens, as they always did.
//!
//! The sums live in the `song_signals` cache, rebuilt from the facts by [`rebuild`] when [`VERSION`]
//! changes. Both sums decay with a 60-day half-life, so last month's habits weigh more than last
//! year's.
//!
//! **Skips in context (PLAN/16).** A play is added only once its context is settled: four more
//! plays in its session, or its session over ([`settle`], called by the transaction that records a
//! play and when the app opens). A play made while browsing adds nothing; a skip's disliking is
//! weighed by its kind and by how sure the classifier is that the user was listening; the song that
//! ended a browse gets one own pick's worth of liking.

use std::collections::HashMap;

use rusqlite::{Connection, OptionalExtension, params};

use crate::db::Db;
use crate::error::Result;
use crate::listening::{Classified, Context, REACH, SESSION_GAP_MS, SkipKind, skip_kind};

/// The formula's version (`meta.song_signals_version`); a change rebuilds the cache.
pub const VERSION: i64 = 2;
/// `meta` key: `started_at` of the last play added to the sums.
const SETTLED_KEY: &str = "song_signals_settled";
const HALF_LIFE_MS: f64 = 60.0 * 86_400_000.0;
/// A song played again this soon after it ended is a replay.
pub const REPLAY_WINDOW_MS: i64 = 3_600_000;

/// One play as the evidence reads it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Play<'a> {
    pub start_reason: &'a str,
    pub end_reason: &'a str,
    pub heard_ms: i64,
    pub duration_ms: i64,
    pub source_kind: Option<&'a str>,
    /// `[at_ms, from_ms, to_ms]`, in order.
    pub seeks: &'a [[i64; 3]],
    /// The song ended less than an hour before this play started.
    pub replay_soon: bool,
}

/// What one play adds: (liking, disliking, own pick, replay, rewinds, scrubbed then skipped).
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Evidence {
    pub positive: f64,
    pub negative: f64,
    pub own_pick: bool,
    pub replay: bool,
    pub rewinds: i64,
    pub scrub_skip: bool,
}

/// The evidence of one play (PLAN/15 L1).
pub fn evidence(play: &Play<'_>) -> Evidence {
    let mut e = Evidence::default();
    if play.start_reason == "user_selected" {
        e.own_pick = true;
        e.positive += 1.0;
    }
    if play.start_reason == "user_previous" || play.replay_soon {
        e.replay = true;
        e.positive += 2.0;
    }
    let mut forward = 0;
    let mut back_to_start = false;
    for &[_, from, to] in play.seeks {
        let back = from - to;
        if to < 3_000 && from > 20_000 {
            back_to_start = true;
        } else if (10_000..=40_000).contains(&back) {
            e.rewinds += 1;
        } else if to > from {
            forward += 1;
        }
    }
    e.positive += e.rewinds.min(2) as f64;
    if back_to_start {
        e.positive += 2.0;
    }
    let left = play.end_reason == "user_next" || play.end_reason == "user_selected";
    let share = if play.duration_ms > 0 { play.heard_ms as f64 / play.duration_ms as f64 } else { 0.0 };
    // A skip inside an album or a playlist says less about the song than one in a shuffle.
    let context = if matches!(play.source_kind, Some("album" | "playlist")) { 0.5 } else { 1.0 };
    if left && share < 0.8 {
        if forward >= 2 && share < 0.5 {
            e.scrub_skip = true;
            e.negative += 2.0 * context;
        } else if play.heard_ms < 30_000 || share < 0.25 {
            e.negative += context;
        }
    }
    e
}

/// A decayed sum at `at`, as of `now`.
fn decayed(value: f64, at: i64, now: i64) -> f64 {
    if at <= 0 || value == 0.0 {
        return value;
    }
    value * 0.5f64.powf((now - at).max(0) as f64 / HALF_LIFE_MS)
}

/// One play's evidence in its context (PLAN/16): nothing while browsing; disliking times the
/// skip's kind and the listening confidence; one own pick's worth of liking for a catch.
pub fn in_context(raw: Evidence, context: &Context, kind: Option<SkipKind>) -> Evidence {
    if context.browsing {
        return Evidence::default();
    }
    let mut e = raw;
    let weight = match kind {
        Some(SkipKind::Accidental) => 0.0,
        _ if raw.scrub_skip => SkipKind::Sampled.weight(),
        Some(k) => k.weight(),
        None => SkipKind::Early.weight(),
    };
    e.negative = raw.negative * weight * context.listening;
    e.scrub_skip = raw.scrub_skip && e.negative > 0.0;
    if context.caught {
        e.positive += 1.0;
    }
    e
}

/// Adds one play's evidence to the song's signals.
fn add(tx: &Connection, song_id: &str, started_at: i64, ended_at: i64, e: &Evidence) -> Result<()> {
    let current: Option<(f64, f64, i64)> = tx
        .query_row("SELECT positive, negative, decayed_to FROM song_signals WHERE song_id = ?1", [song_id], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })
        .optional()?;
    let (positive, negative, at) = current.unwrap_or((0.0, 0.0, 0));
    let at_now = started_at.max(at);
    tx.execute(
        "INSERT INTO song_signals (song_id, positive, negative, decayed_to, own_picks, replays, rewinds, scrub_skips, last_heard)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(song_id) DO UPDATE SET positive = excluded.positive, negative = excluded.negative,
           decayed_to = excluded.decayed_to, own_picks = own_picks + excluded.own_picks,
           replays = replays + excluded.replays, rewinds = rewinds + excluded.rewinds,
           scrub_skips = scrub_skips + excluded.scrub_skips,
           last_heard = max(coalesce(last_heard, 0), excluded.last_heard)",
        params![
            song_id,
            decayed(positive, at, at_now) + e.positive,
            decayed(negative, at, at_now) + e.negative,
            at_now,
            i64::from(e.own_pick),
            i64::from(e.replay),
            e.rewinds,
            i64::from(e.scrub_skip),
            ended_at
        ],
    )?;
    Ok(())
}

/// Adds every play whose context is settled and was not added yet, as of `now` (the end of the
/// latest play when called while recording one). Plays without details (before schema v2) count
/// only through full listens, as they always did.
pub fn settle(tx: &Connection, now: i64) -> Result<()> {
    let marker: i64 = tx
        .query_row("SELECT value FROM meta WHERE key = ?1", [SETTLED_KEY], |r| r.get::<_, String>(0))
        .optional()?
        .and_then(|v| v.parse().ok())
        .unwrap_or(i64::MIN);
    // A few hours before the marker: the neighbours before the first unsettled play, and the hour
    // a replay looks back.
    let since = if marker == i64::MIN { i64::MIN } else { marker - 3 * 3_600_000 };
    let c = Classified::load(tx, since)?;
    let n = c.plays.len();
    // Where each play's session ends (one pass from the end), and each song's previous end.
    let mut session_end = vec![n; n];
    for i in (0..n.saturating_sub(1)).rev() {
        session_end[i] = if c.contexts[i + 1].session == c.contexts[i].session { session_end[i + 1] } else { i + 1 };
    }
    let mut previous_end: HashMap<&str, i64> = HashMap::new();
    let mut settled_to = marker;
    for (i, p) in c.plays.iter().enumerate() {
        let before = previous_end.insert(&p.song_id, p.ended_at);
        if p.started_at <= marker {
            continue;
        }
        let later = session_end[i] - i - 1;
        let over = session_end[i] < n || now - p.ended_at > SESSION_GAP_MS;
        if later < REACH && !over {
            break;
        }
        settled_to = p.started_at;
        let Some(start) = p.start_reason.as_deref() else { continue };
        let replay_soon = before.is_some_and(|t| p.started_at >= t && p.started_at - t < REPLAY_WINDOW_MS);
        let raw = evidence(&Play {
            start_reason: start,
            end_reason: &p.end_reason,
            heard_ms: p.heard_ms,
            duration_ms: p.duration_ms,
            source_kind: p.source_kind.as_deref(),
            seeks: &p.seeks,
            replay_soon,
        });
        let e = in_context(raw, &c.contexts[i], skip_kind(&c.plays, i));
        add(tx, &p.song_id, p.started_at, p.ended_at, &e)?;
    }
    if settled_to != marker {
        tx.execute(
            "INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![SETTLED_KEY, settled_to.to_string()],
        )?;
    }
    Ok(())
}

/// Rebuilds `song_signals` from the facts (plays with details, Song Guessr rounds).
pub fn rebuild(db: &mut Db) -> Result<()> {
    let tx = db.conn_mut().transaction()?;
    tx.execute("DELETE FROM song_signals", [])?;
    tx.execute("DELETE FROM meta WHERE key = ?1", [SETTLED_KEY])?;
    settle(&tx, crate::db::now_ms())?;
    tx.execute(
        "INSERT INTO song_signals (song_id, guessed, missed, last_guessed)
         SELECT song_id, count(attempts), count(*) - count(attempts), max(at) FROM guessr_rounds WHERE true GROUP BY song_id
         ON CONFLICT(song_id) DO UPDATE SET guessed = excluded.guessed, missed = excluded.missed,
           last_guessed = excluded.last_guessed",
        [],
    )?;
    tx.execute(
        "INSERT INTO meta (key, value) VALUES ('song_signals_version', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [VERSION.to_string()],
    )?;
    tx.commit()?;
    Ok(())
}

/// Rebuilds the cache when it was built by another formula (or never).
pub fn ensure_current(db: &mut Db) -> Result<()> {
    if db.meta("song_signals_version")?.and_then(|v| v.parse::<i64>().ok()) != Some(VERSION) {
        rebuild(db)?;
    } else {
        // The last session's tail, settled now that it is over.
        let tx = db.conn_mut().transaction()?;
        settle(&tx, crate::db::now_ms())?;
        tx.commit()?;
    }
    Ok(())
}

/// Engagement per song, 0..1 around a neutral 0.5, as of `now`: liking minus disliking, decayed.
pub fn engagement(db: &Db, now: i64) -> Result<HashMap<String, f64>> {
    let mut stmt = db.conn().prepare(
        "SELECT song_id, positive, negative, decayed_to FROM song_signals WHERE positive <> 0 OR negative <> 0",
    )?;
    let mut out = HashMap::new();
    for row in stmt.query_map([], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, f64>(1)?, r.get::<_, f64>(2)?, r.get::<_, i64>(3)?))
    })? {
        let (song, positive, negative, at) = row?;
        out.insert(song, engagement_of(positive, negative, at, now));
    }
    Ok(out)
}

/// One song's engagement from its sums at `at`, as of `now`.
pub fn engagement_of(positive: f64, negative: f64, at: i64, now: i64) -> f64 {
    let net = decayed(positive, at, now) - decayed(negative, at, now);
    0.5 + 0.5 * (net / 4.0).tanh()
}

/// Faint duels from listening (PLAN/15 L4): the user left a song early and, within 30 s, picked
/// another one: (picked, left, when, weight). Derived from the facts, never stored, never an ELO
/// duel. Weighed like the skip it starts with (PLAN/16): nothing while browsing or by accident.
pub fn implicit_duels(db: &Db, since: i64) -> Result<Vec<(String, String, i64, f64)>> {
    Ok(implicit_duels_in(&Classified::load(db.conn(), since - 3 * 3_600_000)?, since))
}

/// [`implicit_duels`] from plays already classified.
pub fn implicit_duels_in(c: &Classified, since: i64) -> Vec<(String, String, i64, f64)> {
    let mut out = Vec::new();
    for i in 0..c.plays.len().saturating_sub(1) {
        let (left, picked) = (&c.plays[i], &c.plays[i + 1]);
        if left.ended_at < since
            || !left.left_early()
            || picked.start_reason.as_deref() != Some("user_selected")
            || !(0..=30_000).contains(&(picked.started_at - left.ended_at))
            || left.song_id == picked.song_id
        {
            continue;
        }
        let weight = crate::listening::skip_weight(&c.plays, &c.contexts, i);
        if weight > 0.0 {
            out.push((picked.song_id.clone(), left.song_id.clone(), picked.started_at, weight));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn play<'a>(start: &'a str, end: &'a str, heard: i64, seeks: &'a [[i64; 3]]) -> Play<'a> {
        Play {
            start_reason: start,
            end_reason: end,
            heard_ms: heard,
            duration_ms: 200_000,
            source_kind: None,
            seeks,
            replay_soon: false,
        }
    }

    #[test]
    fn each_kind_of_play_says_what_it_should() {
        // Own pick, played through: +1.
        let e = evidence(&play("user_selected", "finished", 200_000, &[]));
        assert_eq!((e.positive, e.negative, e.own_pick), (1.0, 0.0, true));
        // Brought back with previous: a replay.
        let e = evidence(&play("user_previous", "finished", 200_000, &[]));
        assert!(e.replay && e.positive == 2.0);
        // Rewinds of 10-40 s, counted up to two, and one back to the start.
        let seeks = [[0, 90_000, 70_000], [0, 120_000, 95_000], [0, 150_000, 130_000], [0, 180_000, 1_000]];
        let e = evidence(&play("auto", "finished", 200_000, &seeks));
        assert_eq!(e.rewinds, 3);
        assert_eq!(e.positive, 2.0 + 2.0);
        // Scrubbing forward twice, then next at a third: --.
        let seeks = [[0, 5_000, 60_000], [0, 62_000, 120_000]];
        let e = evidence(&play("auto", "user_next", 40_000, &seeks));
        assert!(e.scrub_skip && e.negative == 2.0);
        // An early next: -; after 80 %: nothing.
        assert_eq!(evidence(&play("auto", "user_next", 10_000, &[])).negative, 1.0);
        assert_eq!(evidence(&play("auto", "user_next", 170_000, &[])), Evidence::default());
        // The same early next inside an album counts half.
        let in_album = Play { source_kind: Some("album"), ..play("auto", "user_next", 10_000, &[]) };
        assert_eq!(evidence(&in_album).negative, 0.5);
    }

    #[test]
    fn signals_are_kept_on_write_and_equal_a_rebuild() {
        let mut db = Db::open_in_memory().unwrap();
        let song = "s".repeat(26);
        db.conn().execute("INSERT INTO tracks VALUES (?1, 'flac', 44100, 16, 2, 200000, NULL, 0, 0)", [&song]).unwrap();
        let now = crate::db::now_ms();
        use crate::plays::{EndReason, Fact, Session, StartReason, record_with};
        let session = |at: i64, end: EndReason, heard: i64| Session {
            song_id: song.clone(),
            started_at: at,
            utc_offset_min: 0,
            duration_ms: 200_000,
            source_kind: None,
            source_id: None,
            facts: vec![
                Fact::Play { at_ms: at, position_ms: 0 },
                Fact::End { at_ms: at + heard, position_ms: heard, reason: end },
            ],
        };
        record_with(&mut db, &session(now - 7_200_000, EndReason::Finished, 200_000), StartReason::UserSelected)
            .unwrap();
        // Again within the hour: a replay.
        record_with(&mut db, &session(now - 6_900_000, EndReason::UserNext, 10_000), StartReason::Auto).unwrap();
        // Both settle once their session is over (PLAN/16), as when the app opens.
        let tx = db.conn_mut().transaction().unwrap();
        settle(&tx, now).unwrap();
        tx.commit().unwrap();
        let kept: (f64, f64, i64, i64) = db
            .conn()
            .query_row(
                "SELECT positive, negative, own_picks, replays FROM song_signals WHERE song_id = ?1",
                [&song],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        assert_eq!((kept.2, kept.3), (1, 1));
        // The early next is softened by its kind and by how sure the user was listening.
        assert!(kept.0 > 2.9 && kept.1 > 0.1 && kept.1 < 0.6, "{kept:?}");
        rebuild(&mut db).unwrap();
        let rebuilt: (f64, f64, i64, i64) = db
            .conn()
            .query_row(
                "SELECT positive, negative, own_picks, replays FROM song_signals WHERE song_id = ?1",
                [&song],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        assert!((kept.0 - rebuilt.0).abs() < 1e-9 && (kept.1 - rebuilt.1).abs() < 1e-9);
        assert_eq!((kept.2, kept.3), (rebuilt.2, rebuilt.3));
        // Liked more than disliked: above neutral.
        assert!(engagement(&db, now).unwrap()[&song] > 0.5);
    }

    #[test]
    fn a_skip_then_an_own_pick_is_a_faint_duel() {
        let mut db = Db::open_in_memory().unwrap();
        let (a, b) = ("a".repeat(26), "b".repeat(26));
        for id in [&a, &b] {
            db.conn()
                .execute("INSERT INTO tracks VALUES (?1, 'flac', 44100, 16, 2, 200000, NULL, 0, 0)", [id])
                .unwrap();
        }
        let now = crate::db::now_ms();
        use crate::plays::{EndReason, Fact, Session, StartReason, record_with};
        let session = |song: &str, at: i64, end: EndReason, heard: i64| Session {
            song_id: song.to_owned(),
            started_at: at,
            utc_offset_min: 0,
            duration_ms: 200_000,
            source_kind: None,
            source_id: None,
            facts: vec![
                Fact::Play { at_ms: at, position_ms: 0 },
                Fact::End { at_ms: at + heard, position_ms: heard, reason: end },
            ],
        };
        record_with(&mut db, &session(&a, now - 60_000, EndReason::UserSelected, 8_000), StartReason::Auto).unwrap();
        record_with(&mut db, &session(&b, now - 51_000, EndReason::Finished, 200_000), StartReason::UserSelected)
            .unwrap();
        let duels = implicit_duels(&db, now - 86_400_000).unwrap();
        assert_eq!(duels.len(), 1);
        assert_eq!((duels[0].0.as_str(), duels[0].1.as_str()), (b.as_str(), a.as_str()));
    }
}

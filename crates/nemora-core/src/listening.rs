//! Skips in context (PLAN/16): was the user listening, or flicking through the library?
//!
//! A play's context is read from its neighbourhood, the plays before **and after** it in the same
//! session, so it is decided afterwards: a browse that turns into a long session is still a browse,
//! and a long session's one skip is still a skip. Everything here is derived from the recorded
//! facts (`play_events`, `play_details`), so a change of thresholds applies to the whole history.
//!
//! - **Browsing**: a burst of short starts (three within a minute, or four in a row). A browsing
//!   play teaches the shuffle nothing.
//! - **Listening confidence** (0..1) of any other play: automatic advances around it (a song
//!   finished and the next began by itself, which browsing never does) and the minutes actually
//!   heard around it.
//! - **Kinds of skip**: accidental (skipped, then Previous back to it), instant (under 3 s),
//!   early, sampled (sought forward, then skipped). Every skip is softened; sampling then skipping,
//!   the clearest "no", the least.
//!
//! Statistics never read this: the Stats page and the roll-ups count every start and skip.

use std::collections::HashMap;

use rusqlite::{Connection, params};

use crate::error::Result;

/// A gap this long between one play's end and the next start ends a session.
pub const SESSION_GAP_MS: i64 = 10 * 60_000;
/// How many plays on each side make a play's neighbourhood.
pub const REACH: usize = 4;
/// A start ended by the user after less than this, or less than [`SHORT_SHARE`] of the track, is short.
pub const SHORT_MS: i64 = 20_000;
pub const SHORT_SHARE: f64 = 0.15;
/// This many short starts within [`BURST_WINDOW_MS`], or [`BURST_RUN`] short plays in a row, are a browse.
pub const BURST_STARTS: usize = 3;
pub const BURST_WINDOW_MS: i64 = 60_000;
pub const BURST_RUN: usize = 4;
/// Heard this long around a play (non-browsing plays within [`HEARD_REACH_MS`] on each side) and the
/// heard part of the confidence is full.
pub const HEARD_FULL_MS: i64 = 8 * 60_000;
pub const HEARD_REACH_MS: i64 = 20 * 60_000;
/// Automatic advances around a play for the advance part of the confidence to be full.
pub const ADVANCES_FULL: usize = 2;
/// Skipped, then brought back by Previous within this long: an accident.
pub const ACCIDENT_MS: i64 = 10_000;
/// Heard less than this before the skip: the user did not hear it.
pub const INSTANT_MS: i64 = 3_000;

/// One play as the classifier reads it.
#[derive(Debug, Clone, PartialEq)]
pub struct Listen {
    pub song_id: String,
    pub started_at: i64,
    pub ended_at: i64,
    pub utc_offset_min: i64,
    pub heard_ms: i64,
    pub duration_ms: i64,
    pub end_reason: String,
    /// None for plays recorded before schema v2 (no details).
    pub start_reason: Option<String>,
    pub source_kind: Option<String>,
    /// `[at_ms, from_ms, to_ms]` from `play_details`, in order; empty without details.
    pub seeks: Vec<[i64; 3]>,
}

impl Listen {
    fn share(&self) -> f64 {
        if self.duration_ms > 0 { self.heard_ms as f64 / self.duration_ms as f64 } else { 0.0 }
    }

    fn user_ended(&self) -> bool {
        matches!(self.end_reason.as_str(), "user_next" | "user_selected" | "user_previous")
    }

    /// A short start: the user moved on almost at once.
    pub fn is_short(&self) -> bool {
        self.user_ended() && (self.heard_ms < SHORT_MS || self.share() < SHORT_SHARE)
    }

    /// Left early (the skip-aware and L1 definition: under 30 s or under a quarter).
    pub fn left_early(&self) -> bool {
        matches!(self.end_reason.as_str(), "user_next" | "user_selected")
            && (self.heard_ms < 30_000 || (self.duration_ms > 0 && self.heard_ms * 4 < self.duration_ms))
    }

    fn forward_seeks(&self) -> usize {
        self.seeks.iter().filter(|[_, from, to]| to > from).count()
    }
}

/// What the neighbourhood says about one play.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Context {
    /// Part of a browse: it teaches the shuffle nothing.
    pub browsing: bool,
    /// 0..1: how sure the user was listening (0 while browsing).
    pub listening: f64,
    /// Its session, numbered from 0 across the slice classified.
    pub session: usize,
    /// It ended a browse: the user stopped flicking and listened to it (PLAN/16 D5).
    pub caught: bool,
}

/// How a skip reads (PLAN/16 D3).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SkipKind {
    /// Skipped, then brought back by Previous at once.
    Accidental,
    /// Not even heard.
    Instant,
    /// Heard a little and left.
    Early,
    /// Sought forward through it, then left: the clearest "no".
    Sampled,
}

impl SkipKind {
    /// What a skip of this kind weighs against a song, before the listening confidence.
    pub fn weight(self) -> f64 {
        match self {
            SkipKind::Accidental => 0.0,
            SkipKind::Instant => 0.3,
            SkipKind::Early => 0.6,
            SkipKind::Sampled => 0.85,
        }
    }
}

/// The kind of skip `plays[i]` is, if it left early.
pub fn skip_kind(plays: &[Listen], i: usize) -> Option<SkipKind> {
    let p = &plays[i];
    if !p.left_early() {
        return None;
    }
    if let Some(next) = plays.get(i + 1)
        && next.song_id == p.song_id
        && next.start_reason.as_deref() == Some("user_previous")
        && next.started_at - p.ended_at <= ACCIDENT_MS
    {
        return Some(SkipKind::Accidental);
    }
    Some(if p.forward_seeks() >= 1 && p.heard_ms >= INSTANT_MS {
        SkipKind::Sampled
    } else if p.heard_ms < INSTANT_MS {
        SkipKind::Instant
    } else {
        SkipKind::Early
    })
}

/// The weight of `plays[i]` as a skip: its kind's weight times the listening confidence; 0 when it
/// is not a skip or was made while browsing.
pub fn skip_weight(plays: &[Listen], contexts: &[Context], i: usize) -> f64 {
    let c = contexts[i];
    if c.browsing {
        return 0.0;
    }
    skip_kind(plays, i).map_or(0.0, |k| k.weight() * c.listening)
}

/// Classifies `plays` (oldest first). Plays at the edges of the slice see only the neighbours it
/// holds, so callers load a little history before the plays they judge.
pub fn classify(plays: &[Listen]) -> Vec<Context> {
    let n = plays.len();
    let mut out = vec![Context::default(); n];
    // Sessions.
    let mut sessions = vec![0; n];
    for i in 1..n {
        sessions[i] = sessions[i - 1] + usize::from(plays[i].started_at - plays[i - 1].ended_at > SESSION_GAP_MS);
    }
    let same = |a: usize, b: usize| sessions[a] == sessions[b];
    let short: Vec<bool> = plays.iter().map(Listen::is_short).collect();

    // Browsing: three short starts within a minute (in one session), or four short plays in a row.
    let mut browsing = vec![false; n];
    let shorts_from = |k: usize| {
        let end = plays[k].started_at + BURST_WINDOW_MS;
        (k..n).take_while(|&j| same(j, k) && plays[j].started_at <= end).filter(|&j| short[j]).count()
    };
    for i in (0..n).filter(|&i| short[i]) {
        // The windows that start at a short start at most a minute before i (i included).
        let mut k = i;
        loop {
            if short[k] && shorts_from(k) >= BURST_STARTS {
                browsing[i] = true;
                break;
            }
            if k == 0 || !same(k - 1, i) || plays[i].started_at - plays[k - 1].started_at > BURST_WINDOW_MS {
                break;
            }
            k -= 1;
        }
    }
    let mut i = 0;
    while i < n {
        if !short[i] {
            i += 1;
            continue;
        }
        let mut j = i + 1;
        while j < n && short[j] && same(j, j - 1) {
            j += 1;
        }
        if j - i >= BURST_RUN {
            browsing[i..j].iter_mut().for_each(|b| *b = true);
        }
        i = j;
    }

    // Listening confidence: automatic advances and heard minutes around each play.
    let advanced = |j: usize| {
        j > 0
            && same(j, j - 1)
            && plays[j].start_reason.as_deref() == Some("auto")
            && plays[j - 1].end_reason == "finished"
    };
    for i in 0..n {
        out[i].session = sessions[i];
        out[i].browsing = browsing[i];
        if browsing[i] {
            continue;
        }
        let lo = i.saturating_sub(REACH);
        let hi = (i + REACH).min(n - 1);
        let advances = (lo..=hi).filter(|&j| same(i, j) && advanced(j)).count();
        let t = plays[i].started_at;
        let mut heard = 0;
        let mut j = i;
        while j > 0 && same(j - 1, i) && t - plays[j - 1].started_at <= HEARD_REACH_MS {
            j -= 1;
            if !browsing[j] {
                heard += plays[j].heard_ms;
            }
        }
        let mut j = i + 1;
        while j < n && same(j, i) && plays[j].started_at - t <= HEARD_REACH_MS {
            if !browsing[j] {
                heard += plays[j].heard_ms;
            }
            j += 1;
        }
        let a = advances.min(ADVANCES_FULL) as f64 / ADVANCES_FULL as f64;
        let h = (heard as f64 / HEARD_FULL_MS as f64).min(1.0);
        out[i].listening = 0.5 * a + 0.5 * h;
        let heard_through = plays[i].end_reason == "finished" || plays[i].share() >= 0.5;
        out[i].caught = i > 0 && same(i, i - 1) && browsing[i - 1] && heard_through;
    }
    out
}

/// Plays started at or after `since`, oldest first, with their details.
pub fn load(conn: &Connection, since: i64) -> Result<Vec<Listen>> {
    let mut stmt = conn.prepare(
        // In the order of the time index (no sort); plays do not overlap, so it is also start order.
        "SELECT e.song_id, e.started_at, e.ended_at, e.utc_offset_min, e.heard_ms, e.duration_ms,
                e.end_reason, d.start_reason, e.source_kind, d.seeks
         FROM play_events e LEFT JOIN play_details d USING (event_id)
         WHERE e.ended_at >= ?1 ORDER BY e.ended_at",
    )?;
    let rows = stmt.query_map(params![since], |r| {
        let seeks = r.get_ref(9)?.as_str_or_null()?;
        Ok(Listen {
            song_id: r.get(0)?,
            started_at: r.get(1)?,
            ended_at: r.get(2)?,
            utc_offset_min: r.get(3)?,
            heard_ms: r.get(4)?,
            duration_ms: r.get(5)?,
            end_reason: r.get(6)?,
            start_reason: r.get(7)?,
            source_kind: r.get(8)?,
            seeks: seeks.and_then(|s| serde_json::from_str(s).ok()).unwrap_or_default(),
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Plays and their contexts.
#[derive(Debug, Clone, Default)]
pub struct Classified {
    pub plays: Vec<Listen>,
    pub contexts: Vec<Context>,
}

impl Classified {
    pub fn load(conn: &Connection, since: i64) -> Result<Self> {
        let plays = load(conn, since)?;
        let contexts = classify(&plays);
        Ok(Classified { plays, contexts })
    }

    /// Indices of the plays the shuffle counts as heard (not browsing).
    pub fn heard(&self) -> impl Iterator<Item = usize> + '_ {
        (0..self.plays.len()).filter(|&i| !self.contexts[i].browsing)
    }

    /// The weighted skips per song since `since`: (when, weight, session), oldest first; weight > 0.
    pub fn skips(&self, since: i64) -> HashMap<String, Vec<(i64, f64, usize)>> {
        let mut out: HashMap<String, Vec<(i64, f64, usize)>> = HashMap::new();
        for i in 0..self.plays.len() {
            let p = &self.plays[i];
            if p.ended_at < since || p.end_reason != "user_next" {
                continue;
            }
            let w = skip_weight(&self.plays, &self.contexts, i);
            if w > 0.0 {
                out.entry(p.song_id.clone()).or_default().push((p.ended_at, w, self.contexts[i].session));
            }
        }
        out
    }
}

/// What the last week's skips came to: (counted, ignored as browsing or accidents), for Settings.
pub fn summary(db: &crate::db::Db, now: i64) -> Result<(usize, usize)> {
    let week = 7 * 86_400_000;
    let c = Classified::load(db.conn(), now - week - 3 * 3_600_000)?;
    let (mut counted, mut ignored) = (0, 0);
    for i in 0..c.plays.len() {
        if c.plays[i].ended_at < now - week || !c.plays[i].left_early() {
            continue;
        }
        if skip_weight(&c.plays, &c.contexts, i) > 0.0 { counted += 1 } else { ignored += 1 }
    }
    Ok((counted, ignored))
}

/// The songs heard (not browsed) in the session going on now, oldest first; empty when none is
/// going on. For the taste map's trail (PLAN/17).
pub fn session(db: &crate::db::Db, now: i64) -> Result<Vec<String>> {
    let c = Classified::load(db.conn(), now - 6 * 3_600_000)?;
    let (Some(last), Some(ctx)) = (c.plays.last(), c.contexts.last()) else { return Ok(Vec::new()) };
    if now - last.ended_at > SESSION_GAP_MS {
        return Ok(Vec::new());
    }
    let session = ctx.session;
    Ok((0..c.plays.len())
        .filter(|&i| c.contexts[i].session == session && !c.contexts[i].browsing)
        .map(|i| c.plays[i].song_id.clone())
        .collect())
}

/// The listening confidence of the session going on now (its last play ended less than a session
/// gap ago), None when no session is going on; for the Smart Shuffle button's tooltip.
pub fn current(db: &crate::db::Db, now: i64) -> Result<Option<Context>> {
    let c = Classified::load(db.conn(), now - 3 * 3_600_000)?;
    Ok(match (c.plays.last(), c.contexts.last()) {
        (Some(p), Some(ctx)) if now - p.ended_at <= SESSION_GAP_MS => Some(*ctx),
        _ => None,
    })
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub(crate) const MIN: i64 = 60_000;

    /// A session builder: plays one after another from `at`.
    pub(crate) struct Sessions {
        pub at: i64,
        pub plays: Vec<Listen>,
    }

    impl Sessions {
        pub fn new(at: i64) -> Self {
            Sessions { at, plays: Vec::new() }
        }

        /// `heard` of a `duration` song, ended by `end`, started by `start`.
        pub fn play(&mut self, song: &str, start: &str, heard: i64, duration: i64, end: &str) -> &mut Self {
            self.play_seeking(song, start, heard, duration, end, &[])
        }

        pub fn play_seeking(
            &mut self,
            song: &str,
            start: &str,
            heard: i64,
            duration: i64,
            end: &str,
            seeks: &[[i64; 3]],
        ) -> &mut Self {
            let started = self.at;
            let ended = started + heard + 500;
            self.plays.push(Listen {
                song_id: song.into(),
                started_at: started,
                ended_at: ended,
                utc_offset_min: 0,
                heard_ms: heard,
                duration_ms: duration,
                end_reason: end.into(),
                start_reason: Some(start.into()),
                source_kind: None,
                seeks: seeks.to_vec(),
            });
            self.at = ended + 300;
            self
        }

        /// A song played through, advanced into by the player.
        pub fn listen(&mut self, song: &str) -> &mut Self {
            self.play(song, "auto", 3 * MIN, 3 * MIN, "finished")
        }

        pub fn gap(&mut self, ms: i64) -> &mut Self {
            self.at += ms;
            self
        }
    }

    fn contexts(s: &Sessions) -> Vec<Context> {
        classify(&s.plays)
    }

    #[test]
    fn a_browse_of_twenty_songs_is_all_browsing() {
        let mut s = Sessions::new(0);
        for i in 0..20 {
            s.play(&format!("b{i}"), "user_selected", 4_000, 200_000, "user_selected");
        }
        let c = contexts(&s);
        assert!(c.iter().all(|c| c.browsing && c.listening == 0.0));
        let all = Classified { plays: s.plays.clone(), contexts: c };
        assert!(all.skips(0).is_empty());
    }

    #[test]
    fn a_slow_browse_of_short_plays_in_a_row_is_browsing_too() {
        let mut s = Sessions::new(0);
        for i in 0..5 {
            // 25 s of a five-minute song each: not three in a minute, but five short in a row.
            s.play(&format!("b{i}"), "user_selected", 25_000, 300_000, "user_next");
        }
        assert!(contexts(&s).iter().all(|c| c.browsing));
    }

    #[test]
    fn a_skip_in_a_long_listen_counts_fully_as_its_kind() {
        let mut s = Sessions::new(0);
        s.listen("a").listen("b").listen("c");
        s.play("x", "auto", 8_000, 200_000, "user_next");
        s.listen("d").listen("e");
        let c = contexts(&s);
        assert!(!c[3].browsing && c[3].listening == 1.0, "{:?}", c[3]);
        assert_eq!(skip_kind(&s.plays, 3), Some(SkipKind::Early));
        assert!((skip_weight(&s.plays, &c, 3) - SkipKind::Early.weight()).abs() < 1e-12);
    }

    #[test]
    fn a_browse_that_turns_into_a_listen_stays_a_browse_and_the_catch_is_marked() {
        let mut s = Sessions::new(0);
        for i in 0..6 {
            s.play(&format!("b{i}"), "user_selected", 3_000, 200_000, "user_selected");
        }
        s.play("caught", "user_selected", 3 * MIN, 3 * MIN, "finished");
        s.listen("n1").listen("n2").listen("n3");
        let c = contexts(&s);
        assert!(c[..6].iter().all(|c| c.browsing));
        assert!(c[6].caught && !c[6].browsing);
        assert!(c[7..].iter().all(|c| !c.browsing && !c.caught));
    }

    #[test]
    fn a_skip_brought_back_at_once_is_an_accident() {
        let mut s = Sessions::new(0);
        s.listen("a").listen("b");
        s.play("x", "auto", 5_000, 200_000, "user_next");
        s.play("x", "user_previous", 3 * MIN, 3 * MIN, "finished");
        s.listen("c");
        let c = contexts(&s);
        assert_eq!(skip_kind(&s.plays, 2), Some(SkipKind::Accidental));
        assert_eq!(skip_weight(&s.plays, &c, 2), 0.0);
    }

    #[test]
    fn instant_and_sampled_skips_weigh_as_their_kinds() {
        let mut s = Sessions::new(0);
        s.listen("a").listen("b");
        s.play("i", "auto", 1_000, 200_000, "user_next");
        s.listen("c");
        s.play_seeking("s", "auto", 12_000, 200_000, "user_next", &[[2_000, 2_000, 60_000], [6_000, 64_000, 120_000]]);
        s.listen("d").listen("e");
        assert_eq!(skip_kind(&s.plays, 2), Some(SkipKind::Instant));
        assert_eq!(skip_kind(&s.plays, 4), Some(SkipKind::Sampled));
        assert!(SkipKind::Sampled.weight() > SkipKind::Early.weight());
        assert!(SkipKind::Early.weight() > SkipKind::Instant.weight());
    }

    #[test]
    fn a_lone_skip_with_nothing_around_it_teaches_nothing() {
        let mut s = Sessions::new(0);
        s.play("x", "user_selected", 6_000, 200_000, "user_next");
        let c = contexts(&s);
        assert!(!c[0].browsing && c[0].listening == 0.0);
        assert_eq!(skip_weight(&s.plays, &c, 0), 0.0);
    }

    #[test]
    fn picking_songs_by_hand_and_hearing_them_is_half_sure() {
        let mut s = Sessions::new(0);
        for i in 0..4 {
            s.play(&format!("p{i}"), "user_selected", 3 * MIN, 4 * MIN, "user_selected");
        }
        s.play("x", "user_selected", 9_000, 200_000, "user_next");
        let c = contexts(&s);
        assert!((c[4].listening - 0.5).abs() < 1e-12, "{:?}", c[4]);
    }

    #[test]
    fn a_gap_ends_a_session() {
        let mut s = Sessions::new(0);
        s.listen("a").listen("b");
        s.gap(SESSION_GAP_MS + 1);
        s.play("x", "user_selected", 6_000, 200_000, "user_next");
        let c = contexts(&s);
        assert_ne!(c[1].session, c[2].session);
        assert_eq!(c[2].listening, 0.0);
    }

    /// P16.0: the classes on a copy of a real profile (`NEMORA_REAL_DB`), and its last sessions with
    /// their verdicts, printed for calibration.
    #[test]
    #[ignore]
    fn real_profile_classes() {
        let Ok(path) = std::env::var("NEMORA_REAL_DB") else { return };
        let conn = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
        let c = Classified::load(&conn, 0).unwrap();
        let n = c.plays.len();
        let browsing = c.contexts.iter().filter(|x| x.browsing).count();
        let caught = c.contexts.iter().filter(|x| x.caught).count();
        let early: Vec<usize> = (0..n).filter(|&i| c.plays[i].left_early()).collect();
        let counted = early.iter().filter(|&&i| skip_weight(&c.plays, &c.contexts, i) > 0.0).count();
        let in_browse = early.iter().filter(|&&i| c.contexts[i].browsing).count();
        let mut kinds: HashMap<String, usize> = HashMap::new();
        for &i in &early {
            *kinds.entry(format!("{:?}", skip_kind(&c.plays, i).unwrap())).or_default() += 1;
        }
        let sessions = c.contexts.last().map_or(0, |x| x.session + 1);
        eprintln!(
            "REAL plays {n} in {sessions} sessions | browsing {browsing} | caught {caught} | early skips {}              (counted {counted}, in a browse {in_browse}, no listening around {}) | kinds {kinds:?}",
            early.len(),
            early.len() - counted - in_browse
        );
        // The five latest sessions with more than three plays, one line per play.
        let mut shown = 0;
        let mut s = sessions;
        while shown < 5 && s > 0 {
            s -= 1;
            let idx: Vec<usize> = (0..n).filter(|&i| c.contexts[i].session == s).collect();
            if idx.len() <= 3 {
                continue;
            }
            shown += 1;
            eprintln!("SESSION {s}: {} plays", idx.len());
            for &i in &idx {
                let (p, x) = (&c.plays[i], &c.contexts[i]);
                eprintln!(
                    "  {:>6.1}s / {:>5.1}s {:<13} {:<13} {:<8} c={:.2}{}{}",
                    p.heard_ms as f64 / 1000.0,
                    p.duration_ms as f64 / 1000.0,
                    p.start_reason.as_deref().unwrap_or("-"),
                    p.end_reason,
                    if x.browsing { "BROWSE" } else { "listen" },
                    x.listening,
                    skip_kind(&c.plays, i)
                        .map(|k| format!(" skip:{k:?} w={:.2}", skip_weight(&c.plays, &c.contexts, i)))
                        .unwrap_or_default(),
                    if x.caught { " CAUGHT" } else { "" }
                );
            }
        }
    }
}

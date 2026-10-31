//! Song Guessr's memory of each song (schema v2 `guessr_rounds`): whether a round about it was
//! won and in which attempt. Recognition is not liking: Smart Shuffle reads a missed song as one to
//! bring back, never as one to push away (PLAN/15 M1).

use rusqlite::params;

use crate::db::{Db, now_ms};
use crate::error::Result;

/// The attempts a round allows (Song Guessr's six snippets).
pub const MAX_ATTEMPTS: u8 = 6;

/// Stores one finished round about `song_id`: `attempts` is the attempt that found it (1..=6), None
/// when the round ran out of attempts.
pub fn record_round(
    db: &Db,
    song_id: &str,
    attempts: Option<u8>,
    gave_up: bool,
    pool_kind: Option<&str>,
) -> Result<()> {
    let attempts = attempts.filter(|a| (1..=MAX_ATTEMPTS).contains(a));
    let at = now_ms();
    let device_id = db.device_id()?;
    db.conn().execute(
        "INSERT INTO guessr_rounds (round_id, device_id, song_id, at, attempts, gave_up, pool_kind)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![crate::ids::random(), device_id, song_id, at, attempts, gave_up, pool_kind],
    )?;
    let (guessed, missed) = if attempts.is_some() { (1, 0) } else { (0, 1) };
    db.conn().execute(
        "INSERT INTO song_signals (song_id, guessed, missed, last_guessed) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(song_id) DO UPDATE SET guessed = guessed + excluded.guessed,
           missed = missed + excluded.missed, last_guessed = excluded.last_guessed",
        params![song_id, guessed, missed, at],
    )?;
    Ok(())
}

/// A song's rounds: (found, missed) and when it last came up.
pub fn rounds_of(db: &Db, song_id: &str) -> Result<(i64, i64, Option<i64>)> {
    Ok(db.conn().query_row(
        "SELECT count(attempts), count(*) - count(attempts), max(at) FROM guessr_rounds WHERE song_id = ?1",
        [song_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rounds_are_kept_per_song() {
        let db = Db::open_in_memory().unwrap();
        let song = "s".repeat(26);
        db.conn().execute("INSERT INTO tracks VALUES (?1, 'flac', 44100, 16, 2, 1000, NULL, 0, 0)", [&song]).unwrap();
        record_round(&db, &song, Some(2), false, Some("library")).unwrap();
        record_round(&db, &song, None, false, Some("library")).unwrap();
        record_round(&db, &song, Some(9), false, None).unwrap();
        let (found, missed, last) = rounds_of(&db, &song).unwrap();
        // An attempt out of range is not a find.
        assert_eq!((found, missed), (1, 2));
        assert!(last.is_some());
        let (guessed, missed): (i64, i64) = db
            .conn()
            .query_row("SELECT guessed, missed FROM song_signals WHERE song_id = ?1", [&song], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap();
        assert_eq!((guessed, missed), (1, 2));
    }
}

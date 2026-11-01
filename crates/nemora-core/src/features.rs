//! A track's sound in three numbers (PLAN/15 C2), cached in `track_features` (schema v2): energy,
//! brightness and dynamics, each 0..1, measured by `nemora-audio` from the visual envelope. The
//! view's Energy flow orders a queue so neighbours do not jump in energy.

use std::collections::HashMap;

use rusqlite::params;

use crate::db::{Db, now_ms};
use crate::error::Result;

/// The features' formula; rows of another version are measured again.
pub const VERSION: i64 = 1;

/// Stores one song's features.
pub fn store(db: &Db, song_id: &str, energy: f64, brightness: f64, dynamics: f64) -> Result<()> {
    db.conn().execute(
        "INSERT INTO track_features (song_id, version, energy, brightness, dynamics, analysed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(song_id) DO UPDATE SET version = excluded.version, energy = excluded.energy,
           brightness = excluded.brightness, dynamics = excluded.dynamics, analysed_at = excluded.analysed_at",
        params![song_id, VERSION, energy, brightness, dynamics, now_ms()],
    )?;
    Ok(())
}

/// Songs of the library not measured by this version yet, at most `limit`.
pub fn missing(db: &Db, limit: usize) -> Result<Vec<String>> {
    let mut stmt = db.conn().prepare(
        "SELECT DISTINCT v.song_id FROM track_variants v
         LEFT JOIN track_features f ON f.song_id = v.song_id AND f.version = ?1
         WHERE f.song_id IS NULL AND v.present = 1 ORDER BY v.song_id LIMIT ?2",
    )?;
    Ok(stmt.query_map(params![VERSION, limit as i64], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?)
}

/// (measured, all) songs of the library.
pub fn progress(db: &Db) -> Result<(i64, i64)> {
    Ok(db.conn().query_row(
        "SELECT (SELECT count(*) FROM track_features WHERE version = ?1
                   AND song_id IN (SELECT song_id FROM track_variants WHERE present = 1)),
                (SELECT count(DISTINCT song_id) FROM track_variants WHERE present = 1)",
        [VERSION],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?)
}

/// Every measured song's energy.
pub fn energy(db: &Db) -> Result<HashMap<String, f64>> {
    let mut stmt = db.conn().prepare("SELECT song_id, energy FROM track_features WHERE version = ?1")?;
    Ok(stmt.query_map([VERSION], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<rusqlite::Result<_>>()?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn measured_songs_leave_the_missing_list() {
        let db = Db::open_in_memory().unwrap();
        for id in ["a", "b"] {
            db.conn().execute("INSERT INTO tracks VALUES (?1, 'flac', 44100, 16, 2, 1000, NULL, 0, 0)", [id]).unwrap();
            db.conn()
                .execute(
                    "INSERT INTO track_variants (song_id, tag_signature, title, title_sort, artist_sort, album, album_sort, last_seen_at)
                     VALUES (?1, 'sig', ?1, ?1, '', NULL, NULL, 0)",
                    [id],
                )
                .unwrap();
        }
        assert_eq!(missing(&db, 10).unwrap(), ["a", "b"]);
        store(&db, "a", 0.7, 0.2, 0.1).unwrap();
        assert_eq!(missing(&db, 10).unwrap(), ["b"]);
        assert_eq!(progress(&db).unwrap(), (1, 2));
        assert_eq!(energy(&db).unwrap()["a"], 0.7);
    }
}

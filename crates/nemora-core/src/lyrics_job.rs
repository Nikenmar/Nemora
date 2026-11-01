//! Lyrics for the whole library (PLAN/19 D5), opt-in: the songs still without lyrics, one at a
//! time, from the `.lrc` file next to them, their tags, and only then LRCLIB. What is found is stored
//! as on the lyrics page (`lyrics::save`: a user's own lyrics are never replaced, synced lyrics are
//! never replaced by plain ones). A song LRCLIB does not know is remembered and asked again after
//! [`RETRY_DAYS`]. The pace (about one request a second) is the caller's.

use std::collections::HashMap;

use crate::db::Db;
use crate::lyrics;

/// A song LRCLIB did not know is asked again after this many days.
pub const RETRY_DAYS: i64 = 30;
/// `settings_device` key: `{ song_id: when it was not found (ms) }`.
pub const NOT_FOUND: &str = "lyrics.notFound";
const DAY_MS: i64 = 86_400_000;

/// What LRCLIB is asked.
#[derive(Debug, Clone, PartialEq)]
pub struct Query {
    pub title: String,
    pub artist: String,
    pub album: Option<String>,
    pub duration_sec: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Outcome {
    /// Found next to the file or in its tags; no request was made.
    Local(&'static str),
    /// Found online and stored.
    Found,
    /// Online, and LRCLIB has nothing: remembered.
    NotFound,
    /// The song has lyrics already, or no file on this device.
    Skipped,
}

/// The songs LRCLIB said it does not know, and when.
pub fn not_found(db: &Db) -> crate::Result<HashMap<String, i64>> {
    Ok(crate::settings::device(db, NOT_FOUND)?.and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default())
}

/// Songs of the library without lyrics, most played first, leaving out those LRCLIB did not know
/// in the last [`RETRY_DAYS`].
pub fn pending(db: &Db, now: i64, limit: usize) -> crate::Result<Vec<String>> {
    let missing = not_found(db)?;
    let mut stmt = db.conn().prepare(
        "SELECT v.song_id FROM track_variants v
         LEFT JOIN lyrics l ON l.song_id = v.song_id
         LEFT JOIN song_totals t ON t.song_id = v.song_id
         WHERE v.present = 1 AND l.song_id IS NULL
         GROUP BY v.song_id ORDER BY coalesce(max(t.plays), 0) DESC, v.song_id",
    )?;
    let mut out = Vec::new();
    let mut rows = stmt.query([])?;
    while let Some(row) = rows.next()? {
        let id: String = row.get(0)?;
        if missing.get(&id).is_some_and(|&at| now - at < RETRY_DAYS * DAY_MS) {
            continue;
        }
        out.push(id);
        if out.len() == limit {
            break;
        }
    }
    Ok(out)
}

/// (songs with lyrics, songs in the library).
pub fn progress(db: &Db) -> crate::Result<(i64, i64)> {
    Ok(db.conn().query_row(
        "SELECT (SELECT count(DISTINCT v.song_id) FROM track_variants v JOIN lyrics l ON l.song_id = v.song_id WHERE v.present = 1),
                (SELECT count(DISTINCT song_id) FROM track_variants WHERE present = 1)",
        [],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?)
}

/// Lyrics for one song: local sources first, then `fetch` (LRCLIB in the app, a stand-in in tests).
/// A failed request (`Err`) is passed up and nothing is remembered, so the song is tried again.
pub fn fill(
    db: &Db,
    song_id: &str,
    now: i64,
    fetch: &mut dyn FnMut(&Query) -> Result<Option<String>, String>,
) -> crate::Result<Result<Outcome, String>> {
    if lyrics::stored(db, song_id)?.is_some() {
        return Ok(Ok(Outcome::Skipped));
    }
    let Some(song) = lyrics::lookup(db, song_id)? else { return Ok(Ok(Outcome::Skipped)) };
    let path = std::path::Path::new(&song.uri);
    let local =
        lyrics::from_lrc_file(path).map(|t| (t, "lrc_file")).or_else(|| lyrics::from_tags(path).map(|t| (t, "tags")));
    if let Some((text, source)) = local {
        lyrics::save(db, song_id, &text, source)?;
        return Ok(Ok(Outcome::Local(source)));
    }
    let query = Query {
        title: song.title.clone(),
        artist: song.artist.clone().unwrap_or_default(),
        album: song.album.clone(),
        duration_sec: song.duration_ms as f64 / 1000.0,
    };
    match fetch(&query) {
        Ok(Some(text)) => {
            lyrics::save(db, song_id, &text, "lrclib")?;
            Ok(Ok(Outcome::Found))
        }
        Ok(None) => {
            let mut missing = not_found(db)?;
            missing.insert(song_id.to_owned(), now);
            crate::settings::set_device(db, NOT_FOUND, &serde_json::to_value(&missing)?)?;
            Ok(Ok(Outcome::NotFound))
        }
        Err(e) => Ok(Err(e)),
    }
}

/// LRCLIB, as the app asks it.
pub fn lrclib(query: &Query) -> Result<Option<String>, String> {
    lyrics::lrclib::fetch(&query.title, &query.artist, query.album.as_deref(), query.duration_sec)
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: i64 = 1_800_000_000_000;

    /// Three songs with files under `dir`: `a` has a `.lrc` beside it, `b` and `c` have nothing.
    fn library(dir: &std::path::Path) -> Db {
        let db = Db::open_in_memory().unwrap();
        for (i, id) in ["a", "b", "c"].iter().enumerate() {
            let song = id.repeat(26);
            let uri = dir.join(format!("{id}.flac"));
            std::fs::write(&uri, b"not audio").unwrap();
            db.conn()
                .execute("INSERT INTO tracks VALUES (?1, 'flac', 44100, 16, 2, 180000, NULL, 0, 0)", [&song])
                .unwrap();
            db.conn()
                .execute(
                    "INSERT INTO track_variants (variant_id, song_id, tag_signature, title, title_sort, artist_sort, album, album_sort, last_seen_at)
                     VALUES (?1, ?2, 'sig', ?3, ?3, '', NULL, NULL, 0)",
                    rusqlite::params![i as i64 + 1, song, format!("Title {id}")],
                )
                .unwrap();
            db.conn()
                .execute(
                    "INSERT INTO locations (variant_id, uri, size, mtime, scanned_at) VALUES (?1, ?2, 1, 0, 0)",
                    rusqlite::params![i as i64 + 1, uri.to_string_lossy()],
                )
                .unwrap();
        }
        std::fs::write(dir.join("a.lrc"), "[00:01.00]from the file\n").unwrap();
        db
    }

    #[test]
    fn local_first_then_online_never_over_a_users_own_and_not_found_waits_thirty_days() {
        let dir = std::env::temp_dir().join(format!("nemora-lyrics-job-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let db = library(&dir);
        let (a, b, c) = ("a".repeat(26), "b".repeat(26), "c".repeat(26));
        // The user wrote c's lyrics: the job never asks for it.
        lyrics::save(&db, &c, "my own words", "user").unwrap();
        assert_eq!(pending(&db, NOW, 10).unwrap().len(), 2);
        assert_eq!(progress(&db).unwrap(), (1, 3));

        let mut asked: Vec<Query> = Vec::new();
        let mut never = |q: &Query| -> Result<Option<String>, String> { panic!("asked online for {}", q.title) };
        assert_eq!(fill(&db, &a, NOW, &mut never).unwrap(), Ok(Outcome::Local("lrc_file")));
        assert_eq!(fill(&db, &c, NOW, &mut never).unwrap(), Ok(Outcome::Skipped));
        assert_eq!(lyrics::stored(&db, &c).unwrap().unwrap().0, "my own words");

        // b: a failed request leaves it pending; LRCLIB knowing nothing is remembered.
        let mut failing = |_: &Query| -> Result<Option<String>, String> { Err("offline".into()) };
        assert_eq!(fill(&db, &b, NOW, &mut failing).unwrap(), Err("offline".into()));
        assert_eq!(pending(&db, NOW, 10).unwrap(), std::slice::from_ref(&b));
        let mut nothing = |q: &Query| {
            asked.push(q.clone());
            Ok(None)
        };
        assert_eq!(fill(&db, &b, NOW, &mut nothing).unwrap(), Ok(Outcome::NotFound));
        assert_eq!(asked[0].title, "Title b");
        assert_eq!(asked[0].duration_sec, 180.0);
        assert!(pending(&db, NOW + 29 * DAY_MS, 10).unwrap().is_empty(), "not asked again within 30 days");
        assert_eq!(pending(&db, NOW + 31 * DAY_MS, 10).unwrap(), std::slice::from_ref(&b), "asked again after");
        let mut found = |_: &Query| Ok(Some("[00:02.00]found online".to_owned()));
        assert_eq!(fill(&db, &b, NOW + 31 * DAY_MS, &mut found).unwrap(), Ok(Outcome::Found));
        assert_eq!(lyrics::stored(&db, &b).unwrap().unwrap().1, "lrclib");
        assert_eq!(progress(&db).unwrap(), (3, 3));
        let _ = std::fs::remove_dir_all(&dir);
    }
}

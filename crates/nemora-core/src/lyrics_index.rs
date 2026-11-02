//! Search by a line (PLAN/19 D6): every stored lyrics line in `lyrics_fts` (schema v4), under the
//! same search keys as titles (accents and case off, stylised letters folded, Cyrillic sounded out,
//! Japanese, Chinese and Korean read in Latin), with its time when the lyrics are synced. The index
//! is a cache of `lyrics`: [`sync`] rebuilds the songs whose lyrics changed since.

use std::collections::{HashMap, HashSet};

use rusqlite::{OptionalExtension, params};

use crate::db::Db;
use crate::lyrics::{self, Text};
use crate::search::fold;

/// One found line and the lines around it.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hit {
    pub song_id: String,
    pub line_no: i64,
    /// Seconds into the song, for synced lyrics.
    pub start: Option<f64>,
    pub text: String,
    pub before: Option<String>,
    pub after: Option<String>,
}

fn line_text(text: &Text) -> String {
    match text {
        Text::Plain(s) => s.trim().to_owned(),
        Text::Words(words) => words.iter().map(|w| w.text.as_str()).collect::<String>().trim().to_owned(),
    }
}

/// The keys one line is found under, one per line of the indexed text.
fn keys_of(line: &str) -> String {
    let romanized = crate::search::romanize::romanize(line);
    fold::text_keys(line, romanized.as_deref()).into_iter().map(|k| k.text).collect::<Vec<_>>().join("\n")
}

fn drop_song(tx: &rusqlite::Transaction<'_>, song_id: &str) -> rusqlite::Result<()> {
    tx.execute(
        "DELETE FROM lyrics_fts WHERE rowid IN (SELECT line_id FROM lyrics_lines WHERE song_id = ?1)",
        [song_id],
    )?;
    tx.execute("DELETE FROM lyrics_lines WHERE song_id = ?1", [song_id])?;
    tx.execute("DELETE FROM lyrics_indexed WHERE song_id = ?1", [song_id])?;
    Ok(())
}

/// What the stored lyrics look like at a glance: (songs with lyrics, latest change). A caller keeps
/// it and calls [`sync`] only when it moves (about a millisecond, where a no-op sync reads every row).
pub fn fingerprint(db: &Db) -> crate::Result<(i64, i64)> {
    Ok(db
        .conn()
        .query_row("SELECT count(*), coalesce(max(updated_at), 0) FROM lyrics", [], |r| Ok((r.get(0)?, r.get(1)?)))?)
}

/// Brings the index up to the stored lyrics, at most `limit` songs at a time (a first build of a
/// large library goes in steps, so a search never waits for all of it): songs whose lyrics are new
/// or changed are indexed again, songs whose lyrics are gone leave it. Answers how many changed.
pub fn sync(db: &Db, limit: usize) -> crate::Result<usize> {
    let conn = db.conn();
    let changed: Vec<(String, Option<String>, Option<i64>)> = conn
        .prepare(
            "SELECT l.song_id, l.text, l.updated_at FROM lyrics l LEFT JOIN lyrics_indexed i ON i.song_id = l.song_id
             WHERE i.updated_at IS NULL OR i.updated_at != l.updated_at
             UNION ALL
             SELECT i.song_id, NULL, NULL FROM lyrics_indexed i LEFT JOIN lyrics l ON l.song_id = i.song_id
             WHERE l.song_id IS NULL
             LIMIT ?1",
        )?
        .query_map([limit as i64], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
        .collect::<rusqlite::Result<_>>()?;
    if changed.is_empty() {
        return Ok(0);
    }
    let tx = conn.unchecked_transaction()?;
    {
        let mut line = tx.prepare(
            "INSERT INTO lyrics_lines (song_id, line_no, start_ms, text) VALUES (?1, ?2, ?3, ?4) RETURNING line_id",
        )?;
        let mut fts = tx.prepare("INSERT INTO lyrics_fts (rowid, keys) VALUES (?1, ?2)")?;
        for (song_id, text, updated_at) in &changed {
            drop_song(&tx, song_id)?;
            let (Some(text), Some(updated_at)) = (text, updated_at) else { continue };
            let parsed = lyrics::parse(text);
            let mut no = 0i64;
            for l in &parsed.lines {
                let words = line_text(&l.original);
                if words.is_empty() {
                    continue;
                }
                let start_ms = l.start.filter(|s| s.is_finite()).map(|s| ((s + parsed.offset) * 1000.0).round() as i64);
                let id: i64 = line.query_row(params![song_id, no, start_ms, words], |r| r.get(0))?;
                fts.execute(params![id, keys_of(&words)])?;
                no += 1;
            }
            tx.execute(
                "INSERT INTO lyrics_indexed (song_id, updated_at) VALUES (?1, ?2)",
                params![song_id, updated_at],
            )?;
        }
    }
    tx.commit()?;
    Ok(changed.len())
}

/// An FTS5 phrase for `text`: matched as written, not as query syntax.
fn phrase(text: &str) -> String {
    format!("\"{}\"", text.replace('"', "\"\""))
}

/// Songs with a line matching `query` (one hit per song, its first matching line), best spelling
/// first, at most `limit`. A query shorter than three letters finds nothing (the index is trigrams).
pub fn search(db: &Db, query: &str, limit: usize) -> crate::Result<Vec<Hit>> {
    let conn = db.conn();
    let mut best: HashMap<String, (f64, i64, i64)> = HashMap::new(); // song -> (penalty, line_no, line_id)
    let mut stmt = conn.prepare(
        "SELECT l.song_id, l.line_no, l.line_id FROM lyrics_fts f JOIN lyrics_lines l ON l.line_id = f.rowid
         WHERE lyrics_fts MATCH ?1 LIMIT 2000",
    )?;
    let mut seen: HashSet<String> = HashSet::new();
    for variant in fold::query_variants(query) {
        let text = variant.text.trim();
        if text.chars().count() < 3 || !seen.insert(text.to_owned()) {
            continue;
        }
        let mut rows = stmt.query([phrase(text)])?;
        while let Some(row) = rows.next()? {
            let (song, no, id): (String, i64, i64) = (row.get(0)?, row.get(1)?, row.get(2)?);
            let entry = best.entry(song).or_insert((variant.penalty, no, id));
            if (variant.penalty, no) < (entry.0, entry.1) {
                *entry = (variant.penalty, no, id);
            }
        }
    }
    let mut ranked: Vec<(String, (f64, i64, i64))> = best.into_iter().collect();
    ranked.sort_by(|a, b| a.1.0.partial_cmp(&b.1.0).unwrap_or(std::cmp::Ordering::Equal).then_with(|| a.0.cmp(&b.0)));
    ranked.truncate(limit);
    let mut line = conn.prepare("SELECT start_ms, text FROM lyrics_lines WHERE line_id = ?1")?;
    let mut near = conn.prepare("SELECT text FROM lyrics_lines WHERE song_id = ?1 AND line_no = ?2")?;
    let mut out = Vec::with_capacity(ranked.len());
    for (song_id, (_, line_no, id)) in ranked {
        let (start_ms, text): (Option<i64>, String) = line.query_row([id], |r| Ok((r.get(0)?, r.get(1)?)))?;
        let before = near.query_row(params![song_id, line_no - 1], |r| r.get(0)).optional()?;
        let after = near.query_row(params![song_id, line_no + 1], |r| r.get(0)).optional()?;
        out.push(Hit { song_id, line_no, start: start_ms.map(|ms| ms as f64 / 1000.0), text, before, after });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn song(db: &Db, id: &str, lyrics_text: &str) {
        db.conn()
            .execute("INSERT OR IGNORE INTO tracks VALUES (?1, 'flac', 44100, 16, 2, 1, NULL, 0, 0)", [id])
            .unwrap();
        lyrics::save(db, id, lyrics_text, "user").unwrap();
    }

    #[test]
    fn a_line_is_found_through_folding_transliteration_and_reading_with_its_time() {
        let db = Db::open_in_memory().unwrap();
        let (a, b, c, d) = ("a".repeat(26), "b".repeat(26), "c".repeat(26), "d".repeat(26));
        song(&db, &a, "[00:10.00]Fly me to the moon\n[00:14.50]Let me play among the stars\n[00:19.00]Let me see\n");
        song(&db, &b, "Я помню чудное мгновенье\nПередо мной явилась ты\n");
        song(&db, &c, "[00:05.00]残酷な天使のテーゼ\n[00:09.00]窓辺からやがて飛び立つ\n");
        song(&db, &d, "Ça plane pour moi\n");
        assert_eq!(sync(&db, usize::MAX).unwrap(), 4);
        assert_eq!(sync(&db, usize::MAX).unwrap(), 0, "nothing changed, nothing rebuilt");

        let hit = &search(&db, "PLAY AMONG", 10).unwrap()[0];
        assert_eq!((hit.song_id.as_str(), hit.start, hit.line_no), (a.as_str(), Some(14.5), 1));
        assert_eq!(hit.before.as_deref(), Some("Fly me to the moon"));
        assert_eq!(hit.after.as_deref(), Some("Let me see"));
        assert_eq!(search(&db, "ca plane", 10).unwrap()[0].song_id, d, "accents off");
        assert_eq!(search(&db, "chudnoe mgnovene", 10).unwrap()[0].song_id, b, "Cyrillic sounded out");
        assert_eq!(search(&db, "явилась", 10).unwrap()[0].song_id, b);
        let japanese = search(&db, "yagate", 10).unwrap();
        assert_eq!(
            japanese.first().map(|h| h.song_id.as_str()),
            Some(c.as_str()),
            "Japanese kana read in Latin (kanji readings: PLAN/20)"
        );
        assert_eq!(japanese[0].start, Some(9.0));
        assert!(search(&db, "zz", 10).unwrap().is_empty(), "under three letters finds nothing");

        // An edit rebuilds the song; removed lyrics leave the index.
        lyrics::save(&db, &a, "[00:01.00]Something else entirely\n", "user").unwrap();
        db.conn().execute("UPDATE lyrics SET updated_at = updated_at + 1 WHERE song_id = ?1", [&a]).unwrap();
        db.conn().execute("DELETE FROM lyrics WHERE song_id = ?1", [&d]).unwrap();
        assert_eq!(sync(&db, usize::MAX).unwrap(), 2);
        assert!(search(&db, "play among", 10).unwrap().is_empty());
        assert_eq!(search(&db, "else entirely", 10).unwrap()[0].song_id, a);
        assert!(search(&db, "ca plane", 10).unwrap().is_empty());
    }
}

#[cfg(test)]
mod perf {
    use super::*;

    /// PLAN/19's budget: a search under 30 ms with 20 000 songs' lyrics (40 lines each) indexed.
    #[test]
    #[ignore]
    fn perf_lyrics_search_at_20000_songs() {
        let db = Db::open_in_memory().unwrap();
        let syllables = ["ka", "ri", "mo", "ne", "su", "ta", "lo", "vi", "en", "da", "or", "pu", "shi", "ze", "ku"];
        let mut x: u64 = 7;
        let mut next = || {
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            x
        };
        let word =
            |n: u64| -> String { (0..2 + n % 3).map(|i| syllables[((n >> (i * 4)) % 15) as usize]).collect() };
        let tx = db.conn().unchecked_transaction().unwrap();
        for s in 0..20_000 {
            let id = format!("{s:026}");
            tx.execute("INSERT INTO tracks VALUES (?1, 'flac', 44100, 16, 2, 1, NULL, 0, 0)", [&id]).unwrap();
            let text: String = (0..40)
                .map(|l| {
                    let line: Vec<String> = (0..6).map(|_| word(next())).collect();
                    format!("[{:02}:{:02}.00]{}\n", l / 12, (l * 5) % 60, line.join(" "))
                })
                .collect();
            tx.execute(
                "INSERT INTO lyrics (song_id, text, synced, source, user_edited, updated_at, updated_by) VALUES (?1, ?2, 1, 'user', 1, 1, 'd')",
                params![id, text],
            )
            .unwrap();
        }
        tx.commit().unwrap();
        let t = std::time::Instant::now();
        assert_eq!(sync(&db, usize::MAX).unwrap(), 20_000);
        let built = t.elapsed();
        let mut worst = std::time::Duration::ZERO;
        for q in ["karimo", "neshi zeku", "vi en da", "lomopu", "orsu tashi", "kuze kuze"] {
            let t = std::time::Instant::now();
            let hits = search(&db, q, 50).unwrap();
            let took = t.elapsed();
            worst = worst.max(took);
            println!("{q:12} {:3} hits in {took:?}", hits.len());
        }
        let t = std::time::Instant::now();
        assert_eq!(sync(&db, usize::MAX).unwrap(), 0);
        let noop = t.elapsed();
        let t = std::time::Instant::now();
        fingerprint(&db).unwrap();
        println!(
            "PERF lyrics: index 800 000 lines {built:?} ({:?} per song); no-op sync {noop:?}; fingerprint {:?}; worst search {worst:?}",
            built / 20_000,
            t.elapsed()
        );
        assert!(worst.as_millis() < 30, "search budget 30 ms: {worst:?}");
    }
}

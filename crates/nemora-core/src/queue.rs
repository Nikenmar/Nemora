//! The persisted queue: what plays and where playback stood, for resume after the app or the device
//! restarts and for the car's Continue. One queue per device; it is device state and never syncs.
//!
//! Items live in `queue_items` (positions 0..n); the current index and position are device
//! settings, so the frequent position checkpoint does not rewrite the items.

use rusqlite::{OptionalExtension, params};
use serde_json::json;

use crate::db::Db;
use crate::error::Result;
use crate::settings;

const INDEX: &str = "queue.index";
const POSITION: &str = "queue.position";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QueueItem {
    pub song_id: String,
    /// The tag signature of the variant that was queued: that one plays while its file is there.
    pub variant_hint: Option<String>,
    /// Where the item was queued from ("playlist", "album", ...), for "Playing from".
    pub source_kind: Option<String>,
    pub source_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Queue {
    pub items: Vec<QueueItem>,
    pub index: usize,
    pub position_ms: i64,
}

/// Replaces the queue, its index and position in one transaction.
pub fn save(db: &mut Db, queue: &Queue) -> Result<()> {
    let tx = db.conn_mut().transaction()?;
    tx.execute("DELETE FROM queue_items", [])?;
    for (position, item) in queue.items.iter().enumerate() {
        tx.execute(
            "INSERT INTO queue_items (position, song_id, variant_hint, source_kind, source_id) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![position as i64, item.song_id, item.variant_hint, item.source_kind, item.source_id],
        )?;
    }
    for (key, value) in [(INDEX, json!(queue.index)), (POSITION, json!(queue.position_ms))] {
        tx.execute(
            "INSERT INTO settings_device (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value.to_string()],
        )?;
    }
    tx.commit()?;
    Ok(())
}

/// Where playback stands, without touching the items: the checkpoint written while playing.
pub fn save_position(db: &Db, index: usize, position_ms: i64) -> Result<()> {
    settings::set_device(db, INDEX, &json!(index))?;
    settings::set_device(db, POSITION, &json!(position_ms))
}

/// The saved queue, or `None` when there is none. An index past the end (items were cut by hand)
/// falls back to the last item.
pub fn load(db: &Db) -> Result<Option<Queue>> {
    let mut stmt =
        db.conn().prepare("SELECT song_id, variant_hint, source_kind, source_id FROM queue_items ORDER BY position")?;
    let items: Vec<QueueItem> = stmt
        .query_map([], |r| {
            Ok(QueueItem { song_id: r.get(0)?, variant_hint: r.get(1)?, source_kind: r.get(2)?, source_id: r.get(3)? })
        })?
        .collect::<rusqlite::Result<_>>()?;
    if items.is_empty() {
        return Ok(None);
    }
    let number = |key| -> Result<i64> { Ok(settings::device(db, key)?.and_then(|v| v.as_i64()).unwrap_or(0)) };
    let index = (number(INDEX)?.max(0) as usize).min(items.len() - 1);
    Ok(Some(Queue { items, index, position_ms: number(POSITION)?.max(0) }))
}

pub fn clear(db: &mut Db) -> Result<()> {
    save(db, &Queue { items: Vec::new(), index: 0, position_ms: 0 })
}

/// The variant to play for each item: the queued one while its file is there, else the song's
/// first present variant, else the queued one even without a file (the player reports it
/// missing). `None` for a song with no variant at all.
pub fn resolve(db: &Db, items: &[QueueItem]) -> Result<Vec<Option<i64>>> {
    let mut by_hint = db
        .conn()
        .prepare("SELECT variant_id, present FROM track_variants WHERE song_id = ?1 AND tag_signature = ?2")?;
    let mut first_present = db.conn().prepare(
        "SELECT variant_id FROM track_variants WHERE song_id = ?1 ORDER BY present DESC, variant_id LIMIT 1",
    )?;
    items
        .iter()
        .map(|item| {
            let hinted: Option<(i64, bool)> = match &item.variant_hint {
                Some(hint) => {
                    by_hint.query_row(params![item.song_id, hint], |r| Ok((r.get(0)?, r.get(1)?))).optional()?
                }
                None => None,
            };
            if let Some((variant, true)) = hinted {
                return Ok(Some(variant));
            }
            let fallback: Option<i64> = first_present.query_row([&item.song_id], |r| r.get(0)).optional()?;
            Ok(fallback.or(hinted.map(|(variant, _)| variant)))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db_with(songs: &[&str]) -> Db {
        let db = Db::open_in_memory().unwrap();
        for s in songs {
            db.conn().execute("INSERT INTO tracks VALUES (?1, 'flac', 44100, 16, 2, 1000, NULL, 0, 0)", [s]).unwrap();
        }
        db
    }

    fn variant(db: &Db, song: &str, signature: &str, present: bool) -> i64 {
        db.conn()
            .execute(
                "INSERT INTO track_variants (song_id, tag_signature, title, title_sort, artist_sort, album_sort,
                   last_seen_at, present) VALUES (?1, ?2, ?2, ?2, '', '', 0, ?3)",
                params![song, signature, present],
            )
            .unwrap();
        db.conn().last_insert_rowid()
    }

    fn item(song: &str, hint: Option<&str>) -> QueueItem {
        QueueItem {
            song_id: song.into(),
            variant_hint: hint.map(Into::into),
            source_kind: Some("playlist".into()),
            source_id: Some("p1".into()),
        }
    }

    #[test]
    fn a_saved_queue_comes_back_as_it_was() {
        let mut db = db_with(&["a", "b", "c"]);
        assert_eq!(load(&db).unwrap(), None);
        let queue = Queue {
            items: vec![item("b", Some("sig")), item("a", None), item("c", None)],
            index: 1,
            position_ms: 42_000,
        };
        save(&mut db, &queue).unwrap();
        assert_eq!(load(&db).unwrap(), Some(queue.clone()));

        save_position(&db, 2, 7_000).unwrap();
        assert_eq!(load(&db).unwrap(), Some(Queue { index: 2, position_ms: 7_000, ..queue }));
    }

    #[test]
    fn a_shorter_queue_replaces_the_longer_one_and_the_index_stays_inside_it() {
        let mut db = db_with(&["a", "b", "c"]);
        save(
            &mut db,
            &Queue { items: vec![item("a", None), item("b", None), item("c", None)], index: 0, position_ms: 0 },
        )
        .unwrap();
        save(&mut db, &Queue { items: vec![item("c", None)], index: 0, position_ms: 0 }).unwrap();
        save_position(&db, 5, 0).unwrap();
        let loaded = load(&db).unwrap().unwrap();
        assert_eq!(loaded.items, vec![item("c", None)]);
        assert_eq!(loaded.index, 0);

        clear(&mut db).unwrap();
        assert_eq!(load(&db).unwrap(), None);
    }

    #[test]
    fn the_queued_variant_plays_while_its_file_is_there() {
        let db = db_with(&["a", "b", "c"]);
        let a_album = variant(&db, "a", "album", true);
        let a_single = variant(&db, "a", "single", true);
        let b_gone = variant(&db, "b", "old", false);
        let b_here = variant(&db, "b", "new", true);
        let c_gone = variant(&db, "c", "only", false);
        let items = [
            item("a", Some("single")),
            item("a", Some("album")),
            item("b", Some("old")),
            item("c", Some("only")),
            item("a", None),
        ];
        assert_eq!(
            resolve(&db, &items).unwrap(),
            [Some(a_single), Some(a_album), Some(b_here), Some(c_gone), Some(a_album)]
        );
        assert_ne!(b_gone, b_here);
    }
}

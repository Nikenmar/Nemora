//! Versions (PLAN/18 D6): a song played with a sound of its own - "Title - Slowed". No file, nothing
//! in the tags, nothing separate in the statistics: a version is a row of the library that is the
//! song, with a name and a sound (speed in semitones, keep pitch, reverb and its size). Lists show it
//! right after its song's own row (as a negative id in the ordered lists, `library`); playlists
//! point at it through `variant_hint` = `version:<id>`.

use std::collections::HashMap;

use rusqlite::{OptionalExtension, params};

use crate::db::{Db, now_ms};
use crate::error::Result;

/// A playlist item's `variant_hint` for a version.
pub const HINT_PREFIX: &str = "version:";

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Version {
    #[serde(default)]
    pub id: i64,
    #[serde(default)]
    pub song_id: String,
    pub name: String,
    pub semitones: f64,
    #[serde(default)]
    pub keep_pitch: bool,
    #[serde(default)]
    pub reverb: f64,
    #[serde(default = "hall")]
    pub size: String,
}

fn hall() -> String {
    "hall".into()
}

fn size_of(size: &str) -> &'static str {
    match size {
        "room" => "room",
        "vast" => "vast",
        _ => "hall",
    }
}

/// The hint that points a playlist item at version `id`.
pub fn hint(id: i64) -> String {
    format!("{HINT_PREFIX}{id}")
}

/// The version a playlist item's hint points at, if it does.
pub fn from_hint(hint: Option<&str>) -> Option<i64> {
    hint?.strip_prefix(HINT_PREFIX)?.parse().ok()
}

fn read(r: &rusqlite::Row<'_>) -> rusqlite::Result<Version> {
    Ok(Version {
        id: r.get(0)?,
        song_id: r.get(1)?,
        name: r.get(2)?,
        semitones: r.get(3)?,
        keep_pitch: r.get(4)?,
        reverb: r.get(5)?,
        size: r.get(6)?,
    })
}

const COLUMNS: &str = "version_id, song_id, name, semitones, keep_pitch, reverb, size";

/// Makes a version of `song_id`; answers its id.
pub fn create(db: &Db, song_id: &str, version: &Version) -> Result<i64> {
    db.conn().execute(
        "INSERT INTO song_versions (song_id, name, semitones, keep_pitch, reverb, size, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            song_id,
            version.name.trim(),
            version.semitones,
            version.keep_pitch,
            version.reverb.clamp(0.0, 1.0),
            size_of(&version.size),
            now_ms()
        ],
    )?;
    Ok(db.conn().last_insert_rowid())
}

pub fn rename(db: &Db, id: i64, name: &str) -> Result<()> {
    db.conn().execute("UPDATE song_versions SET name = ?2 WHERE version_id = ?1", params![id, name.trim()])?;
    Ok(())
}

/// Changes a version's sound (its name stays).
pub fn set_sound(db: &Db, id: i64, sound: &Version) -> Result<()> {
    db.conn().execute(
        "UPDATE song_versions SET semitones = ?2, keep_pitch = ?3, reverb = ?4, size = ?5 WHERE version_id = ?1",
        params![id, sound.semitones, sound.keep_pitch, sound.reverb.clamp(0.0, 1.0), size_of(&sound.size)],
    )?;
    Ok(())
}

/// Removes a version and every playlist item that pointed at it; the song and its statistics stay.
pub fn remove(db: &Db, id: i64) -> Result<()> {
    db.conn().execute("DELETE FROM playlist_items WHERE variant_hint = ?1", [hint(id)])?;
    db.conn().execute("DELETE FROM song_versions WHERE version_id = ?1", [id])?;
    Ok(())
}

pub fn get(db: &Db, id: i64) -> Result<Option<Version>> {
    Ok(db
        .conn()
        .query_row(&format!("SELECT {COLUMNS} FROM song_versions WHERE version_id = ?1"), [id], read)
        .optional()?)
}

/// Every version, by song, each song's in name order.
pub fn by_song(db: &Db) -> Result<HashMap<String, Vec<Version>>> {
    let mut stmt =
        db.conn().prepare(&format!("SELECT {COLUMNS} FROM song_versions ORDER BY song_id, name, version_id"))?;
    let mut out: HashMap<String, Vec<Version>> = HashMap::new();
    for v in stmt.query_map([], read)? {
        let v = v?;
        out.entry(v.song_id.clone()).or_default().push(v);
    }
    Ok(out)
}

/// Records which version a play was (`play_details.version_id`): a fact, never a statistic.
pub fn mark_play(db: &Db, event_id: &str, version_id: i64) -> Result<()> {
    db.conn().execute("UPDATE play_details SET version_id = ?2 WHERE event_id = ?1", params![event_id, version_id])?;
    Ok(())
}

/// A version's row title: "Title - Name".
pub fn title(song_title: &str, version: &Version) -> String {
    format!("{song_title} - {}", version.name)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn library() -> Db {
        let db = Db::open_in_memory().unwrap();
        db.conn().execute("INSERT INTO tracks VALUES ('s', 'flac', 44100, 16, 2, 1000, NULL, 0, 0)", []).unwrap();
        db
    }

    fn slowed() -> Version {
        Version {
            id: 0,
            song_id: String::new(),
            name: "Slowed".into(),
            semitones: -2.0,
            keep_pitch: false,
            reverb: 0.0,
            size: "hall".into(),
        }
    }

    #[test]
    fn a_version_follows_its_song_in_lists_shares_its_statistics_and_is_found_by_name() {
        use crate::library::{SongScope, SongSort, search_corpus, songs};
        let db =
            crate::perf::generate(&crate::perf::Shape { songs: 30, artists: 5, plays: 300, duels: 0, tierlists: 0 });
        let song: String = db
            .conn()
            .query_row("SELECT song_id FROM track_variants WHERE present = 1 ORDER BY title_sort LIMIT 1", [], |r| {
                r.get(0)
            })
            .unwrap();
        let id = create(&db, &song, &slowed()).unwrap();
        db.touch();
        let page = songs(&db, &SongScope::All, &SongSort::TitleAsc, 0, 100).unwrap();
        assert_eq!(page.total, 31, "thirty songs and one version");
        let at = page.rows.iter().position(|r| r.song_id == song && r.version.is_none()).unwrap();
        let version = &page.rows[at + 1];
        assert_eq!(version.version.as_ref().map(|v| v.id), Some(id));
        assert_eq!(version.title, format!("{} - Slowed", page.rows[at].title));
        assert_eq!((version.plays, version.is_favorite), (page.rows[at].plays, page.rows[at].is_favorite));
        let corpus = search_corpus(&db).unwrap();
        let found = crate::search::search(&corpus, crate::search::Filter::Songs, "slowed");
        assert_eq!(found.songs.first(), Some(&(-id).to_string()));
    }

    #[test]
    fn a_version_is_made_renamed_changed_and_removed_with_its_playlist_items() {
        let db = library();
        let id = create(&db, "s", &slowed()).unwrap();
        assert_eq!(get(&db, id).unwrap().unwrap().semitones, -2.0);
        rename(&db, id, " Slowed + Reverb ").unwrap();
        set_sound(&db, id, &Version { reverb: 0.35, ..slowed() }).unwrap();
        let v = get(&db, id).unwrap().unwrap();
        assert_eq!((v.name.as_str(), v.reverb, v.semitones), ("Slowed + Reverb", 0.35, -2.0));
        assert_eq!(by_song(&db).unwrap()["s"].len(), 1);
        db.conn()
            .execute("INSERT INTO playlists (playlist_id, name, created_at, updated_at) VALUES ('p', 'P', 0, 0)", [])
            .ok();
        let _ = db.conn().execute(
            "INSERT INTO playlist_items (playlist_id, position, song_id, variant_hint) VALUES ('p', 0, 's', ?1)",
            [hint(id)],
        );
        remove(&db, id).unwrap();
        assert!(get(&db, id).unwrap().is_none());
        let left: i64 = db
            .conn()
            .query_row("SELECT count(*) FROM playlist_items WHERE variant_hint = ?1", [hint(id)], |r| r.get(0))
            .unwrap();
        assert_eq!(left, 0);
        assert_eq!(from_hint(Some(&hint(7))), Some(7));
        assert_eq!(from_hint(Some("abc")), None);
    }
}

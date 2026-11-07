//! Reading the library: paged song lists, albums, artists and genres, and the search corpus.
//!
//! Only rows with a file present are listed. Sorting is deterministic: 1.1.9's comparators were
//! inconsistent (a year sort returned "equal" whenever one side had no year, and the title key
//! stripped every non-ASCII letter, so Cyrillic titles all compared equal); here every order ends
//! with a stable tie-break, and titles sort by their normalised search key in any script.

use std::collections::{BTreeMap, HashMap};

use rusqlite::{ToSql, params_from_iter};

use crate::db::Db;
use crate::error::Result;
use crate::search::{Corpus, NamedInput, SongInput};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SongSort {
    TitleAsc,
    TitleDesc,
    ArtistAsc,
    ArtistDesc,
    AlbumAsc,
    AlbumDesc,
    YearAsc,
    YearDesc,
    /// Disc, then track number: the order of an album.
    TrackAsc,
    TrackDesc,
    AddedAsc,
    AddedDesc,
    PlaysDesc,
    PlaysAsc,
    /// Plays since a local day (`YYYY-MM-DD`), e.g. the first of this month.
    PlaysSinceDesc(String),
    PlaysSinceAsc(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SongScope {
    All,
    Favorites,
    Blacklisted,
    NotBlacklisted,
    /// An album key from [`albums`].
    Album(String),
    Artist(String),
    Genre(String),
    Folder(i64),
}

#[derive(Debug, Clone, PartialEq)]
pub struct SongRow {
    pub variant_id: i64,
    pub song_id: String,
    pub title: String,
    pub artists: Vec<String>,
    pub album: Option<String>,
    pub year: Option<i64>,
    pub track_no: Option<i64>,
    pub disc_no: Option<i64>,
    pub duration_ms: i64,
    pub cover_hash: Option<String>,
    /// The cover's palette as stored, JSON.
    pub palette: Option<String>,
    pub is_favorite: bool,
    pub is_blacklisted: bool,
    pub plays: i64,
    pub added_at: i64,
    /// The file to open: the first location whose file is there.
    pub path: Option<String>,
    /// The song's first present variant. A song whose audio sits in several files with different
    /// tags has one row per variant; every other row is a duplicate sharing its statistics.
    pub is_primary: bool,
    /// A version of the song (PLAN/18 D6): the row is the song's own, retitled, with this sound.
    pub version: Option<crate::versions::Version>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Page<T> {
    pub total: i64,
    pub rows: Vec<T>,
}

const PRESENT: &str = "v.present = 1";

/// Whether the row `v` is blacklisted: the song itself, or a file of it inside a blacklisted folder.
const BLACKLISTED: &str = "(EXISTS (SELECT 1 FROM blacklist_songs b WHERE b.song_id = v.song_id AND b.value = 1)
     OR EXISTS (SELECT 1 FROM locations bl JOIN folders bf ON bf.excluded = 1
                  AND substr(bl.uri, 1, length(bf.uri) + 1) IN (bf.uri || '\\', bf.uri || '/')
                WHERE bl.variant_id = v.variant_id AND bl.missing_since IS NULL))";

/// One page of songs. The order of a list is computed once and cached until the library or the
/// plays change, so scrolling never re-sorts: a page is a slice of the cached ids.
pub fn songs(db: &Db, scope: &SongScope, sort: &SongSort, offset: i64, limit: i64) -> Result<Page<SongRow>> {
    let key = format!("{scope:?}|{sort:?}");
    let album_ids = match scope {
        SongScope::Album(album) => Some(album_variants(db)?.remove(album).unwrap_or_default()),
        _ => None,
    };
    let ids = db.cached_order(&key, |conn| ordered_ids(conn, scope, sort, album_ids.as_deref()))?;
    let start = offset.clamp(0, ids.len() as i64) as usize;
    let end = (start + limit.max(0) as usize).min(ids.len());
    Ok(Page { total: ids.len() as i64, rows: rows_by_id(db, &ids[start..end])? })
}

/// The ids of a list in order: only what the scope and the sort need is joined.
fn ordered_ids(
    conn: &rusqlite::Connection,
    scope: &SongScope,
    sort: &SongSort,
    album: Option<&[i64]>,
) -> Result<Vec<i64>> {
    let mut args: Vec<Box<dyn ToSql>> = Vec::new();
    let mut joins = String::from(" FROM track_variants v");
    let mut filter = format!(" WHERE {PRESENT}");
    match scope {
        SongScope::All => {}
        SongScope::Favorites => filter.push_str(" AND v.song_id IN (SELECT song_id FROM favorites WHERE value = 1)"),
        SongScope::Blacklisted => filter.push_str(&format!(" AND {BLACKLISTED}")),
        SongScope::NotBlacklisted => filter.push_str(&format!(" AND NOT {BLACKLISTED}")),
        SongScope::Album(_) => filter.push_str(&format!(" AND v.variant_id IN ({})", join_ids(album.unwrap_or(&[])))),
        SongScope::Artist(name) => {
            filter.push_str(" AND v.variant_id IN (SELECT variant_id FROM variant_artists WHERE name = ?)");
            args.push(Box::new(name.clone()));
        }
        SongScope::Genre(name) => {
            filter.push_str(" AND v.variant_id IN (SELECT variant_id FROM variant_genres WHERE name = ?)");
            args.push(Box::new(name.clone()));
        }
        SongScope::Folder(id) => {
            filter.push_str(
                " AND v.variant_id IN (SELECT variant_id FROM locations WHERE folder_id = ? AND missing_since IS NULL)",
            );
            args.push(Box::new(*id));
        }
    }
    let order = match sort {
        SongSort::TitleAsc => "v.title_sort, v.variant_id".to_owned(),
        SongSort::TitleDesc => "v.title_sort DESC, v.variant_id".to_owned(),
        SongSort::ArtistAsc => "v.artist_sort, v.title_sort, v.variant_id".to_owned(),
        SongSort::ArtistDesc => "v.artist_sort DESC, v.title_sort, v.variant_id".to_owned(),
        SongSort::AlbumAsc => {
            "v.album_sort IS NULL, v.album_sort, v.disc_no, v.track_no, v.title_sort, v.variant_id".to_owned()
        }
        SongSort::AlbumDesc => {
            "v.album_sort IS NULL, v.album_sort DESC, v.disc_no, v.track_no, v.title_sort, v.variant_id".to_owned()
        }
        SongSort::YearAsc => "v.year IS NULL, v.year, v.title_sort, v.variant_id".to_owned(),
        SongSort::YearDesc => "v.year IS NULL, v.year DESC, v.title_sort, v.variant_id".to_owned(),
        SongSort::TrackAsc => {
            "v.disc_no IS NULL, v.disc_no, v.track_no IS NULL, v.track_no, v.title_sort, v.variant_id".to_owned()
        }
        SongSort::TrackDesc => {
            "v.disc_no IS NULL, v.disc_no DESC, v.track_no IS NULL, v.track_no DESC, v.title_sort, v.variant_id"
                .to_owned()
        }
        SongSort::AddedAsc | SongSort::AddedDesc => {
            joins.push_str(" JOIN tracks t ON t.song_id = v.song_id");
            let direction = if *sort == SongSort::AddedDesc { "DESC" } else { "" };
            // A file that was on the device before the first scan counts as added when it was
            // written: after a fresh install every song is first seen in the same minute.
            format!(
                "min(t.first_seen_at, coalesce((SELECT min(l.mtime) FROM locations l \
                   WHERE l.variant_id = v.variant_id AND l.mtime > 0), t.first_seen_at)) {direction}, \
                 v.title_sort, v.variant_id"
            )
        }
        SongSort::PlaysAsc | SongSort::PlaysDesc => {
            joins.push_str(" LEFT JOIN song_totals st ON st.song_id = v.song_id");
            let direction = if *sort == SongSort::PlaysDesc { "DESC" } else { "" };
            format!("coalesce(st.plays, 0) {direction}, v.title_sort, v.variant_id")
        }
        SongSort::PlaysSinceDesc(day) | SongSort::PlaysSinceAsc(day) => {
            joins.push_str(
                " LEFT JOIN (SELECT song_id, sum(plays) AS n FROM (
                     SELECT song_id, plays, day FROM play_daily
                     UNION ALL SELECT song_id, plays, day FROM legacy_daily WHERE song_id IS NOT NULL)
                   WHERE day >= ? GROUP BY song_id) since ON since.song_id = v.song_id",
            );
            args.insert(0, Box::new(day.clone()));
            let direction = if matches!(sort, SongSort::PlaysSinceDesc(_)) { "DESC" } else { "" };
            format!("coalesce(since.n, 0) {direction}, v.title_sort, v.variant_id")
        }
    };
    let mut stmt = conn.prepare(&format!("SELECT v.variant_id{joins}{filter} ORDER BY {order}"))?;
    let ids: Vec<i64> = stmt
        .query_map(params_from_iter(args.iter().map(|a| a.as_ref())), |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    match sort {
        // Sorted by when they were added, a version is new when it was made, not when its song was.
        SongSort::AddedAsc | SongSort::AddedDesc => with_versions_by_added(conn, ids, *sort == SongSort::AddedDesc),
        _ => with_versions(conn, ids),
    }
}

/// The added-date sorts (PLAN/18 D6): each version placed by when it was made, among the songs by
/// when they were added; a version made now is the newest row.
fn with_versions_by_added(conn: &rusqlite::Connection, ids: Vec<i64>, newest_first: bool) -> Result<Vec<i64>> {
    let mut stmt = conn.prepare(
        "SELECT sv.version_id, sv.created_at,
                (SELECT min(w.variant_id) FROM track_variants w WHERE w.song_id = sv.song_id AND w.present = 1)
         FROM song_versions sv",
    )?;
    let versions: Vec<(i64, i64, Option<i64>)> =
        stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?.collect::<rusqlite::Result<_>>()?;
    let present: std::collections::HashSet<i64> = ids.iter().copied().collect();
    let versions: Vec<(i64, i64)> = versions
        .into_iter()
        .filter(|(_, _, primary)| primary.is_some_and(|p| present.contains(&p)))
        .map(|(id, at, _)| (-id, at))
        .collect();
    if versions.is_empty() {
        return Ok(ids);
    }
    let mut added: HashMap<i64, i64> = HashMap::with_capacity(ids.len());
    let mut stmt = conn.prepare(
        "SELECT v.variant_id, min(t.first_seen_at, coalesce((SELECT min(l.mtime) FROM locations l
           WHERE l.variant_id = v.variant_id AND l.mtime > 0), t.first_seen_at))
         FROM track_variants v JOIN tracks t ON t.song_id = v.song_id",
    )?;
    for row in stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)))? {
        let (id, at) = row?;
        if present.contains(&id) {
            added.insert(id, at);
        }
    }
    // Merge: the songs keep their order; each version goes before the first song added after it
    // (newest first: before the first song added before it).
    let mut versions = versions;
    versions.sort_by_key(|(id, at)| if newest_first { (-at, *id) } else { (*at, *id) });
    let mut out = Vec::with_capacity(ids.len() + versions.len());
    let mut next = versions.into_iter().peekable();
    for id in ids {
        let at = added.get(&id).copied().unwrap_or(0);
        while let Some(&(v, made)) = next.peek() {
            let goes_first = if newest_first { made > at } else { made < at };
            if !goes_first {
                break;
            }
            out.push(v);
            next.next();
        }
        out.push(id);
    }
    out.extend(next.map(|(v, _)| v));
    Ok(out)
}

/// Puts each song's versions (PLAN/18 D6) right after its own row, as negative ids (`-version_id`).
fn with_versions(conn: &rusqlite::Connection, ids: Vec<i64>) -> Result<Vec<i64>> {
    let mut stmt = conn.prepare(
        "SELECT (SELECT min(w.variant_id) FROM track_variants w WHERE w.song_id = sv.song_id AND w.present = 1),
                sv.version_id
         FROM song_versions sv ORDER BY sv.song_id, sv.name, sv.version_id",
    )?;
    let mut after: HashMap<i64, Vec<i64>> = HashMap::new();
    for row in stmt.query_map([], |r| Ok((r.get::<_, Option<i64>>(0)?, r.get::<_, i64>(1)?)))? {
        let (primary, version) = row?;
        if let Some(primary) = primary {
            after.entry(primary).or_default().push(-version);
        }
    }
    if after.is_empty() {
        return Ok(ids);
    }
    let mut out = Vec::with_capacity(ids.len());
    for id in ids {
        out.push(id);
        if let Some(versions) = after.get(&id) {
            out.extend(versions);
        }
    }
    Ok(out)
}

/// Full rows for the given variant ids, in the given order; unknown ids are skipped. A negative id
/// is a version (`-version_id`): its song's own row with the version (name and sound) attached; the
/// title stays the song's, the view shows the version beside it.
pub fn rows_by_id(db: &Db, ids: &[i64]) -> Result<Vec<SongRow>> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    if ids.iter().any(|&id| id < 0) {
        let mut versions: HashMap<i64, crate::versions::Version> = HashMap::new();
        for &id in ids.iter().filter(|&&id| id < 0) {
            if let Some(v) = crate::versions::get(db, -id)? {
                versions.insert(id, v);
            }
        }
        let songs: Vec<String> = versions.values().map(|v| v.song_id.clone()).collect();
        let primary = primary_variants(db, &songs)?;
        let wanted: Vec<i64> = ids
            .iter()
            .map(|&id| {
                if id < 0 { versions.get(&id).and_then(|v| primary.get(&v.song_id)).copied().unwrap_or(0) } else { id }
            })
            .collect();
        let plain: Vec<i64> = wanted.iter().copied().filter(|&id| id > 0).collect();
        let by_id: HashMap<i64, SongRow> = rows_by_id(db, &plain)?.into_iter().map(|r| (r.variant_id, r)).collect();
        return Ok(ids
            .iter()
            .zip(&wanted)
            .filter_map(|(&id, variant)| {
                let mut row = by_id.get(variant)?.clone();
                if id < 0 {
                    let version = versions.get(&id)?.clone();
                    row.is_primary = false;
                    row.version = Some(version);
                }
                Some(row)
            })
            .collect());
    }
    let sql = format!(
        "SELECT v.variant_id, v.song_id, v.title, v.album, v.year, v.track_no, v.disc_no, t.duration_ms, v.cover_hash,
                EXISTS (SELECT 1 FROM favorites f WHERE f.song_id = v.song_id AND f.value = 1),
                {BLACKLISTED},
                coalesce((SELECT plays FROM song_totals st WHERE st.song_id = v.song_id), 0), t.first_seen_at,
                (SELECT group_concat(name, char(31)) FROM (SELECT name FROM variant_artists a
                   WHERE a.variant_id = v.variant_id AND a.role = 'artist' ORDER BY position)),
                (SELECT uri FROM locations l WHERE l.variant_id = v.variant_id AND l.missing_since IS NULL
                   ORDER BY l.location_id LIMIT 1),
                v.variant_id = (SELECT min(w.variant_id) FROM track_variants w WHERE w.song_id = v.song_id AND w.present = 1),
                (SELECT palette FROM covers c WHERE c.cover_hash = v.cover_hash)
         FROM track_variants v JOIN tracks t ON t.song_id = v.song_id WHERE v.variant_id IN ({})",
        join_ids(ids)
    );
    let mut stmt = db.conn().prepare(&sql)?;
    let mut by_id: HashMap<i64, SongRow> = stmt
        .query_map([], |r| {
            let artists: Option<String> = r.get(13)?;
            Ok(SongRow {
                variant_id: r.get(0)?,
                song_id: r.get(1)?,
                title: r.get(2)?,
                artists: artists.map(|a| a.split('\u{1f}').map(str::to_owned).collect()).unwrap_or_default(),
                album: r.get(3)?,
                year: r.get(4)?,
                track_no: r.get(5)?,
                disc_no: r.get(6)?,
                duration_ms: r.get(7)?,
                cover_hash: r.get(8)?,
                is_favorite: r.get(9)?,
                is_blacklisted: r.get(10)?,
                plays: r.get(11)?,
                added_at: r.get(12)?,
                path: r.get(14)?,
                is_primary: r.get::<_, Option<bool>>(15)?.unwrap_or(false),
                palette: r.get(16)?,
                version: None,
            })
        })?
        .map(|row| row.map(|r| (r.variant_id, r)))
        .collect::<rusqlite::Result<_>>()?;
    Ok(ids.iter().filter_map(|id| by_id.remove(id)).collect())
}

/// A present file that carries the picture `cover_hash`: where the full-size picture can be read
/// again, since the cover store keeps thumbnails only.
pub fn file_with_cover(db: &Db, cover_hash: &str) -> Result<Option<String>> {
    use rusqlite::OptionalExtension;
    Ok(db
        .conn()
        .query_row(
            "SELECT l.uri FROM locations l JOIN track_variants v USING (variant_id)
             WHERE v.cover_hash = ?1 AND l.missing_since IS NULL ORDER BY l.uri LIMIT 1",
            [cover_hash],
            |r| r.get(0),
        )
        .optional()?)
}

/// The song whose file is at `path` (any spelling of the separators).
pub fn song_at(db: &Db, path: &str) -> Result<Option<String>> {
    use rusqlite::OptionalExtension;
    let path: std::path::PathBuf = std::path::Path::new(path).components().collect();
    Ok(db
        .conn()
        .query_row(
            "SELECT v.song_id FROM locations l JOIN track_variants v USING (variant_id) WHERE l.uri = ?1",
            [path.to_string_lossy().as_ref()],
            |r| r.get(0),
        )
        .optional()?)
}

/// The tag signature of a variant: what a playlist item keeps to show the same tags again.
pub fn variant_signature(db: &Db, variant_id: i64) -> Result<Option<String>> {
    use rusqlite::OptionalExtension;
    Ok(db
        .conn()
        .query_row("SELECT tag_signature FROM track_variants WHERE variant_id = ?1", [variant_id], |r| r.get(0))
        .optional()?)
}

/// The first present variant of each song; songs with no file present are left out.
pub fn primary_variants(db: &Db, song_ids: &[String]) -> Result<HashMap<String, i64>> {
    let mut out = HashMap::with_capacity(song_ids.len());
    let mut stmt = db
        .conn()
        .prepare_cached(&format!("SELECT min(variant_id) FROM track_variants v WHERE v.song_id = ?1 AND {PRESENT}"))?;
    for id in song_ids {
        if let Some(variant) = stmt.query_row([id], |r| r.get::<_, Option<i64>>(0))? {
            out.insert(id.clone(), variant);
        }
    }
    Ok(out)
}

fn join_ids(ids: &[i64]) -> String {
    if ids.is_empty() { "NULL".to_owned() } else { ids.iter().map(i64::to_string).collect::<Vec<_>>().join(",") }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AlbumRow {
    pub key: String,
    pub title: String,
    pub artists: Vec<String>,
    pub year: Option<i64>,
    pub song_count: i64,
    pub cover_hash: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NameSort {
    NameAsc,
    NameDesc,
    SongsDesc,
    SongsAsc,
}

struct AlbumMember {
    variant_id: i64,
    title: String,
    album_artists: Vec<String>,
    year: Option<i64>,
    cover_hash: Option<String>,
    track: (Option<i64>, Option<i64>),
}

/// Groups present variants into albums: same title and overlapping album artists, or same title
/// and no album artist at all. Returns key -> members.
fn group_albums(db: &Db) -> Result<BTreeMap<String, Vec<AlbumMember>>> {
    let conn = db.conn();
    let mut stmt = conn.prepare(&format!(
        "SELECT v.variant_id, v.album, v.year, v.cover_hash, v.disc_no, v.track_no,
                (SELECT group_concat(name, char(31)) FROM (SELECT name FROM variant_artists a
                   WHERE a.variant_id = v.variant_id AND a.role = 'album_artist' ORDER BY position))
         FROM track_variants v WHERE v.album IS NOT NULL AND {PRESENT}"
    ))?;
    let members: Vec<AlbumMember> = stmt
        .query_map([], |r| {
            let artists: Option<String> = r.get(6)?;
            Ok(AlbumMember {
                variant_id: r.get(0)?,
                title: r.get(1)?,
                year: r.get(2)?,
                cover_hash: r.get(3)?,
                track: (r.get(4)?, r.get(5)?),
                album_artists: artists.map(|a| a.split('\u{1f}').map(str::to_owned).collect()).unwrap_or_default(),
            })
        })?
        .collect::<rusqlite::Result<_>>()?;

    // Union-find within each title over shared album artists.
    let mut by_title: HashMap<String, Vec<usize>> = HashMap::new();
    for (i, m) in members.iter().enumerate() {
        by_title.entry(m.title.clone()).or_default().push(i);
    }
    let mut parent: Vec<usize> = (0..members.len()).collect();
    fn root(parent: &mut [usize], mut i: usize) -> usize {
        while parent[i] != i {
            parent[i] = parent[parent[i]];
            i = parent[i];
        }
        i
    }
    for indexes in by_title.values() {
        let mut owner: HashMap<&str, usize> = HashMap::new();
        let mut untagged: Option<usize> = None;
        for &i in indexes {
            if members[i].album_artists.is_empty() {
                match untagged {
                    Some(u) => {
                        let (a, b) = (root(&mut parent, u), root(&mut parent, i));
                        parent[b] = a;
                    }
                    None => untagged = Some(i),
                }
                continue;
            }
            for artist in &members[i].album_artists {
                match owner.get(artist.as_str()) {
                    Some(&o) => {
                        let (a, b) = (root(&mut parent, o), root(&mut parent, i));
                        parent[b] = a;
                    }
                    None => {
                        owner.insert(artist, i);
                    }
                }
            }
        }
    }
    let mut groups: HashMap<usize, Vec<usize>> = HashMap::new();
    for i in 0..members.len() {
        let r = root(&mut parent, i);
        groups.entry(r).or_default().push(i);
    }
    let mut members: Vec<Option<AlbumMember>> = members.into_iter().map(Some).collect();
    let mut out = BTreeMap::new();
    for indexes in groups.into_values() {
        let group: Vec<AlbumMember> = indexes.into_iter().filter_map(|i| members[i].take()).collect();
        let mut names: Vec<&str> = group.iter().flat_map(|m| m.album_artists.iter().map(String::as_str)).collect();
        names.sort();
        // A key stable across devices and scans: the title and the smallest album artist.
        let key =
            blake3::hash(format!("album\0{}\0{}", group[0].title, names.first().copied().unwrap_or("")).as_bytes())
                .to_hex()[..16]
                .to_owned();
        out.insert(key, group);
    }
    Ok(out)
}

fn album_variants(db: &Db) -> Result<HashMap<String, Vec<i64>>> {
    Ok(group_albums(db)?.into_iter().map(|(k, g)| (k, g.iter().map(|m| m.variant_id).collect())).collect())
}

pub fn albums(db: &Db, sort: NameSort) -> Result<Vec<AlbumRow>> {
    let mut rows: Vec<AlbumRow> = group_albums(db)?
        .into_iter()
        .map(|(key, mut group)| {
            group.sort_by_key(|m| (m.track.0.unwrap_or(i64::MAX), m.track.1.unwrap_or(i64::MAX), m.variant_id));
            let mut artists: Vec<String> = Vec::new();
            for name in group.iter().flat_map(|m| m.album_artists.iter()) {
                if !artists.contains(name) {
                    artists.push(name.clone());
                }
            }
            AlbumRow {
                key,
                title: group[0].title.clone(),
                artists,
                year: group.iter().filter_map(|m| m.year).min(),
                song_count: group.len() as i64,
                cover_hash: group.iter().find_map(|m| m.cover_hash.clone()),
            }
        })
        .collect();
    sort_named(&mut rows, sort, |r| (&r.title, r.song_count, &r.key));
    Ok(rows)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NamedRow {
    pub name: String,
    pub song_count: i64,
    pub cover_hash: Option<String>,
    pub palette: Option<String>,
}

/// Artists credited on present songs (track artists and album artists).
pub fn artists(db: &Db, sort: NameSort) -> Result<Vec<NamedRow>> {
    named_rows(
        db,
        "SELECT a.name, count(DISTINCT v.song_id), max(v.cover_hash) AS cover FROM variant_artists a JOIN track_variants v USING (variant_id)",
        "a.name",
        sort,
    )
}

pub fn genres(db: &Db, sort: NameSort) -> Result<Vec<NamedRow>> {
    named_rows(
        db,
        "SELECT g.name, count(DISTINCT v.song_id), max(v.cover_hash) AS cover FROM variant_genres g JOIN track_variants v USING (variant_id)",
        "g.name",
        sort,
    )
}

fn named_rows(db: &Db, select: &str, group: &str, sort: NameSort) -> Result<Vec<NamedRow>> {
    let mut stmt = db.conn().prepare(&format!(
        "SELECT n.*, (SELECT palette FROM covers c WHERE c.cover_hash = n.cover)
         FROM ({select} WHERE {PRESENT} GROUP BY {group}) n"
    ))?;
    let mut rows: Vec<NamedRow> = stmt
        .query_map([], |r| {
            Ok(NamedRow { name: r.get(0)?, song_count: r.get(1)?, cover_hash: r.get(2)?, palette: r.get(3)? })
        })?
        .collect::<rusqlite::Result<_>>()?;
    sort_named(&mut rows, sort, |r| (&r.name, r.song_count, &r.name));
    Ok(rows)
}

fn sort_named<T>(rows: &mut [T], sort: NameSort, key: impl Fn(&T) -> (&String, i64, &String)) {
    use crate::search::fold::normalize;
    let mut keyed: Vec<(String, i64, String, usize)> = rows
        .iter()
        .enumerate()
        .map(|(i, r)| {
            let (name, count, tie) = key(r);
            (normalize(name), count, tie.clone(), i)
        })
        .collect();
    match sort {
        NameSort::NameAsc => keyed.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.2.cmp(&b.2))),
        NameSort::NameDesc => keyed.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.2.cmp(&b.2))),
        NameSort::SongsDesc => {
            keyed.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)).then_with(|| a.2.cmp(&b.2)))
        }
        NameSort::SongsAsc => {
            keyed.sort_by(|a, b| a.1.cmp(&b.1).then_with(|| a.0.cmp(&b.0)).then_with(|| a.2.cmp(&b.2)))
        }
    }
    let order: Vec<usize> = keyed.into_iter().map(|k| k.3).collect();
    apply_order(rows, &order);
}

/// Reorders `rows` so that position `i` holds the element that was at `order[i]`.
fn apply_order<T>(rows: &mut [T], order: &[usize]) {
    let mut position: Vec<usize> = vec![0; order.len()];
    for (new, &old) in order.iter().enumerate() {
        position[old] = new;
    }
    for i in 0..rows.len() {
        while position[i] != i {
            let target = position[i];
            rows.swap(i, target);
            position.swap(i, target);
        }
    }
}

/// A file of the library: where it is and the row it belongs to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct File {
    pub path: String,
    pub variant_id: i64,
    pub song_id: String,
    pub is_primary: bool,
}

/// Every present file, in path order.
pub fn files(db: &Db) -> Result<Vec<File>> {
    let mut stmt = db.conn().prepare(
        "SELECT l.uri, v.variant_id, v.song_id,
                v.variant_id = (SELECT min(w.variant_id) FROM track_variants w WHERE w.song_id = v.song_id AND w.present = 1)
         FROM locations l JOIN track_variants v USING (variant_id) WHERE l.missing_since IS NULL ORDER BY l.uri",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok(File { path: r.get(0)?, variant_id: r.get(1)?, song_id: r.get(2)?, is_primary: r.get(3)? })
        })?
        .collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}

/// A present library row as a member of an artist, a genre or an album.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Member {
    pub variant_id: i64,
    pub song_id: String,
    pub title: String,
    pub is_primary: bool,
}

/// Which grouping [`members`] reads.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Group {
    /// Track artists and album artists, as [`artists`] counts them.
    Artist,
    Genre,
    /// Album keys from [`albums`].
    Album,
}

/// The present rows of every artist, genre or album in one pass, each list in title order.
pub fn members(db: &Db, group: Group) -> Result<HashMap<String, Vec<Member>>> {
    let conn = db.conn();
    let primary =
        "v.variant_id = (SELECT min(w.variant_id) FROM track_variants w WHERE w.song_id = v.song_id AND w.present = 1)";
    let mut out: HashMap<String, Vec<Member>> = HashMap::new();
    let read = |sql: &str, out: &mut HashMap<String, Vec<Member>>| -> Result<()> {
        let mut stmt = conn.prepare(sql)?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                Member { variant_id: r.get(1)?, song_id: r.get(2)?, title: r.get(3)?, is_primary: r.get(4)? },
            ))
        })?;
        for row in rows {
            let (key, member) = row?;
            let list = out.entry(key).or_default();
            if list.last().is_none_or(|m: &Member| m.variant_id != member.variant_id) {
                list.push(member);
            }
        }
        Ok(())
    };
    match group {
        Group::Artist => read(
            &format!(
                "SELECT a.name, v.variant_id, v.song_id, v.title, {primary} FROM variant_artists a
                 JOIN track_variants v USING (variant_id) WHERE {PRESENT}
                 GROUP BY a.name, v.variant_id ORDER BY a.name, v.title_sort, v.variant_id"
            ),
            &mut out,
        )?,
        Group::Genre => read(
            &format!(
                "SELECT g.name, v.variant_id, v.song_id, v.title, {primary} FROM variant_genres g
                 JOIN track_variants v USING (variant_id) WHERE {PRESENT}
                 GROUP BY g.name, v.variant_id ORDER BY g.name, v.title_sort, v.variant_id"
            ),
            &mut out,
        )?,
        Group::Album => {
            // One read of every present row, then the groups: a query per album took 0.2 s for
            // a thousand albums.
            let mut stmt = conn.prepare(&format!(
                "SELECT v.variant_id, v.song_id, v.title, {primary} FROM track_variants v WHERE {PRESENT}"
            ))?;
            let mut rows: HashMap<i64, Member> = stmt
                .query_map([], |r| {
                    Ok(Member { variant_id: r.get(0)?, song_id: r.get(1)?, title: r.get(2)?, is_primary: r.get(3)? })
                })?
                .map(|m| m.map(|m| (m.variant_id, m)))
                .collect::<rusqlite::Result<_>>()?;
            for (key, mut group) in group_albums(db)? {
                group.sort_by_key(|m| (m.track.0.unwrap_or(i64::MAX), m.track.1.unwrap_or(i64::MAX), m.variant_id));
                out.insert(key, group.iter().filter_map(|m| rows.remove(&m.variant_id)).collect());
            }
        }
    }
    Ok(out)
}

/// The present library in numbers (PLAN/22's summary for agents).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Counts {
    pub songs: i64,
    pub duration_ms: i64,
    pub plays: i64,
    pub songs_with_lyrics: i64,
}

pub fn counts(db: &Db) -> Result<Counts> {
    let present = "EXISTS (SELECT 1 FROM track_variants v JOIN locations l USING (variant_id)
                   WHERE v.song_id = t.song_id AND l.missing_since IS NULL)";
    let one = |sql: String| db.conn().query_row(&sql, [], |r| r.get::<_, i64>(0));
    Ok(Counts {
        songs: one(format!("SELECT count(*) FROM tracks t WHERE {present}"))?,
        duration_ms: one(format!("SELECT coalesce(sum(t.duration_ms), 0) FROM tracks t WHERE {present}"))?,
        plays: one("SELECT coalesce(sum(plays), 0) FROM song_totals".to_owned())?,
        songs_with_lyrics: one("SELECT count(*) FROM lyrics".to_owned())?,
    })
}

/// The search corpus of the present library: one entry per library row, ids are variant ids.
pub fn search_corpus(db: &Db) -> Result<Corpus> {
    let conn = db.conn();
    let mut stmt = conn.prepare(&format!(
        "SELECT v.variant_id, v.title, v.album, coalesce(st.plays, 0) + coalesce(st.full, 0),
                (SELECT group_concat(name, char(31)) FROM (SELECT name FROM variant_artists a
                   WHERE a.variant_id = v.variant_id AND a.role = 'artist' ORDER BY position))
         FROM track_variants v LEFT JOIN song_totals st USING (song_id)
         WHERE {PRESENT} ORDER BY v.title_sort, v.variant_id"
    ))?;
    let songs: Vec<SongInput> = stmt
        .query_map([], |r| {
            let artists: Option<String> = r.get(4)?;
            Ok(SongInput {
                id: r.get::<_, i64>(0)?.to_string(),
                title: r.get(1)?,
                album: r.get(2)?,
                popularity: r.get(3)?,
                artists: artists.map(|a| a.split('\u{1f}').map(str::to_owned).collect()).unwrap_or_default(),
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    // Versions (PLAN/18 D6) are found by their own name too: "slowed" finds every slowed version.
    let mut songs = songs;
    let mut stmt = conn.prepare(&format!(
        "SELECT sv.version_id, v.title || ' - ' || sv.name, v.album, coalesce(st.plays, 0) + coalesce(st.full, 0),
                (SELECT group_concat(name, char(31)) FROM (SELECT name FROM variant_artists a
                   WHERE a.variant_id = v.variant_id AND a.role = 'artist' ORDER BY position))
         FROM song_versions sv
         JOIN track_variants v ON v.variant_id =
           (SELECT min(w.variant_id) FROM track_variants w WHERE w.song_id = sv.song_id AND w.present = 1)
         LEFT JOIN song_totals st ON st.song_id = sv.song_id
         WHERE {PRESENT} ORDER BY sv.version_id"
    ))?;
    for row in stmt.query_map([], |r| {
        let artists: Option<String> = r.get(4)?;
        Ok(SongInput {
            id: (-r.get::<_, i64>(0)?).to_string(),
            title: r.get(1)?,
            album: r.get(2)?,
            popularity: r.get(3)?,
            artists: artists.map(|a| a.split('\u{1f}').map(str::to_owned).collect()).unwrap_or_default(),
        })
    })? {
        songs.push(row?);
    }
    let named =
        |rows: Vec<NamedRow>| rows.into_iter().map(|r| NamedInput { id: r.name.clone(), name: r.name }).collect();
    let albums = albums(db, NameSort::NameAsc)?.into_iter().map(|a| NamedInput { id: a.key, name: a.title }).collect();
    let mut stmt = conn.prepare("SELECT playlist_id, name FROM playlists WHERE deleted_at IS NULL ORDER BY name")?;
    let playlists =
        stmt.query_map([], |r| Ok(NamedInput { id: r.get(0)?, name: r.get(1)? }))?.collect::<rusqlite::Result<_>>()?;
    Ok(Corpus::build(
        songs,
        named(artists(db, NameSort::NameAsc)?),
        albums,
        playlists,
        named(genres(db, NameSort::NameAsc)?),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn apply_order_permutes() {
        let mut v = vec!['a', 'b', 'c', 'd'];
        apply_order(&mut v, &[2, 0, 3, 1]);
        assert_eq!(v, vec!['c', 'a', 'd', 'b']);
    }
}

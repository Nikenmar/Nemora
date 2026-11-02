//! Development probe for PLAN/20 D1: how many files of a library carry sort-order tags (title,
//! artist, album), read-only. Usage: sort_tags_probe <profile.db>
use lofty::config::{ParseOptions, ParsingMode};
use lofty::file::TaggedFileExt;
use lofty::probe::Probe;
use lofty::tag::ItemKey;

fn main() {
    let db = std::env::args().nth(1).expect("profile db");
    let conn = rusqlite::Connection::open_with_flags(db, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    let mut stmt = conn.prepare("SELECT l.uri, v.title FROM locations l JOIN track_variants v USING (variant_id) WHERE l.missing_since IS NULL").unwrap();
    let rows: Vec<(String, String)> =
        stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).unwrap().map(Result::unwrap).collect();
    let (mut files, mut with) = (0, 0);
    for (uri, title) in &rows {
        let Ok(tagged) =
            Probe::open(uri).and_then(|p| p.options(ParseOptions::new().parsing_mode(ParsingMode::Relaxed)).read())
        else {
            continue;
        };
        files += 1;
        let Some(tag) = tagged.primary_tag().or_else(|| tagged.first_tag()) else { continue };
        let found: Vec<String> = [
            ItemKey::TrackTitleSortOrder,
            ItemKey::TrackArtistSortOrder,
            ItemKey::AlbumTitleSortOrder,
            ItemKey::AlbumArtistSortOrder,
        ]
        .iter()
        .filter_map(|k| tag.get_string(*k).map(|v| format!("{k:?}={v}")))
        .collect();
        if !found.is_empty() {
            with += 1;
            if with <= 15 {
                println!("{title} | {}", found.join(" ; "));
            }
        }
    }
    println!("SORT TAGS: {with} of {files} files");
}

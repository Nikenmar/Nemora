mod common;

use std::path::Path;

use nemora_core::covers::CoverStore;
use nemora_core::db::Db;
use nemora_core::scan::{ScanReport, scan_folders};

fn count(db_path: &Path, sql: &str) -> i64 {
    let conn = rusqlite::Connection::open(db_path).unwrap();
    conn.query_row(sql, [], |r| r.get(0)).unwrap()
}

#[test]
fn scan_follows_the_folder_through_edits_copies_and_missing_files() {
    if !common::ffmpeg_available() {
        eprintln!("SKIPPED: ffmpeg is not on PATH");
        return;
    }
    let root = common::temp_dir("scan");
    let music = root.join("music");
    std::fs::create_dir_all(music.join("sub")).unwrap();
    let a = music.join("a.flac");
    let b = music.join("b.flac");
    let c = music.join("c.flac");
    common::flac(&a, 1, 3);
    common::flac(&b, 2, 3);
    common::flac(&c, 3, 3);
    let album_cover = common::png(7);
    common::set_tags(&a, "Shiniest Sky", "Red X, Habazane", Some("Album"), Some(album_cover.clone()));
    common::set_tags(&b, "Second", "Red X", Some("Album"), Some(album_cover));

    let db_path = root.join("nemora.db");
    let mut db = Db::open(&db_path).unwrap();
    let covers = CoverStore::new(root.join("covers"));
    let roots = vec![music.clone()];
    let mut scan = || scan_folders(&mut db, &covers, &roots).unwrap();

    // First scan: three songs, one shared album cover.
    let r = scan();
    assert_eq!((r.files, r.added, r.covers_written), (3, 3, 1), "{r:?}");
    assert!(r.failed.is_empty(), "{r:?}");
    assert_eq!(count(&db_path, "SELECT count(*) FROM tracks"), 3);
    assert_eq!(count(&db_path, "SELECT count(*) FROM covers"), 1);
    assert_eq!(
        count(&db_path, "SELECT count(*) FROM variant_artists v JOIN track_variants t USING (variant_id) WHERE t.title = 'Shiniest Sky'"),
        2,
        "artists are split on commas"
    );
    assert_eq!(count(&db_path, "SELECT count(*) FROM track_variants WHERE title = 'c'"), 1, "untagged title is the file name");
    assert_eq!(count(&db_path, "SELECT count(*) FROM search_fts WHERE search_fts MATCH 'iniest'"), 1);

    // Nothing changed: nothing is opened again.
    assert_eq!(scan(), ScanReport { files: 3, unchanged: 3, ..Default::default() });

    // Retag: same song, new variant; the superseded variant is dropped.
    common::set_tags(&a, "Shiniest Sky (edit)", "Red X, Habazane", Some("Album"), None);
    let r = scan();
    assert_eq!((r.updated, r.unchanged), (1, 2), "{r:?}");
    assert_eq!(count(&db_path, "SELECT count(*) FROM tracks"), 3);
    assert_eq!(count(&db_path, "SELECT count(*) FROM track_variants"), 3);
    assert_eq!(count(&db_path, "SELECT count(*) FROM search_fts WHERE search_fts MATCH 'edit'"), 1);
    assert_eq!(count(&db_path, "SELECT count(*) FROM search_fts WHERE search_fts MATCH 'iniest'"), 1);

    // An identical copy elsewhere: one more location, same song, same row.
    std::fs::copy(&b, music.join("sub").join("b copy.flac")).unwrap();
    let r = scan();
    assert_eq!(r.added, 1, "{r:?}");
    assert_eq!(count(&db_path, "SELECT count(*) FROM tracks"), 3);
    assert_eq!(count(&db_path, "SELECT count(*) FROM track_variants"), 3);
    assert_eq!(count(&db_path, "SELECT count(*) FROM locations"), 4);

    // The same audio with other tags: same song, a second row (shared statistics, separate display).
    let c2 = music.join("sub").join("c retagged.flac");
    std::fs::copy(&c, &c2).unwrap();
    common::set_tags(&c2, "Other tags", "Somebody", None, None);
    scan();
    assert_eq!(count(&db_path, "SELECT count(*) FROM tracks"), 3);
    assert_eq!(count(&db_path, "SELECT count(*) FROM track_variants"), 4);

    // A file disappears, then comes back unchanged.
    let away = root.join("b.flac");
    std::fs::rename(&b, &away).unwrap();
    let r = scan();
    assert_eq!(r.missing, 1, "{r:?}");
    assert_eq!(count(&db_path, "SELECT count(*) FROM locations WHERE missing_since IS NOT NULL"), 1);
    assert_eq!(count(&db_path, "SELECT count(*) FROM tracks"), 3, "a track never dies with its file");
    std::fs::rename(&away, &b).unwrap();
    let r = scan();
    assert_eq!(r.restored, 1, "{r:?}");
    assert_eq!(count(&db_path, "SELECT count(*) FROM locations WHERE missing_since IS NOT NULL"), 0);

    drop(db);
    let _ = std::fs::remove_dir_all(&root);
}

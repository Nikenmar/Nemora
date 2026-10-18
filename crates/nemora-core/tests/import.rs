mod common;

use std::path::Path;

use nemora_core::covers::CoverStore;
use nemora_core::db::Db;
use nemora_core::import::import_nemora_1x;
use nemora_core::scan::scan_folders;
use serde_json::json;

fn write_store(dir: &Path, file: &str, key: &str, payload: serde_json::Value) {
    let doc = json!({ "version": "1.1.9", key: payload });
    std::fs::write(dir.join(file), serde_json::to_string_pretty(&doc).unwrap()).unwrap();
}

/// Every row of the tables an import writes, as text, so two databases can be compared.
fn dump(db_path: &Path) -> Vec<String> {
    let conn = rusqlite::Connection::open(db_path).unwrap();
    let mut out = Vec::new();
    for table in [
        "favorites", "playlists", "playlist_items", "pending_tracks", "legacy_daily", "elo_baseline", "duels",
        "tierlists", "blacklist_songs", "settings_shared", "settings_device", "folders",
    ] {
        let mut stmt = conn.prepare(&format!("SELECT * FROM {table}")).unwrap();
        let columns = stmt.column_count();
        let mut rows: Vec<String> = stmt
            .query_map([], |r| {
                Ok((0..columns).map(|i| format!("{:?}", r.get_ref(i).unwrap())).collect::<Vec<_>>().join("|"))
            })
            .unwrap()
            .map(|r| format!("{table}: {}", r.unwrap()))
            .collect();
        rows.sort();
        out.extend(rows);
    }
    out
}

fn one(db_path: &Path, sql: &str) -> i64 {
    rusqlite::Connection::open(db_path).unwrap().query_row(sql, [], |r| r.get(0)).unwrap()
}

#[test]
fn a_1x_profile_lands_on_the_right_songs_and_imports_once() {
    if !common::ffmpeg_available() {
        eprintln!("SKIPPED: ffmpeg is not on PATH");
        return;
    }
    let root = common::temp_dir("import");
    let music = root.join("music");
    std::fs::create_dir_all(&music).unwrap();
    let a = music.join("a.flac");
    let b = music.join("b.flac");
    common::flac(&a, 11, 3);
    common::flac(&b, 12, 3);
    common::set_tags(&a, "Song A", "Artist", None, None);
    common::set_tags(&b, "Song B", "Artist", None, None);

    let db_path = root.join("nemora.db");
    let mut db = Db::open(&db_path).unwrap();
    // The folder is given with forward slashes while 1.x wrote backslashes: a song must still be
    // found by its path.
    let music_fwd = std::path::PathBuf::from(music.to_string_lossy().replace('\\', "/"));
    scan_folders(&mut db, &CoverStore::new(root.join("covers")), &[music_fwd]).unwrap();

    // The 1.x profile: A is found by path, B moved since (found by file name and duration), C was
    // deleted (history only), and a playlist names an id nothing describes.
    let profile = root.join("profile");
    std::fs::create_dir_all(&profile).unwrap();
    let song = |id: &str, path: &str, title: &str, fav: bool| {
        json!({ "songId": id, "path": path, "title": title, "artists": [{ "name": "Artist", "artistId": "x" }],
                "duration": 3.0, "isAFavorite": fav })
    };
    write_store(&profile, "songs.json", "songs", json!([
        song("OLDA", a.to_str().unwrap(), "Song A", true),
        song("OLDB", r"Z:\old place\b.flac", "Song B", false),
    ]));
    write_store(&profile, "listening_events.json", "listeningEvents", json!({
        "version": 1, "installId": "DEV",
        "tracks": {
            "k1": { "songId": "OLDA", "title": "Song A", "artists": ["artist"], "duration": 3.0, "fileName": "a.flac" },
            "k4": { "songId": "OLDA", "title": "Song A (old tags)", "artists": ["artist"], "duration": 3.0, "fileName": "a.flac" },
            "k2": { "songId": "OLDB", "title": "Song B", "artists": ["artist"], "duration": 3.0, "fileName": "b.flac" },
            "k3": { "songId": "OLDC", "title": "Gone", "artists": ["artist"], "duration": 200.0, "fileName": "c.flac" }
        },
        "counters": {
            "k1": { "DEV": { "2026-01-01": { "l": 3, "f": 1, "s": 1, "h": { "20": 1, "21": 1, "9": 1, "14": 1, "3": 1, "17": 1 } } } },
            "k4": { "DEV": { "2026-01-01": { "l": 2, "s": 1 } } },
            "k2": { "migrated:abc": { "2025-12-31": { "l": 4, "f": 4 } } },
            "k3": { "DEV": { "2026-01-02": { "l": 7, "f": 6 } } }
        }
    }));
    write_store(&profile, "playlists.json", "playlists", json!([
        { "playlistId": "Favorites", "name": "Favorites", "createdDate": "2026-01-01T00:00:00.000Z", "songs": [] },
        { "playlistId": "History", "name": "History", "createdDate": "2026-01-01T00:00:00.000Z", "songs": ["OLDA"] },
        { "playlistId": "P1", "name": "Mine", "createdDate": "2026-02-01T10:00:00.000Z", "songs": ["OLDA", "OLDC", "NOBODY"] }
    ]));
    write_store(&profile, "cmr_stats.json", "cmrStats", json!({
        "elo": {
            "ratings": {
                "OLDA": { "rating": 1215.5, "games": 1, "wins": 1, "losses": 0, "draws": 0 },
                "OLDB": { "rating": 1184.5, "games": 1, "wins": 0, "losses": 1, "draws": 0 },
                "OLDC": { "rating": 1300.0, "games": 9, "wins": 9, "losses": 0, "draws": 0 }
            },
            "history": [ { "at": 1, "songAId": "OLDA", "songBId": "OLDB", "winner": "A", "deltaA": 15.5, "deltaB": -15.5 } ],
            "totalDuels": 1
        },
        "duelMatchmaking": { "skippedPairs": [ { "at": 2, "songAId": "OLDA", "songBId": "OLDB", "reason": "cantDecide" } ] },
        "tournament": { "championSongId": "OLDB" }
    }));
    write_store(&profile, "tierlists.json", "tierlists", json!([
        { "tierlistId": "T1", "name": "best", "createdDate": "2026-03-01T00:00:00.000Z", "sourcePlaylistIds": ["P1"],
          "tiers": [ { "tierId": "s", "name": "S", "items": ["OLDA", "OLDC"] } ] }
    ]));
    write_store(&profile, "blacklist.json", "blacklist", json!({ "songBlacklist": ["OLDB"], "folderBlacklist": [] }));
    write_store(&profile, "userData.json", "userData", json!({ "language": "en", "theme": { "isDarkMode": true },
        "recentSearches": ["x"] }));

    let report = import_nemora_1x(&mut db, &profile).unwrap();
    assert_eq!((report.songs_by_path, report.songs_by_fingerprint), (1, 1), "{report:#?}");
    assert_eq!(report.pending, 1, "only the deleted song is pending: {report:#?}");
    assert_eq!(report.favorites, 1);
    assert_eq!((report.playlists, report.playlist_items, report.playlist_items_pending), (1, 3, 2));
    assert_eq!((report.ratings, report.ratings_unmapped, report.duels), (2, 1, 1));
    assert_eq!(report.blacklisted_songs, 1);

    // Two track keys of one song on one day are summed, not lost.
    assert_eq!(one(&db_path, "SELECT l FROM legacy_daily WHERE day = '2026-01-01'"), 5);
    assert_eq!(one(&db_path, "SELECT s FROM legacy_daily WHERE day = '2026-01-01'"), 2);
    // The deleted song's history waits on its pending record.
    assert_eq!(one(&db_path, "SELECT l FROM legacy_daily WHERE pending_id IS NOT NULL"), 7);
    assert_eq!(one(&db_path, "SELECT sum(l) FROM legacy_daily"), 16);
    // System playlists are not imported; History's content is not a playlist any more.
    assert_eq!(one(&db_path, "SELECT count(*) FROM playlists"), 1);
    let tier_doc: String = rusqlite::Connection::open(&db_path)
        .unwrap()
        .query_row("SELECT doc FROM tierlists", [], |r| r.get(0))
        .unwrap();
    assert!(!tier_doc.contains("OLDA") && tier_doc.contains("pending:"), "{tier_doc}");
    // Skipped pairs are facts now, the duel counter survives.
    assert_eq!(one(&db_path, "SELECT count(*) FROM duels WHERE outcome = 'skip' AND imported = 1"), 1);
    assert_eq!(nemora_core::elo::total_duels(&db).unwrap(), 1);
    let tournament: String = rusqlite::Connection::open(&db_path)
        .unwrap()
        .query_row("SELECT value FROM settings_shared WHERE key = 'elo.tournament'", [], |r| r.get(0))
        .unwrap();
    assert!(!tournament.contains("OLDB"), "{tournament}");

    // Importing the same profile again changes nothing.
    let before = dump(&db_path);
    let again = import_nemora_1x(&mut db, &profile).unwrap();
    assert_eq!(again.pending, 1);
    assert_eq!(dump(&db_path), before);

    // The deleted song's file comes back (any name, any folder): its history, its playlist slot and
    // its tier placement re-attach on the next scan.
    let c = music.join("Gone.flac");
    common::flac(&c, 13, 200);
    common::set_tags(&c, "Gone", "Artist", None, None);
    let report = scan_folders(&mut db, &CoverStore::new(root.join("covers")), std::slice::from_ref(&music)).unwrap();
    assert_eq!(report.reattached, 1, "{report:?}");
    assert_eq!(one(&db_path, "SELECT count(*) FROM legacy_daily WHERE pending_id IS NOT NULL"), 0);
    assert_eq!(one(&db_path, "SELECT l FROM legacy_daily WHERE day = '2026-01-02'"), 7);
    assert_eq!(one(&db_path, "SELECT count(*) FROM playlist_items WHERE pending_id IS NOT NULL"), 1, "only the unknown id stays pending");
    let tier_doc: String = rusqlite::Connection::open(&db_path).unwrap().query_row("SELECT doc FROM tierlists", [], |r| r.get(0)).unwrap();
    assert!(!tier_doc.contains("pending:"), "{tier_doc}");
    // plays = l - s per imported day: A (5 - 2) + B (4 - 0) + the re-attached song (7 - 0).
    assert_eq!(one(&db_path, "SELECT sum(plays) FROM song_totals"), 3 + 4 + 7);

    drop(db);
    let _ = std::fs::remove_dir_all(&root);
}

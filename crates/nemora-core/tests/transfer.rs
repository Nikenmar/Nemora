mod common;

use nemora_core::covers::CoverStore;
use nemora_core::db::Db;
use nemora_core::scan::scan_folders;
use nemora_core::transfer::import_stats_export;
use serde_json::json;

fn one(path: &std::path::Path, sql: &str) -> String {
    let conn = rusqlite::Connection::open(path).unwrap();
    conn.query_row(sql, [], |r| r.get::<_, rusqlite::types::Value>(0)).map(|v| format!("{v:?}")).unwrap()
}

#[test]
fn an_export_from_another_device_merges_once() {
    if !common::ffmpeg_available() {
        eprintln!("SKIPPED: ffmpeg is not on PATH");
        return;
    }
    let root = common::temp_dir("transfer");
    let music = root.join("music");
    std::fs::create_dir_all(&music).unwrap();
    for (i, name) in ["a.flac", "b.flac"].iter().enumerate() {
        let path = music.join(name);
        common::flac(&path, 500 + i as u32, 3);
        common::set_tags(&path, &format!("Song {i}"), "Artist", None, None);
    }
    let db_path = root.join("nemora.db");
    let mut db = Db::open(&db_path).unwrap();
    scan_folders(&mut db, &CoverStore::new(root.join("covers")), std::slice::from_ref(&music)).unwrap();
    let song_a: String = rusqlite::Connection::open(&db_path)
        .unwrap()
        .query_row("SELECT v.song_id FROM track_variants v WHERE title = 'Song 0'", [], |r| r.get(0))
        .unwrap();
    // A rating this device already has for song A.
    db_exec(&db_path, &format!("INSERT INTO elo_baseline VALUES ('{song_a}', 1300.0, 2, 2, 0, 0, 0)"));
    let mine = nemora_core::playlists::create(&db, "Shared name").unwrap();

    let export = json!({
        "format": "nora-cmr-stats-export", "formatVersion": 1, "exportId": "EXP1",
        "exportedAt": "2026-10-01T10:00:00.000Z", "appVersion": "1.1.9",
        "songs": [
            { "songId": "FA", "title": "Song 0", "artists": ["Artist"], "duration": 3.0, "fileName": "a.flac" },
            { "songId": "FB", "title": "Song 1", "artists": ["Artist"], "duration": 3.0, "fileName": "b.flac" },
            { "songId": "FX", "title": "Elsewhere", "artists": ["Nobody"], "duration": 100.0, "fileName": "x.flac" }
        ],
        "listeningData": [],
        "events": {
            "version": 1, "installId": "PHONE",
            "tracks": { "ka": { "songId": "FA" }, "kx": { "songId": "FX" } },
            "counters": {
                "ka": { "PHONE": { "2026-09-30": { "l": 4, "f": 3, "s": 1 } } },
                "kx": { "PHONE": { "2026-09-30": { "l": 2 } } }
            }
        },
        "elo": {
            "ratings": { "FA": { "rating": 1200.0, "games": 2, "wins": 1, "losses": 1, "draws": 0 } },
            "history": [ { "at": 5, "songAId": "FA", "songBId": "FB", "winner": "A", "deltaA": 16, "deltaB": -16 } ],
            "totalDuels": 2
        },
        "playlists": [ { "playlistId": "PL", "name": "Shared name", "songs": ["FB", "FA", "FX"], "createdDate": "2026-01-01T00:00:00.000Z" } ],
        "tierlists": [ { "tierlistId": "T", "name": "phone tiers", "sourcePlaylistIds": ["PL"], "tiers": [ { "name": "S", "items": ["FA", "FX"] } ] } ],
        "preferences": { "tierShuffleIntensity": 0.8 }
    })
    .to_string();

    let r = import_stats_export(&mut db, &export).unwrap();
    assert_eq!((r.songs, r.matched, r.pending), (3, 2, 1), "{r:?}");
    assert!(r.elo_merged && !r.already_imported);
    assert_eq!((r.playlists, r.tierlists), (1, 1));
    // Games-weighted mean of 1300 (2 games) and 1200 (2 games); games summed.
    assert_eq!(one(&db_path, "SELECT rating FROM elo_baseline"), "Real(1250.0)");
    assert_eq!(one(&db_path, "SELECT games FROM elo_baseline"), "Integer(4)");
    // The playlist merged into the local one of the same name; the unknown song waits as pending.
    assert_eq!(
        one(&db_path, &format!("SELECT count(*) FROM playlist_items WHERE playlist_id = '{mine}'")),
        "Integer(3)"
    );
    assert_eq!(one(&db_path, "SELECT count(*) FROM playlists"), "Integer(1)");
    let tier: String =
        rusqlite::Connection::open(&db_path).unwrap().query_row("SELECT doc FROM tierlists", [], |r| r.get(0)).unwrap();
    assert!(tier.contains(&song_a) && tier.contains(&mine) && tier.contains("pending:"), "{tier}");
    assert_eq!(one(&db_path, "SELECT sum(plays) FROM song_totals"), "Integer(3)");
    assert_eq!(one(&db_path, "SELECT value FROM settings_shared WHERE key = 'shuffle.intensity'"), "Text(\"0.8\")");

    // The same export again: counters and collections unchanged, ELO not merged a second time.
    let again = import_stats_export(&mut db, &export).unwrap();
    assert!(again.already_imported && !again.elo_merged);
    assert_eq!(one(&db_path, "SELECT rating FROM elo_baseline"), "Real(1250.0)");
    assert_eq!(one(&db_path, "SELECT sum(l) FROM legacy_daily"), "Integer(6)");
    assert_eq!(
        one(&db_path, &format!("SELECT count(*) FROM playlist_items WHERE playlist_id = '{mine}'")),
        "Integer(3)"
    );
    assert_eq!(one(&db_path, "SELECT count(*) FROM tierlists"), "Integer(1)");

    // Not an export: refused with a reason, nothing written.
    assert!(import_stats_export(&mut db, r#"{"format":"something else"}"#).is_err());

    drop(db);
    let _ = std::fs::remove_dir_all(&root);
}

fn db_exec(path: &std::path::Path, sql: &str) {
    rusqlite::Connection::open(path).unwrap().execute(sql, []).unwrap();
}

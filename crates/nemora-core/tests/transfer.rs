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

    // A later export of the same install (another id) with one more duel: its ratings and tierlists
    // are counted already; only the new duel is added, and no duel twice.
    let mut later: serde_json::Value = serde_json::from_str(&export).unwrap();
    later["exportId"] = json!("EXP2");
    later["elo"]["history"]
        .as_array_mut()
        .unwrap()
        .push(json!({ "at": 9, "songAId": "FB", "songBId": "FA", "winner": "B", "deltaA": -15, "deltaB": 15 }));
    let next = import_stats_export(&mut db, &later.to_string()).unwrap();
    assert!(next.from_known_install && !next.elo_merged && !next.already_imported, "{next:?}");
    assert_eq!(one(&db_path, "SELECT games FROM elo_baseline"), "Integer(4)");
    assert_eq!(one(&db_path, "SELECT count(*) FROM duels"), "Integer(2)");
    assert_eq!(one(&db_path, "SELECT count(*) FROM tierlists"), "Integer(1)");

    // Not an export: refused with a reason, nothing written.
    assert!(import_stats_export(&mut db, r#"{"format":"something else"}"#).is_err());

    drop(db);
    let _ = std::fs::remove_dir_all(&root);
}

fn db_exec(path: &std::path::Path, sql: &str) {
    rusqlite::Connection::open(path).unwrap().execute(sql, []).unwrap();
}

#[test]
fn an_export_imports_back_into_another_profile_without_loss() {
    use nemora_core::plays::{EndReason, Fact, Session, record};
    use nemora_core::transfer::{ExportOptions, export_stats};
    if !common::ffmpeg_available() {
        eprintln!("SKIPPED: ffmpeg is not on PATH");
        return;
    }
    let root = common::temp_dir("export");
    let music = root.join("music");
    std::fs::create_dir_all(&music).unwrap();
    for (i, name) in ["a.flac", "b.flac"].iter().enumerate() {
        let path = music.join(name);
        common::flac(&path, 700 + i as u32, 40);
        common::set_tags(&path, &format!("Song {i}"), "Artist", None, None);
    }
    let song_ids = |db_path: &std::path::Path| -> Vec<String> {
        let conn = rusqlite::Connection::open(db_path).unwrap();
        let mut stmt = conn.prepare("SELECT song_id FROM track_variants ORDER BY title").unwrap();
        stmt.query_map([], |r| r.get(0)).unwrap().map(Result::unwrap).collect()
    };

    // Profile A: one play, a playlist, a duel.
    let a_path = root.join("a.db");
    let mut a = Db::open(&a_path).unwrap();
    scan_folders(&mut a, &CoverStore::new(root.join("covers-a")), std::slice::from_ref(&music)).unwrap();
    let ids = song_ids(&a_path);
    let t = 1_790_000_000_000;
    record(
        &mut a,
        &Session {
            song_id: ids[0].clone(),
            started_at: t,
            utc_offset_min: 180,
            duration_ms: 40_000,
            source_kind: None,
            source_id: None,
            facts: vec![
                Fact::Play { at_ms: t, position_ms: 0 },
                Fact::End { at_ms: t + 40_000, position_ms: 40_000, reason: EndReason::Finished },
            ],
        },
    )
    .unwrap();
    let playlist = nemora_core::playlists::create(&a, "Mix").unwrap();
    nemora_core::playlists::add(&mut a, &playlist, &[(ids[1].clone(), None), (ids[0].clone(), None)], None).unwrap();
    nemora_core::elo::submit(&mut a, &ids[0], &ids[1], nemora_core::elo::Winner::A).unwrap();
    let text = export_stats(
        &a,
        &ExportOptions {
            app_version: "2.0.0",
            export_id: "E1",
            exported_at: "2026-10-18T00:00:00.000Z",
            tier_shuffle_intensity: Some(0.6),
        },
    )
    .unwrap();

    // Profile B: the same music, then the export.
    let b_path = root.join("b.db");
    let mut b = Db::open(&b_path).unwrap();
    scan_folders(&mut b, &CoverStore::new(root.join("covers-b")), std::slice::from_ref(&music)).unwrap();
    let r = import_stats_export(&mut b, &text).unwrap();
    assert_eq!((r.songs, r.matched, r.pending), (2, 2, 0), "{r:?}");
    assert!(r.elo_merged);
    assert_eq!(one(&b_path, "SELECT sum(plays) FROM song_totals"), "Integer(1)");
    assert_eq!(one(&b_path, "SELECT count(*) FROM playlist_items"), "Integer(2)");
    assert_eq!(one(&b_path, "SELECT name FROM playlists"), "Text(\"Mix\")");
    assert_eq!(one(&b_path, "SELECT sum(games) FROM elo_baseline"), "Integer(2)");
    assert_eq!(one(&b_path, "SELECT value FROM settings_shared WHERE key = 'shuffle.intensity'"), "Text(\"0.6\")");

    // Twice: nothing doubles.
    let again = import_stats_export(&mut b, &text).unwrap();
    assert!(again.already_imported);
    assert_eq!(one(&b_path, "SELECT sum(plays) FROM song_totals"), "Integer(1)");
    assert_eq!(one(&b_path, "SELECT sum(games) FROM elo_baseline"), "Integer(2)");

    // B's export back into A: A's own play comes home and must not count twice.
    let back = export_stats(
        &b,
        &ExportOptions {
            app_version: "2.0.0",
            export_id: "E2",
            exported_at: "2026-10-18T00:00:00.000Z",
            tier_shuffle_intensity: None,
        },
    )
    .unwrap();
    import_stats_export(&mut a, &back).unwrap();
    assert_eq!(one(&a_path, "SELECT sum(plays) FROM song_totals"), "Integer(1)");

    // B's own export into B: nothing of it may count twice.
    let own = import_stats_export(&mut b, &back).unwrap();
    assert!(own.from_this_device && !own.elo_merged);
    assert_eq!(one(&b_path, "SELECT sum(plays) FROM song_totals"), "Integer(1)");
    assert_eq!(one(&b_path, "SELECT sum(games) FROM elo_baseline"), "Integer(2)");
    assert_eq!(one(&b_path, "SELECT count(*) FROM playlist_items"), "Integer(2)");

    drop((a, b));
    let _ = std::fs::remove_dir_all(&root);
}

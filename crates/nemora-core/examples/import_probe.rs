//! Development probe: import a real 1.x profile into a scanned throwaway profile and check the
//! totals against the source files.
//!
//!   import_probe <1.x profile dir> <2.0 profile dir with a scanned nemora.db>
//!
//! The 1.x profile is only read.

use std::path::{Path, PathBuf};

use nemora_core::db::Db;
use nemora_core::import::import_nemora_1x;
use serde_json::Value;

fn store(dir: &Path, file: &str, key: &str) -> Value {
    let root: Value = serde_json::from_str(&std::fs::read_to_string(dir.join(file)).unwrap()).unwrap();
    root[key].clone()
}

fn dump_hash(db: &Path) -> String {
    let conn = rusqlite::Connection::open(db).unwrap();
    let mut hasher = blake3::Hasher::new();
    for table in ["favorites", "playlists", "playlist_items", "pending_tracks", "legacy_daily", "elo_baseline",
                  "duels", "tierlists", "blacklist_songs", "settings_shared", "settings_device"] {
        let mut stmt = conn.prepare(&format!("SELECT * FROM {table}")).unwrap();
        let n = stmt.column_count();
        let mut rows: Vec<String> = stmt
            .query_map([], |r| Ok((0..n).map(|i| format!("{:?}", r.get_ref(i).unwrap())).collect::<Vec<_>>().join("|")))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        rows.sort();
        for row in rows {
            hasher.update(table.as_bytes());
            hasher.update(row.as_bytes());
        }
    }
    hasher.finalize().to_hex()[..16].to_owned()
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let (old, new) = (PathBuf::from(&args[0]), PathBuf::from(&args[1]));
    let db_path = new.join("nemora.db");
    let mut db = Db::open(&db_path).unwrap();

    let report = import_nemora_1x(&mut db, &old).unwrap();
    println!("{report:#?}");

    // Source totals.
    let events = store(&old, "listening_events.json", "listeningEvents");
    let (mut l, mut f, mut s) = (0i64, 0i64, 0i64);
    for by_source in events["counters"].as_object().unwrap().values() {
        for by_day in by_source.as_object().unwrap().values() {
            for c in by_day.as_object().unwrap().values() {
                l += c["l"].as_i64().unwrap_or(0);
                f += c["f"].as_i64().unwrap_or(0);
                s += c["s"].as_i64().unwrap_or(0);
            }
        }
    }
    let conn = rusqlite::Connection::open(&db_path).unwrap();
    let q = |sql: &str| -> i64 { conn.query_row(sql, [], |r| r.get(0)).unwrap() };
    println!("source counters  l={l} f={f} s={s}  -> plays (l - s) = {}", l - s);
    println!(
        "database         l={} f={} s={}  (on songs: l={}, pending: l={})",
        q("SELECT coalesce(sum(l),0) FROM legacy_daily"),
        q("SELECT coalesce(sum(f),0) FROM legacy_daily"),
        q("SELECT coalesce(sum(s),0) FROM legacy_daily"),
        q("SELECT coalesce(sum(l),0) FROM legacy_daily WHERE song_id IS NOT NULL"),
        q("SELECT coalesce(sum(l),0) FROM legacy_daily WHERE pending_id IS NOT NULL"),
    );
    let tiers = store(&old, "tierlists.json", "tierlists");
    let tier_items: usize = tiers
        .as_array()
        .unwrap()
        .iter()
        .flat_map(|t| t["tiers"].as_array().unwrap().iter())
        .map(|t| t["items"].as_array().unwrap().len())
        .sum();
    let ratings = store(&old, "cmr_stats.json", "cmrStats")["elo"]["ratings"].as_object().unwrap().len();
    println!("source: tier items {tier_items}, ratings {ratings}");

    let first = dump_hash(&db_path);
    let again = import_nemora_1x(&mut db, &old).unwrap();
    let second = dump_hash(&db_path);
    println!("re-import: dump {first} -> {second} ({}), pending {}", if first == second { "unchanged" } else { "CHANGED" }, again.pending);
}

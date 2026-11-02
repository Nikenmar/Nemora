//! Search measured on the user's own library (PLAN/20 D1): every query of `data/search-eval.tsv`
//! against a copy of a real profile (`NEMORA_REAL_DB`), scored as hit@1 and hit@5 per kind. The
//! queries that hit@5 are written to `data/search-eval-hits.txt` with `NEMORA_EVAL_WRITE=1`; after
//! that, a query listed there that misses fails the test, so a change to search can only add hits.

use std::collections::{BTreeMap, HashMap, HashSet};

use nemora_core::db::Db;
use nemora_core::search::{Filter, search};

const SET: &str = include_str!("data/search-eval.tsv");
const HITS: &str = "data/search-eval-hits.txt";

#[test]
#[ignore]
fn search_on_the_real_library() {
    let Ok(path) = std::env::var("NEMORA_REAL_DB") else { return };
    let db = Db::open(std::path::Path::new(&path)).unwrap();
    let corpus = nemora_core::library::search_corpus(&db).unwrap();
    let conn = rusqlite::Connection::open_with_flags(&path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    let mut by_title: HashMap<String, HashSet<String>> = HashMap::new();
    let mut stmt = conn.prepare("SELECT variant_id, title FROM track_variants WHERE present = 1").unwrap();
    for row in stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))).unwrap() {
        let (id, title) = row.unwrap();
        by_title.entry(title).or_default().insert(id.to_string());
    }

    let mut per_kind: BTreeMap<String, (usize, usize, usize)> = BTreeMap::new();
    let mut hits5: Vec<String> = Vec::new();
    let mut misses: Vec<String> = Vec::new();
    let mut slowest = std::time::Duration::ZERO;
    for line in SET.lines().filter(|l| !l.starts_with('#') && !l.trim().is_empty()) {
        let parts: Vec<&str> = line.split('\t').collect();
        let (query, kind, expected) = (parts[0], parts[1], parts[2]);
        let wanted: HashSet<&String> =
            expected.split('|').flat_map(|t| by_title.get(t).into_iter().flatten()).collect();
        assert!(!wanted.is_empty(), "the library has no song titled {expected}");
        let started = std::time::Instant::now();
        let results = search(&corpus, Filter::Songs, query);
        slowest = slowest.max(started.elapsed());
        let rank = results.songs.iter().position(|id| wanted.contains(id));
        let e = per_kind.entry(kind.to_owned()).or_default();
        e.0 += 1;
        if rank == Some(0) {
            e.1 += 1;
        }
        if rank.is_some_and(|r| r < 5) {
            e.2 += 1;
            hits5.push(query.to_owned());
        } else {
            misses.push(format!("{query} ({kind}) -> {:?}", results.songs.first()));
        }
        let suggestion = results.suggestions.first().cloned().unwrap_or_default();
        println!("{:>5} {query:40} {kind:14} {suggestion}", rank.map_or("-".into(), |r| (r + 1).to_string()));
    }
    let total: (usize, usize, usize) = per_kind.values().fold((0, 0, 0), |a, b| (a.0 + b.0, a.1 + b.1, a.2 + b.2));
    for (kind, (n, h1, h5)) in &per_kind {
        println!("{kind:14} {n:3} queries  hit@1 {h1:3}  hit@5 {h5:3}");
    }
    println!(
        "EVAL {} queries: hit@1 {} ({:.0} %), hit@5 {} ({:.0} %); slowest query {slowest:?}",
        total.0,
        total.1,
        100.0 * total.1 as f64 / total.0 as f64,
        total.2,
        100.0 * total.2 as f64 / total.0 as f64
    );
    for m in &misses {
        println!("MISS {m}");
    }

    let file = format!("{}/tests/{HITS}", env!("CARGO_MANIFEST_DIR"));
    if std::env::var("NEMORA_EVAL_WRITE").is_ok() {
        std::fs::write(&file, hits5.join("\n") + "\n").unwrap();
    } else if let Ok(before) = std::fs::read_to_string(&file) {
        let now: HashSet<&str> = hits5.iter().map(String::as_str).collect();
        let lost: Vec<&str> = before.lines().filter(|q| !q.is_empty() && !now.contains(q)).collect();
        assert!(lost.is_empty(), "queries that hit before and miss now: {lost:?}");
    }
}

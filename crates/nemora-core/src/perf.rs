//! Performance budgets of Smart Shuffle's core work (PLAN/15, performance), on a generated library
//! of 20 000 songs, 200 000 plays, 5 000 duels and 30 tierlists, and optionally on a copy of a real
//! profile (`NEMORA_PERF_DB`). Run in release at every gate:
//! `cargo test --release -p nemora-core --lib perf -- --ignored --nocapture`.

use std::time::Instant;

use rusqlite::params;

use crate::db::Db;
use crate::plays::{EndReason, Fact, Session, StartReason, record_with};
use crate::shuffle;

/// SplitMix64, so the generated library is the same on every run.
struct Random(u64);

impl Random {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^ (z >> 31)
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n.max(1)
    }
    fn unit(&mut self) -> f64 {
        (self.next() >> 11) as f64 / (1u64 << 53) as f64
    }
    /// Skewed towards 0: a few artists and songs get most plays, as in a real library.
    fn skewed(&mut self, n: u64) -> u64 {
        ((self.unit().powi(3)) * n as f64) as u64 % n.max(1)
    }
}

pub struct Shape {
    pub songs: u64,
    pub artists: u64,
    pub plays: u64,
    pub duels: u64,
    pub tierlists: u64,
}

pub const LARGE: Shape = Shape { songs: 20_000, artists: 2_500, plays: 200_000, duels: 5_000, tierlists: 30 };

fn song_id(i: u64) -> String {
    format!("{i:026}")
}

/// A library of `shape`, written straight into the tables (no scanning), then rolled up.
pub fn generate(shape: &Shape) -> Db {
    let mut db = Db::open_in_memory().unwrap();
    let mut random = Random(0x0001_5eed);
    let device = db.device_id().unwrap();
    let day_ms = 86_400_000i64;
    let now = crate::db::now_ms();
    {
        let tx = db.conn_mut().transaction().unwrap();
        for i in 0..shape.songs {
            let id = song_id(i);
            let duration = 120_000 + random.below(240_000) as i64;
            tx.execute(
                "INSERT INTO tracks VALUES (?1, 'flac', 44100, 16, 2, ?2, NULL, ?3, 0)",
                params![id, duration, now - random.below(700) as i64 * day_ms],
            )
            .unwrap();
            let title = format!("Song {i}");
            tx.execute(
                "INSERT INTO track_variants (song_id, tag_signature, title, title_sort, artist_sort, album, album_sort, last_seen_at)
                 VALUES (?1, 'sig', ?2, lower(?2), '', NULL, NULL, 0)",
                params![id, title],
            )
            .unwrap();
            let variant = tx.last_insert_rowid();
            let artists = 1 + random.below(2);
            for position in 0..artists {
                let artist = format!("Artist {}", random.skewed(shape.artists));
                tx.execute(
                    "INSERT OR IGNORE INTO variant_artists VALUES (?1, 'artist', ?2, ?3)",
                    params![variant, position as i64, artist],
                )
                .unwrap();
            }
        }
        // Plays over two years, a third of them skips, half with details as v2 records them.
        let mut at = now - 730 * day_ms;
        let step = 730 * day_ms / shape.plays.max(1) as i64;
        for seq in 1..=shape.plays as i64 {
            let song = song_id(random.skewed(shape.songs));
            let duration = 200_000i64;
            let skipped = random.below(3) == 0;
            let heard = if skipped { random.below(40_000) as i64 } else { duration };
            let reason = if skipped { "user_next" } else { "finished" };
            let event = format!("{device}:{seq}");
            tx.execute(
                "INSERT INTO play_events (event_id, device_id, seq, song_id, started_at, ended_at, utc_offset_min, heard_ms,
                   duration_ms, max_position_ms, end_reason)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7, ?8, ?7, ?9)",
                params![event, device, seq, song, at, at + heard, heard, duration, reason],
            )
            .unwrap();
            if seq % 2 == 0 {
                tx.execute(
                    "INSERT INTO play_details (event_id, start_reason, seeks) VALUES (?1, ?2, NULL)",
                    params![event, if random.below(4) == 0 { "user_selected" } else { "auto" }],
                )
                .unwrap();
            }
            at += step;
        }
        for n in 0..shape.duels as i64 {
            let a = song_id(random.skewed(shape.songs));
            let b = song_id(random.skewed(shape.songs));
            if a == b {
                continue;
            }
            let outcome = ["a", "b", "draw"][random.below(3) as usize];
            tx.execute(
                "INSERT INTO duels (duel_id, device_id, at, song_a, song_b, outcome) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![format!("{device}:d{n}"), device, now - (shape.duels as i64 - n) * 60_000, a, b, outcome],
            )
            .unwrap();
        }
        tx.commit().unwrap();
    }
    for t in 0..shape.tierlists {
        let tiers: Vec<serde_json::Value> = (0..6)
            .map(|k| {
                let items: Vec<String> = (0..100).map(|_| song_id(random.below(shape.songs))).collect();
                let name = ["S", "A", "B", "C", "D", "E"][k];
                serde_json::json!({ "name": name, "items": items })
            })
            .collect();
        let doc = serde_json::json!({ "name": format!("Tierlist {t}"), "influencesShuffle": t < 10, "tiers": tiers });
        crate::playlists::save_tierlist(&db, None, &doc).unwrap();
    }
    crate::plays::rebuild_rollups(&mut db).unwrap();
    let started = Instant::now();
    crate::signals::rebuild(&mut db).unwrap();
    eprintln!("PERF signals rebuilt from {} plays in {:.0} ms", shape.plays, started.elapsed().as_secs_f64() * 1000.0);
    db
}

/// Runs `f` `runs` times and returns the best time in ms (the steady cost, not the first warm-up).
fn best<T>(runs: usize, mut f: impl FnMut() -> T) -> f64 {
    (0..runs)
        .map(|_| {
            let start = Instant::now();
            std::hint::black_box(f());
            start.elapsed().as_secs_f64() * 1000.0
        })
        .fold(f64::MAX, f64::min)
}

struct Measured {
    weights: f64,
    explain: f64,
    order: f64,
    record: f64,
}

fn measure(db: &mut Db, label: &str) -> Measured {
    let songs: Vec<String> = db
        .conn()
        .prepare("SELECT DISTINCT song_id FROM track_variants ORDER BY song_id")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap();
    let prepare = best(3, || shuffle::prepare(db).unwrap());
    let prepared = shuffle::prepare(db).unwrap();
    let cached = best(3, || shuffle::weights_prepared(db, &prepared, &[], 0.6, &shuffle::Options::default()).unwrap());
    eprintln!("PERF {label}: prepare {prepare:.1} ms, weights from it {cached:.1} ms");
    let weights = best(3, || shuffle::stored_weights(db, &[], 0.6, &shuffle::Options::default()).unwrap());
    let some: Vec<String> = songs.iter().step_by((songs.len() / 20).max(1)).take(20).cloned().collect();
    let explain = best(3, || shuffle::explain(db, &some, 0.6, &shuffle::Options::default()).unwrap());
    let map = shuffle::stored_weights(db, &[], 0.6, &shuffle::Options::default()).unwrap();
    let mut random = Random(7);
    let order = best(3, || shuffle::weighted_order(&songs, &map, &[], Some(0), &mut || random.unit()));
    let song = songs[0].clone();
    let record = best(5, || {
        let session = Session {
            song_id: song.clone(),
            started_at: crate::db::now_ms(),
            utc_offset_min: 0,
            duration_ms: 200_000,
            source_kind: None,
            source_id: None,
            facts: vec![
                Fact::Play { at_ms: 0, position_ms: 0 },
                Fact::End { at_ms: 200_000, position_ms: 200_000, reason: EndReason::Finished },
            ],
        };
        record_with(db, &session, StartReason::Auto).unwrap()
    });
    eprintln!(
        "PERF {label}: {} songs | weights {weights:.1} ms | explain 20 {explain:.1} ms | order {order:.1} ms | record {record:.2} ms",
        songs.len()
    );
    Measured { weights, explain, order, record }
}

#[test]
#[ignore]
fn budgets_hold_on_a_large_library() {
    let started = Instant::now();
    let mut db = generate(&LARGE);
    eprintln!("PERF generated in {:.1} s", started.elapsed().as_secs_f64());
    let m = measure(&mut db, "20k");
    // The core's share of the plan's budgets (release build): turning Smart Shuffle on <= 300 ms end
    // to end at 20 000 songs, re-ordering <= 200 ms, Why this song? <= 50 ms, a play <= 10 ms.
    assert!(m.weights <= 100.0, "weights {:.1} ms", m.weights);
    assert!(m.explain <= 100.0, "explain {:.1} ms", m.explain);
    assert!(m.order <= 50.0, "order {:.1} ms", m.order);
    assert!(m.record <= 10.0, "record {:.2} ms", m.record);
    if let Ok(path) = std::env::var("NEMORA_PERF_DB") {
        // A copy of a real profile: migrating it keeps every row of every v1 table.
        let path = std::path::Path::new(&path);
        let counts = |conn: &rusqlite::Connection, tables: &[String]| -> Vec<(String, i64)> {
            tables
                .iter()
                .map(|t| {
                    (t.clone(), conn.query_row(&format!("SELECT count(*) FROM \"{t}\""), [], |r| r.get(0)).unwrap())
                })
                .collect()
        };
        let before = {
            let conn = rusqlite::Connection::open(path).unwrap();
            let tables: Vec<String> = conn
                .prepare(
                    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'search_fts%' ORDER BY name",
                )
                .unwrap()
                .query_map([], |r| r.get(0))
                .unwrap()
                .collect::<rusqlite::Result<_>>()
                .unwrap();
            counts(&conn, &tables)
        };
        let mut real = Db::open(path).unwrap();
        let tables: Vec<String> = before.iter().map(|(t, _)| t.clone()).collect();
        // Only `meta` grows, by the one row that says when the file was migrated.
        let expected: Vec<(String, i64)> =
            before.iter().map(|(t, n)| (t.clone(), if t == "meta" { n + 1 } else { *n })).collect();
        assert_eq!(counts(real.conn(), &tables), expected, "migration changed a v1 table");
        eprintln!("PERF real library: {} v1 tables kept, every row", before.len());
        measure(&mut real, "real library");
    }
}

#[test]
#[ignore]
fn where_the_weights_go() {
    let db = generate(&LARGE);
    let t = |label: &str, f: &mut dyn FnMut()| eprintln!("PART {label}: {:.1} ms", best(3, &mut *f));
    t("songs and artists", &mut || {
        db.conn()
            .prepare(
                "SELECT v.song_id, (SELECT group_concat(name, char(31)) FROM variant_artists a WHERE a.variant_id = v.variant_id AND a.role = 'artist')
                 FROM track_variants v GROUP BY v.song_id ORDER BY v.song_id",
            )
            .unwrap()
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?)))
            .unwrap()
            .count();
    });
    t("song_totals", &mut || {
        db.conn()
            .prepare("SELECT song_id, full FROM song_totals")
            .unwrap()
            .query_map([], |r| r.get::<_, String>(0))
            .unwrap()
            .count();
    });
    t("tierlists", &mut || {
        shuffle::stored_tierlists(&db).unwrap();
    });
    t("recent", &mut || {
        shuffle::recent_songs(&db, 50).unwrap();
    });
    t("ratings", &mut || {
        crate::elo::ratings(&db).unwrap();
    });
    t("total duels", &mut || {
        crate::elo::total_duels(&db).unwrap();
    });
    t("skip factors", &mut || {
        shuffle::skip_factors(&db, crate::db::now_ms()).unwrap();
    });
    let now = crate::db::now_ms();
    t("listening: load", &mut || {
        crate::listening::load(db.conn(), now - shuffle::HORIZON_MS).unwrap();
    });
    let plays = crate::listening::load(db.conn(), now - shuffle::HORIZON_MS).unwrap();
    eprintln!("PART listening: {} plays in the horizon", plays.len());
    t("listening: classify", &mut || {
        crate::listening::classify(&plays);
    });
    let listening = shuffle::Listening::load(&db, now).unwrap();
    t("listening: last days", &mut || {
        listening.last_days(&db).unwrap();
    });
    t("prepare", &mut || {
        shuffle::prepare(&db).unwrap();
    });
    // The taste map (PLAN/17): its parts, a fresh layout, a rebuild from it, and a read's annotation.
    let clock = std::time::Instant::now();
    let inputs = crate::tastemap::stored_inputs(&db).unwrap();
    eprintln!("PART taste map: inputs {:.0} ms ({} plays)", clock.elapsed().as_secs_f64() * 1000.0, inputs.plays.len());
    let clock = std::time::Instant::now();
    let linked = crate::tastemap::links(&inputs);
    eprintln!("PART taste map: links {:.0} ms", clock.elapsed().as_secs_f64() * 1000.0);
    let plain = crate::tastemap::plain(&linked);
    let clock = std::time::Instant::now();
    crate::tastemap::layout(&inputs.songs, &plain, None, None);
    eprintln!("PART taste map: layout {:.0} ms", clock.elapsed().as_secs_f64() * 1000.0);
    let clock = std::time::Instant::now();
    let _ = crate::tastemap::communities(inputs.songs.len(), &crate::tastemap::edges_of(&inputs.songs, &plain));
    eprintln!("PART taste map: communities {:.0} ms", clock.elapsed().as_secs_f64() * 1000.0);
    let started = std::time::Instant::now();
    let map = crate::tastemap::build(&db, None, true).unwrap();
    eprintln!("PART taste map: fresh build {:.0} ms", started.elapsed().as_secs_f64() * 1000.0);
    let mut stale = map.clone();
    stale.hash = String::new();
    let started = std::time::Instant::now();
    crate::tastemap::build(&db, Some(&stale), false).unwrap();
    eprintln!("PART taste map: rebuild from the last {:.0} ms", started.elapsed().as_secs_f64() * 1000.0);
    let weights = shuffle::stored_weights(&db, &[], 0.6, &shuffle::Options::default()).unwrap();
    t("taste map: annotate", &mut || {
        let mut m = map.clone();
        crate::tastemap::annotate(&db, &mut m, &weights).unwrap();
    });
    eprintln!("PART taste map: {} islands", map.islands.len());
    let prepared = shuffle::prepare(&db).unwrap();
    for (label, options) in [
        ("weights prepared: classic", shuffle::Options::CLASSIC),
        ("weights prepared: default", shuffle::Options::default()),
        ("weights prepared: no skip-aware", shuffle::Options { skip_aware: false, ..shuffle::Options::default() }),
        (
            "weights prepared: no freshness by days",
            shuffle::Options { freshness_by_days: false, ..shuffle::Options::default() },
        ),
        ("weights prepared: no adaptive", shuffle::Options { adaptive: false, ..shuffle::Options::default() }),
        ("weights prepared: no learn", shuffle::Options { learn: false, ..shuffle::Options::default() }),
    ] {
        t(label, &mut || {
            shuffle::weights_prepared(&db, &prepared, &[], 0.6, &options).unwrap();
        });
    }
    t("all", &mut || {
        shuffle::stored_weights(&db, &[], 0.6, &shuffle::Options::default()).unwrap();
    });
}

/// PLAN/15 P15.1 gate on a copy of a real profile (`NEMORA_PERF_DB`): how many placed songs the
/// nudge lifts, by how much, and how far their rank among all songs moves.
#[test]
#[ignore]
fn the_nudge_on_a_library_copy() {
    let Ok(path) = std::env::var("NEMORA_PERF_DB") else { return };
    let db = Db::open(std::path::Path::new(&path)).unwrap();
    let stored = shuffle::stored_inputs(&db).unwrap();
    let inputs = stored.inputs();
    let classic: Vec<(String, shuffle::Parts)> = shuffle::parts(&inputs, &[], &shuffle::Options::CLASSIC);
    let nudged: Vec<(String, shuffle::Parts)> = shuffle::parts(&inputs, &[], &shuffle::Options::default());
    let rank = |list: &[(String, shuffle::Parts)]| -> std::collections::HashMap<String, usize> {
        let mut order: Vec<&(String, shuffle::Parts)> = list.iter().collect();
        order.sort_by(|a, b| b.1.score.total_cmp(&a.1.score).then_with(|| a.0.cmp(&b.0)));
        order.iter().enumerate().map(|(i, (id, _))| (id.clone(), i)).collect()
    };
    let (before, after) = (rank(&classic), rank(&nudged));
    let lifted: Vec<&(String, shuffle::Parts)> = nudged.iter().filter(|(_, p)| p.nudge > 0.0).collect();
    let placed = nudged.iter().filter(|(_, p)| p.tier > 0.0).count();
    let shifts: Vec<usize> = lifted.iter().map(|(id, _)| before[id] - after[id]).collect();
    let max_nudge = lifted.iter().map(|(_, p)| p.nudge).fold(0.0, f64::max);
    let mean_shift = shifts.iter().sum::<usize>() as f64 / shifts.len().max(1) as f64;
    eprintln!(
        "NUDGE {} songs, {placed} placed, {} nudged, largest nudge {max_nudge:.3}, rank moved up {:.1} places on average, at most {} (of {})",
        nudged.len(),
        lifted.len(),
        mean_shift,
        shifts.iter().max().unwrap_or(&0),
        nudged.len()
    );
    assert!(lifted.iter().all(|(_, p)| p.nudge <= shuffle::NUDGE_MAX + 1e-12));
}

#[test]
#[ignore]
fn where_the_signals_go() {
    let db = generate(&LARGE);
    let only = |set: &dyn Fn(&mut shuffle::Options)| {
        let mut o = shuffle::Options::CLASSIC;
        set(&mut o);
        o
    };
    for (label, options) in [
        ("none", shuffle::Options::CLASSIC),
        ("learn", only(&|o| o.learn = true)),
        ("freshness by days", only(&|o| o.freshness_by_days = true)),
        ("fair rotation", only(&|o| o.fair_rotation = true)),
        ("artist fatigue", only(&|o| o.artist_fatigue = true)),
        (
            "adaptive with implicit duels",
            only(&|o| {
                o.adaptive = true;
                o.implicit_duels = true;
            }),
        ),
    ] {
        let prepared = shuffle::prepare(&db).unwrap();
        eprintln!("SIGNAL {label}: {:.1} ms", best(3, || shuffle::stored_signals(&db, &prepared, &options).unwrap()));
    }
}

//! The ELO port against 1.1.9's own answers (`tools/oracle/elo.ts`): 300 generated scenarios
//! replayed with the very same random draws, plus the rating math.

use std::collections::{HashMap, HashSet};

use nemora_core::elo::{
    DuelRecord, MatchSong, Rating, SkipReason, SkipRecord, Winner, deltas, effective, normalized_score, order_pair,
    positive_score, select_anchor, select_opponent,
};
use serde_json::Value;

fn load() -> Value {
    let path = format!("{}/../../fixtures/synthetic/oracle/elo-expected.json", env!("CARGO_MANIFEST_DIR"));
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

fn strings(v: &Value) -> Vec<String> {
    v.as_array().map(|a| a.iter().map(|s| s.as_str().unwrap().to_owned()).collect()).unwrap_or_default()
}

fn rating(v: &Value) -> Rating {
    Rating {
        rating: v["rating"].as_f64().unwrap(),
        games: v["games"].as_i64().unwrap(),
        wins: v["wins"].as_i64().unwrap_or(0),
        losses: v["losses"].as_i64().unwrap_or(0),
        draws: v["draws"].as_i64().unwrap_or(0),
        last_duel_at: v["lastDuelAt"].as_i64(),
    }
}

#[test]
fn matchmaker_picks_what_1x_picks() {
    let data = load();
    let now = data["now"].as_i64().unwrap();
    let mut failures = Vec::new();
    let scenarios = data["scenarios"].as_array().unwrap();
    assert_eq!(scenarios.len(), 300);
    for (n, s) in scenarios.iter().enumerate() {
        let songs: Vec<MatchSong> = s["songs"]
            .as_array()
            .unwrap()
            .iter()
            .map(|m| MatchSong {
                id: m["songId"].as_str().unwrap().to_owned(),
                artists: strings(&m["artistIds"]),
                genres: strings(&m["genreIds"]),
                album: m["albumId"].as_str().map(str::to_owned),
                playlists: strings(&m["playlistIds"]),
                tierlists: strings(&m["tierlistIds"]),
            })
            .collect();
        let ratings: HashMap<String, Rating> =
            s["ratings"].as_object().unwrap().iter().map(|(k, v)| (k.clone(), rating(v))).collect();
        let history: Vec<DuelRecord> = s["history"]
            .as_array()
            .unwrap()
            .iter()
            .map(|d| DuelRecord {
                at: d["at"].as_i64().unwrap(),
                a: d["songAId"].as_str().unwrap().to_owned(),
                b: d["songBId"].as_str().unwrap().to_owned(),
                winner: match d["winner"].as_str().unwrap() {
                    "A" => Winner::A,
                    "B" => Winner::B,
                    _ => Winner::Draw,
                },
            })
            .collect();
        let skipped: Vec<SkipRecord> = s["skippedPairs"]
            .as_array()
            .unwrap()
            .iter()
            .map(|k| SkipRecord {
                at: k["at"].as_i64().unwrap(),
                a: k["songAId"].as_str().unwrap().to_owned(),
                b: k["songBId"].as_str().unwrap().to_owned(),
                reason: SkipReason::parse(k["reason"].as_str().unwrap()),
            })
            .collect();
        let candidates: Vec<(String, i64)> = s["candidates"]
            .as_array()
            .unwrap()
            .iter()
            .map(|c| (c["songId"].as_str().unwrap().to_owned(), c["listenedAt"].as_i64().unwrap()))
            .collect();
        let eligible: HashSet<String> = strings(&s["eligible"]).into_iter().collect();
        let excluded: HashSet<String> = strings(&s["excluded"]).into_iter().collect();
        let draws: Vec<f64> = s["draws"].as_array().unwrap().iter().map(|d| d.as_f64().unwrap()).collect();
        let mut used = 0usize;
        let mut random = || {
            let d = draws[used];
            used += 1;
            d
        };

        let anchor = select_anchor(&candidates, &eligible, &excluded, &ratings, now, &mut random);
        let want_anchor = s["anchor"].as_str().map(str::to_owned);
        if anchor != want_anchor {
            failures.push(format!("#{n} anchor {anchor:?}, 1.x {want_anchor:?}"));
            continue;
        }
        let anchor_for_opponent = s["anchorForOpponent"].as_str().unwrap();
        let opponent = select_opponent(anchor_for_opponent, &songs, &ratings, &history, &skipped, now, &mut random);
        let want_opponent = s["opponent"].as_str().map(str::to_owned);
        if opponent != want_opponent {
            failures.push(format!("#{n} opponent {opponent:?}, 1.x {want_opponent:?}"));
            continue;
        }
        if let Some(opponent) = opponent {
            let (a, b) = order_pair(anchor_for_opponent, &opponent, &mut random);
            let want = strings(&s["order"]);
            if vec![a.clone(), b.clone()] != want {
                failures.push(format!("#{n} order {:?}, 1.x {want:?}", (a, b)));
            }
        }
        let want_used = s["used"].as_u64().unwrap() as usize;
        if used != want_used {
            failures.push(format!("#{n} drew {used} random numbers, 1.x drew {want_used}"));
        }
    }
    assert!(failures.is_empty(), "{} of 300 scenarios differ:\n{}", failures.len(), failures.join("\n"));
}

#[test]
fn rating_math_matches_1x() {
    let data = load();
    for d in data["deltas"].as_array().unwrap() {
        let got = deltas(d["a"].as_f64().unwrap(), d["b"].as_f64().unwrap(), d["score"].as_f64().unwrap());
        let want = (d["result"]["deltaA"].as_f64().unwrap(), d["result"]["deltaB"].as_f64().unwrap());
        assert_eq!(got, want, "deltas({}, {}, {})", d["a"], d["b"], d["score"]);
    }
    for s in data["scores"].as_array().unwrap() {
        let r = rating(&s["rating"]);
        assert!((effective(&r) - s["effective"].as_f64().unwrap()).abs() < 1e-9);
        assert!((normalized_score(&r) - s["normalized"].as_f64().unwrap()).abs() < 1e-12);
        assert!((positive_score(&r) - s["positive"].as_f64().unwrap()).abs() < 1e-12);
    }
}

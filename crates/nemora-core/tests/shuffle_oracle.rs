//! Smart Shuffle and Rediscover against 1.1.9's own answers (`tools/oracle/shuffle.ts`).

use std::collections::{HashMap, HashSet};

use nemora_core::elo::Rating;
use nemora_core::shuffle::{Inputs, Tierlist, weighted_order, weights};
use serde_json::Value;

fn strings(v: &Value) -> Vec<String> {
    v.as_array().map(|a| a.iter().map(|s| s.as_str().unwrap().to_owned()).collect()).unwrap_or_default()
}

#[test]
fn weights_rediscover_and_queue_order_match_1x() {
    let path = format!("{}/../../fixtures/synthetic/oracle/shuffle-expected.json", env!("CARGO_MANIFEST_DIR"));
    let data: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let mut failures = Vec::new();
    let cases = data["cases"].as_array().unwrap();
    // The old functions swallow their own errors and return empty results: an oracle run where
    // they failed would make every comparison trivially pass.
    assert!(cases.iter().filter(|c| !c["weights"].as_object().unwrap().is_empty()).count() >= 70);
    assert!(cases.iter().filter(|c| !c["rediscover"].as_array().unwrap().is_empty()).count() >= 40);
    assert!(cases.iter().filter(|c| !c["tierlists"].as_array().unwrap().is_empty()).count() >= 30);
    for (n, c) in cases.iter().enumerate() {
        let songs: Vec<(String, Vec<String>)> = c["songs"]
            .as_array()
            .unwrap()
            .iter()
            .map(|s| (s["songId"].as_str().unwrap().to_owned(), strings(&s["artists"])))
            .collect();
        let tierlists: Vec<Tierlist> = c["tierlists"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| Tierlist {
                influences_shuffle: t["influencesShuffle"].as_bool().unwrap(),
                tiers: t["tiers"].as_array().unwrap().iter().map(|tier| strings(&tier["items"])).collect(),
            })
            .collect();
        let mut full = HashMap::new();
        let mut last_heard = HashMap::new();
        for l in c["listening"].as_array().unwrap() {
            let id = l["songId"].as_str().unwrap().to_owned();
            full.insert(id.clone(), l["fullListens"].as_i64().unwrap());
            last_heard.insert(id, l["lastAt"].as_i64().unwrap());
        }
        let ratings: HashMap<String, Rating> = c["ratings"]
            .as_object()
            .unwrap()
            .iter()
            .map(|(k, v)| {
                (
                    k.clone(),
                    Rating {
                        rating: v["rating"].as_f64().unwrap(),
                        games: v["games"].as_i64().unwrap(),
                        ..Default::default()
                    },
                )
            })
            .collect();
        let recent = strings(&c["history"]);
        let total_duels = c["totalDuels"].as_i64().unwrap();
        let inputs = Inputs {
            songs: &songs,
            tierlists: &tierlists,
            full_listens: &full,
            recent: &recent,
            ratings: &ratings,
            total_duels,
        };

        let got = weights(&inputs, &strings(&c["targets"]), c["intensity"].as_f64().unwrap());
        let want: HashMap<String, f64> =
            c["weights"].as_object().unwrap().iter().map(|(k, v)| (k.clone(), v.as_f64().unwrap())).collect();
        if got.len() != want.len() || want.iter().any(|(k, w)| got.get(k).is_none_or(|g| (g - w).abs() > 1e-12)) {
            failures.push(format!("#{n} weights differ"));
        }

        let ids: Vec<String> = songs.iter().map(|(id, _)| id.clone()).collect();
        let blacklisted: HashSet<String> = strings(&c["blacklisted"]).into_iter().collect();
        let picked = nemora_core::rediscover::pick(
            &nemora_core::rediscover::Inputs {
                songs: &ids,
                tierlists: &tierlists,
                ratings: &ratings,
                total_duels,
                full_listens: &full,
                last_heard: &last_heard,
                blacklisted: &blacklisted,
            },
            c["cutoff"].as_i64().unwrap(),
        );
        if picked != strings(&c["rediscover"]) {
            failures.push(format!("#{n} rediscover {picked:?}, 1.x {:?}", strings(&c["rediscover"])));
        }

        let draws: Vec<f64> = c["draws"].as_array().unwrap().iter().map(|d| d.as_f64().unwrap()).collect();
        let mut i = 0;
        let mut random = || {
            i += 1;
            draws[i - 1]
        };
        let pairs: Vec<(String, String)> = c["pairFeedback"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| (p["songAId"].as_str().unwrap().to_owned(), p["songBId"].as_str().unwrap().to_owned()))
            .collect();
        let current = c["currentSongIndex"].as_u64().map(|i| i as usize);
        let (order, _) = weighted_order(&strings(&c["queue"]), &want, &pairs, current, &mut random);
        if order != strings(&c["shuffledQueue"]) {
            failures.push(format!("#{n} queue order differs"));
        }
    }
    assert!(failures.is_empty(), "{} differences:\n{}", failures.len(), failures.join("\n"));
}

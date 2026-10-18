//! Tournaments against 1.1.9's own brackets (`tools/oracle/tournament.ts`): creation, then every
//! step of play and drop-out, state for state.

use std::collections::{HashMap, HashSet};

use nemora_core::elo::Rating;
use nemora_core::tournament::{State, create, reconcile, record_winner};
use serde_json::Value;

#[test]
fn brackets_evolve_as_in_1x() {
    let path = format!("{}/../../fixtures/synthetic/oracle/tournament-expected.json", env!("CARGO_MANIFEST_DIR"));
    let data: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let cases = data["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 24);
    let mut steps_checked = 0;
    for (n, case) in cases.iter().enumerate() {
        let ids: Vec<String> =
            case["songIds"].as_array().unwrap().iter().map(|v| v.as_str().unwrap().to_owned()).collect();
        let ratings: HashMap<String, Rating> = case["ratings"]
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
        let mut state =
            create(&ids, &ratings, case["size"].as_u64().unwrap() as u32, case["createdAt"].as_i64().unwrap()).unwrap();
        let want: State = serde_json::from_value(case["created"].clone()).unwrap();
        assert_eq!(state, want, "case {n}: created bracket");
        let mut available: HashSet<String> = ids.iter().cloned().collect();
        for (s, step) in case["steps"].as_array().unwrap().iter().enumerate() {
            if let Some(gone) = step["remove"].as_str() {
                available.remove(gone);
                state = reconcile(&state, &available);
            } else {
                state =
                    record_winner(&state, step["play"].as_str().unwrap(), step["winner"].as_str().unwrap(), &available)
                        .unwrap();
            }
            let want: State = serde_json::from_value(step["state"].clone()).unwrap();
            assert_eq!(state, want, "case {n}, step {s}");
            steps_checked += 1;
        }
    }
    assert!(steps_checked > 200, "only {steps_checked} steps were compared");
}

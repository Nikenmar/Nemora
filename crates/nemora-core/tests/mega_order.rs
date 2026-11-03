//! PLAN/21 P21.6: the Rust port of Smart Shuffle's order against its oracle, the view's
//! `megaShuffleQueue.ts`. The cases and the oracle's answers come from
//! `apps/desktop/src/renderer/test/megaOrderCases.test.ts` (which fails when they are stale);
//! every one must come out the same here.

use nemora_core::mega_order::{MegaData, MegaOrder, mega_order};
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Case {
    song_ids: Vec<String>,
    data: MegaData,
    current_index: Option<i64>,
    draws: Vec<f64>,
    expected: MegaOrder,
}

#[test]
fn the_port_orders_every_case_as_the_oracle() {
    let text = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/data/mega-order-cases.json"))
        .expect("the cases (generate them with the view's test)");
    let cases: Vec<Case> = serde_json::from_str(&text).expect("the cases parse");
    assert!(cases.len() >= 400, "{} cases", cases.len());
    let mut mismatches = Vec::new();
    for (i, case) in cases.iter().enumerate() {
        let got = mega_order(&case.song_ids, &case.data, case.current_index, &case.draws);
        if got != case.expected {
            let first = got.shuffled_queue.iter().zip(&case.expected.shuffled_queue).position(|(a, b)| a != b);
            mismatches.push(format!("case {i} ({} songs): first difference at {first:?}", case.song_ids.len()));
        }
    }
    assert!(mismatches.is_empty(), "{} of {} cases differ:\n{}", mismatches.len(), cases.len(), mismatches.join("\n"));
}

#[test]
fn the_suite_covers_every_rule() {
    let text =
        std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/data/mega-order-cases.json")).unwrap();
    let cases: Vec<Case> = serde_json::from_str(&text).unwrap();
    let count = |f: &dyn Fn(&Case) -> bool| cases.iter().filter(|c| f(c)).count();
    // Each rule is exercised by enough cases that a port missing it could not pass.
    assert!(count(&|c| c.data.held.as_ref().is_some_and(|h| !h.is_empty())) > 20);
    assert!(count(&|c| c.data.artists.is_some()) > 50);
    assert!(count(&|c| c.data.energy.is_some()) > 50);
    assert!(count(&|c| c.data.neighbours.as_ref().is_some_and(|n| n.values().any(|v| !v.is_empty()))) > 20);
    assert!(count(&|c| c.data.pair_feedback.iter().any(|p| p.reason.as_deref() == Some("tooDifferent"))) > 50);
    assert!(count(&|c| c.data.pair_feedback.iter().any(|p| p.reason.is_none())) > 50);
    assert!(count(&|c| c.song_ids.iter().any(|id| id.contains(':'))) > 50);
    assert!(count(&|c| c.current_index == Some(-1)) > 10);
    assert!(count(&|c| c.current_index.is_some_and(|i| i >= c.song_ids.len() as i64)) > 10);
}

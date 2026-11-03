//! PLAN/21 P21.6: Smart Shuffle's order from the core (`nemora_core::mega_order`), for the view's
//! shadow: the view orders the queue itself (its `megaShuffleQueue`, the oracle) and asks this for
//! the same order from the same random draws, logging any difference. The view's switch
//! (`nemora.megaOrder.fromCore`, off) would make this the order it plays.

use nemora_core::mega_order::{MegaData, MegaOrder, mega_order as order};

/// `draws53`: the oracle's random numbers as whole multiples of 2^-53 (JavaScript's `Math.random`
/// gives such numbers), so they cross JSON exactly.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn mega_order(song_ids: Vec<String>, data: MegaData, current_index: Option<i64>, draws53: Vec<u64>) -> MegaOrder {
    const UNIT: f64 = 1.0 / 9_007_199_254_740_992.0; // 2^-53
    let draws: Vec<f64> = draws53.iter().map(|&n| n as f64 * UNIT).collect();
    order(&song_ids, &data, current_index, &draws)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn draws_cross_as_whole_multiples() {
        let data = MegaData { weights: [("a".to_owned(), 1.0), ("b".to_owned(), 1.0)].into(), ..Default::default() };
        // 0.75 and 0.25: a first.
        let first = mega_order(vec!["a".into(), "b".into()], data.clone(), None, vec![3 << 51, 1 << 51]);
        assert_eq!(first.shuffled_queue, ["a", "b"]);
        let second = mega_order(vec!["a".into(), "b".into()], data, None, vec![1 << 51, 3 << 51]);
        assert_eq!(second.shuffled_queue, ["b", "a"]);
        assert_eq!(second.positions, [1, 0]);
    }
}

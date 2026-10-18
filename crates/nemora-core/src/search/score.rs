//! How well a query matches one key: a port of 1.1.9 `common/searchScoring.ts`. Lower is better;
//! a worse kind of match can never outrank a better one:
//!
//! ```text
//!      0  exact
//!    100  the value starts with the query
//!    150  a word in the value starts with the query
//!    200  every query word appears, in any order        (`halo beyonce`)
//!    250  the query appears somewhere inside            (substring)
//!    600  every query word appears with a typo or two   (`niravna`)
//!   1000  the query's letters appear in order           (subsequence)
//!      ∞  no match
//! ```
//!
//! Strings are compared as UTF-16 code units, as JavaScript does, so lengths and indexes in the
//! scores match the old code exactly.

pub const LOOSE_SCORE_THRESHOLD: f64 = TYPO;

const EXACT: f64 = 0.0;
const PREFIX: f64 = 100.0;
const WORD_PREFIX: f64 = 150.0;
const TOKEN_SET: f64 = 200.0;
const SUBSTRING: f64 = 250.0;
const TYPO: f64 = 600.0;
const SUBSEQUENCE: f64 = 1000.0;
const SPACE: u16 = b' ' as u16;

fn typo_budget(len: usize) -> usize {
    match len {
        0..=3 => 0,
        4..=6 => 1,
        _ => 2,
    }
}

/// Damerau-Levenshtein (transposition = one edit), abandoned once it exceeds `budget`.
pub fn bounded_edit_distance(left: &[u16], right: &[u16], budget: usize) -> Option<usize> {
    if left == right {
        return Some(0);
    }
    if budget == 0 || left.len().abs_diff(right.len()) > budget || left.is_empty() || right.is_empty() {
        return None;
    }
    let mut before_previous: Vec<usize> = Vec::new();
    let mut previous: Vec<usize> = (0..=right.len()).collect();
    for i in 1..=left.len() {
        let mut current = vec![0usize; right.len() + 1];
        current[0] = i;
        let mut row_best = current[0];
        for j in 1..=right.len() {
            let substitution = usize::from(left[i - 1] != right[j - 1]);
            let mut cost = (current[j - 1] + 1).min(previous[j] + 1).min(previous[j - 1] + substitution);
            if i > 1 && j > 1 && left[i - 1] == right[j - 2] && left[i - 2] == right[j - 1] {
                cost = cost.min(before_previous[j - 2] + 1);
            }
            current[j] = cost;
            row_best = row_best.min(cost);
        }
        if row_best > budget {
            return None;
        }
        before_previous = std::mem::replace(&mut previous, current);
    }
    let distance = previous[right.len()];
    (distance <= budget).then_some(distance)
}

fn tokens(value: &[u16]) -> Vec<&[u16]> {
    if value.is_empty() { Vec::new() } else { value.split(|&c| c == SPACE).collect() }
}

fn find(haystack: &[u16], needle: &[u16]) -> Option<usize> {
    if needle.is_empty() {
        return Some(0);
    }
    haystack.windows(needle.len()).position(|w| w == needle)
}

fn token_set(query_tokens: &[&[u16]], value_tokens: &[&[u16]]) -> Option<f64> {
    if query_tokens.len() < 2 {
        return None;
    }
    let mut position_cost = 0usize;
    for q in query_tokens {
        position_cost += value_tokens.iter().position(|v| v.starts_with(q))?;
    }
    Some(TOKEN_SET + position_cost as f64 * 0.5)
}

fn typo_tokens(query_tokens: &[&[u16]], value_tokens: &[&[u16]]) -> Option<f64> {
    let mut total = 0usize;
    for q in query_tokens {
        let budget = typo_budget(q.len());
        if budget == 0 {
            return None;
        }
        let mut best: Option<usize> = None;
        for v in value_tokens {
            if let Some(d) = bounded_edit_distance(q, v, budget) {
                best = Some(best.map_or(d, |b| b.min(d)));
                if d == 0 {
                    break;
                }
            }
        }
        total += best?;
    }
    Some(TYPO + total as f64 * 100.0)
}

fn subsequence(query: &[u16], value: &[u16]) -> Option<f64> {
    if query.len() < 2 || value.is_empty() {
        return None;
    }
    let (mut qi, mut vi) = (0, 0);
    let (mut first, mut last) = (None, 0usize);
    while qi < query.len() && vi < value.len() {
        if query[qi] == value[vi] {
            first.get_or_insert(vi);
            last = vi;
            qi += 1;
        }
        vi += 1;
    }
    if qi != query.len() {
        return None;
    }
    let first = first?;
    let span = last - first + 1;
    let internal_gaps = span - query.len();
    Some(SUBSEQUENCE + first as f64 + internal_gaps as f64 * 2.0 + (value.len() as f64 - query.len() as f64) * 0.01)
}

/// Both arguments already normalised to the same key form.
pub fn score(query: &[u16], value: &[u16]) -> f64 {
    if query.is_empty() || value.is_empty() {
        return f64::INFINITY;
    }
    let length_cost = value.len() as f64 * 0.01;
    if value == query {
        return EXACT;
    }
    if value.starts_with(query) {
        return PREFIX + length_cost;
    }
    let value_tokens = tokens(value);
    if value_tokens.iter().any(|t| t.starts_with(query)) {
        return WORD_PREFIX + length_cost;
    }
    let query_tokens = tokens(query);
    if let Some(s) = token_set(&query_tokens, &value_tokens) {
        return s + length_cost;
    }
    if let Some(index) = find(value, query) {
        return SUBSTRING + index as f64 + length_cost;
    }
    if let Some(s) = typo_tokens(&query_tokens, &value_tokens) {
        return s + length_cost;
    }
    subsequence(query, value).unwrap_or(f64::INFINITY)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn u(s: &str) -> Vec<u16> {
        s.encode_utf16().collect()
    }

    #[test]
    fn bands_are_ordered() {
        let s = |q: &str, v: &str| score(&u(q), &u(v));
        assert_eq!(s("halo", "halo"), 0.0);
        assert!(s("hal", "halo") < 150.0);
        assert!((150.0..200.0).contains(&s("halo", "beyonce halo")));
        assert!((200.0..250.0).contains(&s("halo beyonce", "beyonce halo extra")));
        assert!((250.0..600.0).contains(&s("alo", "halo")));
        assert!((600.0..1000.0).contains(&s("niravna", "nirvana")));
        assert!(s("nvn", "nirvana") >= 1000.0);
        assert_eq!(s("xyz", "nirvana"), f64::INFINITY);
    }

    #[test]
    fn transposition_is_one_edit() {
        assert_eq!(bounded_edit_distance(&u("niravna"), &u("nirvana"), 2), Some(1));
        assert_eq!(bounded_edit_distance(&u("abcd"), &u("wxyz"), 2), None);
    }
}

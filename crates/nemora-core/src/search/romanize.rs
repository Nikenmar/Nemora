//! A Latin reading for text in any script, so `ひかり` is reachable by typing `hikari`. Port of
//! 1.1.9 `romanizeForSearch.ts` with Rust libraries: kana through wana_kana, hanzi through pinyin,
//! everything else through any_ascii (the same table as the JS any-ascii).
//!
//! Hangul is the one deliberate difference: 1.x used romaja, which applies the syllable
//! assimilation rules of Revised Romanization; the only Rust crate with those rules is GPL, which
//! the licence policy rules out. Syllables are therefore romanised one by one with the plain RR
//! table (`안녕하세요` -> `annyeonghaseyo`, the same; assimilating words can differ).

use wana_kana::ConvertJapanese;

fn is_kana(c: char) -> bool {
    ('\u{3040}'..='\u{30ff}').contains(&c)
}

fn is_hangul(c: char) -> bool {
    ('\u{ac00}'..='\u{d7af}').contains(&c) || ('\u{1100}'..='\u{11ff}').contains(&c)
}

fn is_han(c: char) -> bool {
    ('\u{4e00}'..='\u{9fff}').contains(&c) || ('\u{3400}'..='\u{4dbf}').contains(&c)
}

/// Anything outside printable ASCII may read differently than it is written.
pub fn has_romanizable_script(value: &str) -> bool {
    value.chars().any(|c| !(' '..='~').contains(&c))
}

/// A Latin reading, or `None` when there is nothing to read. Never fails.
pub fn romanize(value: &str) -> Option<String> {
    if value.is_empty() {
        return None;
    }
    if value.chars().any(is_hangul) {
        return Some(romanize_hangul(value));
    }
    // Kana anywhere means Japanese: the Han characters beside it are kanji, not Chinese.
    if value.chars().any(is_kana) {
        return Some(value.to_romaji());
    }
    if value.chars().any(is_han) {
        return Some(romanize_han(value));
    }
    if has_romanizable_script(value) {
        return Some(any_ascii::any_ascii(value));
    }
    None
}

/// Pinyin without tones, one syllable per character, runs of other text kept together.
fn romanize_han(value: &str) -> String {
    use pinyin::ToPinyin;
    let mut words: Vec<String> = Vec::new();
    let mut run = String::new();
    for c in value.chars() {
        match c.to_pinyin() {
            Some(p) => {
                if !run.is_empty() {
                    words.push(std::mem::take(&mut run));
                }
                words.push(p.plain().to_owned());
            }
            None => run.push(c),
        }
    }
    if !run.is_empty() {
        words.push(run);
    }
    words.join(" ")
}

const INITIALS: [&str; 19] =
    ["g", "kk", "n", "d", "tt", "r", "m", "b", "pp", "s", "ss", "", "j", "jj", "ch", "k", "t", "p", "h"];
const VOWELS: [&str; 21] = [
    "a", "ae", "ya", "yae", "eo", "e", "yeo", "ye", "o", "wa", "wae", "oe", "yo", "u", "wo", "we", "wi", "yu", "eu",
    "ui", "i",
];
const FINALS: [&str; 28] = [
    "", "k", "k", "k", "n", "n", "n", "t", "l", "k", "m", "l", "l", "l", "p", "l", "m", "p", "p", "t", "t", "ng", "t",
    "t", "k", "t", "p", "t",
];

fn romanize_hangul(value: &str) -> String {
    let mut out = String::new();
    for c in value.chars() {
        let code = c as u32;
        if (0xac00..=0xd7a3).contains(&code) {
            let index = code - 0xac00;
            out.push_str(INITIALS[(index / 588) as usize]);
            out.push_str(VOWELS[((index % 588) / 28) as usize]);
            out.push_str(FINALS[(index % 28) as usize]);
        } else {
            out.push(c);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scripts_get_their_reading() {
        assert_eq!(romanize("ひかり").as_deref(), Some("hikari"));
        assert_eq!(romanize("안녕하세요").as_deref(), Some("annyeonghaseyo"));
        assert_eq!(romanize("你好").as_deref(), Some("ni hao"));
        assert_eq!(romanize("Ελλάδα").as_deref(), Some("Ellada"));
        assert_eq!(romanize("plain ascii"), None);
    }
}

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

static JAPANESE: std::sync::LazyLock<Option<lindera::segmenter::Segmenter>> = std::sync::LazyLock::new(|| {
    let dictionary = lindera::dictionary::load_dictionary("embedded://ipadic").ok()?;
    Some(lindera::segmenter::Segmenter::new(lindera::mode::Mode::Normal, dictionary, None))
});

/// Japanese readings (PLAN/20 D1) for text with kana or kanji, through IPADIC: the reading of
/// every word, romanised, words apart (`無職転生` -> `mushoku tensei`), and the same run together
/// (`mushokutensei`). A word the dictionary does not know keeps its own letters. Empty for text
/// with neither; kanji-only text is read this way as well as by pinyin, as a title alone does
/// not say whether it is Japanese or Chinese.
/// Katakana combinations for sounds Japanese borrowed, which wana_kana spells kana by kana
/// (`ファティマ` -> `fuateima`): written out first, as a person would type them.
const LOAN_SOUNDS: &[(&str, &str)] = &[
    ("ヴァ", "va"),
    ("ヴィ", "vi"),
    ("ヴェ", "ve"),
    ("ヴォ", "vo"),
    ("ヴ", "vu"),
    ("ファ", "fa"),
    ("フィ", "fi"),
    ("フェ", "fe"),
    ("フォ", "fo"),
    ("ティ", "ti"),
    ("ディ", "di"),
    ("トゥ", "tu"),
    ("ドゥ", "du"),
    ("ウィ", "wi"),
    ("ウェ", "we"),
    ("ウォ", "wo"),
    ("シェ", "she"),
    ("ジェ", "je"),
    ("チェ", "che"),
    ("ツァ", "tsa"),
];

fn romaji(kana: &str) -> String {
    let mut text = kana.to_owned();
    for (from, to) in LOAN_SOUNDS {
        if text.contains(from) {
            text = text.replace(from, to);
        }
    }
    text.to_romaji()
}

pub fn japanese_readings(value: &str) -> Vec<String> {
    if !value.chars().any(|c| is_kana(c) || is_han(c)) {
        return Vec::new();
    }
    let Some(segmenter) = JAPANESE.as_ref() else { return Vec::new() };
    let Ok(mut tokens) = segmenter.segment(std::borrow::Cow::Borrowed(value)) else { return Vec::new() };
    let mut words: Vec<String> = Vec::with_capacity(tokens.len());
    for token in tokens.iter_mut() {
        let surface = token.surface.to_string();
        let reading = token.details().get(7).map(|r| r.to_string()).filter(|r| r != "*" && !r.is_empty());
        let word = match reading {
            Some(r) => romaji(&r),
            None if surface.chars().any(is_kana) => romaji(&surface),
            None => surface,
        };
        let word = crate::search::fold::normalize(&word);
        if !word.is_empty() {
            words.push(word);
        }
    }
    if words.is_empty() {
        return Vec::new();
    }
    let spaced = words.join(" ");
    // `n'` before a vowel (`sain'in`) folds to a space too: run together, it reads `sainin`.
    let together = spaced.replace(' ', "");
    if spaced == together { vec![spaced] } else { vec![spaced, together] }
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

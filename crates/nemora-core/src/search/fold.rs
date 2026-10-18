//! Search keys for text nobody can type as written: a port of 1.1.9 `common/searchFolding.ts`,
//! kept byte-compatible (checked against the old code by `tests/search_oracle.rs`).
//!
//! Three independent layers, never merged, because they answer different questions:
//!
//!   fold      same letters, other glyphs   `hiræth` -> `hiraeth`, `ΔS†ΞЯ` -> `aster`
//!   translit  same sounds, other script    `тупая` -> `tupaya`
//!   layout    same keys, wrong layout      `negfz` -> `тупая`
//!
//! Every layer is applied to both the query and the indexed text, so a layer can only add matches.
//! Digits are not folded (`1979`, `24K Magic`, `2Pac` must not collide with words); a digit that
//! touches a letter is spelled out instead (`1heart` -> `oneheart`).

use std::collections::HashMap;
use std::sync::LazyLock;

use regex::Regex;
use unicode_normalization::UnicodeNormalization;

/// Added to a match's score per layer: lower is better, so the plain key wins.
pub const FOLD_PENALTY: f64 = 30.0;
pub const NUMERAL_PENALTY: f64 = 45.0;
pub const TRANSLIT_PENALTY: f64 = 60.0;
pub const LAYOUT_PENALTY: f64 = 90.0;

/// Shorter than this (in UTF-16 units, as 1.x measured), a layout twin is noise.
pub const MIN_LAYOUT_SWAP_LENGTH: usize = 3;

static LATIN_EXPANSIONS: LazyLock<HashMap<char, &'static str>> = LazyLock::new(|| {
    HashMap::from([
        ('æ', "ae"),
        ('œ', "oe"),
        ('ß', "ss"),
        ('ẞ', "ss"),
        ('þ', "th"),
        ('ð', "d"),
        ('đ', "d"),
        ('ø', "o"),
        ('ǿ', "o"),
        ('ł', "l"),
        ('ħ', "h"),
        ('ŧ', "t"),
        ('ı', "i"),
        ('ȷ', "j"),
        ('ŋ', "ng"),
        ('ĸ', "k"),
        ('ſ', "s"),
        ('ĳ', "ij"),
        ('ǆ', "dz"),
        ('ǉ', "lj"),
        ('ǌ', "nj"),
    ])
});

/// Capitals whose shape parts ways with their own lowercase: `Δ` draws an A, `δ` a d.
static UPPERCASE_HOMOGLYPHS: LazyLock<HashMap<char, &'static str>> = LazyLock::new(|| {
    HashMap::from([
        ('Δ', "a"),
        ('Λ', "a"),
        ('Ξ', "e"),
        ('Σ', "s"),
        ('Π', "n"),
        ('Γ', "r"),
        ('Θ', "o"),
        ('Φ', "o"),
        ('Ψ', "y"),
        ('Ω', "o"),
        ('Л', "a"),
        ('Д', "d"),
        ('Ч', "y"),
        ('Ы', "b"),
    ])
});

/// Glyphs stylised names borrow for Latin letters, chosen by shape, not sound.
static HOMOGLYPHS: LazyLock<HashMap<char, &'static str>> = LazyLock::new(|| {
    HashMap::from([
        // Greek
        ('α', "a"),
        ('β', "b"),
        ('γ', "y"),
        ('δ', "d"),
        ('ε', "e"),
        ('ζ', "z"),
        ('η', "n"),
        ('θ', "o"),
        ('ι', "i"),
        ('κ', "k"),
        ('λ', "a"),
        ('μ', "u"),
        ('ν', "v"),
        ('ξ', "e"),
        ('ο', "o"),
        ('π', "n"),
        ('ρ', "p"),
        ('σ', "o"),
        ('τ', "t"),
        ('υ', "u"),
        ('φ', "o"),
        ('χ', "x"),
        ('ψ', "y"),
        ('ω', "w"),
        // Cyrillic
        ('а', "a"),
        ('б', "b"),
        ('в', "b"),
        ('г', "r"),
        ('д', "d"),
        ('е', "e"),
        ('ж', "x"),
        ('з', "z"),
        ('и', "u"),
        ('й', "u"),
        ('к', "k"),
        ('л', "a"),
        ('м', "m"),
        ('н', "h"),
        ('о', "o"),
        ('п', "n"),
        ('р', "p"),
        ('с', "c"),
        ('т', "t"),
        ('у', "y"),
        ('ф', "o"),
        ('х', "x"),
        ('ц', "u"),
        ('ч', "y"),
        ('ш', "w"),
        ('щ', "w"),
        ('ъ', ""),
        ('ы', "b"),
        ('ь', ""),
        ('э', "e"),
        ('ю', "o"),
        ('я', "r"),
        // Symbols and daggers that stand in for letters
        ('†', "t"),
        ('‡', "t"),
        ('∆', "a"),
        ('∇', "v"),
        ('∑', "e"),
        ('∏', "n"),
        ('√', "v"),
        ('∞', "oo"),
        ('×', "x"),
        ('÷', "i"),
        ('ƒ', "f"),
        ('¢', "c"),
        ('£', "l"),
        ('¥', "y"),
        ('€', "e"),
        ('©', "c"),
        ('®', "r"),
        ('§', "s"),
        ('¶', "p"),
        ('‰', "o"),
        ('ʌ', "v"),
        ('ɐ', "a"),
        ('ɔ', "c"),
        ('ə', "e"),
        ('ɪ', "i"),
        ('ʊ', "u"),
        ('·', " "),
    ])
});

/// Sounds, not shapes: the reading a Latin keyboard would write out.
static CYRILLIC_TRANSLITERATION: LazyLock<HashMap<char, &'static str>> = LazyLock::new(|| {
    HashMap::from([
        ('а', "a"),
        ('б', "b"),
        ('в', "v"),
        ('г', "g"),
        ('д', "d"),
        ('е', "e"),
        ('ё', "e"),
        ('ж', "zh"),
        ('з', "z"),
        ('и', "i"),
        ('й', "y"),
        ('к', "k"),
        ('л', "l"),
        ('м', "m"),
        ('н', "n"),
        ('о', "o"),
        ('п', "p"),
        ('р', "r"),
        ('с', "s"),
        ('т', "t"),
        ('у', "u"),
        ('ф', "f"),
        ('х', "h"),
        ('ц', "ts"),
        ('ч', "ch"),
        ('ш', "sh"),
        ('щ', "sch"),
        ('ъ', ""),
        ('ы', "y"),
        ('ь', ""),
        ('э', "e"),
        ('ю', "yu"),
        ('я', "ya"),
        ('і', "i"),
        ('ї', "yi"),
        ('є', "ye"),
        ('ґ', "g"),
    ])
});

const DIGIT_WORDS: [&str; 10] = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

/// Key for key between QWERTY and ЙЦУКЕН, built in 1.x's insertion order: for punctuation the
/// uppercase pass overwrites the lowercase one (`[` ends up as `Х`), and normalisation lowercases it.
static LAYOUT_MAP: LazyLock<HashMap<char, char>> = LazyLock::new(|| {
    const QWERTY: &str = "qwertyuiop[]asdfghjkl;'zxcvbnm,.`";
    const JCUKEN: &str = "йцукенгшщзхъфывапролджэячсмитьбюё";
    let upper = |c: char| c.to_uppercase().next().unwrap_or(c);
    let mut map = HashMap::new();
    for (latin, cyrillic) in QWERTY.chars().zip(JCUKEN.chars()) {
        map.insert(latin, cyrillic);
        map.insert(cyrillic, latin);
        map.insert(upper(latin), upper(cyrillic));
        map.insert(upper(cyrillic), upper(latin));
    }
    map
});

static NON_ALPHANUMERIC: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[^\p{L}\p{N}]+").unwrap());
static LETTER: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\p{L}$").unwrap());

fn is_combining_mark(c: char) -> bool {
    ('\u{0300}'..='\u{036f}').contains(&c)
}

fn is_letter(c: char) -> bool {
    let mut buf = [0u8; 4];
    LETTER.is_match(c.encode_utf8(&mut buf))
}

/// Lowercase, punctuation to single spaces, trimmed.
fn collapse(value: &str) -> String {
    let lower = value.to_lowercase();
    let spaced = NON_ALPHANUMERIC.replace_all(&lower, " ");
    spaced.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// The plain key: accents, case and punctuation off. A match here outranks every other layer.
pub fn normalize(value: &str) -> String {
    if value.is_empty() {
        return String::new();
    }
    collapse(&value.nfd().filter(|c| !is_combining_mark(*c)).collect::<String>())
}

/// The stylised key: NFKD for fullwidth, math alphanumerics, ligatures and circled letters, the
/// tables for what Unicode has no decomposition for.
pub fn fold(value: &str) -> String {
    if value.is_empty() {
        return String::new();
    }
    let mut folded = String::new();
    for c in value.nfkd().filter(|c| !is_combining_mark(*c)) {
        let lower: String = c.to_lowercase().collect();
        let mut lower_chars = lower.chars();
        let single_lower = match (lower_chars.next(), lower_chars.next()) {
            (Some(l), None) => Some(l),
            _ => None,
        };
        if let Some(mapped) = UPPERCASE_HOMOGLYPHS.get(&c) {
            folded.push_str(mapped);
        } else if let Some(mapped) = single_lower.and_then(|l| LATIN_EXPANSIONS.get(&l).or_else(|| HOMOGLYPHS.get(&l)))
        {
            folded.push_str(mapped);
        } else {
            folded.push(c);
        }
    }
    collapse(&folded)
}

/// Digits touching a letter spelled out (`4ever`, `SR20DET`); a digit standing alone means itself.
/// Empty when nothing was spelled.
pub fn spell_digits(value: &str) -> String {
    let chars: Vec<char> = value.chars().collect();
    let mut spelled = String::new();
    let mut did_spell = false;
    for (index, &c) in chars.iter().enumerate() {
        if !c.is_ascii_digit() {
            spelled.push(c);
            continue;
        }
        let mut before = index as isize - 1;
        while before >= 0 && chars[before as usize].is_ascii_digit() {
            before -= 1;
        }
        let mut after = index + 1;
        while after < chars.len() && chars[after].is_ascii_digit() {
            after += 1;
        }
        let touches_letter =
            (before >= 0 && is_letter(chars[before as usize])) || (after < chars.len() && is_letter(chars[after]));
        if touches_letter {
            spelled.push_str(DIGIT_WORDS[c as usize - '0' as usize]);
            did_spell = true;
        } else {
            spelled.push(c);
        }
    }
    if did_spell { normalize(&spelled) } else { String::new() }
}

/// The sounded-out key for Cyrillic; other scripts pass through.
pub fn transliterate(value: &str) -> String {
    if value.is_empty() {
        return String::new();
    }
    let mut out = String::new();
    for c in value.chars() {
        let lower: String = c.to_lowercase().collect();
        let mut it = lower.chars();
        match (it.next(), it.next()) {
            (Some(l), None) if CYRILLIC_TRANSLITERATION.contains_key(&l) => out.push_str(CYRILLIC_TRANSLITERATION[&l]),
            _ => out.push(c),
        }
    }
    normalize(&out)
}

/// The same physical keys in the other layout; empty when nothing mapped.
pub fn swap_layout(value: &str) -> String {
    let mut swapped = String::new();
    let mut did_swap = false;
    for c in value.chars() {
        match LAYOUT_MAP.get(&c) {
            Some(&m) => {
                swapped.push(m);
                did_swap = true;
            }
            None => swapped.push(c),
        }
    }
    if did_swap { swapped } else { String::new() }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Variant {
    pub text: String,
    pub penalty: f64,
}

fn add(variants: &mut Vec<Variant>, text: String, penalty: f64) {
    if text.is_empty() || variants.iter().any(|v| v.text == text) {
        return;
    }
    variants.push(Variant { text, penalty });
}

/// Every spelling of a query worth trying, cheapest first.
pub fn query_variants(query: &str) -> Vec<Variant> {
    let mut v = Vec::new();
    add(&mut v, normalize(query), 0.0);
    let folded = fold(query);
    add(&mut v, folded.clone(), FOLD_PENALTY);
    add(&mut v, spell_digits(&folded), NUMERAL_PENALTY);
    add(&mut v, transliterate(query), TRANSLIT_PENALTY);
    let long_enough = query.trim().encode_utf16().count() >= MIN_LAYOUT_SWAP_LENGTH;
    let swapped = if long_enough { swap_layout(query) } else { String::new() };
    if !swapped.is_empty() {
        add(&mut v, normalize(&swapped), LAYOUT_PENALTY);
        add(&mut v, transliterate(&swapped), LAYOUT_PENALTY + TRANSLIT_PENALTY);
    }
    v
}

/// The keys one indexed string is searchable under.
pub fn text_keys(value: &str, romanized: Option<&str>) -> Vec<Variant> {
    let mut k = Vec::new();
    add(&mut k, normalize(value), 0.0);
    let folded = fold(value);
    add(&mut k, folded.clone(), FOLD_PENALTY);
    add(&mut k, spell_digits(&folded), NUMERAL_PENALTY);
    add(&mut k, transliterate(value), TRANSLIT_PENALTY);
    if let Some(r) = romanized {
        add(&mut k, normalize(r), TRANSLIT_PENALTY);
    }
    k
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_examples_of_the_1x_documentation_hold() {
        assert_eq!(fold("hiræth"), "hiraeth");
        assert_eq!(fold("ΔS†ΞЯ"), "aster");
        assert_eq!(transliterate("тупая"), "tupaya");
        assert_eq!(normalize(&swap_layout("negfz")), "тупая");
        // 1.x itself gives "ooneheart" here (the folded Ø is an "o" of its own); the oracle confirmed it.
        assert_eq!(spell_digits(&fold("Ø1heart")), "ooneheart");
        assert_eq!(spell_digits("1979"), "");
        assert_eq!(spell_digits("sr20det"), "srtwozerodet");
    }
}

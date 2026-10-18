//! The LRC parser against 1.1.9's own answers (`tools/oracle/lyrics.ts`).

use nemora_core::lyrics::{Text, parse};
use serde_json::Value;

fn number(v: &Value) -> f64 {
    // JSON has no Infinity: 1.x's infinite end times arrive as null.
    v.as_f64().unwrap_or(f64::INFINITY)
}

fn same_text(got: &Text, want: &Value) -> bool {
    match (got, want) {
        (Text::Plain(s), Value::String(w)) => s == w,
        (Text::Words(words), Value::Array(w)) => {
            words.len() == w.len()
                && words.iter().zip(w).all(|(a, b)| {
                    a.text == b["text"].as_str().unwrap()
                        && a.unparsed_text == b["unparsedText"].as_str().unwrap()
                        && (a.start - number(&b["start"])).abs() < 1e-9
                        && (a.end == number(&b["end"]) || (a.end - number(&b["end"])).abs() < 1e-9)
                })
        }
        _ => false,
    }
}

fn has_cjk(s: &str) -> bool {
    s.chars().any(|c| {
        ('\u{3040}'..='\u{30ff}').contains(&c)
            || ('\u{4e00}'..='\u{9fff}').contains(&c)
            || ('\u{ac00}'..='\u{d7af}').contains(&c)
    })
}

#[test]
fn lrc_parses_as_in_1x() {
    let path = format!("{}/../../fixtures/synthetic/oracle/lyrics-expected.json", env!("CARGO_MANIFEST_DIR"));
    let data: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let mut failures = Vec::new();
    for (n, case) in data["cases"].as_array().unwrap().iter().enumerate() {
        let input = case["input"].as_str().unwrap();
        let want = &case["output"];
        let got = parse(input);
        let mut fail = |what: String| failures.push(format!("#{n} {what}\n    input: {input:?}"));
        if got.synced != want["isSynced"].as_bool().unwrap() {
            fail(format!("synced {} vs {}", got.synced, want["isSynced"]));
        }
        if got.translated != want["isTranslated"].as_bool().unwrap() {
            fail(format!("translated {} vs {}", got.translated, want["isTranslated"]));
        }
        if got.copyright.as_deref() != want["copyright"].as_str() {
            fail(format!("copyright {:?} vs {}", got.copyright, want["copyright"]));
        }
        if (got.offset - want["offset"].as_f64().unwrap()).abs() > 1e-12 {
            fail(format!("offset {} vs {}", got.offset, want["offset"]));
        }
        let langs: Vec<String> =
            want["translatedLanguages"].as_array().unwrap().iter().map(|v| v.as_str().unwrap().to_owned()).collect();
        if got.translated_languages != langs {
            fail(format!("translated languages {:?} vs {langs:?}", got.translated_languages));
        }
        // Script detection used JavaScript libraries; it is compared where no CJK is involved.
        if !has_cjk(input) && got.language.as_deref() != want["originalLanguage"].as_str() {
            fail(format!("language {:?} vs {}", got.language, want["originalLanguage"]));
        }
        let lines = want["parsedLyrics"].as_array().unwrap();
        if got.lines.len() != lines.len() {
            fail(format!("{} lines vs {}", got.lines.len(), lines.len()));
            continue;
        }
        for (i, (g, w)) in got.lines.iter().zip(lines).enumerate() {
            if !same_text(&g.original, &w["originalText"]) {
                fail(format!("line {i} text {:?} vs {}", g.original, w["originalText"]));
            }
            if g.enhanced != w["isEnhancedSynced"].as_bool().unwrap() {
                fail(format!("line {i} enhanced"));
            }
            let times_ok = match (g.start, &w["start"]) {
                (None, Value::Null) => g.end.is_none(),
                (Some(s), ws) if ws.is_number() => {
                    (s - number(ws)).abs() < 1e-9
                        && g.end
                            .map(|e| e == number(&w["end"]) || (e - number(&w["end"])).abs() < 1e-9)
                            .unwrap_or(false)
                }
                _ => false,
            };
            if !times_ok {
                fail(format!("line {i} times {:?}-{:?} vs {}-{}", g.start, g.end, w["start"], w["end"]));
            }
            let wt = w["translatedTexts"].as_array().unwrap();
            if g.translations.len() != wt.len()
                || g.translations
                    .iter()
                    .zip(wt)
                    .any(|(a, b)| a.lang != b["lang"].as_str().unwrap() || !same_text(&a.text, &b["text"]))
            {
                fail(format!("line {i} translations {:?} vs {}", g.translations, w["translatedTexts"]));
            }
        }
    }
    assert!(failures.is_empty(), "{} mismatches:\n{}", failures.len(), failures.join("\n"));
}

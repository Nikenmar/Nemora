//! Development probe for PLAN/20 D1: IPADIC readings of Japanese titles.
use lindera::dictionary::load_dictionary;
use lindera::mode::Mode;
use lindera::segmenter::Segmenter;

fn main() {
    let t = std::time::Instant::now();
    let dictionary = load_dictionary("embedded://ipadic").unwrap();
    let tokenizer = Segmenter::new(Mode::Normal, dictionary, None);
    println!("load {:?}", t.elapsed());
    for text in ["ファティマ", "サインイン", "幻影", "ビートマニア", "藤澤慶昌", "空想メソロギヰ"]
    {
        println!("READ {text}: {:?}", nemora_core::search::romanize::japanese_readings(text));
    }
    for text in [
        "無職転生",
        "拷問の時間",
        "夜に駆ける",
        "祈り、終われば",
        "梶浦由記",
        "藤澤慶昌",
        "大原ゆい子",
        "今井麻美",
        "リサがいない。",
        "狼少女といっしょ",
        "垂直方向の静脈切開",
        "陽だまりの寒さ",
        "79憎い、死んで欲しい。",
        "幻影",
        "湖",
    ] {
        let t = std::time::Instant::now();
        let mut tokens = tokenizer.segment(std::borrow::Cow::Borrowed(text)).unwrap();
        let parts: Vec<String> = tokens
            .iter_mut()
            .map(|tok| {
                let surface = tok.surface.to_string();
                let reading = tok.details().get(7).map(|s| s.to_string()).unwrap_or_default();
                format!("{surface}[{reading}]")
            })
            .collect();
        println!("{text}: {} ({:?})", parts.join(" "), t.elapsed());
    }
}

//! Development probe for lyrics sources.
//!
//!   lyrics_probe scan <music folder>                 how many files carry lyrics (read only)
//!   lyrics_probe lrclib <title> <artist> <seconds>   one LRCLIB lookup

use std::path::Path;

use nemora_core::lyrics::{from_lrc_file, from_tags, lrclib, parse};

fn walk(dir: &Path, out: &mut Vec<std::path::PathBuf>) {
    for entry in std::fs::read_dir(dir).into_iter().flatten().flatten() {
        let p = entry.path();
        if p.is_dir() {
            walk(&p, out);
        } else if p
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| ["mp3", "flac", "m4a", "ogg", "opus", "wav"].contains(&e.to_ascii_lowercase().as_str()))
        {
            out.push(p);
        }
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("scan") => {
            let mut files = Vec::new();
            walk(Path::new(&args[1]), &mut files);
            let (mut lrc, mut tags, mut synced) = (0, 0, 0);
            for f in &files {
                if let Some(t) = from_lrc_file(f) {
                    lrc += 1;
                    synced += usize::from(parse(&t).synced);
                } else if let Some(t) = from_tags(f) {
                    tags += 1;
                    synced += usize::from(parse(&t).synced);
                }
            }
            println!(
                "{} files: {lrc} with an .lrc file, {tags} with lyrics in tags, {synced} of them synced",
                files.len()
            );
        }
        Some("lrclib") => match lrclib::fetch(&args[1], &args[2], None, args[3].parse().unwrap()) {
            Ok(Some(text)) => {
                let l = parse(&text);
                println!(
                    "found: synced {}, {} lines, first: {:?}",
                    l.synced,
                    l.lines.len(),
                    l.lines.first().map(|x| &x.original)
                );
            }
            Ok(None) => println!("LRCLIB has no lyrics for it"),
            Err(e) => println!("error: {e}"),
        },
        _ => eprintln!("usage: lyrics_probe scan <folder> | lrclib <title> <artist> <seconds>"),
    }
}

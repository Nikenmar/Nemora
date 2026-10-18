//! The identity corpus of `spec/identity-v1.md`: per format, what a tagger does to a file must keep
//! the song id, and a different recording must not.
//!
//! Audio is generated at run time with ffmpeg (a deterministic tone plus seeded pink noise), so the
//! repository carries no binary fixtures. Without ffmpeg on PATH the test reports a skip and passes.
//! Tag edits go through lofty, which rewrites files the way a tagger does: in place, re-paginating
//! OGG and rewriting MP4 atoms when a tag grows.

use std::path::{Path, PathBuf};
use std::process::Command;

use lofty::config::WriteOptions;
use lofty::picture::{MimeType, Picture, PictureType};
use lofty::prelude::*;
use lofty::tag::{Tag, TagType};
use nemora_core::identity::{Identity, identify_path};

struct Format {
    name: &'static str,
    extension: &'static str,
    codec_args: &'static [&'static str],
}

const FORMATS: &[Format] = &[
    Format { name: "mp3 cbr", extension: "mp3", codec_args: &["-c:a", "libmp3lame", "-b:a", "192k"] },
    Format { name: "mp3 vbr", extension: "mp3", codec_args: &["-c:a", "libmp3lame", "-q:a", "2"] },
    // No Xing/Info header: the demuxer estimates the length from the file size, tags included.
    Format {
        name: "mp3 cbr without xing",
        extension: "mp3",
        codec_args: &["-c:a", "libmp3lame", "-b:a", "192k", "-write_xing", "0"],
    },
    Format { name: "flac", extension: "flac", codec_args: &["-c:a", "flac"] },
    Format { name: "aac in m4a", extension: "m4a", codec_args: &["-c:a", "aac", "-b:a", "192k"] },
    Format { name: "alac in m4a", extension: "m4a", codec_args: &["-c:a", "alac"] },
    Format { name: "vorbis in ogg", extension: "ogg", codec_args: &["-c:a", "libvorbis", "-q:a", "5"] },
    Format { name: "opus", extension: "opus", codec_args: &["-c:a", "libopus", "-b:a", "128k"] },
    // 20 s of 16-bit stereo is larger than the 2 MiB window, so the window cut is exercised too.
    Format { name: "wav", extension: "wav", codec_args: &["-c:a", "pcm_s16le"] },
];

fn ffmpeg_available() -> bool {
    Command::new("ffmpeg").arg("-version").output().map(|o| o.status.success()).unwrap_or(false)
}

fn generate(out: &Path, format: &Format, seed: u32, seconds: u32) {
    let graph = format!(
        "sine=f=440:d={seconds}:r=44100[a];anoisesrc=d={seconds}:c=pink:a=0.2:r=44100:seed={seed}[b];[a][b]amix=inputs=2[m]"
    );
    let status = Command::new("ffmpeg")
        .args(["-v", "error", "-y", "-filter_complex", &graph, "-map", "[m]", "-ac", "2"])
        .args(["-map_metadata", "-1", "-fflags", "+bitexact"])
        .args(format.codec_args)
        .arg(out)
        .status()
        .expect("ffmpeg runs");
    assert!(status.success(), "ffmpeg failed for {}", format.name);
}

fn id(path: &Path) -> Identity {
    identify_path(path).unwrap_or_else(|e| panic!("identify {}: {e}", path.display()))
}

fn bytes(path: &Path) -> Vec<u8> {
    std::fs::read(path).unwrap()
}

fn copy_to(src: &Path, dir: &Path, name: &str) -> PathBuf {
    let dst = dir.join(name);
    std::fs::copy(src, &dst).unwrap();
    dst
}

fn retag(path: &Path, edit: impl FnOnce(&mut Tag)) {
    let mut file = lofty::read_from_path(path).unwrap();
    if file.primary_tag_mut().is_none() {
        let tag_type = file.primary_tag_type();
        file.insert_tag(Tag::new(tag_type));
    }
    edit(file.primary_tag_mut().unwrap());
    file.save_to_path(path, WriteOptions::default()).unwrap();
}

/// Appends a tag of its own kind. It carries the big picture: a trailing tag counts towards
/// symphonia's MP3 length estimate, and only a large one moves it past rounding.
fn add_tag(path: &Path, tag_type: TagType) {
    let mut tag = Tag::new(tag_type);
    tag.set_title("Another title".to_owned());
    if tag_type == TagType::Ape {
        tag.push_picture(big_picture());
    }
    tag.save_to_path(path, WriteOptions::default()).unwrap();
}

fn strip_tags(path: &Path) {
    let file = lofty::read_from_path(path).unwrap();
    let types: Vec<TagType> = file.tags().iter().map(|t| t.tag_type()).collect();
    for tag_type in types {
        // `remove_from_path` fails on Windows with "failed to write to file" (lofty 0.25.4);
        // handing it a handle opened for reading and writing works.
        let mut handle = std::fs::OpenOptions::new().read(true).write(true).open(path).unwrap();
        if let Err(e) = tag_type.remove_from(&mut handle, WriteOptions::default()) {
            panic!("removing {tag_type:?} from {}: {e}", path.display());
        }
    }
}

/// 1.5 MB of pseudo-random bytes: larger than symphonia's 1 MB probe depth (a tag the probe cannot
/// skip hides the audio behind it) and enough to push an OGG comment header over many pages.
fn big_picture() -> Picture {
    let mut state: u32 = 0x9e37_79b9;
    let data: Vec<u8> = (0..1_500_000)
        .map(|_| {
            state ^= state << 13;
            state ^= state >> 17;
            state ^= state << 5;
            state as u8
        })
        .collect();
    Picture::unchecked(data).pic_type(PictureType::CoverFront).mime_type(MimeType::Jpeg).build()
}

#[test]
fn tagger_edits_keep_the_id_and_other_audio_changes_it() {
    if !ffmpeg_available() {
        eprintln!("SKIPPED: ffmpeg is not on PATH, the identity corpus was not run");
        return;
    }
    let root = std::env::temp_dir().join(format!("nemora-identity-corpus-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    let mut failures = Vec::new();

    for (index, format) in FORMATS.iter().enumerate() {
        let dir = root.join(index.to_string());
        std::fs::create_dir_all(dir.join("moved")).unwrap();
        let original = dir.join(format!("original.{}", format.extension));
        generate(&original, format, 42, 20);
        let base = id(&original);

        let mut same = |label: &str, path: &Path, must_differ_on_disk: bool| {
            if must_differ_on_disk && bytes(path) == bytes(&original) {
                failures.push(format!("{}: '{label}' did not change the file, the case proves nothing", format.name));
                return;
            }
            let got = id(path);
            if got.song_id != base.song_id {
                failures.push(format!(
                    "{}: '{label}' changed the id ({} -> {}; frames {:?} -> {:?})",
                    format.name, base.song_id, got.song_id, base.frame_count, got.frame_count
                ));
            }
        };

        let p = copy_to(&original, &dir, &format!("retagged.{}", format.extension));
        retag(&p, |t| {
            t.set_title("A completely different title".to_owned());
            t.set_artist("Somebody Else".to_owned());
            t.set_album("Another Album".to_owned());
        });
        same("title, artist and album changed", &p, true);

        let p = copy_to(&original, &dir, &format!("picture.{}", format.extension));
        retag(&p, |t| t.push_picture(big_picture()));
        same("1.5 MB cover added", &p, true);

        let p = copy_to(&dir.join(format!("picture.{}", format.extension)), &dir, &format!("stripped.{}", format.extension));
        strip_tags(&p);
        same("every tag removed after a cover was added", &p, false);

        let p = copy_to(&original, &dir.join("moved"), &format!("renamed file.{}", format.extension));
        same("renamed and moved", &p, false);

        if format.extension == "mp3" {
            let p = copy_to(&original, &dir, "id3v1.mp3");
            add_tag(&p, TagType::Id3v1);
            same("ID3v1 tag appended", &p, true);
            let p = copy_to(&original, &dir, "ape.mp3");
            add_tag(&p, TagType::Ape);
            same("APEv2 tag with a 1.5 MB cover appended", &p, true);
        }

        let mut different = |label: &str, path: &Path| {
            let got = id(path);
            if got.song_id == base.song_id {
                failures.push(format!("{}: '{label}' kept the id {}", format.name, base.song_id));
            }
        };
        let p = dir.join(format!("other recording.{}", format.extension));
        generate(&p, format, 43, 20);
        different("a different recording", &p);
        let p = dir.join(format!("trimmed.{}", format.extension));
        generate(&p, format, 42, 15);
        different("the same recording, 5 s shorter", &p);
    }

    let _ = std::fs::remove_dir_all(&root);
    assert!(failures.is_empty(), "identity corpus failures:\n{}", failures.join("\n"));
}

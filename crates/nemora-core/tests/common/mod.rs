//! Helpers shared by the integration tests: generated audio and tag edits.
#![allow(dead_code)]

use std::path::{Path, PathBuf};
use std::process::Command;

use lofty::config::WriteOptions;
use lofty::picture::{MimeType, Picture, PictureType};
use lofty::prelude::*;
use lofty::tag::Tag;

pub fn ffmpeg_available() -> bool {
    Command::new("ffmpeg").arg("-version").output().map(|o| o.status.success()).unwrap_or(false)
}

/// A fresh temporary directory, unique per test and process.
pub fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("nemora-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// A short FLAC whose audio is decided by `seed`: same seed, same audio.
pub fn flac(path: &Path, seed: u32, seconds: u32) {
    let graph = format!(
        "sine=f=440:d={seconds}:r=44100[a];anoisesrc=d={seconds}:c=pink:a=0.2:r=44100:seed={seed}[b];[a][b]amix=inputs=2[m]"
    );
    let status = Command::new("ffmpeg")
        .args(["-v", "error", "-y", "-filter_complex", &graph, "-map", "[m]", "-ac", "2"])
        .args(["-map_metadata", "-1", "-fflags", "+bitexact", "-c:a", "flac"])
        .arg(path)
        .status()
        .expect("ffmpeg runs");
    assert!(status.success());
}

/// A small valid PNG whose pixels depend on `seed`.
pub fn png(seed: u8) -> Vec<u8> {
    let image = image::RgbImage::from_fn(64, 64, |x, y| image::Rgb([x as u8 ^ seed, y as u8, seed]));
    let mut out = std::io::Cursor::new(Vec::new());
    image.write_to(&mut out, image::ImageFormat::Png).unwrap();
    out.into_inner()
}

pub fn set_tags(path: &Path, title: &str, artist: &str, album: Option<&str>, cover: Option<Vec<u8>>) {
    let mut file = lofty::read_from_path(path).unwrap();
    if file.primary_tag_mut().is_none() {
        let tag_type = file.primary_tag_type();
        file.insert_tag(Tag::new(tag_type));
    }
    let tag = file.primary_tag_mut().unwrap();
    tag.set_title(title.to_owned());
    tag.set_artist(artist.to_owned());
    if let Some(album) = album {
        tag.set_album(album.to_owned());
    }
    if let Some(data) = cover {
        tag.push_picture(Picture::unchecked(data).pic_type(PictureType::CoverFront).mime_type(MimeType::Png).build());
    }
    file.save_to_path(path, WriteOptions::default()).unwrap();
}

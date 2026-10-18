//! Content-addressed cover storage (vault plan PLAN/04-covers.md).
//!
//! A picture is stored once, however many tracks carry it, under the BLAKE3 hash of its original
//! bytes. Only thumbnails live on disk; the full-size picture is read back from the audio file when
//! it is needed.

use std::fs;
use std::path::{Path, PathBuf};

use image::imageops::FilterType;
use image::{DynamicImage, GenericImageView};

use crate::error::{Error, Result};

/// Thumbnail edges in pixels: list rows, and grids / phone player / tierlists / the car.
pub const THUMB_SIZES: [u32; 2] = [128, 512];

const WEBP_QUALITY: f32 = 80.0;

pub fn cover_hash(data: &[u8]) -> String {
    blake3::hash(data).to_hex().to_string()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PictureSize {
    pub width: u32,
    pub height: u32,
}

pub struct CoverStore {
    root: PathBuf,
}

impl CoverStore {
    /// `root` is `<profile>/covers`; it is created on first write.
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    pub fn thumbnail_path(&self, hash: &str, size: u32) -> PathBuf {
        self.root.join(&hash[..2]).join(format!("{hash}-{size}.webp"))
    }

    pub fn has_thumbnails(&self, hash: &str) -> bool {
        THUMB_SIZES.iter().all(|&size| self.thumbnail_path(hash, size).is_file())
    }

    /// Writes the missing thumbnails of a picture and returns its original size. Pictures smaller
    /// than a thumbnail are never enlarged.
    pub fn write_thumbnails(&self, hash: &str, data: &[u8]) -> Result<PictureSize> {
        let image = image::load_from_memory(data).map_err(|e| Error::Image(e.to_string()))?;
        let (width, height) = image.dimensions();
        fs::create_dir_all(self.root.join(&hash[..2]))?;
        // Largest first, and each smaller one from the previous: cheaper than resizing the
        // original every time, and Lanczos keeps the small one sharp.
        let mut source = image;
        for &size in THUMB_SIZES.iter().rev() {
            let thumb = if source.width() > size || source.height() > size {
                source.resize(size, size, FilterType::Lanczos3)
            } else {
                source.clone()
            };
            write_atomically(&self.thumbnail_path(hash, size), &encode_webp(&thumb)?)?;
            source = thumb;
        }
        Ok(PictureSize { width, height })
    }
}

fn encode_webp(image: &DynamicImage) -> Result<Vec<u8>> {
    let rgba = DynamicImage::ImageRgba8(image.to_rgba8());
    let encoder = webp::Encoder::from_image(&rgba).map_err(|e| Error::Image(e.to_string()))?;
    Ok(encoder.encode(WEBP_QUALITY).to_vec())
}

/// A crash leaves either no thumbnail or a complete one, never a truncated file. The temporary name
/// is unique because a parallel scan can write the same album cover from two tracks at once.
fn write_atomically(path: &Path, bytes: &[u8]) -> Result<()> {
    let tmp = path.with_extension(format!("{}.tmp", &crate::ids::random()[..10]));
    fs::write(&tmp, bytes)?;
    fs::rename(&tmp, path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png(width: u32, height: u32) -> Vec<u8> {
        let image = image::RgbImage::from_fn(width, height, |x, y| image::Rgb([x as u8, y as u8, 90]));
        let mut out = std::io::Cursor::new(Vec::new());
        image.write_to(&mut out, image::ImageFormat::Png).unwrap();
        out.into_inner()
    }

    #[test]
    fn thumbnails_fit_the_box_and_small_pictures_are_not_enlarged() {
        let dir = std::env::temp_dir().join(format!("nemora-covers-test-{}", std::process::id()));
        let store = CoverStore::new(&dir);

        let big = png(1000, 600);
        let hash = cover_hash(&big);
        assert_eq!(store.write_thumbnails(&hash, &big).unwrap(), PictureSize { width: 1000, height: 600 });
        let t512 = image::open(store.thumbnail_path(&hash, 512)).unwrap();
        let t128 = image::open(store.thumbnail_path(&hash, 128)).unwrap();
        assert_eq!(t512.dimensions(), (512, 307));
        assert_eq!(t128.dimensions(), (128, 77));
        assert!(store.has_thumbnails(&hash));

        let small = png(100, 100);
        let hash = cover_hash(&small);
        store.write_thumbnails(&hash, &small).unwrap();
        assert_eq!(image::open(store.thumbnail_path(&hash, 512)).unwrap().dimensions(), (100, 100));

        let _ = fs::remove_dir_all(&dir);
    }
}

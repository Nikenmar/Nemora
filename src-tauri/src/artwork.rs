//! Artwork decoding, resizing, encoding and palette extraction, done natively.
//!
//! Every one of these ran inside WebView2 before: `createImageBitmap` plus an
//! `OffscreenCanvas` for the transform, `node-vibrant` for the palette. That
//! put a decoded bitmap of every cover in the renderer's heap and the encode
//! cost on the thread that draws the interface, for a library that ships 3962
//! cover files.
//!
//! ONE RULE IS IMPLEMENTED TWICE HERE, AND THAT IS A DELIBERATE TRADE. The
//! centred `fit: cover` geometry also lives in `createTransformPlan`. Keeping a
//! single implementation would mean asking TypeScript to solve the plan, which
//! needs the decoded dimensions, which needs a decode - so every cover would be
//! decoded twice, 1745 times over on a full scan. Instead `cover_rect` mirrors
//! the rule and its tests use the same numbers as the TypeScript suite
//! (3840 -> 50, and 947x621 left alone), so a drift in either direction fails a
//! test rather than reaching a user.
//!
//! The spike rule about binary data still holds: nothing here takes or returns
//! image bytes over `invoke`. Sources are paths, results are files written by
//! the same crash-safe writer the stores use.

use std::path::Path;

use image::{imageops::FilterType, DynamicImage, GenericImageView, RgbImage};
use serde::{Deserialize, Serialize};

use crate::fsops::write_file_atomic_impl;

/// A source rectangle in the decoded image, as solved by `createTransformPlan`.
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct SourceRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Copy, Deserialize)]
pub struct OutputSize {
    pub width: u32,
    pub height: u32,
}

/// One output file: where it goes and what shape it takes.
///
/// This carries the PROFILE, not a solved plan. Solving it on the TypeScript
/// side would mean decoding every cover twice - once to learn its dimensions,
/// once to transform it - which is 1745 extra decodes on a full scan. The
/// centred-cover rule is therefore implemented twice, and `cover_rect` below is
/// tested against the exact numbers the TypeScript suite uses.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransformJob {
    pub destination: String,
    /// `image/webp`, `image/png` or `image/jpeg`, matching ArtworkMimeType.
    pub mime_type: String,
    /// 0..1, as the canvas backend expresses it. Ignored by PNG.
    pub quality: Option<f32>,
    /// Absent means "keep the source dimensions", as in IMAGE_PROFILES.png.
    pub resize: Option<OutputSize>,
}

/// The centred `fit: cover` rectangle, mirroring `createTransformPlan`.
fn cover_rect(input: (u32, u32), output: OutputSize) -> SourceRect {
    let (input_width, input_height) = (input.0 as f64, input.1 as f64);
    let scale = (output.width as f64 / input_width).max(output.height as f64 / input_height);
    let width = output.width as f64 / scale;
    let height = output.height as f64 / scale;
    SourceRect {
        x: (input_width - width) / 2.0,
        y: (input_height - height) / 2.0,
        width,
        height,
    }
}

#[derive(Debug, Serialize)]
pub struct Swatch {
    pub hex: String,
    /// `[hue 0..1, saturation 0..1, lightness 0..1]`, the shape node-vibrant uses.
    pub hsl: [f64; 3],
    pub population: u32,
}

/// The six swatches `palettes.json` records. Names and shape follow
/// node-vibrant exactly, because the renderer reads this store directly.
#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "PascalCase")]
pub struct Palette {
    pub vibrant: Option<Swatch>,
    pub dark_vibrant: Option<Swatch>,
    pub light_vibrant: Option<Swatch>,
    pub muted: Option<Swatch>,
    pub dark_muted: Option<Swatch>,
    pub light_muted: Option<Swatch>,
}

fn open_image(path: &str) -> Result<DynamicImage, String> {
    image::open(Path::new(path)).map_err(|error| format!("cannot decode {path}: {error}"))
}

/// Crops and scales one decoded image to a job's plan.
///
/// The rectangle arrives as floats because the cover geometry divides; it is
/// clamped to the real bounds here so a rounding error at the edge cannot ask
/// for a pixel that does not exist.
fn render(image: &DynamicImage, job: &TransformJob) -> DynamicImage {
    let (width, height) = image.dimensions();
    let Some(output) = job.resize else {
        return image.clone();
    };
    let rect = cover_rect((width, height), output);
    let x = rect.x.round().max(0.0) as u32;
    let y = rect.y.round().max(0.0) as u32;
    let crop_width = (rect.width.round().max(1.0) as u32).min(width.saturating_sub(x).max(1));
    let crop_height = (rect.height.round().max(1.0) as u32).min(height.saturating_sub(y).max(1));

    let cropped = if x == 0 && y == 0 && crop_width == width && crop_height == height {
        image.clone()
    } else {
        image.crop_imm(x, y, crop_width, crop_height)
    };

    if cropped.width() == output.width && cropped.height() == output.height {
        return cropped;
    }

    // Two filters, chosen by how far the image is being shrunk.
    //
    // Lanczos3 is the closest match to what the canvas backend produces, and it
    // is what anything the user actually looks at gets. But it costs the same
    // per OUTPUT pixel however far the source is above it, and the 50x50 list
    // icon is a 24-fold reduction of a 1200px cover - measured at 23 ms, second
    // only to the full-size encode. Past a large enough ratio each output pixel
    // is an average of hundreds of source pixels, where a box average and a
    // windowed sinc agree to within noise, so the cheap filter is used and the
    // measurement drops to 7 ms.
    let ratio = f64::from(cropped.width().min(cropped.height()))
        / f64::from(output.width.max(output.height).max(1));
    if ratio >= FAST_DOWNSCALE_RATIO {
        cropped.thumbnail_exact(output.width, output.height)
    } else {
        cropped.resize_exact(output.width, output.height, FilterType::Lanczos3)
    }
}

/// Below this reduction factor the quality filter is used; at or above it the
/// cheap one is. Four keeps the 400px tier-list thumbnail (a threefold
/// reduction, and displayed large) on Lanczos3.
const FAST_DOWNSCALE_RATIO: f64 = 4.0;

/// libwebp's speed/size dial, which is NOT a quality dial.
///
/// Measured on 40 real covers at quality 80: method 0 takes 24 ms and averages
/// 131 KB, method 2 takes 44 ms and 119 KB, method 4 takes 99 ms and 115 KB,
/// method 6 takes 203 ms and 111 KB. The encoder searches harder for a smaller
/// file at the SAME quality target, so the picture looks the same either way.
/// Two buys back more than half the encode time for three percent more disk,
/// on the stage that was three quarters of the cost of a cover.
const WEBP_METHOD: i32 = 2;

fn encode(image: &DynamicImage, job: &TransformJob) -> Result<Vec<u8>, String> {
    match job.mime_type.as_str() {
        "image/webp" => {
            let rgba = image.to_rgba8();
            let encoder = webp::Encoder::from_rgba(rgba.as_raw(), rgba.width(), rgba.height());
            // Canvas quality is 0..1, libwebp is 0..100. The default matches
            // IMAGE_PROFILES.fullWebp so a missing value cannot silently mean 0.
            let quality = job.quality.unwrap_or(0.8).clamp(0.0, 1.0) * 100.0;
            let mut config = webp::WebPConfig::new()
                .map_err(|()| "libwebp rejected its own default configuration".to_string())?;
            config.quality = quality;
            config.method = WEBP_METHOD;
            config.alpha_compression = 1;
            Ok(encoder
                .encode_advanced(&config)
                .map_err(|error| format!("webp encode failed: {error:?}"))?
                .to_vec())
        }
        "image/png" => {
            let mut buffer = std::io::Cursor::new(Vec::new());
            image
                .write_to(&mut buffer, image::ImageFormat::Png)
                .map_err(|error| format!("png encode failed: {error}"))?;
            Ok(buffer.into_inner())
        }
        "image/jpeg" => {
            let mut buffer = std::io::Cursor::new(Vec::new());
            let quality = (job.quality.unwrap_or(0.8).clamp(0.0, 1.0) * 100.0).round() as u8;
            let mut encoder =
                image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buffer, quality.max(1));
            encoder
                .encode_image(&image.to_rgb8())
                .map_err(|error| format!("jpeg encode failed: {error}"))?;
            Ok(buffer.into_inner())
        }
        other => Err(format!("unsupported artwork mime type: {other}")),
    }
}

fn run_jobs(image: &DynamicImage, jobs: &[TransformJob]) -> Result<(), String> {
    for job in jobs {
        let rendered = render(image, job);
        let bytes = encode(&rendered, job)?;
        write_file_atomic_impl(Path::new(&job.destination), &bytes)
            .map_err(|error| format!("cannot write {}: {error}", job.destination))?;
    }
    Ok(())
}

/// Transforms an image file into one or more variants.
#[tauri::command]
pub async fn artwork_transform_file(source: String, jobs: Vec<TransformJob>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let image = open_image(&source)?;
        run_jobs(&image, &jobs)
    })
    .await
    .map_err(|error| format!("artwork transform task failed: {error}"))?
}

/// Reads the embedded picture out of an audio file and writes its variants.
///
/// This is the path that matters during a library scan. The alternative is what
/// happens today: the scanner lifts the picture bytes into the renderer, hands
/// them back through `invoke`, and both copies live in the JS heap meanwhile.
/// Here the bytes never leave the native side.
///
/// Returns false when the file simply has no embedded picture, which is a
/// normal answer and not an error.
#[tauri::command]
pub async fn artwork_transform_audio(
    source: String,
    jobs: Vec<TransformJob>,
) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        use lofty::file::TaggedFileExt;
        use lofty::probe::Probe;

        let tagged = Probe::open(Path::new(&source))
            .map_err(|error| format!("cannot open {source}: {error}"))?
            .read()
            .map_err(|error| format!("cannot read tags of {source}: {error}"))?;

        let picture = tagged
            .tags()
            .iter()
            .flat_map(|tag| tag.pictures())
            .find(|picture| !picture.data().is_empty());

        let Some(picture) = picture else {
            return Ok(false);
        };

        let image = image::load_from_memory(picture.data())
            .map_err(|error| format!("cannot decode embedded picture of {source}: {error}"))?;
        run_jobs(&image, &jobs)?;
        Ok(true)
    })
    .await
    .map_err(|error| format!("artwork transform task failed: {error}"))?
}

/// Extracts the six swatches for `palettes.json`.
#[tauri::command]
pub async fn artwork_palette(source: String) -> Result<Palette, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let image = open_image(&source)?;
        Ok(palette_of(&image))
    })
    .await
    .map_err(|error| format!("palette task failed: {error}"))?
}

// ---------------------------------------------------------------------------
// Palette extraction
//
// A reimplementation of what node-vibrant produces, not a port of how it gets
// there. The renderer reads these swatches to tint the interface, so the shape
// and the names are fixed; the selection rule is the same idea as Vibrant's:
// quantise the image, then score every candidate against a target lightness and
// saturation, weighting population so a colour nobody can see does not win.
// ---------------------------------------------------------------------------

const SAMPLE_EDGE: u32 = 128;
const QUANT_BITS: u32 = 5;

struct Bucket {
    r: u64,
    g: u64,
    b: u64,
    count: u32,
}

fn quantise(image: &DynamicImage) -> Vec<([f64; 3], u32)> {
    let small: RgbImage = image
        .resize(SAMPLE_EDGE, SAMPLE_EDGE, FilterType::Triangle)
        .to_rgb8();

    let shift = 8 - QUANT_BITS;
    let side = 1u32 << QUANT_BITS;
    let mut buckets: std::collections::HashMap<u32, Bucket> = std::collections::HashMap::new();

    for pixel in small.pixels() {
        let [r, g, b] = pixel.0;
        // Near-white and near-black carry no hue worth tinting with, and they
        // dominate letterboxed covers.
        let max = r.max(g).max(b) as u32;
        let min = r.min(g).min(b) as u32;
        if max >= 250 && min >= 250 {
            continue;
        }
        if max <= 8 {
            continue;
        }

        let key = ((r as u32 >> shift) * side + (g as u32 >> shift)) * side + (b as u32 >> shift);
        let entry = buckets.entry(key).or_insert(Bucket {
            r: 0,
            g: 0,
            b: 0,
            count: 0,
        });
        entry.r += r as u64;
        entry.g += g as u64;
        entry.b += b as u64;
        entry.count += 1;
    }

    let mut swatches: Vec<([f64; 3], u32)> = buckets
        .into_values()
        .map(|bucket| {
            let count = bucket.count.max(1) as f64;
            (
                [
                    bucket.r as f64 / count,
                    bucket.g as f64 / count,
                    bucket.b as f64 / count,
                ],
                bucket.count,
            )
        })
        .collect();
    // Most populous first, so the truncation below keeps the dominant colours.
    swatches.sort_by_key(|(_, count)| std::cmp::Reverse(*count));
    swatches.truncate(256);
    swatches
}

fn rgb_to_hsl(rgb: [f64; 3]) -> [f64; 3] {
    let (r, g, b) = (rgb[0] / 255.0, rgb[1] / 255.0, rgb[2] / 255.0);
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let lightness = (max + min) / 2.0;
    let delta = max - min;

    if delta.abs() < f64::EPSILON {
        return [0.0, 0.0, lightness];
    }

    let saturation = if lightness > 0.5 {
        delta / (2.0 - max - min)
    } else {
        delta / (max + min)
    };

    let hue = if (max - r).abs() < f64::EPSILON {
        ((g - b) / delta) % 6.0
    } else if (max - g).abs() < f64::EPSILON {
        (b - r) / delta + 2.0
    } else {
        (r - g) / delta + 4.0
    };

    let hue = (hue * 60.0 + 360.0) % 360.0;
    [hue / 360.0, saturation, lightness]
}

fn to_hex(rgb: [f64; 3]) -> String {
    format!(
        "#{:02x}{:02x}{:02x}",
        rgb[0].round().clamp(0.0, 255.0) as u8,
        rgb[1].round().clamp(0.0, 255.0) as u8,
        rgb[2].round().clamp(0.0, 255.0) as u8
    )
}

/// Vibrant's weighting: distance from the target matters more than population,
/// and population is normalised so one huge flat background cannot take every
/// slot.
fn score(hsl: [f64; 3], population: u32, max_population: u32, target: (f64, f64)) -> f64 {
    let (target_saturation, target_lightness) = target;
    let saturation_weight = 1.0 - (hsl[1] - target_saturation).abs();
    let lightness_weight = 1.0 - (hsl[2] - target_lightness).abs();
    let population_weight = population as f64 / max_population.max(1) as f64;
    saturation_weight * 3.0 + lightness_weight * 6.0 + population_weight * 1.0
}

fn pick(
    candidates: &[([f64; 3], u32)],
    max_population: u32,
    target: (f64, f64),
    bounds: (f64, f64, f64, f64),
    used: &mut Vec<[f64; 3]>,
) -> Option<Swatch> {
    let (min_saturation, max_saturation, min_lightness, max_lightness) = bounds;

    let mut best: Option<(f64, [f64; 3], [f64; 3], u32)> = None;
    for (rgb, population) in candidates {
        let hsl = rgb_to_hsl(*rgb);
        if hsl[1] < min_saturation || hsl[1] > max_saturation {
            continue;
        }
        if hsl[2] < min_lightness || hsl[2] > max_lightness {
            continue;
        }
        if used.iter().any(|taken| taken == rgb) {
            continue;
        }
        let value = score(hsl, *population, max_population, target);
        if best.as_ref().is_none_or(|(current, ..)| value > *current) {
            best = Some((value, *rgb, hsl, *population));
        }
    }

    best.map(|(_, rgb, hsl, population)| {
        used.push(rgb);
        Swatch {
            hex: to_hex(rgb),
            hsl,
            population,
        }
    })
}

fn palette_of(image: &DynamicImage) -> Palette {
    let candidates = quantise(image);
    if candidates.is_empty() {
        return Palette::default();
    }
    let max_population = candidates
        .iter()
        .map(|(_, count)| *count)
        .max()
        .unwrap_or(1);
    let mut used: Vec<[f64; 3]> = Vec::new();

    // Targets and bounds mirror node-vibrant's defaults: saturation, lightness.
    Palette {
        vibrant: pick(
            &candidates,
            max_population,
            (1.0, 0.5),
            (0.35, 1.0, 0.3, 0.7),
            &mut used,
        ),
        light_vibrant: pick(
            &candidates,
            max_population,
            (1.0, 0.74),
            (0.35, 1.0, 0.55, 1.0),
            &mut used,
        ),
        dark_vibrant: pick(
            &candidates,
            max_population,
            (1.0, 0.26),
            (0.35, 1.0, 0.0, 0.45),
            &mut used,
        ),
        muted: pick(
            &candidates,
            max_population,
            (0.3, 0.5),
            (0.0, 0.4, 0.3, 0.7),
            &mut used,
        ),
        light_muted: pick(
            &candidates,
            max_population,
            (0.3, 0.74),
            (0.0, 0.4, 0.55, 1.0),
            &mut used,
        ),
        dark_muted: pick(
            &candidates,
            max_population,
            (0.3, 0.26),
            (0.0, 0.4, 0.0, 0.45),
            &mut used,
        ),
    }
}

#[cfg(test)]
mod bench {
    //! Where the time in a cover actually goes.
    //!
    //! Ignored by default: it needs a real music folder and it measures rather
    //! than asserts. Run it deliberately when changing the pipeline:
    //!
    //! ```text
    //! cargo test artwork::bench -- --ignored --nocapture
    //! ```
    //!
    //! `NEMORA_BENCH_MUSIC` points it at a folder of audio files.
    use super::*;
    use std::time::Instant;

    fn embedded_pictures(limit: usize) -> Vec<Vec<u8>> {
        use lofty::file::TaggedFileExt;
        use lofty::probe::Probe;

        let Ok(folder) = std::env::var("NEMORA_BENCH_MUSIC") else {
            return Vec::new();
        };
        let Ok(entries) = std::fs::read_dir(folder) else {
            return Vec::new();
        };

        let mut pictures = Vec::new();
        for entry in entries.flatten() {
            if pictures.len() >= limit {
                break;
            }
            let Ok(tagged) = Probe::open(entry.path()).and_then(|probe| probe.read()) else {
                continue;
            };
            if let Some(picture) = tagged
                .tags()
                .iter()
                .flat_map(|tag| tag.pictures())
                .find(|picture| !picture.data().is_empty())
            {
                pictures.push(picture.data().to_vec());
            }
        }
        pictures
    }

    #[test]
    #[ignore]
    fn measures_each_stage_of_a_cover() {
        let pictures = embedded_pictures(60);
        if pictures.is_empty() {
            println!("set NEMORA_BENCH_MUSIC to a folder of audio files");
            return;
        }

        let mut decoded = Vec::new();
        let start = Instant::now();
        for bytes in &pictures {
            if let Ok(image) = image::load_from_memory(bytes) {
                decoded.push(image);
            }
        }
        let decode = start.elapsed();

        let full = job("image/webp", Some(0.8), None);
        let start = Instant::now();
        let mut full_bytes = 0usize;
        for image in &decoded {
            full_bytes += encode(image, &full).unwrap().len();
        }
        let encode_full = start.elapsed();

        let thumb = job("image/webp", Some(0.5), Some((50, 50)));
        let start = Instant::now();
        let lanczos: Vec<DynamicImage> =
            decoded.iter().map(|image| render(image, &thumb)).collect();
        let resize_lanczos = start.elapsed();

        let start = Instant::now();
        let triangle: Vec<DynamicImage> = decoded
            .iter()
            .map(|image| {
                let rect = cover_rect(
                    image.dimensions(),
                    OutputSize {
                        width: 50,
                        height: 50,
                    },
                );
                image
                    .crop_imm(
                        rect.x.round() as u32,
                        rect.y.round() as u32,
                        rect.width.round() as u32,
                        rect.height.round() as u32,
                    )
                    .resize_exact(50, 50, FilterType::Triangle)
            })
            .collect();
        let resize_triangle = start.elapsed();

        let start = Instant::now();
        let thumbnails: Vec<DynamicImage> = decoded
            .iter()
            .map(|image| {
                let rect = cover_rect(
                    image.dimensions(),
                    OutputSize {
                        width: 50,
                        height: 50,
                    },
                );
                image
                    .crop_imm(
                        rect.x.round() as u32,
                        rect.y.round() as u32,
                        rect.width.round() as u32,
                        rect.height.round() as u32,
                    )
                    .thumbnail_exact(50, 50)
            })
            .collect();
        let resize_thumbnail = start.elapsed();

        let start = Instant::now();
        for image in &lanczos {
            encode(image, &thumb).unwrap();
        }
        let encode_thumb = start.elapsed();

        let count = decoded.len() as u32;
        let dimensions: Vec<String> = decoded
            .iter()
            .take(3)
            .map(|image| format!("{}x{}", image.width(), image.height()))
            .collect();

        println!("covers: {count}  first sizes: {dimensions:?}");
        println!("decode          {:>8.1} ms/cover", ms(decode, count));
        println!("encode full     {:>8.1} ms/cover", ms(encode_full, count));
        println!(
            "resize lanczos3 {:>8.1} ms/cover",
            ms(resize_lanczos, count)
        );
        println!(
            "resize triangle {:>8.1} ms/cover",
            ms(resize_triangle, count)
        );
        println!(
            "resize thumbnail{:>8.1} ms/cover",
            ms(resize_thumbnail, count)
        );
        println!("encode 50x50    {:>8.1} ms/cover", ms(encode_thumb, count));
        println!("full webp average {} KB", full_bytes / decoded.len() / 1024);
        assert_eq!(triangle.len(), lanczos.len());
        assert_eq!(thumbnails.len(), lanczos.len());
    }

    /// The whole cover as the scan actually produces it: decode, then both
    /// stored variants, exactly as `run_jobs` does it.
    #[test]
    #[ignore]
    fn measures_a_whole_cover_end_to_end() {
        let pictures = embedded_pictures(60);
        if pictures.is_empty() {
            println!("set NEMORA_BENCH_MUSIC to a folder of audio files");
            return;
        }

        let directory = std::env::temp_dir().join("nemora-bench-covers");
        std::fs::create_dir_all(&directory).unwrap();
        let full_path = directory.join("full.webp");
        let thumb_path = directory.join("thumb.webp");

        let mut jobs = vec![
            job("image/webp", Some(0.8), None),
            job("image/webp", Some(0.5), Some((50, 50))),
        ];
        jobs[0].destination = full_path.to_string_lossy().to_string();
        jobs[1].destination = thumb_path.to_string_lossy().to_string();

        let start = Instant::now();
        let mut produced = 0u32;
        for bytes in &pictures {
            let Ok(image) = image::load_from_memory(bytes) else {
                continue;
            };
            run_jobs(&image, &jobs).unwrap();
            produced += 1;
        }
        let elapsed = start.elapsed();

        println!(
            "whole cover  {:>8.1} ms  ({produced} covers, {:.1} s for 300)",
            ms(elapsed, produced),
            ms(elapsed, produced) * 300.0 / 1000.0
        );
        let _ = std::fs::remove_dir_all(&directory);
    }

    /// Splits the cost of a cover into "reaching the picture" and "converting it".
    ///
    /// The app measures 42 ms per track with seven workers where the arithmetic
    /// predicted 9; this says which half the missing time is in. Reading the
    /// picture means opening the audio file and letting lofty parse its tag,
    /// which for a FLAC with a 3 MB cover is a multi-megabyte read - per cover,
    /// every time, because the point of the native route is that the bytes never
    /// leave the file.
    #[test]
    #[ignore]
    fn measures_reaching_the_picture_against_converting_it() {
        use lofty::file::TaggedFileExt;
        use lofty::probe::Probe;

        let Ok(folder) = std::env::var("NEMORA_BENCH_MUSIC") else {
            println!("set NEMORA_BENCH_MUSIC to a folder of audio files");
            return;
        };
        let Ok(entries) = std::fs::read_dir(&folder) else { return };
        let files: Vec<std::path::PathBuf> = entries
            .flatten()
            .map(|entry| entry.path())
            .filter(|path| path.is_file())
            .take(60)
            .collect();

        let directory = std::env::temp_dir().join("nemora-bench-whole");
        std::fs::create_dir_all(&directory).unwrap();
        let mut jobs = vec![
            job("image/webp", Some(0.8), None),
            job("image/webp", Some(0.5), Some((50, 50))),
        ];
        jobs[0].destination = directory.join("full.webp").to_string_lossy().to_string();
        jobs[1].destination = directory.join("thumb.webp").to_string_lossy().to_string();

        let mut reach = std::time::Duration::ZERO;
        let mut convert = std::time::Duration::ZERO;
        let mut bytes = 0usize;
        let mut counted = 0u32;

        for path in &files {
            let start = Instant::now();
            let Ok(tagged) = Probe::open(path).and_then(|probe| probe.read()) else {
                continue;
            };
            let picture = tagged
                .tags()
                .iter()
                .flat_map(|tag| tag.pictures())
                .find(|picture| !picture.data().is_empty());
            let Some(picture) = picture else { continue };
            let data = picture.data().to_vec();
            reach += start.elapsed();
            bytes += data.len();

            let start = Instant::now();
            let Ok(image) = image::load_from_memory(&data) else { continue };
            run_jobs(&image, &jobs).unwrap();
            convert += start.elapsed();
            counted += 1;
        }

        println!("covers: {counted}");
        println!(
            "reaching the picture {:>8.1} ms/cover  ({} KB average picture)",
            ms(reach, counted),
            bytes / counted.max(1) as usize / 1024
        );
        println!("converting it        {:>8.1} ms/cover", ms(convert, counted));
        println!(
            "total                {:>8.1} ms/cover",
            ms(reach + convert, counted)
        );
        let _ = std::fs::remove_dir_all(&directory);
    }

    /// Same measurement for the libwebp effort knob, which trades size for time.
    #[test]
    #[ignore]
    fn measures_webp_encoding_effort() {
        let pictures = embedded_pictures(40);
        if pictures.is_empty() {
            println!("set NEMORA_BENCH_MUSIC to a folder of audio files");
            return;
        }
        let decoded: Vec<DynamicImage> = pictures
            .iter()
            .filter_map(|bytes| image::load_from_memory(bytes).ok())
            .collect();

        for method in [0, 2, 4, 6] {
            let start = Instant::now();
            let mut total = 0usize;
            for image in &decoded {
                let rgba = image.to_rgba8();
                let encoder = webp::Encoder::from_rgba(rgba.as_raw(), rgba.width(), rgba.height());
                let mut config = webp::WebPConfig::new().unwrap();
                config.quality = 80.0;
                config.method = method;
                total += encoder.encode_advanced(&config).unwrap().len();
            }
            let elapsed = start.elapsed();
            println!(
                "method {method}: {:>8.1} ms/cover, {} KB average",
                ms(elapsed, decoded.len() as u32),
                total / decoded.len() / 1024
            );
        }
    }

    fn ms(duration: std::time::Duration, count: u32) -> f64 {
        duration.as_secs_f64() * 1000.0 / f64::from(count.max(1))
    }

    fn job(mime: &str, quality: Option<f32>, resize: Option<(u32, u32)>) -> TransformJob {
        TransformJob {
            destination: String::new(),
            mime_type: mime.into(),
            quality,
            resize: resize.map(|(width, height)| OutputSize { width, height }),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgb, RgbImage};

    fn solid(width: u32, height: u32, colour: [u8; 3]) -> DynamicImage {
        let mut buffer = RgbImage::new(width, height);
        for pixel in buffer.pixels_mut() {
            *pixel = Rgb(colour);
        }
        DynamicImage::ImageRgb8(buffer)
    }

    fn job(mime: &str, quality: Option<f32>, resize: Option<(u32, u32)>) -> TransformJob {
        TransformJob {
            destination: String::new(),
            mime_type: mime.into(),
            quality,
            resize: resize.map(|(width, height)| OutputSize { width, height }),
        }
    }

    /// The same vectors the TypeScript suite asserts, so the duplicated rule
    /// cannot drift silently in either direction.
    #[test]
    fn cover_geometry_matches_the_typescript_vectors() {
        // 3840x3840 -> the 50px optimized profile: square in, square out, no crop.
        let square = cover_rect(
            (3840, 3840),
            OutputSize {
                width: 50,
                height: 50,
            },
        );
        assert!((square.x - 0.0).abs() < 1e-9);
        assert!((square.y - 0.0).abs() < 1e-9);
        assert!((square.width - 3840.0).abs() < 1e-9);

        // A wide source is cropped to a centred square, never squashed.
        let wide = cover_rect(
            (200, 100),
            OutputSize {
                width: 50,
                height: 50,
            },
        );
        assert!((wide.width - 100.0).abs() < 1e-9);
        assert!((wide.height - 100.0).abs() < 1e-9);
        assert!((wide.x - 50.0).abs() < 1e-9);
        assert!((wide.y - 0.0).abs() < 1e-9);
    }

    #[test]
    fn a_profile_without_resize_keeps_the_source_dimensions() {
        // IMAGE_PROFILES.png on the 947x621 fixture the TypeScript test uses.
        let image = solid(947, 621, [10, 120, 200]);
        let rendered = render(&image, &job("image/png", None, None));
        assert_eq!(rendered.dimensions(), (947, 621));
    }

    #[test]
    fn crops_a_wide_cover_to_a_centred_square() {
        let image = solid(200, 100, [10, 120, 200]);
        let rendered = render(&image, &job("image/webp", Some(0.8), Some((50, 50))));
        assert_eq!(rendered.dimensions(), (50, 50));
    }

    /// Both filters must agree on a flat image; only their cost differs.
    ///
    /// This is what makes the ratio switch safe to have at all: the cheap
    /// filter is used where each output pixel averages hundreds of source
    /// pixels, and a wrong turn there would show up as a shifted or discoloured
    /// list icon rather than as a failure anywhere else.
    #[test]
    fn both_downscale_filters_agree_on_the_colour_they_produce() {
        let image = solid(1200, 1200, [40, 90, 160]);

        // 24-fold reduction: the cheap filter.
        let icon = render(&image, &job("image/webp", Some(0.5), Some((50, 50))));
        // 3-fold reduction: Lanczos3, because this one is displayed large.
        let tile = render(&image, &job("image/webp", Some(0.8), Some((400, 400))));

        assert_eq!(icon.dimensions(), (50, 50));
        assert_eq!(tile.dimensions(), (400, 400));
        let icon_pixel = icon.to_rgb8().get_pixel(25, 25).0;
        let tile_pixel = tile.to_rgb8().get_pixel(200, 200).0;
        for channel in 0..3 {
            assert!(
                icon_pixel[channel].abs_diff(tile_pixel[channel]) <= 1,
                "filters disagree: {icon_pixel:?} vs {tile_pixel:?}"
            );
        }
    }

    #[test]
    fn clamps_a_rectangle_that_rounds_past_the_edge() {
        let image = solid(31, 31, [200, 30, 30]);
        let rendered = render(&image, &job("image/png", None, Some((16, 16))));
        assert_eq!(rendered.dimensions(), (16, 16));
    }

    #[test]
    fn encodes_every_supported_mime_and_refuses_the_rest() {
        let image = solid(8, 8, [90, 90, 90]);
        for mime in ["image/webp", "image/png", "image/jpeg"] {
            let encoded = encode(&image, &job(mime, Some(0.8), None)).unwrap();
            assert!(!encoded.is_empty(), "{mime} produced nothing");
        }

        assert!(encode(&image, &job("image/gif", None, None)).is_err());
    }

    #[test]
    fn hsl_matches_the_shape_the_renderer_expects() {
        let hsl = rgb_to_hsl([255.0, 0.0, 0.0]);
        assert!((hsl[0] - 0.0).abs() < 1e-9, "hue");
        assert!((hsl[1] - 1.0).abs() < 1e-9, "saturation");
        assert!((hsl[2] - 0.5).abs() < 1e-9, "lightness");
        assert_eq!(to_hex([255.0, 0.0, 0.0]), "#ff0000");
    }

    #[test]
    fn a_vivid_cover_yields_a_vibrant_swatch() {
        let image = solid(64, 64, [220, 40, 60]);
        let palette = palette_of(&image);
        let vibrant = palette
            .vibrant
            .expect("a saturated image has a vibrant swatch");
        assert!(vibrant.population > 0);
        assert!(vibrant.hex.starts_with('#'));
    }

    #[test]
    fn a_blank_white_cover_yields_no_swatches_rather_than_grey_ones() {
        let image = solid(64, 64, [255, 255, 255]);
        let palette = palette_of(&image);
        assert!(palette.vibrant.is_none());
        assert!(palette.muted.is_none());
    }
}

#[cfg(test)]
mod real_cover_tests {
    use super::*;

    /// Runs the pipeline over a cover from the real profile when one is present.
    ///
    /// Skipped rather than failed on a machine without that profile: a test that
    /// depends on one developer's disk is how `safeStorage.test.ts` once broke
    /// CI for twelve tests that needed no fixture at all.
    #[test]
    fn transforms_a_real_cover_into_the_three_stored_variants() {
        let Ok(appdata) = std::env::var("APPDATA") else {
            return;
        };
        let covers = Path::new(&appdata).join("Nora").join("song_covers");
        let Ok(entries) = std::fs::read_dir(&covers) else {
            return;
        };

        let Some(source) = entries.flatten().map(|entry| entry.path()).find(|path| {
            path.extension().is_some_and(|ext| ext == "webp")
                && !path.to_string_lossy().contains("-optimized")
                && !path.to_string_lossy().contains("-tl")
        }) else {
            return;
        };

        let image = open_image(&source.to_string_lossy()).expect("a stored cover decodes");
        let temp = std::env::temp_dir().join("nemora-artwork-check");
        std::fs::create_dir_all(&temp).expect("temp dir");

        for (name, mime, quality, resize) in [
            ("full.webp", "image/webp", Some(0.8), None),
            ("optimized.webp", "image/webp", Some(0.5), Some((50, 50))),
            ("tl.webp", "image/webp", Some(0.8), Some((400, 400))),
        ] {
            let destination = temp.join(name);
            let job = TransformJob {
                destination: destination.to_string_lossy().to_string(),
                mime_type: mime.into(),
                quality,
                resize: resize.map(|(width, height)| OutputSize { width, height }),
            };
            run_jobs(&image, std::slice::from_ref(&job)).expect("variant written");

            let written = image::open(&destination).expect("the variant decodes again");
            if let Some((width, height)) = resize {
                assert_eq!(written.dimensions(), (width, height), "{name}");
            }
            assert!(
                std::fs::metadata(&destination).unwrap().len() > 0,
                "{name} is empty"
            );
        }

        let palette = palette_of(&image);
        assert!(
            palette.vibrant.is_some() || palette.muted.is_some() || palette.dark_muted.is_some(),
            "a real cover yields at least one swatch"
        );
    }
}

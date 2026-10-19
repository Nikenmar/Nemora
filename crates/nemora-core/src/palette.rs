//! Cover colour palettes: the six swatches the view tints genre cards, home cards and the dynamic
//! theme with. The algorithm is 1.x's (`src-tauri/src/artwork.rs`), so a cover gets the colours it
//! had there: quantise the picture, then score every candidate against a target lightness and
//! saturation, weighting population so a colour nobody can see does not win.
//!
//! A palette is computed once per cover from its stored thumbnail and kept as JSON in
//! `covers.palette`, in the shape node-vibrant gives and the view reads.

use std::collections::HashMap;

use image::imageops::FilterType;
use image::{DynamicImage, RgbImage};
use rayon::prelude::*;
use rusqlite::params;
use serde::Serialize;

use crate::covers::{CoverStore, THUMB_SIZES};
use crate::db::Db;
use crate::error::Result;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Swatch {
    pub hex: String,
    /// `[hue 0..1, saturation 0..1, lightness 0..1]`, rounded to three places as 1.x stored it.
    pub hsl: [f64; 3],
    pub population: u32,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "PascalCase")]
pub struct Palette {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vibrant: Option<Swatch>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dark_vibrant: Option<Swatch>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub light_vibrant: Option<Swatch>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub muted: Option<Swatch>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dark_muted: Option<Swatch>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub light_muted: Option<Swatch>,
}

/// What 1.x gave a song without a cover.
pub const DEFAULT_PALETTE: &str = r##"{"paletteId":"DEFAULT_PALETTE","DarkMuted":{"hex":"#104888","hsl":[0.589,0.789,0.3],"population":0},"DarkVibrant":{"hex":"#0d3e76","hsl":[0.589,0.789,0.26],"population":0},"LightMuted":{"hex":"#154383","hsl":[0.597,0.716,0.3],"population":0},"LightVibrant":{"hex":"#8cb4ec","hsl":[0.597,0.716,0.737],"population":8},"Muted":{"hex":"#104888","hsl":[0.589,0.789,0.3],"population":0},"Vibrant":{"hex":"#3c8ce8","hsl":[0.589,0.789,0.576],"population":2}}"##;

/// Computes the palettes of every cover that has none yet. The pictures are decoded outside the
/// writer: `read` lists the work, `write` stores the results in one go. A cover whose thumbnail
/// cannot be read gets an empty palette, so it is not retried on every scan.
pub fn fill_missing(
    store: &CoverStore,
    read: impl FnOnce() -> Result<Vec<String>>,
    write: impl FnOnce(&[(String, String)]) -> Result<()>,
) -> Result<usize> {
    let hashes = read()?;
    if hashes.is_empty() {
        return Ok(0);
    }
    let palettes: Vec<(String, String)> = hashes
        .into_par_iter()
        .map(|hash| {
            let json = image::open(store.thumbnail_path(&hash, THUMB_SIZES[1]))
                .map(|image| to_json(&hash, &palette_of(&image)))
                .unwrap_or_else(|_| "{}".to_owned());
            (hash, json)
        })
        .collect();
    write(&palettes)?;
    Ok(palettes.len())
}

pub fn covers_without_palette(db: &Db) -> Result<Vec<String>> {
    let mut stmt = db.conn().prepare("SELECT cover_hash FROM covers WHERE palette IS NULL")?;
    Ok(stmt.query_map([], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?)
}

pub fn store_palettes(db: &mut Db, palettes: &[(String, String)]) -> Result<()> {
    let tx = db.conn_mut().transaction()?;
    {
        let mut stmt = tx.prepare("UPDATE covers SET palette = ?2 WHERE cover_hash = ?1")?;
        for (hash, json) in palettes {
            stmt.execute(params![hash, json])?;
        }
    }
    tx.commit()?;
    Ok(())
}

/// The view's `PaletteData`: the swatches plus an id, which is the cover's hash.
fn to_json(hash: &str, palette: &Palette) -> String {
    let mut value = serde_json::to_value(palette).unwrap_or_default();
    value["paletteId"] = hash.into();
    value.to_string()
}

// The 1.x extraction, unchanged in its constants.

const SAMPLE_EDGE: u32 = 128;
const QUANT_BITS: u32 = 5;

struct Bucket {
    r: u64,
    g: u64,
    b: u64,
    count: u32,
}

fn quantise(image: &DynamicImage) -> Vec<([f64; 3], u32)> {
    let small: RgbImage = image.resize(SAMPLE_EDGE, SAMPLE_EDGE, FilterType::Triangle).to_rgb8();

    let shift = 8 - QUANT_BITS;
    let side = 1u32 << QUANT_BITS;
    let mut buckets: HashMap<u32, Bucket> = HashMap::new();

    for pixel in small.pixels() {
        let [r, g, b] = pixel.0;
        // Near-white and near-black carry no hue worth tinting with, and they dominate
        // letterboxed covers.
        let max = r.max(g).max(b) as u32;
        let min = r.min(g).min(b) as u32;
        if (max >= 250 && min >= 250) || max <= 8 {
            continue;
        }
        let key = ((r as u32 >> shift) * side + (g as u32 >> shift)) * side + (b as u32 >> shift);
        let entry = buckets.entry(key).or_insert(Bucket { r: 0, g: 0, b: 0, count: 0 });
        entry.r += r as u64;
        entry.g += g as u64;
        entry.b += b as u64;
        entry.count += 1;
    }

    let mut swatches: Vec<([f64; 3], u32)> = buckets
        .into_values()
        .map(|bucket| {
            let count = bucket.count.max(1) as f64;
            ([bucket.r as f64 / count, bucket.g as f64 / count, bucket.b as f64 / count], bucket.count)
        })
        .collect();
    // Most populous first, so the truncation below keeps the dominant colours. Ties by colour, so
    // the result does not depend on the hash map's order.
    swatches.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal)));
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
    let saturation = if lightness > 0.5 { delta / (2.0 - max - min) } else { delta / (max + min) };
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
    let byte = |v: f64| v.round().clamp(0.0, 255.0) as u8;
    format!("#{:02x}{:02x}{:02x}", byte(rgb[0]), byte(rgb[1]), byte(rgb[2]))
}

fn round3(v: f64) -> f64 {
    (v * 1000.0).round() / 1000.0
}

/// Distance from the target matters more than population, and population is normalised so one
/// huge flat background cannot take every slot.
fn score(hsl: [f64; 3], population: u32, max_population: u32, target: (f64, f64)) -> f64 {
    let (target_saturation, target_lightness) = target;
    let saturation_weight = 1.0 - (hsl[1] - target_saturation).abs();
    let lightness_weight = 1.0 - (hsl[2] - target_lightness).abs();
    let population_weight = population as f64 / max_population.max(1) as f64;
    saturation_weight * 3.0 + lightness_weight * 6.0 + population_weight
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
        if hsl[1] < min_saturation || hsl[1] > max_saturation || hsl[2] < min_lightness || hsl[2] > max_lightness {
            continue;
        }
        if used.contains(rgb) {
            continue;
        }
        let value = score(hsl, *population, max_population, target);
        if best.as_ref().is_none_or(|(current, ..)| value > *current) {
            best = Some((value, *rgb, hsl, *population));
        }
    }
    best.map(|(_, rgb, hsl, population)| {
        used.push(rgb);
        Swatch { hex: to_hex(rgb), hsl: hsl.map(round3), population }
    })
}

pub fn palette_of(image: &DynamicImage) -> Palette {
    let candidates = quantise(image);
    let Some(max_population) = candidates.iter().map(|(_, count)| *count).max() else {
        return Palette::default();
    };
    let mut used = Vec::new();
    let mut pick = |target, bounds| pick(&candidates, max_population, target, bounds, &mut used);
    // Targets (saturation, lightness) and bounds mirror node-vibrant's defaults, in 1.x's order.
    let mut palette = Palette {
        vibrant: pick((1.0, 0.5), (0.35, 1.0, 0.3, 0.7)),
        light_vibrant: pick((1.0, 0.74), (0.35, 1.0, 0.55, 1.0)),
        dark_vibrant: pick((1.0, 0.26), (0.35, 1.0, 0.0, 0.45)),
        muted: pick((0.3, 0.5), (0.0, 0.4, 0.3, 0.7)),
        light_muted: pick((0.3, 0.74), (0.0, 0.4, 0.55, 1.0)),
        dark_muted: pick((0.3, 0.26), (0.0, 0.4, 0.0, 0.45)),
    };
    fill_empty(&mut palette);
    palette
}

/// node-vibrant's `_generateEmptySwatches`, which 1.x's palettes of embedded covers went through:
/// a slot no colour qualified for is derived from a neighbour at the slot's lightness. Kept as
/// node-vibrant has it, including the light-muted case that fills the dark vibrant slot and the
/// muted slots taking the muted saturation target as their lightness.
fn fill_empty(p: &mut Palette) {
    const DARK: f64 = 0.26;
    const NORMAL: f64 = 0.5;
    const LIGHT: f64 = 0.74;
    const MUTES_SATURATION: f64 = 0.3;
    let at = |from: &Option<Swatch>, lightness: f64| {
        from.as_ref().map(|s| {
            let rgb = hsl_to_rgb([s.hsl[0], s.hsl[1], lightness]);
            Swatch { hex: to_hex(rgb), hsl: rgb_to_hsl(rgb).map(round3), population: 0 }
        })
    };

    if p.vibrant.is_none() && p.dark_vibrant.is_none() && p.light_vibrant.is_none() {
        if p.dark_muted.is_some() {
            p.dark_vibrant = at(&p.dark_muted, DARK);
        }
        if p.light_muted.is_some() {
            p.dark_vibrant = at(&p.light_muted, DARK);
        }
    }
    if p.vibrant.is_none() {
        p.vibrant = if p.dark_vibrant.is_some() { at(&p.dark_vibrant, NORMAL) } else { at(&p.light_vibrant, NORMAL) };
    }
    if p.dark_vibrant.is_none() {
        p.dark_vibrant = at(&p.vibrant, DARK);
    }
    if p.light_vibrant.is_none() {
        p.light_vibrant = at(&p.vibrant, LIGHT);
    }
    if p.muted.is_none() {
        p.muted = at(&p.vibrant, MUTES_SATURATION);
    }
    if p.dark_muted.is_none() {
        p.dark_muted = at(&p.dark_vibrant, MUTES_SATURATION);
    }
    if p.light_muted.is_none() {
        p.light_muted = at(&p.light_vibrant, MUTES_SATURATION);
    }
}

fn hsl_to_rgb([h, s, l]: [f64; 3]) -> [f64; 3] {
    if s == 0.0 {
        return [l * 255.0; 3];
    }
    let hue = |p: f64, q: f64, mut t: f64| {
        if t < 0.0 {
            t += 1.0;
        }
        if t > 1.0 {
            t -= 1.0;
        }
        if t < 1.0 / 6.0 {
            p + (q - p) * 6.0 * t
        } else if t < 0.5 {
            q
        } else if t < 2.0 / 3.0 {
            p + (q - p) * (2.0 / 3.0 - t) * 6.0
        } else {
            p
        }
    };
    let q = if l < 0.5 { l * (1.0 + s) } else { l + s - l * s };
    let p = 2.0 * l - q;
    [hue(p, q, h + 1.0 / 3.0) * 255.0, hue(p, q, h) * 255.0, hue(p, q, h - 1.0 / 3.0) * 255.0]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_dark_blue_cover_gets_a_dark_blue_dark_vibrant() {
        let image = DynamicImage::ImageRgb8(RgbImage::from_fn(64, 64, |x, _| {
            if x < 40 { image::Rgb([20, 40, 120]) } else { image::Rgb([230, 120, 40]) }
        }));
        let palette = palette_of(&image);
        let dark = palette.dark_vibrant.as_ref().expect("a dark vibrant swatch");
        assert_eq!(dark.hex, "#142878");
        assert!((dark.hsl[0] - 0.63).abs() < 0.01, "{:?}", dark.hsl);
        assert_eq!(palette.vibrant.as_ref().expect("a vibrant swatch").hex, "#e67828");

        let json: serde_json::Value = serde_json::from_str(&to_json("abc", &palette)).unwrap();
        assert_eq!(json["paletteId"], "abc");
        assert_eq!(json["DarkVibrant"]["hex"], "#142878");
    }

    #[test]
    fn a_grey_cover_still_gets_every_slot_as_in_node_vibrant() {
        // Low saturation only: no vibrant colour qualifies, so they are derived from the muted ones.
        let image = DynamicImage::ImageRgb8(RgbImage::from_fn(64, 64, |x, _| {
            if x < 32 { image::Rgb([60, 66, 72]) } else { image::Rgb([170, 176, 180]) }
        }));
        let palette = palette_of(&image);
        let dark = palette.dark_vibrant.as_ref().expect("a derived dark vibrant swatch");
        assert_eq!(dark.population, 0);
        assert!((dark.hsl[2] - 0.26).abs() < 0.01, "{:?}", dark.hsl);
        assert!(palette.vibrant.is_some() && palette.light_vibrant.is_some());
        assert!(palette.muted.is_some() && palette.light_muted.is_some() && palette.dark_muted.is_some());
    }

    #[test]
    fn hsl_round_trips() {
        for rgb in [[20.0, 40.0, 120.0], [230.0, 120.0, 40.0], [90.0, 90.0, 90.0]] {
            let back = hsl_to_rgb(rgb_to_hsl(rgb));
            assert!(rgb.iter().zip(back).all(|(a, b)| (a - b).abs() < 1e-9), "{rgb:?} {back:?}");
        }
    }

    #[test]
    fn a_blank_cover_has_no_swatches() {
        let image = DynamicImage::ImageRgb8(RgbImage::from_pixel(16, 16, image::Rgb([255, 255, 255])));
        assert_eq!(palette_of(&image), Palette::default());
    }

    #[test]
    fn the_default_palette_is_valid_json() {
        let value: serde_json::Value = serde_json::from_str(DEFAULT_PALETTE).unwrap();
        assert_eq!(value["DarkVibrant"]["hex"], "#0d3e76");
    }
}

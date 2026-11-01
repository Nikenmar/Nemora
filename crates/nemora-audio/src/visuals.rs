//! A track's visual envelope: what the view draws in time with the music (PLAN/14 B0).
//!
//! One background pass over the decoded file, never the output path: the real-time callback and
//! its bit-transparency are untouched. For every 1/30 s the envelope holds the loudness (RMS of the
//! mono mix in dBFS) and the energy of 12 log-spaced bands from 40 Hz to 16 kHz, each quantised to
//! a byte. The view reads the frame for the player's position, so it is in sync by construction and
//! works while paused.
//!
//! Layout: 4 header bytes (format version, frames per second, bands, 0), then one record per
//! frame: loudness, then the bands, low to high.

use std::path::Path;

use realfft::RealFftPlanner;

use crate::decode::{DecodeError, Decoder};

pub const VERSION: u8 = 1;
pub const FPS: u32 = 30;
pub const BANDS: usize = 12;
pub const RECORD: usize = 1 + BANDS;
const LOW_HZ: f64 = 40.0;
const HIGH_HZ: f64 = 16_000.0;
/// Loudness below this many dBFS reads as 0; 0 dBFS reads as 255.
const LOUDNESS_FLOOR_DB: f64 = -60.0;
/// Band power mapped from this range (dB, relative to a full-scale sine) to 0..255.
const BAND_FLOOR_DB: f64 = -80.0;
const BAND_CEIL_DB: f64 = -10.0;

/// Analyses the file at `path` into an envelope.
pub fn analyse(path: &Path) -> Result<Vec<u8>, DecodeError> {
    let mut decoder = Decoder::open(path)?;
    let rate = decoder.sample_rate.max(1);
    let channels = decoder.channels.max(1);
    let hop = (rate / FPS).max(1) as usize;
    let size = (rate as usize / 24).next_power_of_two().max(512);
    let window: Vec<f32> =
        (0..size).map(|i| 0.5 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / size as f32).cos()).collect();
    let window_power: f64 = window.iter().map(|w| f64::from(*w) * f64::from(*w)).sum();
    let bands = band_bins(rate, size);

    let mut planner = RealFftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(size);
    let mut input = fft.make_input_vec();
    let mut spectrum = fft.make_output_vec();
    let mut scratch = fft.make_scratch_vec();

    let mut out = vec![VERSION, FPS as u8, BANDS as u8, 0];
    // The last `size` mono samples as a ring (`head` is the oldest), and the hop being filled.
    let mut history = vec![0f32; size];
    let mut head = 0usize;
    let mut hop_samples: Vec<f32> = Vec::with_capacity(hop);
    let mut block = Vec::new();

    let mut emit = |hop_samples: &[f32], history: &[f32], head: usize, out: &mut Vec<u8>| {
        let mean_square =
            hop_samples.iter().map(|s| f64::from(*s) * f64::from(*s)).sum::<f64>() / hop_samples.len().max(1) as f64;
        out.push(scale(10.0 * mean_square.max(1e-12).log10(), LOUDNESS_FLOOR_DB, 0.0));
        let ordered = history[head..].iter().chain(&history[..head]);
        for ((slot, sample), w) in input.iter_mut().zip(ordered).zip(&window) {
            *slot = sample * w;
        }
        if fft.process_with_scratch(&mut input, &mut spectrum, &mut scratch).is_err() {
            out.extend([0u8; BANDS]);
            return;
        }
        for &(from, to) in &bands {
            let bins = &spectrum[from..to];
            let power = bins.iter().map(|c| f64::from(c.norm_sqr())).sum::<f64>() / bins.len().max(1) as f64;
            // Relative to the power a full-scale sine puts in its bin through this window.
            let relative = power * 4.0 / (window_power * size as f64);
            out.push(scale(10.0 * relative.max(1e-14).log10(), BAND_FLOOR_DB, BAND_CEIL_DB));
        }
    };

    while decoder.next_block(&mut block)? {
        for frame in block.chunks(channels) {
            let mono = frame.iter().sum::<f32>() / channels as f32;
            history[head] = mono;
            head = (head + 1) % size;
            hop_samples.push(mono);
            if hop_samples.len() == hop {
                emit(&hop_samples, &history, head, &mut out);
                hop_samples.clear();
            }
        }
    }
    if !hop_samples.is_empty() {
        emit(&hop_samples, &history, head, &mut out);
    }
    Ok(out)
}

/// A track's sound in three numbers, from its envelope (PLAN/15 C2), each 0..1: energy (mean
/// loudness), brightness (the top four bands' share of all band energy) and dynamics (how much the
/// loudness moves: its standard deviation, scaled). None for an envelope without frames.
pub fn features(envelope: &[u8]) -> Option<(f64, f64, f64)> {
    let frames: Vec<&[u8]> = envelope.get(4..)?.chunks_exact(RECORD).collect();
    if frames.is_empty() {
        return None;
    }
    let n = frames.len() as f64;
    let loud: Vec<f64> = frames.iter().map(|f| f64::from(f[0]) / 255.0).collect();
    let energy = loud.iter().sum::<f64>() / n;
    let spread = (loud.iter().map(|l| (l - energy).powi(2)).sum::<f64>() / n).sqrt();
    let (mut high, mut all) = (0.0, 0.0);
    for f in &frames {
        for (band, value) in f[1..].iter().enumerate() {
            let v = f64::from(*value);
            all += v;
            if band >= BANDS - 4 {
                high += v;
            }
        }
    }
    let brightness = if all > 0.0 { high / all } else { 0.0 };
    Some((energy, brightness.clamp(0.0, 1.0), (spread * 4.0).clamp(0.0, 1.0)))
}

/// FFT bin ranges of the 12 log-spaced bands; every band holds at least one bin.
fn band_bins(rate: u32, size: usize) -> Vec<(usize, usize)> {
    let nyquist = size / 2;
    let hz_per_bin = f64::from(rate) / size as f64;
    let high = HIGH_HZ.min(f64::from(rate) / 2.0 * 0.98);
    (0..BANDS)
        .map(|i| {
            let edge = |k: usize| LOW_HZ * (high / LOW_HZ).powf(k as f64 / BANDS as f64);
            let from = ((edge(i) / hz_per_bin).floor() as usize).clamp(1, nyquist - 1);
            let to = ((edge(i + 1) / hz_per_bin).ceil() as usize).clamp(from + 1, nyquist);
            (from, to)
        })
        .collect()
}

fn scale(db: f64, floor: f64, ceil: f64) -> u8 {
    (((db - floor) / (ceil - floor)).clamp(0.0, 1.0) * 255.0).round() as u8
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn wav(path: &Path, rate: u32, samples: &[f32]) {
        let data: Vec<u8> = samples.iter().flat_map(|s| ((s * 32767.0) as i16).to_le_bytes()).collect();
        let mut file = std::fs::File::create(path).unwrap();
        let header = [
            b"RIFF".as_slice(),
            &(36 + data.len() as u32).to_le_bytes(),
            b"WAVEfmt ",
            &16u32.to_le_bytes(),
            &1u16.to_le_bytes(),
            &1u16.to_le_bytes(),
            &rate.to_le_bytes(),
            &(rate * 2).to_le_bytes(),
            &2u16.to_le_bytes(),
            &16u16.to_le_bytes(),
            b"data",
            &(data.len() as u32).to_le_bytes(),
        ]
        .concat();
        file.write_all(&header).unwrap();
        file.write_all(&data).unwrap();
    }

    fn analyse_samples(name: &str, samples: &[f32]) -> Vec<u8> {
        let path = std::env::temp_dir().join(format!("nemora-visuals-{name}-{}.wav", std::process::id()));
        wav(&path, 44_100, samples);
        let envelope = analyse(&path).unwrap();
        let _ = std::fs::remove_file(&path);
        envelope
    }

    #[test]
    fn one_record_per_thirtieth_of_a_second() {
        let envelope = analyse_samples("count", &vec![0.0; 44_100 * 2]);
        assert_eq!(&envelope[..4], &[VERSION, 30, 12, 0]);
        assert_eq!((envelope.len() - 4) / RECORD, 60);
        assert_eq!((envelope.len() - 4) % RECORD, 0);
    }

    #[test]
    fn a_loud_bright_track_reads_louder_and_brighter_than_a_quiet_dull_one() {
        let tone = |hz: f32, level: f32| -> Vec<f32> {
            (0..44_100 * 2).map(|i| level * (2.0 * std::f32::consts::PI * hz * i as f32 / 44_100.0).sin()).collect()
        };
        let (loud, bright, _) = features(&analyse_samples("bright", &tone(9_000.0, 0.8))).unwrap();
        let (quiet, dull, _) = features(&analyse_samples("dull", &tone(120.0, 0.05))).unwrap();
        assert!(loud > quiet && bright > dull, "{loud} {quiet} {bright} {dull}");
        assert!(features(&[VERSION, 30, 12, 0]).is_none());
    }

    #[test]
    fn silence_is_all_zeros() {
        let envelope = analyse_samples("silence", &vec![0.0; 44_100]);
        assert!(envelope[4..].iter().all(|b| *b == 0));
    }

    #[test]
    fn a_1khz_tone_lands_in_its_band_and_reads_loud() {
        let tone: Vec<f32> =
            (0..44_100).map(|i| 0.5 * (2.0 * std::f32::consts::PI * 1000.0 * i as f32 / 44_100.0).sin()).collect();
        let envelope = analyse_samples("tone", &tone);
        let record = &envelope[4 + RECORD * 20..4 + RECORD * 21];
        let expected = band_bins(44_100, 2048)
            .iter()
            .position(|&(from, to)| {
                let hz = |bin: usize| bin as f64 * 44_100.0 / 2048.0;
                hz(from) <= 1000.0 && 1000.0 < hz(to)
            })
            .unwrap();
        let loudest = (0..BANDS).max_by_key(|&b| record[1 + b]).unwrap();
        assert_eq!(loudest, expected, "bands {:?}", &record[1..]);
        // A -6 dBFS peak sine is about -9 dBFS RMS: high on the 60 dB scale.
        assert!(record[0] > 200, "loudness {}", record[0]);
    }
}

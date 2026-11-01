//! Saving a version as a file (PLAN/18 D4): the song played through the same varispeed (or
//! time-stretch) and the same reverb as live, offline, at the file's own rate, the reverb's tail let
//! ring out, written as WAV: 32-bit float (the samples exactly as computed) or 24-bit PCM. No
//! dither, no normalising, no limiter: in 24-bit a sample past full scale is the only thing that
//! must change (clamped to it), and the result says how many were. (FLAC was tried with flacenc:
//! its files did not open in symphonia, so Nemora itself could not have played them.)

use std::path::Path;

use crate::decode::Decoder;
use crate::reverb::{Reverb, Size};
use crate::source::Source;
use crate::vari::factor_of_semitones;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Format {
    /// WAV, 32-bit float: the samples exactly as computed.
    WavFloat,
    /// WAV, 24-bit PCM.
    Wav24,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Sound {
    pub semitones: f64,
    pub keep_pitch: bool,
    pub reverb: f64,
    pub size: Size,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rendered {
    pub seconds: f64,
    /// Samples past full scale (clamped in 24-bit, kept in float).
    pub overs: u64,
}

/// The rendered samples, interleaved, at the file's rate: (samples, rate, channels).
pub fn samples(path: &Path, sound: &Sound) -> Result<(Vec<f32>, u32, usize), String> {
    let probe = Decoder::open(path).map_err(|e| e.to_string())?;
    let (rate, channels) = (probe.sample_rate, probe.channels.clamp(1, 2));
    drop(probe);
    let mut source = Source::open(path, rate, channels).map_err(|e| e.to_string())?;
    let factor = factor_of_semitones(sound.semitones);
    if sound.keep_pitch {
        source.set_speed(factor);
    } else if (factor - 1.0).abs() > 1e-12 {
        source.set_factor(factor).map_err(|e| e.to_string())?;
    }
    let mut out = Vec::new();
    while source.fill(&mut out, 1 << 16).map_err(|e| e.to_string())? {}
    if sound.reverb > 0.0 {
        let mut reverb = Reverb::new(rate, channels);
        reverb.set(sound.reverb, sound.size);
        // Let the wet level reach its target at once, as it has live by the time a song starts.
        let mut settle = vec![0.0f64; (rate as usize / 10) * channels];
        reverb.process(&mut settle);
        let tail = (reverb.shape().rt60 * 1.2 * rate as f64) as usize * channels;
        let mut wide: Vec<f64> = out.iter().map(|&s| s as f64).chain(std::iter::repeat_n(0.0, tail)).collect();
        for block in wide.chunks_mut(4096 * channels) {
            reverb.process(block);
        }
        out = wide.into_iter().map(|s| s as f32).collect();
    }
    Ok((out, rate, channels))
}

/// Renders `path` with `sound` into `out`.
pub fn render(path: &Path, sound: &Sound, out: &Path, format: Format) -> Result<Rendered, String> {
    let (samples, rate, channels) = samples(path, sound)?;
    let overs = samples.iter().filter(|s| s.abs() > 1.0).count() as u64;
    let bytes = match format {
        Format::WavFloat => wav(&samples, rate, channels, true),
        Format::Wav24 => wav(&samples, rate, channels, false),
    };
    std::fs::write(out, bytes).map_err(|e| e.to_string())?;
    Ok(Rendered { seconds: samples.len() as f64 / channels as f64 / rate as f64, overs })
}

fn wav(samples: &[f32], rate: u32, channels: usize, float: bool) -> Vec<u8> {
    let width: u16 = if float { 4 } else { 3 };
    let data = (samples.len() * width as usize) as u32;
    let mut b = Vec::with_capacity(data as usize + 44);
    b.extend_from_slice(b"RIFF");
    b.extend_from_slice(&(36 + data).to_le_bytes());
    b.extend_from_slice(b"WAVEfmt ");
    b.extend_from_slice(&16u32.to_le_bytes());
    b.extend_from_slice(&(if float { 3u16 } else { 1u16 }).to_le_bytes());
    b.extend_from_slice(&(channels as u16).to_le_bytes());
    b.extend_from_slice(&rate.to_le_bytes());
    b.extend_from_slice(&(rate * channels as u32 * width as u32).to_le_bytes());
    b.extend_from_slice(&(channels as u16 * width).to_le_bytes());
    b.extend_from_slice(&(width * 8).to_le_bytes());
    b.extend_from_slice(b"data");
    b.extend_from_slice(&data.to_le_bytes());
    const FULL: f64 = 8_388_607.0;
    for &s in samples {
        if float {
            b.extend_from_slice(&s.to_le_bytes());
        } else {
            let v = (s as f64 * FULL).round().clamp(-FULL - 1.0, FULL) as i32;
            b.extend_from_slice(&v.to_le_bytes()[..3]);
        }
    }
    b
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transparency::ffmpeg;

    fn tone_file(name: &str) -> Option<std::path::PathBuf> {
        if !ffmpeg(&["-version"]) {
            eprintln!("SKIPPED: ffmpeg is not on PATH");
            return None;
        }
        let dir = std::env::temp_dir().join(format!("nemora-render-{}-{name}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("tone.wav");
        let out = path.to_string_lossy().into_owned();
        assert!(ffmpeg(&[
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=2:sample_rate=44100",
            "-ac",
            "2",
            "-c:a",
            "pcm_s16le",
            &out
        ]));
        Some(path)
    }

    #[test]
    fn a_rendered_file_is_what_the_live_chain_makes_and_rings_out() {
        let Some(path) = tone_file("same") else { return };
        let sound = Sound { semitones: -2.0, keep_pitch: false, reverb: 0.35, size: Size::Hall };
        let out = path.with_file_name("slowed.wav");
        let rendered = render(&path, &sound, &out, Format::WavFloat).unwrap();
        // The live chain by hand: the same source at the same factor, the same reverb.
        let mut source = Source::open(&path, 44_100, 2).unwrap();
        source.set_factor(factor_of_semitones(-2.0)).unwrap();
        let mut live = Vec::new();
        while source.fill(&mut live, 4096).unwrap() {}
        let music = live.len() / 2;
        let bytes = std::fs::read(&out).unwrap();
        let file: Vec<f32> =
            bytes[44..].chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect();
        // Longer by the factor, plus the tail.
        assert!((music as f64 / 44_100.0 - 2.0 / factor_of_semitones(-2.0)).abs() < 0.01);
        assert!(file.len() / 2 > music + 44_100, "the tail rings out after the music");
        assert!((rendered.seconds - file.len() as f64 / 2.0 / 44_100.0).abs() < 1e-9);
        // The tail is not silence, and it decays.
        let tail = &file[music * 2..];
        let early: f64 = tail[..44_100].iter().map(|&s| (s as f64).powi(2)).sum();
        let late: f64 = tail[tail.len() - 44_100..].iter().map(|&s| (s as f64).powi(2)).sum();
        assert!(early > 0.0 && late < early / 100.0);
        // Without reverb the file is the live source exactly.
        let dry = Sound { reverb: 0.0, ..sound };
        let (samples, _, _) = super::samples(&path, &dry).unwrap();
        assert_eq!(samples, live, "sample for sample");
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn a_24_bit_file_holds_it_and_opens_in_nemora() {
        let Some(path) = tone_file("wav24") else { return };
        let sound = Sound { semitones: 4.0, keep_pitch: false, reverb: 0.0, size: Size::Hall };
        let out = path.with_file_name("nightcore.wav");
        render(&path, &sound, &out, Format::Wav24).unwrap();
        // Decoded back, it matches the samples within a 24-bit step.
        let (samples, _, _) = super::samples(&path, &sound).unwrap();
        let mut decoder = Decoder::open(&out).unwrap();
        let mut back = Vec::new();
        let mut block = Vec::new();
        while decoder.next_block(&mut block).unwrap() {
            back.extend_from_slice(&block);
        }
        assert_eq!(back.len(), samples.len());
        let worst = back.iter().zip(&samples).map(|(a, b)| (a - b).abs()).fold(0.0f32, f32::max);
        assert!(worst < 2.0 / 8_388_607.0, "{worst}");
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }
}

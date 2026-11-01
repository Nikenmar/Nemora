//! Varispeed (PLAN/18 D1): a track played faster or slower the way a turntable, or FL Studio's
//! resample, does it - the pitch goes with the speed, -2 semitones is exactly 2^(-2/12) of the speed.
//!
//! Done by reading the file as if its rate were `rate x factor` and converting that to the device
//! rate with a long windowed-sinc filter in 64-bit float (rubato `Async`), and nothing else: no gain,
//! no limiter, no dither. A change of factor while playing glides over the next chunk (about 20 ms),
//! as long as the anti-alias cutoff the stream was built with still fits the new ratio; when it does
//! not (speeding up past the point where the cutoff must come down), the caller rebuilds the stream.

use rubato::audioadapter_buffers::direct::InterleavedSlice;
use rubato::{
    Adjustable, Async, FixedAsync, Resampler, SincInterpolationParameters, SincInterpolationType, WindowFunction,
};

/// The factors offered: an octave each way.
pub const RANGE: (f64, f64) = (0.5, 2.0);
/// Input frames per resampler call: about 23 ms at 44.1 kHz, the length of a glide.
const CHUNK: usize = 1024;
/// How far a running stream may glide from the ratio it was built at.
const MAX_RELATIVE: f64 = 4.0;
/// Sinc length and oversampling: the filter that decides how clean the result is (PLAN/18 P18.0
/// measures it: images and aliases below -120 dBFS).
const SINC_LEN: usize = 256;
const OVERSAMPLING: usize = 256;

/// The factor for a number of semitones.
pub fn factor_of_semitones(semitones: f64) -> f64 {
    2f64.powf(semitones / 12.0)
}

fn ratio(from: u32, to: u32, factor: f64) -> f64 {
    to as f64 / (from as f64 * factor)
}

/// What part of the band the anti-alias filter must keep at a ratio: all of it when the stream is
/// not squeezed, less when it is.
fn band(ratio: f64) -> f64 {
    ratio.min(1.0)
}

pub struct Varispeed {
    resampler: Async<f64>,
    channels: usize,
    from: u32,
    to: u32,
    factor: f64,
    built_ratio: f64,
    current_ratio: f64,
    pending: Vec<f64>,
    out: Vec<f64>,
    /// Output frames still to drop: the filter's own delay, so the signal is not shifted.
    delay: usize,
    /// Output frames the input so far should come to, at the ratios it went through.
    expected: f64,
    frames_out: u64,
}

impl Varispeed {
    /// A stream from `from` Hz at `factor` to `to` Hz.
    pub fn new(from: u32, to: u32, channels: usize, factor: f64) -> Result<Self, String> {
        let r = ratio(from, to, factor);
        let parameters = SincInterpolationParameters::new(SINC_LEN, WindowFunction::BlackmanHarris2)
            .oversampling_factor(OVERSAMPLING)
            .interpolation(SincInterpolationType::Cubic);
        let resampler = Async::<f64>::new_sinc(r, MAX_RELATIVE, &parameters, CHUNK, channels, FixedAsync::Input)
            .map_err(|e| e.to_string())?;
        let delay = resampler.output_delay();
        let out = vec![0.0; resampler.output_frames_max() * channels];
        Ok(Self {
            resampler,
            channels,
            from,
            to,
            factor,
            built_ratio: r,
            current_ratio: r,
            pending: Vec::new(),
            out,
            delay,
            expected: 0.0,
            frames_out: 0,
        })
    }

    pub fn factor(&self) -> f64 {
        self.factor
    }

    /// Whether `factor` can be reached by gliding (same band to keep, within the glide range).
    pub fn can_glide(&self, factor: f64) -> bool {
        let r = ratio(self.from, self.to, factor);
        let relative = r / self.built_ratio;
        (band(r) - band(self.built_ratio)).abs() <= 0.01 * band(self.built_ratio)
            && (1.0 / MAX_RELATIVE..=MAX_RELATIVE).contains(&relative)
    }

    /// Glides to `factor` over the next chunk; `false` (and nothing changed) when it cannot.
    pub fn glide(&mut self, factor: f64) -> bool {
        if !self.can_glide(factor) {
            return false;
        }
        let r = ratio(self.from, self.to, factor);
        if self.resampler.set_resample_ratio(r, true).is_err() {
            return false;
        }
        self.factor = factor;
        self.current_ratio = r;
        true
    }

    /// Feeds interleaved input; appends whatever output is ready to `output`.
    pub fn push(&mut self, input: &[f32], output: &mut Vec<f32>) -> Result<(), String> {
        self.pending.extend(input.iter().map(|&s| s as f64));
        loop {
            let need = self.resampler.input_frames_next() * self.channels;
            if self.pending.len() < need {
                return Ok(());
            }
            self.run(need, output)?;
        }
    }

    /// Ends the stream: the input still pending and the filter's tail, cut to exactly the length
    /// the input has at the ratios it went through.
    pub fn finish(&mut self, output: &mut Vec<f32>) -> Result<(), String> {
        let pending_frames = self.pending.len() / self.channels;
        let expected = (self.expected + pending_frames as f64 * self.current_ratio).round() as u64;
        let start = output.len();
        let mut rounds = 0;
        while self.frames_out < expected && rounds < 64 {
            let need = self.resampler.input_frames_next() * self.channels;
            // Silence pushes the last real samples through the filter's delay; it does not count.
            let real = self.pending.len().min(need);
            self.pending.resize(need, 0.0);
            let before = self.expected;
            self.run(need, output)?;
            self.expected = before + (real / self.channels) as f64 * self.current_ratio;
            rounds += 1;
        }
        let extra = (self.frames_out.saturating_sub(expected) as usize * self.channels).min(output.len() - start);
        output.truncate(output.len() - extra);
        self.frames_out -= (extra / self.channels) as u64;
        Ok(())
    }

    fn run(&mut self, need: usize, output: &mut Vec<f32>) -> Result<(), String> {
        let frames_in = need / self.channels;
        let input =
            InterleavedSlice::new(&self.pending[..need], self.channels, frames_in).map_err(|e| e.to_string())?;
        let frames_out_max = self.out.len() / self.channels;
        let mut out =
            InterleavedSlice::new_mut(&mut self.out, self.channels, frames_out_max).map_err(|e| e.to_string())?;
        let (_, produced) = self.resampler.process_into_buffer(&input, &mut out, None).map_err(|e| e.to_string())?;
        self.pending.drain(..need);
        self.expected += frames_in as f64 * self.current_ratio;
        let skip = self.delay.min(produced);
        self.delay -= skip;
        output.extend(self.out[skip * self.channels..produced * self.channels].iter().map(|&s| s as f32));
        self.frames_out += (produced - skip) as u64;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: u32 = 44_100;

    fn tone(hz: f64, seconds: f64, amplitude: f64) -> Vec<f32> {
        (0..(RATE as f64 * seconds) as usize)
            .map(|i| ((2.0 * std::f64::consts::PI * hz * i as f64 / RATE as f64).sin() * amplitude) as f32)
            .collect()
    }

    fn run(input: &[f32], factor: f64) -> Vec<f32> {
        let mut v = Varispeed::new(RATE, RATE, 1, factor).unwrap();
        let mut out = Vec::new();
        for block in input.chunks(777) {
            v.push(block, &mut out).unwrap();
        }
        v.finish(&mut out).unwrap();
        out
    }

    /// The frequency of a steady tone, from zero crossings with linear interpolation.
    fn frequency(signal: &[f32]) -> f64 {
        let mut crossings = Vec::new();
        for i in 1..signal.len() {
            let (a, b) = (signal[i - 1] as f64, signal[i] as f64);
            if a < 0.0 && b >= 0.0 {
                crossings.push(i as f64 - 1.0 + a / (a - b));
            }
        }
        let periods = crossings.len() - 1;
        RATE as f64 * periods as f64 / (crossings[periods] - crossings[0])
    }

    fn rms(signal: &[f32]) -> f64 {
        (signal.iter().map(|&s| (s as f64).powi(2)).sum::<f64>() / signal.len() as f64).sqrt()
    }

    #[test]
    fn minus_two_semitones_is_exactly_that_and_longer_by_as_much() {
        let factor = factor_of_semitones(-2.0);
        let input = tone(1000.0, 2.0, 0.5);
        let out = run(&input, factor);
        // Length: the input divided by the factor, to the frame.
        let expected = (input.len() as f64 / factor).round() as usize;
        assert!((out.len() as i64 - expected as i64).abs() <= 1, "{} vs {expected}", out.len());
        // Pitch: 1000 Hz x 0.8909 = 890.9 Hz, measured in the steady middle.
        let middle = &out[out.len() / 4..out.len() * 3 / 4];
        let hz = frequency(middle);
        assert!((hz - 1000.0 * factor).abs() < 0.05, "{hz} Hz");
        // Level unchanged: no gain anywhere.
        let db = 20.0 * (rms(middle) / rms(&input[input.len() / 4..input.len() * 3 / 4])).log10();
        assert!(db.abs() < 0.05, "{db} dB");
    }

    #[test]
    fn sped_up_keeps_its_level_and_pitch_too() {
        let factor = factor_of_semitones(4.0);
        let out = run(&tone(1000.0, 2.0, 0.5), factor);
        let middle = &out[out.len() / 4..out.len() * 3 / 4];
        assert!((frequency(middle) - 1000.0 * factor).abs() < 0.05);
        assert!((20.0 * (rms(middle) / (0.5 / 2f64.sqrt())).log10()).abs() < 0.05);
    }

    #[test]
    fn a_tone_near_the_top_does_not_fold_back_when_sped_up() {
        // 15 kHz sped up by 1.5x would be 22.5 kHz: above Nyquist, so it must vanish, not alias.
        let out = run(&tone(15_000.0, 1.0, 0.5), 1.5);
        let middle = &out[out.len() / 4..out.len() * 3 / 4];
        let db = 20.0 * (rms(middle) + 1e-12).log10();
        assert!(db < -100.0, "aliased energy at {db} dBFS");
    }

    #[test]
    fn a_glide_moves_the_pitch_without_a_jump() {
        let mut v = Varispeed::new(RATE, RATE, 1, factor_of_semitones(-2.0)).unwrap();
        let input = tone(440.0, 2.0, 0.5);
        let mut out = Vec::new();
        let (first, second) = input.split_at(input.len() / 2);
        for block in first.chunks(512) {
            v.push(block, &mut out).unwrap();
        }
        assert!(v.glide(factor_of_semitones(-4.0)), "-2 to -4 st glides");
        for block in second.chunks(512) {
            v.push(block, &mut out).unwrap();
        }
        // No step larger than a sine of this frequency and amplitude can make between two samples.
        let limit = 0.5 * 2.0 * std::f64::consts::PI * 440.0 / RATE as f64 * 1.05;
        let worst = out.windows(2).map(|w| (w[1] - w[0]).abs() as f64).fold(0.0, f64::max);
        assert!(worst <= limit, "a step of {worst} (limit {limit})");
        // Speeding up past the cutoff it was built with is not a glide.
        assert!(!v.glide(1.5));
    }

    /// P18.0's measurements: how clean and how costly the stage is.
    #[test]
    #[ignore]
    fn measure_quality_and_cost() {
        let alias = run(&tone(15_000.0, 1.0, 0.5), 1.5);
        let m = &alias[alias.len() / 4..alias.len() * 3 / 4];
        eprintln!("VARI alias of 15 kHz at 1.5x: {:.1} dBFS", 20.0 * (rms(m) + 1e-15).log10());
        let hz = 1000.0 * factor_of_semitones(-2.0);
        let slowed = run(&tone(1000.0, 1.0, 0.5), factor_of_semitones(-2.0));
        let m = &slowed[slowed.len() / 4..slowed.len() * 3 / 4];
        // What is left after removing the best-fitting tone at the exact frequency (least squares on
        // sine and cosine): the stage's own noise and distortion.
        let w = std::f64::consts::TAU * hz / RATE as f64;
        let (mut ss, mut cc, mut sc, mut ys, mut yc) = (0.0, 0.0, 0.0, 0.0, 0.0);
        for (i, &y) in m.iter().enumerate() {
            let (s, c) = (w * i as f64).sin_cos();
            ss += s * s;
            cc += c * c;
            sc += s * c;
            ys += y as f64 * s;
            yc += y as f64 * c;
        }
        let det = ss * cc - sc * sc;
        let (a, b) = ((ys * cc - yc * sc) / det, (yc * ss - ys * sc) / det);
        let best: f64 = m
            .iter()
            .enumerate()
            .map(|(i, &y)| {
                let (s, c) = (w * i as f64).sin_cos();
                (y as f64 - a * s - b * c).powi(2)
            })
            .sum();
        let residual = (best / m.len() as f64).sqrt();
        eprintln!("VARI residual after the ideal tone: {:.1} dBFS", 20.0 * residual.log10());
        let minute: Vec<f32> = tone(440.0, 60.0, 0.5).iter().flat_map(|&s| [s, s]).collect();
        let mut v = Varispeed::new(RATE, 48_000, 2, factor_of_semitones(-2.0)).unwrap();
        let mut out = Vec::new();
        let start = std::time::Instant::now();
        for block in minute.chunks(4096) {
            v.push(block, &mut out).unwrap();
        }
        let ms = start.elapsed().as_secs_f64() * 1000.0;
        eprintln!("VARI a minute of stereo 44.1 kHz to 48 kHz at -2 st: {ms:.0} ms ({:.2} % of one core)", ms / 600.0);
    }
}

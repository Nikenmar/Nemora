//! The user's sound settings, applied in 64-bit float: equalizer, volume and fades.
//!
//! Every stage is skipped outright at its neutral setting, so at full volume, a flat equalizer and
//! no fade the samples leave untouched (the transparency rule). Nothing here lowers or raises the
//! sound on its own: the only automatic gain is the equalizer's pre-gain, which exists only while
//! the user has the equalizer on with a boosted band, and equals that boost so it cannot clip.

/// The ten bands of the 1.x equalizer, in Hz.
pub const EQ_BANDS: [f64; 10] = [32.0, 64.0, 125.0, 250.0, 500.0, 1000.0, 2000.0, 4000.0, 8000.0, 16000.0];
/// The bands' Q, as 1.x set them on its WebAudio filters.
const EQ_Q: f64 = 1.0;

/// 1.x's volume taper: the 0..100 slider mapped to gain on a ~30 dB exponential curve, so loudness
/// changes evenly to the ear. Same formula as the renderer's `getPerceptualGain`.
pub fn perceptual_gain(volume_percent: f64) -> f64 {
    let range = 30f64.ln();
    let v = (volume_percent / 100.0).clamp(0.0, 1.0);
    if v <= 0.0 { 0.0 } else { ((range * v).exp() - 1.0) / (range.exp() - 1.0) }
}

/// A peaking biquad in direct form I (RBJ cookbook, the WebAudio `peaking` filter).
#[derive(Debug, Clone, Copy, Default)]
struct Biquad {
    b0: f64,
    b1: f64,
    b2: f64,
    a1: f64,
    a2: f64,
}

impl Biquad {
    fn peaking(frequency: f64, gain_db: f64, sample_rate: f64) -> Option<Self> {
        if frequency >= sample_rate / 2.0 {
            return None;
        }
        let a = 10f64.powf(gain_db / 40.0);
        let w0 = 2.0 * std::f64::consts::PI * frequency / sample_rate;
        let alpha = w0.sin() / (2.0 * EQ_Q);
        let cos = w0.cos();
        let a0 = 1.0 + alpha / a;
        Some(Self {
            b0: (1.0 + alpha * a) / a0,
            b1: (-2.0 * cos) / a0,
            b2: (1.0 - alpha * a) / a0,
            a1: (-2.0 * cos) / a0,
            a2: (1.0 - alpha / a) / a0,
        })
    }
}

/// Filter memory of one band on one channel.
#[derive(Debug, Clone, Copy, Default)]
struct History {
    x1: f64,
    x2: f64,
    y1: f64,
    y2: f64,
}

pub struct Equalizer {
    gains_db: [f64; 10],
    sample_rate: f64,
    channels: usize,
    filters: Vec<Biquad>,
    /// Per channel, per active filter.
    history: Vec<History>,
    pre_gain: f64,
}

impl Equalizer {
    pub fn new(sample_rate: u32, channels: usize) -> Self {
        Self {
            gains_db: [0.0; 10],
            sample_rate: sample_rate as f64,
            channels,
            filters: Vec::new(),
            history: Vec::new(),
            pre_gain: 1.0,
        }
    }

    /// Off when every band is at 0 dB.
    pub fn is_flat(&self) -> bool {
        self.filters.is_empty()
    }

    pub fn set_gains(&mut self, gains_db: [f64; 10]) {
        if gains_db == self.gains_db {
            return;
        }
        self.gains_db = gains_db;
        self.filters = EQ_BANDS
            .iter()
            .zip(gains_db)
            .filter(|(_, g)| *g != 0.0)
            .filter_map(|(f, g)| Biquad::peaking(*f, g, self.sample_rate))
            .collect();
        self.history = vec![History::default(); self.filters.len() * self.channels];
        let boost = gains_db.iter().copied().fold(0.0f64, f64::max);
        self.pre_gain = 10f64.powf(-boost / 20.0);
    }

    fn process(&mut self, samples: &mut [f64]) {
        if self.filters.is_empty() {
            return;
        }
        let bands = self.filters.len();
        for frame in samples.chunks_exact_mut(self.channels) {
            for (ch, sample) in frame.iter_mut().enumerate() {
                let mut x = *sample * self.pre_gain;
                for (band, f) in self.filters.iter().enumerate() {
                    let h = &mut self.history[ch * bands + band];
                    let y = f.b0 * x + f.b1 * h.x1 + f.b2 * h.x2 - f.a1 * h.y1 - f.a2 * h.y2;
                    h.x2 = h.x1;
                    h.x1 = x;
                    h.y2 = h.y1;
                    h.y1 = y;
                    x = y;
                }
                *sample = x;
            }
        }
    }
}

/// A linear gain ramp, as 1.x faded on play and pause.
#[derive(Debug, Clone, Copy)]
pub struct Fade {
    from: f64,
    to: f64,
    frames: u64,
    done: u64,
}

impl Fade {
    pub fn new(from: f64, to: f64, frames: u64) -> Self {
        Self { from, to, frames: frames.max(1), done: 0 }
    }

    fn gain(&self) -> f64 {
        self.from + (self.to - self.from) * (self.done as f64 / self.frames as f64)
    }

    pub fn finished(&self) -> bool {
        self.done >= self.frames
    }

    pub fn target(&self) -> f64 {
        self.to
    }
}

/// The chain for one output format.
pub struct Chain {
    pub equalizer: Equalizer,
    channels: usize,
    volume: f64,
    fade: Option<Fade>,
    /// Gain held after a fade finished (0 after fading out, 1 after fading in).
    fade_level: f64,
    scratch: Vec<f64>,
}

impl Chain {
    pub fn new(sample_rate: u32, channels: usize) -> Self {
        Self {
            equalizer: Equalizer::new(sample_rate, channels),
            channels,
            volume: 1.0,
            fade: None,
            fade_level: 1.0,
            scratch: Vec::new(),
        }
    }

    /// Linear gain (already tapered).
    pub fn set_volume(&mut self, gain: f64) {
        self.volume = gain.clamp(0.0, 1.0);
    }

    pub fn start_fade(&mut self, to: f64, frames: u64) {
        let from = self.fade.map_or(self.fade_level, |f| f.gain());
        self.fade = Some(Fade::new(from, to, frames));
    }

    /// Where the last fade ended, or is heading.
    pub fn fade_target(&self) -> f64 {
        self.fade.map_or(self.fade_level, |f| f.target())
    }

    pub fn is_fading(&self) -> bool {
        self.fade.is_some_and(|f| !f.finished())
    }

    /// Whether the chain would leave samples untouched.
    pub fn is_neutral(&self) -> bool {
        self.equalizer.is_flat() && self.volume == 1.0 && self.fade.is_none() && self.fade_level == 1.0
    }

    /// Applies the chain to interleaved samples in place.
    pub fn process(&mut self, samples: &mut [f32]) {
        if self.is_neutral() {
            return;
        }
        self.scratch.clear();
        self.scratch.extend(samples.iter().map(|&s| s as f64));
        self.equalizer.process(&mut self.scratch);
        for frame in self.scratch.chunks_exact_mut(self.channels) {
            let fade = match &mut self.fade {
                Some(f) if !f.finished() => {
                    let g = f.gain();
                    f.done += 1;
                    if f.finished() {
                        self.fade_level = f.to;
                    }
                    g
                }
                _ => self.fade_level,
            };
            let gain = self.volume * fade;
            if gain != 1.0 {
                for s in frame.iter_mut() {
                    *s *= gain;
                }
            }
        }
        if self.fade.is_some_and(|f| f.finished()) {
            self.fade = None;
        }
        for (out, s) in samples.iter_mut().zip(&self.scratch) {
            *out = *s as f32;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn noise(n: usize) -> Vec<f32> {
        let mut x: u32 = 12345;
        (0..n)
            .map(|_| {
                x ^= x << 13;
                x ^= x >> 17;
                x ^= x << 5;
                (x as f32 / u32::MAX as f32) * 2.0 - 1.0
            })
            .collect()
    }

    #[test]
    fn the_neutral_chain_is_bit_transparent() {
        let input = noise(4096);
        let mut chain = Chain::new(48_000, 2);
        let mut out = input.clone();
        chain.process(&mut out);
        assert!(input.iter().zip(&out).all(|(a, b)| a.to_bits() == b.to_bits()));
    }

    #[test]
    fn a_flat_equalizer_set_back_is_transparent_again() {
        let mut chain = Chain::new(48_000, 2);
        chain.equalizer.set_gains([3.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, -2.0]);
        assert!(!chain.is_neutral());
        chain.equalizer.set_gains([0.0; 10]);
        let input = noise(1024);
        let mut out = input.clone();
        chain.process(&mut out);
        assert!(input.iter().zip(&out).all(|(a, b)| a.to_bits() == b.to_bits()));
    }

    #[test]
    fn the_volume_taper_matches_1x() {
        assert_eq!(perceptual_gain(0.0), 0.0);
        assert_eq!(perceptual_gain(100.0), 1.0);
        // 1.x: (exp(ln30 * 0.5) - 1) / (30 - 1)
        assert!((perceptual_gain(50.0) - (30f64.sqrt() - 1.0) / 29.0).abs() < 1e-15);
    }

    #[test]
    fn a_boost_never_clips_a_full_scale_sine() {
        let rate = 48_000.0;
        let mut chain = Chain::new(48_000, 1);
        chain.equalizer.set_gains([0.0, 0.0, 0.0, 0.0, 0.0, 6.0, 0.0, 0.0, 0.0, 0.0]);
        let mut sine: Vec<f32> =
            (0..48_000).map(|i| (2.0 * std::f64::consts::PI * 1000.0 * i as f64 / rate).sin() as f32).collect();
        chain.process(&mut sine);
        let peak = sine[24_000..].iter().fold(0.0f32, |p, s| p.max(s.abs()));
        assert!(peak <= 1.0005, "peak {peak}");
        assert!(peak > 0.95, "the boost is still heard at its frequency: {peak}");
    }

    #[test]
    fn a_fade_out_ends_silent_and_a_fade_in_ends_transparent() {
        let mut chain = Chain::new(48_000, 1);
        chain.start_fade(0.0, 100);
        let mut ones = vec![1.0f32; 200];
        chain.process(&mut ones);
        assert_eq!(ones[0], 1.0);
        assert_eq!(ones[150], 0.0);
        chain.start_fade(1.0, 100);
        let mut more = vec![0.5f32; 200];
        chain.process(&mut more);
        assert_eq!(more[150], 0.5);
        assert!(chain.is_neutral(), "after fading back in nothing is applied any more");
    }
}

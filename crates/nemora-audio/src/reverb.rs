//! The reverb of "slowed + reverb" (PLAN/18 D2): an eight-line feedback delay network, 64-bit.
//!
//! The dry signal passes at its own level; the reverb is added to it. Inside: a pre-delay, a few
//! early reflections, then eight delay lines mixed by a Householder matrix (every line feeds every
//! other, energy kept), each with a gain that sets the decay time (RT60), a gentle low-pass in its
//! loop (the air), and a slowly wandering length (against the metallic ring of fixed delays). Each
//! line's input is scaled by sqrt(1 - g^2), so the tail's level does not grow with its length.
//! The left and right outputs take the lines with different signs, so the tail is wide.
//!
//! Nothing here limits or compresses. At amount 0 the stage is skipped; turning it down glides the
//! wet level to 0 over 50 ms, then the network is cleared.

/// How large the space is: it scales the delay lengths and the decay.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Size {
    Room,
    #[default]
    Hall,
    Vast,
}

impl Size {
    /// `room`, `hall` or `vast`; anything else is a Hall.
    pub fn named(name: &str) -> Self {
        match name {
            "room" => Size::Room,
            "vast" => Size::Vast,
            _ => Size::Hall,
        }
    }

    fn scale(self) -> f64 {
        match self {
            Size::Room => 0.6,
            Size::Hall => 1.0,
            Size::Vast => 1.6,
        }
    }
}

/// The delay lengths of a Hall, in ms (mutually prime as samples at the usual rates).
const LENGTHS_MS: [f64; 8] = [29.7, 37.1, 41.1, 43.7, 53.0, 59.9, 67.7, 73.1];
/// How far the lengths wander, in ms, and how fast (Hz, one per line).
const WANDER_MS: f64 = 0.35;
const WANDER_HZ: [f64; 8] = [0.11, 0.13, 0.17, 0.19, 0.23, 0.29, 0.31, 0.37];
/// Early reflections: (ms after the pre-delay, gain left, gain right).
const EARLY: [(f64, f64, f64); 6] = [
    (7.0, 0.32, 0.18),
    (11.0, 0.18, 0.30),
    (17.0, 0.24, 0.14),
    (23.0, 0.12, 0.22),
    (31.0, 0.16, 0.10),
    (41.0, 0.08, 0.13),
];
/// Signs that take the eight lines to the left and to the right.
const LEFT: [f64; 8] = [1.0, -1.0, 1.0, -1.0, 1.0, 1.0, -1.0, -1.0];
const RIGHT: [f64; 8] = [1.0, 1.0, -1.0, -1.0, -1.0, 1.0, 1.0, -1.0];
/// The wet level's glide when the amount changes, in seconds.
const GLIDE_SECONDS: f64 = 0.05;

/// What an amount (0..1) and a size mean.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Shape {
    /// Linear gain of the reverb added to the dry signal.
    pub wet: f64,
    /// Seconds for the tail to fall by 60 dB.
    pub rt60: f64,
    pub predelay_ms: f64,
    /// 0..1: how much the loop darkens the tail.
    pub damping: f64,
}

pub fn shape(amount: f64, size: Size) -> Shape {
    let a = amount.clamp(0.0, 1.0);
    Shape {
        wet: 0.75 * a.powf(1.3),
        rt60: (1.2 + 3.3 * a) * size.scale(),
        predelay_ms: (10.0 + 30.0 * a) * size.scale().sqrt(),
        damping: 0.2 + 0.35 * a,
    }
}

struct Line {
    buffer: Vec<f64>,
    write: usize,
    length: f64,
    gain: f64,
    input_gain: f64,
    low: f64,
    phase: f64,
    step: f64,
}

impl Line {
    fn read(&self, delay: f64) -> f64 {
        let n = self.buffer.len();
        let position = self.write as f64 + n as f64 - delay;
        let i = position.floor();
        let frac = position - i;
        let a = self.buffer[i as usize % n];
        let b = self.buffer[(i as usize + 1) % n];
        a + (b - a) * frac
    }
}

pub struct Reverb {
    rate: f64,
    channels: usize,
    amount: f64,
    size: Size,
    shape: Shape,
    /// The wet gain heard now, gliding to `shape.wet`.
    wet: f64,
    /// The wet level's change per frame while it glides (set by `set`).
    glide: f64,
    lines: Vec<Line>,
    predelay: Vec<f64>,
    pre_write: usize,
    /// Whether the network holds anything.
    active: bool,
}

impl Reverb {
    pub fn new(sample_rate: u32, channels: usize) -> Self {
        let rate = sample_rate as f64;
        let mut reverb = Self {
            rate,
            channels,
            amount: 0.0,
            size: Size::Hall,
            shape: shape(0.0, Size::Hall),
            wet: 0.0,
            glide: 0.0,
            lines: Vec::new(),
            predelay: vec![0.0; (rate * 0.2) as usize],
            pre_write: 0,
            active: false,
        };
        reverb.build();
        reverb
    }

    fn build(&mut self) {
        let wander = WANDER_MS / 1000.0 * self.rate;
        self.lines = LENGTHS_MS
            .iter()
            .zip(WANDER_HZ)
            .map(|(&ms, hz)| {
                let length = ms * self.size.scale() / 1000.0 * self.rate;
                Line {
                    buffer: vec![0.0; (length + wander) as usize + 4],
                    write: 0,
                    length,
                    gain: 0.0,
                    input_gain: 0.0,
                    low: 0.0,
                    phase: 0.0,
                    step: hz / self.rate,
                }
            })
            .collect();
        self.tune();
    }

    /// The loop gains for the decay and the input gains that keep the tail's level.
    fn tune(&mut self) {
        let rt60 = self.shape.rt60;
        for line in &mut self.lines {
            line.gain = 10f64.powf(-3.0 * line.length / (rt60 * self.rate));
            line.input_gain = (1.0 - line.gain * line.gain).sqrt();
        }
    }

    /// The amount (0..1) and the size. The wet level glides; the decay changes at once.
    pub fn set(&mut self, amount: f64, size: Size) {
        let amount = amount.clamp(0.0, 1.0);
        let rebuild = size != self.size;
        self.amount = amount;
        self.size = size;
        self.shape = shape(amount.max(1e-6), size);
        let target = if amount == 0.0 { 0.0 } else { self.shape.wet };
        self.glide = (target - self.wet).abs().max(1e-9) / (GLIDE_SECONDS * self.rate);
        if rebuild {
            self.build();
            self.active = false;
        } else {
            self.tune();
        }
    }

    pub fn shape(&self) -> Shape {
        self.shape
    }

    /// Whether the stage can be skipped: off, and nothing left to glide out.
    pub fn is_off(&self) -> bool {
        self.amount == 0.0 && self.wet == 0.0
    }

    /// Adds the reverb of interleaved `samples` to them, in place.
    pub fn process(&mut self, samples: &mut [f64]) {
        if self.is_off() {
            return;
        }
        let target = if self.amount == 0.0 { 0.0 } else { self.shape.wet };
        let pre = ((self.shape.predelay_ms / 1000.0 * self.rate) as usize).min(self.predelay.len() - 1);
        let early: Vec<(usize, f64, f64)> = EARLY
            .iter()
            .map(|&(ms, l, r)| ((pre + (ms / 1000.0 * self.rate) as usize).min(self.predelay.len() - 1), l, r))
            .collect();
        let damping = self.shape.damping;
        let wander = WANDER_MS / 1000.0 * self.rate;
        let mut taps = [0.0f64; 8];
        for frame in samples.chunks_exact_mut(self.channels) {
            let input = if self.channels >= 2 { 0.5 * (frame[0] + frame[1]) } else { frame[0] };
            let n = self.predelay.len();
            self.predelay[self.pre_write] = input;
            let delayed = self.predelay[(self.pre_write + n - pre) % n];
            let (mut early_l, mut early_r) = (0.0, 0.0);
            for &(at, l, r) in &early {
                let v = self.predelay[(self.pre_write + n - at) % n];
                early_l += v * l;
                early_r += v * r;
            }
            self.pre_write = (self.pre_write + 1) % n;

            // Read the lines (each length wandering a little), damp, then mix (Householder).
            let mut sum = 0.0;
            for (k, line) in self.lines.iter_mut().enumerate() {
                line.phase = (line.phase + line.step) % 1.0;
                let delay = line.length + wander * (std::f64::consts::TAU * line.phase).sin();
                let v = line.read(delay);
                line.low += (v - line.low) * (1.0 - damping);
                taps[k] = line.low;
                sum += line.low;
            }
            let mix = 2.0 / 8.0 * sum;
            let (mut wet_l, mut wet_r) = (0.0, 0.0);
            for (k, line) in self.lines.iter_mut().enumerate() {
                let tap = taps[k];
                wet_l += tap * LEFT[k];
                wet_r += tap * RIGHT[k];
                let mut fed = line.gain * (tap - mix) + line.input_gain * delayed;
                if fed.abs() < 1e-25 {
                    fed = 0.0;
                }
                let n = line.buffer.len();
                line.buffer[line.write] = fed;
                line.write = (line.write + 1) % n;
            }
            // The wet level glides towards its target.
            if self.wet < target {
                self.wet = (self.wet + self.glide).min(target);
            } else if self.wet > target {
                self.wet = (self.wet - self.glide).max(target);
            }
            let scale = self.wet / 8f64.sqrt();
            let (l, r) = ((wet_l * scale) + early_l * self.wet, (wet_r * scale) + early_r * self.wet);
            if self.channels >= 2 {
                frame[0] += l;
                frame[1] += r;
            } else {
                frame[0] += 0.5 * (l + r);
            }
            self.active = true;
        }
        // Fully turned down: clear the network, so turning it up again starts from silence.
        if self.amount == 0.0 && self.wet == 0.0 && self.active {
            self.build();
            self.predelay.iter_mut().for_each(|s| *s = 0.0);
            self.active = false;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: u32 = 48_000;

    /// The wet response to a unit impulse, `seconds` long, as (left, right).
    fn impulse(amount: f64, size: Size, seconds: f64) -> (Vec<f64>, Vec<f64>) {
        let mut reverb = Reverb::new(RATE, 2);
        reverb.set(amount, size);
        // Let the wet level reach its target before the impulse.
        let mut warm = vec![0.0; RATE as usize / 5 * 2];
        reverb.process(&mut warm);
        let n = (RATE as f64 * seconds) as usize;
        let mut frames = vec![0.0; n * 2];
        frames[0] = 1.0;
        frames[1] = 1.0;
        reverb.process(&mut frames);
        // The dry impulse is the first frame; the rest is reverb.
        frames[0] -= 1.0;
        frames[1] -= 1.0;
        (frames.iter().step_by(2).copied().collect(), frames.iter().skip(1).step_by(2).copied().collect())
    }

    /// RT60 from the Schroeder backward integral, fitted between -5 and -35 dB (T30 x 2).
    fn rt60(signal: &[f64]) -> f64 {
        let mut energy: Vec<f64> = signal.iter().map(|s| s * s).collect();
        for i in (0..energy.len() - 1).rev() {
            energy[i] += energy[i + 1];
        }
        let total = energy[0];
        let db = |i: usize| 10.0 * (energy[i] / total).log10();
        let at = |level: f64| (0..energy.len()).find(|&i| db(i) <= level).unwrap_or(energy.len() - 1);
        let (a, b) = (at(-5.0), at(-35.0));
        (b - a) as f64 / RATE as f64 * 2.0
    }

    #[test]
    fn the_tail_decays_in_the_time_set_at_every_size() {
        for size in [Size::Room, Size::Hall, Size::Vast] {
            for amount in [0.3, 0.7, 1.0] {
                let want = shape(amount, size).rt60;
                let (l, r) = impulse(amount, size, want * 2.0);
                // RT60 is a low-mid figure (the loop darkens the highs on purpose): measured below
                // about 500 Hz, through a one-pole low-pass run forward and back.
                let a = (-std::f64::consts::TAU * 500.0 / RATE as f64).exp();
                let mut low: Vec<f64> = l.iter().zip(&r).map(|(x, y)| x + y).collect();
                for pass in 0..2 {
                    let mut y = 0.0;
                    let range: Vec<usize> =
                        if pass == 0 { (0..low.len()).collect() } else { (0..low.len()).rev().collect() };
                    for i in range {
                        y = (1.0 - a) * low[i] + a * y;
                        low[i] = y;
                    }
                }
                let got = rt60(&low);
                assert!((got - want).abs() / want < 0.10, "{size:?} {amount}: RT60 {got:.2} s, set {want:.2} s");
            }
        }
    }

    #[test]
    fn the_tail_is_wide() {
        let (l, r) = impulse(0.7, Size::Hall, 2.0);
        let tail = RATE as usize / 10..RATE as usize;
        let (mut lr, mut ll, mut rr) = (0.0, 0.0, 0.0);
        for i in tail {
            lr += l[i] * r[i];
            ll += l[i] * l[i];
            rr += r[i] * r[i];
        }
        let correlation = lr / (ll * rr).sqrt();
        assert!(correlation.abs() < 0.3, "left and right correlate at {correlation:.2}");
    }

    #[test]
    fn off_is_skipped_and_turning_down_glides_then_clears() {
        let mut reverb = Reverb::new(RATE, 2);
        assert!(reverb.is_off());
        let mut samples = vec![0.25; 960];
        let before = samples.clone();
        reverb.process(&mut samples);
        assert_eq!(samples, before, "off leaves samples untouched");
        reverb.set(0.5, Size::Hall);
        let mut tone: Vec<f64> = (0..RATE as usize).flat_map(|i| [(i as f64 * 0.05).sin() * 0.5; 2]).collect();
        reverb.process(&mut tone);
        reverb.set(0.0, Size::Hall);
        assert!(!reverb.is_off(), "the wet level glides out first");
        let mut rest = vec![0.0; RATE as usize / 5 * 2];
        reverb.process(&mut rest);
        assert!(reverb.is_off(), "then the stage is off");
        let mut silence = vec![0.0; 960];
        reverb.process(&mut silence);
        assert!(silence.iter().all(|&s| s == 0.0));
    }

    #[test]
    fn silence_after_a_tail_costs_nothing_and_ends_at_zero() {
        let mut reverb = Reverb::new(RATE, 2);
        reverb.set(1.0, Size::Vast);
        let mut frames = vec![0.0; RATE as usize * 2];
        frames[0] = 1.0;
        frames[1] = 1.0;
        reverb.process(&mut frames);
        // A long silence: the network must not slow down on tiny numbers.
        let start = std::time::Instant::now();
        let mut silence = vec![0.0; RATE as usize * 2];
        for _ in 0..30 {
            silence.iter_mut().for_each(|s| *s = 0.0);
            reverb.process(&mut silence);
        }
        let per_second = start.elapsed().as_secs_f64() / 30.0;
        assert!(per_second < 0.25, "{per_second:.3} s of work per second of audio");
    }

    /// P18.1's cost: a second of stereo 48 kHz.
    #[test]
    #[ignore]
    fn measure_cost() {
        let mut reverb = Reverb::new(RATE, 2);
        reverb.set(0.7, Size::Hall);
        let mut audio: Vec<f64> = (0..RATE as usize * 60).flat_map(|i| [(i as f64 * 0.01).sin() * 0.3; 2]).collect();
        let start = std::time::Instant::now();
        for block in audio.chunks_mut(960) {
            reverb.process(block);
        }
        let ms = start.elapsed().as_secs_f64() * 1000.0;
        eprintln!("REVERB a minute of stereo 48 kHz: {ms:.0} ms ({:.2} % of one core)", ms / 600.0);
    }
}

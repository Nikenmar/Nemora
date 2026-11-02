//! Headphone correction (PLAN/18 D5): a parametric equalizer read from an AutoEQ / Equalizer APO
//! `ParametricEQ.txt` - its preamp and up to [`MAX_FILTERS`] biquads (peaking, low shelf, high
//! shelf; RBJ cookbook, 64-bit) - run before the 10-band equalizer. Off, the stage does nothing at
//! all. The preamp is the profile's own: part of the correction the user turned on, never an
//! automatic gain.

use std::f64::consts::PI;

pub const MAX_FILTERS: usize = 20;

#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum Kind {
    Peak,
    LowShelf,
    HighShelf,
}

#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct Filter {
    pub kind: Kind,
    pub frequency: f64,
    pub gain_db: f64,
    pub q: f64,
}

#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct Profile {
    pub preamp_db: f64,
    pub filters: Vec<Filter>,
    /// Lines the parser did not take (types it does not run, such as LP or HP), for the user to see.
    #[serde(default)]
    pub skipped: Vec<String>,
}

/// The Q a shelf gets when the file gives none (Equalizer APO's default 12 dB per octave slope).
const SHELF_Q: f64 = std::f64::consts::FRAC_1_SQRT_2;

fn number(s: &str) -> Option<f64> {
    s.trim().replace(',', ".").parse().ok().filter(|v: &f64| v.is_finite())
}

/// Reads an AutoEQ `ParametricEQ.txt` or an Equalizer APO config: `Preamp: -6.3 dB` and lines like
/// `Filter 1: ON PK Fc 105 Hz Gain 6.5 dB Q 0.70`. Filters that are OFF, at 0 dB, or of a kind
/// this stage does not run are left out (the last listed in `skipped`).
pub fn parse(text: &str) -> Result<Profile, String> {
    let mut profile = Profile::default();
    let mut found = false;
    for raw in text.lines() {
        let line = raw.trim().trim_start_matches('\u{feff}');
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let lower = line.to_ascii_lowercase();
        if let Some(rest) = lower.strip_prefix("preamp:") {
            let value = rest.trim().trim_end_matches("db").trim();
            profile.preamp_db += number(value).ok_or_else(|| format!("unreadable preamp: {line}"))?;
            found = true;
            continue;
        }
        if !lower.starts_with("filter") {
            continue;
        }
        let Some((_, body)) = line.split_once(':') else { continue };
        let words: Vec<&str> = body.split_whitespace().collect();
        let Some(state) = words.first() else { continue };
        if !state.eq_ignore_ascii_case("on") {
            continue;
        }
        let kind = match words.get(1).map(|k| k.to_ascii_uppercase()).as_deref() {
            Some("PK" | "PEQ" | "MODAL") => Kind::Peak,
            Some("LS" | "LSC" | "LSQ") => Kind::LowShelf,
            Some("HS" | "HSC" | "HSQ") => Kind::HighShelf,
            _ => {
                profile.skipped.push(line.to_owned());
                continue;
            }
        };
        let value_after = |key: &str| {
            words
                .iter()
                .position(|w| w.eq_ignore_ascii_case(key))
                .and_then(|i| words.get(i + 1))
                .and_then(|v| number(v))
        };
        let (Some(frequency), Some(gain_db)) = (value_after("Fc"), value_after("Gain")) else {
            profile.skipped.push(line.to_owned());
            continue;
        };
        let q = value_after("Q").unwrap_or(if kind == Kind::Peak { 1.0 } else { SHELF_Q });
        found = true;
        if gain_db == 0.0 || frequency <= 0.0 || q <= 0.0 {
            continue;
        }
        if profile.filters.len() == MAX_FILTERS {
            profile.skipped.push(line.to_owned());
            continue;
        }
        profile.filters.push(Filter { kind, frequency, gain_db, q });
    }
    if found { Ok(profile) } else { Err("no preamp and no filter in this file".into()) }
}

#[derive(Debug, Clone, Copy, Default)]
struct Coefficients {
    b0: f64,
    b1: f64,
    b2: f64,
    a1: f64,
    a2: f64,
}

impl Coefficients {
    /// RBJ Audio EQ Cookbook; `None` at or past Nyquist.
    fn of(f: &Filter, rate: f64) -> Option<Self> {
        if f.frequency >= rate / 2.0 {
            return None;
        }
        let a = 10f64.powf(f.gain_db / 40.0);
        let w0 = 2.0 * PI * f.frequency / rate;
        let (sin, cos) = w0.sin_cos();
        let alpha = sin / (2.0 * f.q);
        let (b0, b1, b2, a0, a1, a2) = match f.kind {
            Kind::Peak => (1.0 + alpha * a, -2.0 * cos, 1.0 - alpha * a, 1.0 + alpha / a, -2.0 * cos, 1.0 - alpha / a),
            Kind::LowShelf => {
                let s = 2.0 * a.sqrt() * alpha;
                (
                    a * ((a + 1.0) - (a - 1.0) * cos + s),
                    2.0 * a * ((a - 1.0) - (a + 1.0) * cos),
                    a * ((a + 1.0) - (a - 1.0) * cos - s),
                    (a + 1.0) + (a - 1.0) * cos + s,
                    -2.0 * ((a - 1.0) + (a + 1.0) * cos),
                    (a + 1.0) + (a - 1.0) * cos - s,
                )
            }
            Kind::HighShelf => {
                let s = 2.0 * a.sqrt() * alpha;
                (
                    a * ((a + 1.0) + (a - 1.0) * cos + s),
                    -2.0 * a * ((a - 1.0) + (a + 1.0) * cos),
                    a * ((a + 1.0) + (a - 1.0) * cos - s),
                    (a + 1.0) - (a - 1.0) * cos + s,
                    2.0 * ((a - 1.0) - (a + 1.0) * cos),
                    (a + 1.0) - (a - 1.0) * cos - s,
                )
            }
        };
        Some(Self { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 })
    }

    /// Magnitude in dB at `frequency`.
    fn magnitude_db(&self, frequency: f64, rate: f64) -> f64 {
        let w = 2.0 * PI * frequency / rate;
        let (c1, s1, c2, s2) = (w.cos(), w.sin(), (2.0 * w).cos(), (2.0 * w).sin());
        let num = ((self.b0 + self.b1 * c1 + self.b2 * c2).powi(2) + (self.b1 * s1 + self.b2 * s2).powi(2)).sqrt();
        let den = ((1.0 + self.a1 * c1 + self.a2 * c2).powi(2) + (self.a1 * s1 + self.a2 * s2).powi(2)).sqrt();
        20.0 * (num / den).log10()
    }
}

/// The correction's response in dB at `frequency` (preamp included), as the stage runs it at `rate`.
pub fn response_db(profile: &Profile, frequency: f64, rate: u32) -> f64 {
    profile.preamp_db
        + profile
            .filters
            .iter()
            .filter_map(|f| Coefficients::of(f, rate as f64))
            .map(|c| c.magnitude_db(frequency, rate as f64))
            .sum::<f64>()
}

#[derive(Debug, Clone, Copy, Default)]
struct History {
    x1: f64,
    x2: f64,
    y1: f64,
    y2: f64,
}

/// The stage in the chain.
pub struct Correction {
    rate: f64,
    channels: usize,
    profile: Option<Profile>,
    filters: Vec<Coefficients>,
    history: Vec<History>,
    preamp: f64,
}

impl Correction {
    pub fn new(sample_rate: u32, channels: usize) -> Self {
        Self {
            rate: sample_rate as f64,
            channels,
            profile: None,
            filters: Vec::new(),
            history: Vec::new(),
            preamp: 1.0,
        }
    }

    pub fn is_off(&self) -> bool {
        self.profile.is_none()
    }

    /// Turns the correction on with `profile`, or off with `None`.
    pub fn set(&mut self, profile: Option<Profile>) {
        if profile == self.profile {
            return;
        }
        self.filters =
            profile.iter().flat_map(|p| p.filters.iter().filter_map(|f| Coefficients::of(f, self.rate))).collect();
        self.history = vec![History::default(); self.filters.len() * self.channels];
        self.preamp = profile.as_ref().map_or(1.0, |p| 10f64.powf(p.preamp_db / 20.0));
        self.profile = profile;
    }

    pub fn process(&mut self, samples: &mut [f64]) {
        if self.profile.is_none() {
            return;
        }
        let bands = self.filters.len();
        for frame in samples.chunks_exact_mut(self.channels) {
            for (ch, sample) in frame.iter_mut().enumerate() {
                let mut x = *sample * self.preamp;
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

#[cfg(test)]
mod tests {
    use super::*;

    /// AutoEQ's oratory1990 profile for the Sennheiser HD 600 (results/oratory1990/over-ear), as
    /// fetched on 2026-11-01, with Windows line ends and a BOM as some editors save it.
    const HD600: &str = "\u{feff}Preamp: -6.3 dB\r\nFilter 1: ON LSC Fc 105 Hz Gain 6.5 dB Q 0.70\r\nFilter 2: ON PK Fc 125 Hz Gain -2.7 dB Q 0.55\r\nFilter 3: ON PK Fc 8445 Hz Gain 3.3 dB Q 1.61\r\nFilter 4: ON PK Fc 522 Hz Gain 0.7 dB Q 1.02\r\nFilter 5: ON PK Fc 1298 Hz Gain -1.2 dB Q 2.14\r\nFilter 6: ON HSC Fc 10000 Hz Gain -3.1 dB Q 0.70\r\nFilter 7: ON PK Fc 3158 Hz Gain -1.8 dB Q 3.67\r\nFilter 8: ON PK Fc 2166 Hz Gain 0.9 dB Q 3.32\r\nFilter 9: ON PK Fc 6639 Hz Gain 2.2 dB Q 5.82\r\nFilter 10: ON PK Fc 5433 Hz Gain -1.2 dB Q 5.70\r\n";

    /// An Equalizer APO config: comments, a device line, an OFF filter, a shelf without Q, a
    /// low-pass this stage does not run, a comma decimal.
    const APO: &str = "# my headphones\nDevice: Speakers\nPreamp: -3 dB\nFilter 1: ON PK Fc 1000 Hz Gain -2,5 dB Q 1.41\nFilter 2: OFF PK Fc 2000 Hz Gain 4 dB Q 1\nFilter 3: ON LS Fc 80 Hz Gain 3 dB\nFilter 4: ON LP Fc 18000 Hz\n";

    #[test]
    fn the_parser_reads_autoeq_and_equalizer_apo_files() {
        let p = parse(HD600).unwrap();
        assert_eq!(p.preamp_db, -6.3);
        assert_eq!(p.filters.len(), 10);
        assert_eq!(p.filters[0], Filter { kind: Kind::LowShelf, frequency: 105.0, gain_db: 6.5, q: 0.7 });
        assert_eq!(p.filters[5].kind, Kind::HighShelf);
        assert!(p.skipped.is_empty());
        let a = parse(APO).unwrap();
        assert_eq!(a.preamp_db, -3.0);
        assert_eq!(a.filters.len(), 2, "the OFF filter and the low-pass are not run");
        assert_eq!(a.filters[0].gain_db, -2.5);
        assert_eq!((a.filters[1].kind, a.filters[1].q), (Kind::LowShelf, SHELF_Q));
        assert_eq!(a.skipped, ["Filter 4: ON LP Fc 18000 Hz"]);
        assert!(parse("hello\nworld").is_err());
    }

    /// The stage's measured response (a sine through it, settled, RMS out over in) matches the
    /// filters' computed response within 0.1 dB at 50 frequencies, 20 Hz to 20 kHz.
    #[test]
    fn a_profiles_response_matches_its_filters() {
        let profile = parse(HD600).unwrap();
        let rate = 48_000u32;
        for i in 0..50 {
            let f = 20.0 * (1000f64).powf(i as f64 / 49.0);
            let mut stage = Correction::new(rate, 1);
            stage.set(Some(profile.clone()));
            let n = rate as usize; // one second: long enough for the narrowest filter to settle
            let mut x: Vec<f64> = (0..n).map(|k| (2.0 * PI * f * k as f64 / rate as f64).sin() * 0.25).collect();
            let input = x.clone();
            stage.process(&mut x);
            let tail = n / 2;
            let rms = |v: &[f64]| (v.iter().map(|s| s * s).sum::<f64>() / v.len() as f64).sqrt();
            let measured = 20.0 * (rms(&x[tail..]) / rms(&input[tail..])).log10();
            let computed = response_db(&profile, f, rate);
            assert!(
                (measured - computed).abs() < 0.1,
                "{f:.0} Hz: measured {measured:.3} dB, computed {computed:.3} dB"
            );
        }
    }

    #[test]
    fn off_is_bit_identical_and_on_then_off_again_too() {
        let input: Vec<f64> = (0..4096).map(|k| ((k * 7919) % 2001) as f64 / 1000.0 - 1.0).collect();
        let mut stage = Correction::new(44_100, 2);
        let mut out = input.clone();
        stage.process(&mut out);
        assert!(input.iter().zip(&out).all(|(a, b)| a.to_bits() == b.to_bits()));
        stage.set(Some(parse(HD600).unwrap()));
        assert!(!stage.is_off());
        stage.set(None);
        let mut again = input.clone();
        stage.process(&mut again);
        assert!(input.iter().zip(&again).all(|(a, b)| a.to_bits() == b.to_bits()));
    }

    #[test]
    fn shelves_reach_their_gain_and_peaks_their_centre() {
        let rate = 48_000;
        let shelf = |kind| Profile {
            preamp_db: 0.0,
            filters: vec![Filter { kind, frequency: 1000.0, gain_db: 6.0, q: SHELF_Q }],
            skipped: vec![],
        };
        let low = shelf(Kind::LowShelf);
        assert!((response_db(&low, 20.0, rate) - 6.0).abs() < 0.05);
        assert!(response_db(&low, 15_000.0, rate).abs() < 0.05);
        let high = shelf(Kind::HighShelf);
        assert!((response_db(&high, 20_000.0, rate) - 6.0).abs() < 0.1);
        assert!(response_db(&high, 20.0, rate).abs() < 0.05);
        let peak = Profile {
            preamp_db: -2.0,
            filters: vec![Filter { kind: Kind::Peak, frequency: 3000.0, gain_db: -4.0, q: 2.0 }],
            skipped: vec![],
        };
        assert!((response_db(&peak, 3000.0, rate) + 6.0).abs() < 1e-9);
    }
}

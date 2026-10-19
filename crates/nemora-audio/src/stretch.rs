//! Speed without a change of pitch, by Signalsmith Stretch (vendored, see `vendor/signalsmith`).
//!
//! One `Stretch` serves one stream of interleaved device frames from the point it starts at. Its
//! output is aligned with that point (the stretcher's own pre-roll is dropped) and has, in all,
//! the input length divided by the speed, so positions keep counting in input time exactly as
//! they do at normal speed.

use std::ptr::NonNull;

#[allow(non_camel_case_types)]
mod ffi {
    #[repr(C)]
    pub struct signalsmith_stretch_t {
        _private: [u8; 0],
    }

    unsafe extern "C" {
        pub fn signalsmith_stretch_create_preset_default(channels: i32, sample_rate: f32)
        -> *mut signalsmith_stretch_t;
        pub fn signalsmith_stretch_destroy(handle: *mut signalsmith_stretch_t);
        pub fn signalsmith_stretch_input_latency(handle: *mut signalsmith_stretch_t) -> usize;
        pub fn signalsmith_stretch_output_latency(handle: *mut signalsmith_stretch_t) -> usize;
        pub fn signalsmith_stretch_seek(
            handle: *mut signalsmith_stretch_t,
            input: *mut f32,
            input_length: usize,
            playback_rate: f64,
        );
        pub fn signalsmith_stretch_process(
            handle: *mut signalsmith_stretch_t,
            input: *mut f32,
            input_length: usize,
            output: *mut f32,
            output_length: usize,
        );
        pub fn signalsmith_stretch_flush(handle: *mut signalsmith_stretch_t, output: *mut f32, output_length: usize);
    }
}

/// The speeds the view offers (1.x: 0.25x to 4x).
pub const SPEED_RANGE: (f64, f64) = (0.25, 4.0);

/// Input given to the stretcher per call, in frames.
const CHUNK: usize = 4096;

pub struct Stretch {
    handle: NonNull<ffi::signalsmith_stretch_t>,
    channels: usize,
    speed: f64,
    input_latency: usize,
    output_latency: usize,
    /// Input not yet given to the stretcher.
    pending: Vec<f32>,
    started: bool,
    /// Frames given to `process` so far.
    processed: u64,
    /// Frames `process` and `flush` produced so far, pre-roll included.
    produced: u64,
    scratch: Vec<f32>,
}

// The handle is owned by this value alone and used from one thread at a time.
unsafe impl Send for Stretch {}

impl Stretch {
    pub fn new(channels: usize, sample_rate: u32, speed: f64) -> Self {
        // SAFETY: plain constructor; a null answer means allocation failed.
        let raw = unsafe { ffi::signalsmith_stretch_create_preset_default(channels as i32, sample_rate as f32) };
        let handle = NonNull::new(raw).expect("Signalsmith Stretch could not be created");
        // SAFETY: the handle is valid.
        let (input_latency, output_latency) = unsafe {
            (
                ffi::signalsmith_stretch_input_latency(handle.as_ptr()),
                ffi::signalsmith_stretch_output_latency(handle.as_ptr()),
            )
        };
        Self {
            handle,
            channels,
            speed: speed.clamp(SPEED_RANGE.0, SPEED_RANGE.1),
            input_latency,
            output_latency,
            pending: Vec::new(),
            started: false,
            processed: 0,
            produced: 0,
            scratch: Vec::new(),
        }
    }

    pub fn speed(&self) -> f64 {
        self.speed
    }

    /// Takes interleaved input and appends the output that is ready.
    pub fn push(&mut self, input: &[f32], out: &mut Vec<f32>) {
        self.pending.extend_from_slice(input);
        if !self.started {
            if self.pending.len() < self.input_latency * self.channels {
                return;
            }
            self.start();
        }
        while self.pending.len() >= CHUNK * self.channels {
            let chunk: Vec<f32> = self.pending.drain(..CHUNK * self.channels).collect();
            self.process(chunk, out);
        }
    }

    /// The input has ended: appends the rest of the output.
    pub fn finish(&mut self, out: &mut Vec<f32>) {
        if !self.started {
            self.start();
        }
        let mut rest = std::mem::take(&mut self.pending);
        // The processing point trails the input by the input latency; silence carries it to the
        // end of the music.
        rest.resize(rest.len() + self.input_latency * self.channels, 0.0);
        self.process(rest, out);
        let mut tail = vec![0.0f32; self.output_latency * self.channels];
        // SAFETY: `tail` holds `output_latency` frames of `channels` samples.
        unsafe { ffi::signalsmith_stretch_flush(self.handle.as_ptr(), tail.as_mut_ptr(), self.output_latency) };
        self.emit(&tail, out);
    }

    /// Hands the first `input_latency` frames over as pre-roll, so the processing point sits on
    /// the first frame of the stream.
    fn start(&mut self) {
        let frames = (self.pending.len() / self.channels).min(self.input_latency);
        let mut preroll: Vec<f32> = self.pending.drain(..frames * self.channels).collect();
        // SAFETY: `preroll` holds `frames` frames.
        unsafe { ffi::signalsmith_stretch_seek(self.handle.as_ptr(), preroll.as_mut_ptr(), frames, self.speed) };
        self.started = true;
    }

    fn process(&mut self, mut input: Vec<f32>, out: &mut Vec<f32>) {
        let frames = input.len() / self.channels;
        self.processed += frames as u64;
        // `flush` adds the output latency at the end; with the pre-roll left out, the stream comes
        // to the input length divided by the speed.
        let wanted = (self.processed as f64 / self.speed) as u64;
        let output_frames = wanted.saturating_sub(self.produced) as usize;
        let mut output = std::mem::take(&mut self.scratch);
        output.clear();
        output.resize(output_frames * self.channels, 0.0);
        // SAFETY: `input` holds `frames` frames and `output` `output_frames` frames.
        unsafe {
            ffi::signalsmith_stretch_process(
                self.handle.as_ptr(),
                input.as_mut_ptr(),
                frames,
                output.as_mut_ptr(),
                output_frames,
            );
        }
        self.emit(&output, out);
        self.scratch = output;
    }

    /// Appends produced frames, leaving out the stretcher's pre-roll.
    fn emit(&mut self, produced: &[f32], out: &mut Vec<f32>) {
        let frames = (produced.len() / self.channels) as u64;
        let preroll = (self.output_latency as u64).saturating_sub(self.produced).min(frames);
        out.extend_from_slice(&produced[preroll as usize * self.channels..]);
        self.produced += frames;
    }
}

impl Drop for Stretch {
    fn drop(&mut self) {
        // SAFETY: created by `signalsmith_stretch_create_*` and destroyed once.
        unsafe { ffi::signalsmith_stretch_destroy(self.handle.as_ptr()) };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: u32 = 44_100;

    /// `seconds` of silence, then a 997 Hz tone, in stereo.
    fn tone_after(silence: f64, seconds: f64) -> Vec<f32> {
        let quiet = (silence * RATE as f64) as usize;
        let total = (seconds * RATE as f64) as usize;
        (0..total)
            .flat_map(|i| {
                let s = if i < quiet {
                    0.0
                } else {
                    0.25 * (2.0 * std::f64::consts::PI * 997.0 * (i - quiet) as f64 / RATE as f64).sin() as f32
                };
                [s, s]
            })
            .collect()
    }

    fn stretched(input: &[f32], speed: f64) -> Vec<f32> {
        let mut stretch = Stretch::new(2, RATE, speed);
        let mut out = Vec::new();
        // Device-sized pieces, as the player hands them over.
        for piece in input.chunks(441 * 2) {
            stretch.push(piece, &mut out);
        }
        stretch.finish(&mut out);
        out
    }

    fn left(samples: &[f32]) -> Vec<f32> {
        samples.iter().step_by(2).copied().collect()
    }

    /// Where the tone reaches half its level: the middle of an onset the analysis window smears.
    fn onset(samples: &[f32]) -> usize {
        let l = left(samples);
        let ms = RATE as usize / 1000;
        l.chunks(ms).position(|w| w.iter().fold(0.0f32, |m, s| m.max(s.abs())) >= 0.125).unwrap() * ms
    }

    /// The tone's frequency, from zero crossings in the steady middle of the output.
    fn frequency(samples: &[f32], from: usize, to: usize) -> f64 {
        let l = left(samples);
        let crossings = l[from..to].windows(2).filter(|w| w[0] < 0.0 && w[1] >= 0.0).count();
        crossings as f64 * RATE as f64 / (to - from) as f64
    }

    #[test]
    fn the_output_lasts_the_input_divided_by_the_speed() {
        let input = tone_after(0.0, 3.0);
        let frames = input.len() / 2;
        for speed in [0.25, 0.5, 0.75, 1.25, 1.5, 2.0, 4.0] {
            let out = stretched(&input, speed);
            let expected = (frames as f64 / speed) as usize;
            assert_eq!(out.len() / 2, expected, "{speed}x");
        }
    }

    #[test]
    fn the_pitch_stays_put() {
        let input = tone_after(0.0, 3.0);
        for speed in [0.5, 1.5, 2.0] {
            let out = stretched(&input, speed);
            let frames = out.len() / 2;
            let hz = frequency(&out, frames / 4, frames * 3 / 4);
            assert!((hz - 997.0).abs() < 997.0 * 0.01, "{speed}x plays the tone at {hz:.1} Hz");
        }
    }

    #[test]
    fn a_moment_of_the_music_lands_at_its_time_divided_by_the_speed() {
        let input = tone_after(1.0, 2.5);
        for speed in [0.25, 0.5, 2.0, 4.0] {
            let out = stretched(&input, speed);
            // In music time: the tone begins one second in.
            let landed = onset(&out) as f64 * speed / RATE as f64;
            // The stretcher's analysis window smears an onset by a few milliseconds (worst 4.3 ms in
            // 300 runs). Stretching by more than 2x (below 0.5x) it also randomises phases, seeded
            // from std::random_device, so the smear varies run to run: worst 10.2 ms in 300 at 0.25x.
            let tolerance = if speed < 0.5 { 0.020 } else { 0.008 };
            assert!((landed - 1.0).abs() < tolerance, "{speed}x: the tone starts at {landed:.4} s of music, not 1 s");
        }
    }
}

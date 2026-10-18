//! Rate conversion when a file's rate differs from the device's (a 44.1 kHz file on a 48 kHz
//! device): done here with a high-quality FFT resampler (rubato), not left to Windows. Files at the
//! device rate never pass through it.

use rubato::audioadapter_buffers::direct::InterleavedSlice;
use rubato::{Fft, FixedSync, Resampler};

/// Input frames per resampler call.
const CHUNK: usize = 1024;

pub struct Stream {
    resampler: Fft<f32>,
    channels: usize,
    /// Input waiting for a full chunk.
    pending: Vec<f32>,
    out: Vec<f32>,
    /// Output frames still to drop: the resampler's own delay, so the signal is not shifted.
    delay: usize,
    from: u64,
    to: u64,
    frames_in: u64,
    frames_out: u64,
}

impl Stream {
    pub fn new(from: u32, to: u32, channels: usize) -> Result<Self, String> {
        let resampler = Fft::<f32>::new(from as usize, to as usize, CHUNK, channels, FixedSync::Input)
            .map_err(|e| e.to_string())?;
        let delay = resampler.output_delay();
        let out = vec![0.0; resampler.output_frames_max() * channels];
        Ok(Self {
            resampler,
            channels,
            pending: Vec::new(),
            out,
            delay,
            from: from as u64,
            to: to as u64,
            frames_in: 0,
            frames_out: 0,
        })
    }

    /// Feeds interleaved input; appends whatever output is ready to `output`.
    pub fn push(&mut self, input: &[f32], output: &mut Vec<f32>) -> Result<(), String> {
        self.pending.extend_from_slice(input);
        self.frames_in += (input.len() / self.channels) as u64;
        let need = self.resampler.input_frames_next() * self.channels;
        while self.pending.len() >= need {
            self.run(need, None, output)?;
        }
        Ok(())
    }

    /// Ends the stream: the input still pending and the resampler's tail, cut to exactly the
    /// length the input has at the new rate.
    pub fn finish(&mut self, output: &mut Vec<f32>) -> Result<(), String> {
        let expected = (self.frames_in * self.to).div_ceil(self.from);
        let start = output.len();
        let need = self.resampler.input_frames_next() * self.channels;
        // Silence pushes the last real samples through the filter's delay.
        let mut rounds = 0;
        while self.frames_out < expected && rounds < 64 {
            self.pending.resize(need, 0.0);
            self.run(need, None, output)?;
            rounds += 1;
        }
        let extra = (self.frames_out.saturating_sub(expected) as usize * self.channels).min(output.len() - start);
        output.truncate(output.len() - extra);
        self.frames_out -= (extra / self.channels) as u64;
        Ok(())
    }

    fn run(
        &mut self,
        need: usize,
        indexing: Option<&rubato::Indexing>,
        output: &mut Vec<f32>,
    ) -> Result<usize, String> {
        let frames_in = need / self.channels;
        let input =
            InterleavedSlice::new(&self.pending[..need], self.channels, frames_in).map_err(|e| e.to_string())?;
        let frames_out_max = self.out.len() / self.channels;
        let mut out =
            InterleavedSlice::new_mut(&mut self.out, self.channels, frames_out_max).map_err(|e| e.to_string())?;
        let (_, produced) =
            self.resampler.process_into_buffer(&input, &mut out, indexing).map_err(|e| e.to_string())?;
        self.pending.drain(..need);
        let skip = self.delay.min(produced);
        self.delay -= skip;
        output.extend_from_slice(&self.out[skip * self.channels..produced * self.channels]);
        self.frames_out += (produced - skip) as u64;
        Ok(produced)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_tone_keeps_its_pitch_and_length() {
        let (from, to) = (44_100u32, 48_000u32);
        let seconds = 1.0;
        let input: Vec<f32> = (0..(from as f64 * seconds) as usize)
            .map(|i| (2.0 * std::f64::consts::PI * 1000.0 * i as f64 / from as f64).sin() as f32 * 0.5)
            .collect();
        let mut stream = Stream::new(from, to, 1).unwrap();
        let mut out = Vec::new();
        for block in input.chunks(777) {
            stream.push(block, &mut out).unwrap();
        }
        stream.finish(&mut out).unwrap();
        let expected = (to as f64 * seconds) as usize;
        assert_eq!(out.len(), expected, "the length at the new rate");
        // Zero crossings in the steady middle: a 1 kHz tone crosses twice per millisecond.
        let middle = &out[to as usize / 4..to as usize * 3 / 4];
        let crossings = middle.windows(2).filter(|w| (w[0] < 0.0) != (w[1] < 0.0)).count();
        assert!((crossings as i64 - 1000).abs() <= 2, "{crossings} crossings in 0.5 s");
        // The delay is removed: the first output sample is the first input sample's neighbourhood.
        assert!(out[0].abs() < 0.05, "{}", out[0]);
    }
}

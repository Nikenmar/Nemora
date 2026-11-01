//! One track as the device needs it: decoded, converted to the device rate when it differs (or, with
//! varispeed on, resampled at another speed so the pitch goes with it, PLAN/18), laid out on the
//! device's channels, and stretched when the listener changed the speed with the pitch kept.

use std::path::{Path, PathBuf};

use crate::decode::{DecodeError, Decoder};
use crate::resample;
use crate::stretch::Stretch;
use crate::vari::Varispeed;

pub struct Source {
    path: PathBuf,
    decoder: Decoder,
    resampler: Option<resample::Stream>,
    /// Varispeed, in place of `resampler`, while its factor is not 1.
    vari: Option<Varispeed>,
    factor: f64,
    out_rate: u32,
    out_channels: usize,
    block: Vec<f32>,
    /// Device-format samples not yet handed out.
    staged: Vec<f32>,
    finished: bool,
    speed: f64,
    /// Only while the speed is not 1: at 1 nothing stands between the decoder and the device.
    stretch: Option<Stretch>,
}

/// Lays interleaved `input` with `from` channels onto `to` channels: equal counts are copied as
/// they are; mono goes to every channel; otherwise the first channels are kept and the rest
/// left silent.
pub fn map_channels(input: &[f32], from: usize, to: usize, out: &mut Vec<f32>) {
    if from == to {
        out.extend_from_slice(input);
        return;
    }
    for frame in input.chunks_exact(from) {
        for ch in 0..to {
            out.push(if from == 1 {
                frame[0]
            } else if ch < from {
                frame[ch]
            } else {
                0.0
            });
        }
    }
}

impl Source {
    pub fn open(path: &Path, out_rate: u32, out_channels: usize) -> Result<Self, DecodeError> {
        let decoder = Decoder::open(path)?;
        let resampler = Self::resampler_for(&decoder, out_rate)?;
        Ok(Self {
            path: path.to_owned(),
            decoder,
            resampler,
            vari: None,
            factor: 1.0,
            out_rate,
            out_channels,
            block: Vec::new(),
            staged: Vec::new(),
            finished: false,
            speed: 1.0,
            stretch: None,
        })
    }

    /// Plays at `speed` with the pitch kept, from the start or from the next `seek`.
    pub fn set_speed(&mut self, speed: f64) {
        self.speed = speed;
        self.stretch = self.new_stretch();
    }

    /// The varispeed factor in use (1: off).
    pub fn factor(&self) -> f64 {
        self.factor
    }

    /// Sets the varispeed factor before anything is read (a fresh source).
    pub fn set_factor(&mut self, factor: f64) -> Result<(), DecodeError> {
        self.factor = factor;
        self.rebuild_rate()
    }

    /// Changes the factor while playing: `true` when it glides from here (nothing else to do),
    /// `false` when the caller must `seek` to where it is heard, which rebuilds the stream.
    pub fn change_factor(&mut self, factor: f64) -> bool {
        let glided = factor != 1.0 && self.vari.as_mut().is_some_and(|v| v.glide(factor));
        self.factor = factor;
        glided
    }

    /// The rate stage for the current factor: varispeed, the device-rate resampler, or nothing.
    fn rebuild_rate(&mut self) -> Result<(), DecodeError> {
        if self.factor == 1.0 {
            self.vari = None;
            self.resampler = Self::resampler_for(&self.decoder, self.out_rate)?;
        } else {
            self.resampler = None;
            self.vari = Some(
                Varispeed::new(self.decoder.sample_rate, self.out_rate, self.decoder.channels, self.factor)
                    .map_err(DecodeError::Decode)?,
            );
        }
        Ok(())
    }

    fn new_stretch(&self) -> Option<Stretch> {
        (self.speed != 1.0).then(|| Stretch::new(self.out_channels, self.out_rate, self.speed))
    }

    fn resampler_for(decoder: &Decoder, out_rate: u32) -> Result<Option<resample::Stream>, DecodeError> {
        if decoder.sample_rate == out_rate {
            return Ok(None);
        }
        resample::Stream::new(decoder.sample_rate, out_rate, decoder.channels).map(Some).map_err(DecodeError::Decode)
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn duration(&self) -> Option<f64> {
        self.decoder.duration()
    }

    /// Whether the source passes samples through untouched (no rate conversion, same channels,
    /// normal speed).
    pub fn is_direct(&self) -> bool {
        self.resampler.is_none()
            && self.vari.is_none()
            && self.decoder.channels == self.out_channels
            && self.stretch.is_none()
    }

    /// Appends up to `max_frames` device frames to `out`. `false` once nothing is left.
    pub fn fill(&mut self, out: &mut Vec<f32>, max_frames: usize) -> Result<bool, DecodeError> {
        while self.staged.len() < max_frames * self.out_channels && !self.finished {
            let mut decoded = Vec::new();
            let more = self.decoder.next_block(&mut self.block)?;
            match (&mut self.vari, &mut self.resampler) {
                (Some(v), _) if more => v.push(&self.block, &mut decoded).map_err(DecodeError::Decode)?,
                (Some(v), _) => v.finish(&mut decoded).map_err(DecodeError::Decode)?,
                (None, Some(r)) if more => r.push(&self.block, &mut decoded).map_err(DecodeError::Decode)?,
                (None, Some(r)) => r.finish(&mut decoded).map_err(DecodeError::Decode)?,
                (None, None) if more => decoded.extend_from_slice(&self.block),
                (None, None) => {}
            }
            match &mut self.stretch {
                Some(stretch) => {
                    let mut mapped = Vec::new();
                    map_channels(&decoded, self.decoder.channels, self.out_channels, &mut mapped);
                    stretch.push(&mapped, &mut self.staged);
                    if !more {
                        stretch.finish(&mut self.staged);
                    }
                }
                None => map_channels(&decoded, self.decoder.channels, self.out_channels, &mut self.staged),
            }
            self.finished = !more;
        }
        let n = self.staged.len().min(max_frames * self.out_channels);
        out.extend(self.staged.drain(..n));
        Ok(!(self.finished && self.staged.is_empty()) || n > 0)
    }

    /// Moves to `seconds`; answers where playback resumes.
    pub fn seek(&mut self, seconds: f64) -> Result<f64, DecodeError> {
        let landed = self.decoder.seek(seconds)?;
        self.rebuild_rate()?;
        self.staged.clear();
        self.finished = false;
        self.stretch = self.new_stretch();
        Ok(landed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mono_reaches_both_speakers_and_stereo_stays_put() {
        let mut out = Vec::new();
        map_channels(&[0.1, 0.2], 1, 2, &mut out);
        assert_eq!(out, [0.1, 0.1, 0.2, 0.2]);
        out.clear();
        map_channels(&[0.1, 0.2], 2, 2, &mut out);
        assert_eq!(out, [0.1, 0.2]);
        out.clear();
        map_channels(&[0.1, 0.2], 2, 4, &mut out);
        assert_eq!(out, [0.1, 0.2, 0.0, 0.0]);
    }
}

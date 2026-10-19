//! Decoding a file into PCM, block by block.
//!
//! Samples come out as `f32`, which holds 16- and 24-bit PCM exactly, so the decoded signal is the
//! file's own. Decoders trim encoder delay and padding (gapless), so consecutive tracks of a
//! continuous album join without a gap or a click.

use std::path::Path;

use symphonia::core::codecs::audio::{AudioDecoder, AudioDecoderOptions};
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::{FormatOptions, FormatReader, SeekMode, SeekTo, TrackType};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::units::{Time, TimeBase};

#[derive(Debug, thiserror::Error)]
pub enum DecodeError {
    #[error("cannot open {path}: {reason}")]
    Open { path: String, reason: String },
    #[error("decoding failed: {0}")]
    Decode(String),
}

pub struct Decoder {
    reader: Box<dyn FormatReader>,
    decoder: Box<dyn AudioDecoder>,
    track_id: u32,
    time_base: Option<TimeBase>,
    pub sample_rate: u32,
    pub channels: usize,
    /// Total frames when the container states them.
    pub frames: Option<u64>,
    /// Frames handed out since the start (or since the last seek's landing point).
    position: u64,
    /// Frames still to drop after a seek: the reader lands on the start of the packet that holds
    /// the requested moment.
    skip: u64,
}

impl Decoder {
    pub fn open(path: &Path) -> Result<Self, DecodeError> {
        let fail = |reason: String| DecodeError::Open { path: path.display().to_string(), reason };
        let file = std::fs::File::open(path).map_err(|e| fail(e.to_string()))?;
        let stream = MediaSourceStream::new(Box::new(file), Default::default());
        let mut hint = Hint::new();
        if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
            hint.with_extension(ext);
        }
        let reader = symphonia::default::get_probe()
            .probe(&hint, stream, FormatOptions::default(), MetadataOptions::default())
            .map_err(|e| fail(e.to_string()))?;
        let track = reader.default_track(TrackType::Audio).ok_or_else(|| fail("no audio track".into()))?;
        let params = track
            .codec_params
            .as_ref()
            .and_then(|p| p.audio())
            .ok_or_else(|| fail("no audio parameters".into()))?
            .clone();
        let decoder = symphonia::default::get_codecs()
            .make_audio_decoder(&params, &AudioDecoderOptions::default())
            .map_err(|e| fail(e.to_string()))?;
        let sample_rate = params.sample_rate.ok_or_else(|| fail("no sample rate".into()))?;
        let channels =
            params.channels.as_ref().map(|c| c.count()).filter(|&c| c > 0).ok_or_else(|| fail("no channels".into()))?;
        let (track_id, time_base, frames) = (track.id, track.time_base, track.num_frames);
        Ok(Self { reader, decoder, track_id, time_base, sample_rate, channels, frames, position: 0, skip: 0 })
    }

    /// Seconds of audio, when known.
    pub fn duration(&self) -> Option<f64> {
        self.frames.map(|f| f as f64 / self.sample_rate as f64)
    }

    /// Where the next block starts, in seconds.
    pub fn position(&self) -> f64 {
        self.position as f64 / self.sample_rate as f64
    }

    /// The next block of interleaved samples into `out` (replaced). `false` at the end.
    pub fn next_block(&mut self, out: &mut Vec<f32>) -> Result<bool, DecodeError> {
        loop {
            let packet = match self.reader.next_packet() {
                Ok(Some(packet)) => packet,
                Ok(None) => return Ok(false),
                Err(SymphoniaError::ResetRequired) => return Ok(false),
                Err(SymphoniaError::IoError(e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(false),
                Err(e) => return Err(DecodeError::Decode(e.to_string())),
            };
            if packet.track_id != self.track_id {
                continue;
            }
            match self.decoder.decode(&packet) {
                Ok(buffer) => {
                    out.clear();
                    out.resize(buffer.samples_interleaved(), 0.0);
                    buffer.copy_to_slice_interleaved(out.as_mut_slice());
                    if self.skip > 0 {
                        let dropped = (self.skip as usize).min(out.len() / self.channels);
                        out.drain(..dropped * self.channels);
                        self.skip -= dropped as u64;
                    }
                    if out.is_empty() {
                        continue;
                    }
                    self.position += (out.len() / self.channels) as u64;
                    return Ok(true);
                }
                // A damaged packet is skipped, as players do; the rest of the file still plays.
                Err(SymphoniaError::DecodeError(_)) | Err(SymphoniaError::IoError(_)) => continue,
                Err(e) => return Err(DecodeError::Decode(e.to_string())),
            }
        }
    }

    /// Moves to `seconds`; answers where playback resumes: the requested moment itself, unless the
    /// container cannot place it.
    pub fn seek(&mut self, seconds: f64) -> Result<f64, DecodeError> {
        let time = Time::try_from_secs_f64(seconds.max(0.0)).unwrap_or(Time::ZERO);
        let seeked = self
            .reader
            .seek(SeekMode::Accurate, SeekTo::Time { time, track_id: Some(self.track_id) })
            .map_err(|e| DecodeError::Decode(e.to_string()))?;
        self.decoder.reset();
        let time = |ts| self.time_base.and_then(|tb| tb.calc_time(ts)).map(|t| t.as_secs_f64());
        let (actual, required) = (time(seeked.actual_ts), time(seeked.required_ts));
        let landed = required.or(actual).unwrap_or(seconds);
        self.skip = match (actual, required) {
            (Some(a), Some(r)) if r > a => ((r - a) * self.sample_rate as f64).round() as u64,
            _ => 0,
        };
        self.position = (landed * self.sample_rate as f64).round().max(0.0) as u64;
        Ok(landed)
    }
}

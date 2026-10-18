//! Track identity: `nemora-audio-v1`.
//!
//! A track is identified by its audio stream alone. Tags, embedded pictures, the file name and the
//! folder take no part, so a retagged, renamed or moved file keeps its id and its history, and the
//! same file yields the same id on every device. The contract is
//! `crates/nemora-core/spec/identity-v1.md`; this module is its only implementation.
//!
//! The hash covers the demuxed packet payloads, not the file bytes: the container layout around
//! them (metadata blocks, padding, ID3/APE tags, MP4 atom order, OGG page numbering) changes when a
//! tagger rewrites a file, the packets do not.

use std::fmt;
use std::fs::File;
use std::path::Path;
use std::str::FromStr;

use symphonia::core::codecs::CodecParameters;
use symphonia::core::codecs::audio::well_known::{
    CODEC_ID_AAC, CODEC_ID_ALAC, CODEC_ID_FLAC, CODEC_ID_MP1, CODEC_ID_MP2, CODEC_ID_MP3, CODEC_ID_OPUS,
    CODEC_ID_VORBIS,
};
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::{FormatOptions, TrackType};
use symphonia::core::io::{MediaSource, MediaSourceStream};
use symphonia::core::meta::MetadataOptions;

use crate::ids;

/// The algorithm tag, hashed first. A new algorithm gets a new tag and never reuses this one.
pub const ALGORITHM: &str = "nemora-audio-v1";

/// Packet payload taken into the hash: whole packets until at least this many bytes.
pub const WINDOW_BYTES: u64 = 2 * 1024 * 1024;

/// Containers whose frame count is stated exactly in the file and does not move when tags change.
/// MPEG audio and ADTS streams are absent on purpose: without a Xing/Info/VBRI header the demuxer
/// estimates their length from the file size, tags included.
const EXACT_FRAME_COUNT_FORMATS: &[&str] = &["flac", "isomp4", "ogg", "wave", "aiff", "matroska"];

/// A 128-bit song id, written as 26 lowercase base32 characters (RFC 4648 alphabet, no padding).
#[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct SongId([u8; 16]);

impl SongId {
    pub const fn from_bytes(bytes: [u8; 16]) -> Self {
        Self(bytes)
    }

    pub const fn as_bytes(&self) -> &[u8; 16] {
        &self.0
    }
}

impl fmt::Display for SongId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&ids::encode(&self.0))
    }
}

impl fmt::Debug for SongId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "SongId({self})")
    }
}

impl FromStr for SongId {
    type Err = IdentityError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        ids::decode(s).map(Self).ok_or_else(|| IdentityError::InvalidSongId(s.to_owned()))
    }
}

/// What the identity was computed from, kept for diagnostics and the scan index.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Identity {
    pub song_id: SongId,
    pub codec: &'static str,
    pub format: &'static str,
    pub sample_rate: u32,
    pub channels: u8,
    /// The frame count that entered the hash; `None` when the container does not state it exactly.
    pub frame_count: Option<u64>,
    pub packets_hashed: u64,
    pub bytes_hashed: u64,
}

#[derive(Debug, thiserror::Error)]
pub enum IdentityError {
    #[error("cannot open the file: {0}")]
    Io(#[from] std::io::Error),
    #[error("not a supported audio file: {0}")]
    Unsupported(String),
    #[error("the file has no audio track")]
    NoAudioTrack,
    #[error("the audio stream has no packets")]
    Empty,
    #[error("not a song id: {0:?}")]
    InvalidSongId(String),
}

/// Identifies a file on disk. The extension is only a hint for the probe; the content decides.
pub fn identify_path(path: &Path) -> Result<Identity, IdentityError> {
    let file = File::open(path)?;
    let extension = path.extension().and_then(|e| e.to_str());
    identify(Box::new(file), extension)
}

/// Identifies any readable, seekable source (a file, an Android file descriptor, a buffer).
pub fn identify(source: Box<dyn MediaSource>, extension_hint: Option<&str>) -> Result<Identity, IdentityError> {
    let stream = MediaSourceStream::new(source, Default::default());
    let mut hint = Hint::new();
    if let Some(extension) = extension_hint {
        hint.with_extension(extension);
    }
    let mut reader = symphonia::default::get_probe()
        .probe(&hint, stream, FormatOptions::default(), MetadataOptions::default())
        .map_err(|e| IdentityError::Unsupported(e.to_string()))?;

    let format = reader.format_info().short_name;
    let track = reader.default_track(TrackType::Audio).ok_or(IdentityError::NoAudioTrack)?;
    let track_id = track.id;
    let Some(CodecParameters::Audio(params)) = track.codec_params.as_ref() else {
        return Err(IdentityError::NoAudioTrack);
    };
    let codec = codec_name(params.codec);
    let sample_rate = params.sample_rate.unwrap_or(0);
    let channels = params.channels.as_ref().map_or(0, |c| c.count() as u8);
    let frame_count = if EXACT_FRAME_COUNT_FORMATS.contains(&format) { track.num_frames } else { None };

    let mut hasher = blake3::Hasher::new();
    hasher.update(ALGORITHM.as_bytes());
    hasher.update(&[0]);
    hasher.update(codec.as_bytes());
    hasher.update(&[0]);
    hasher.update(&sample_rate.to_le_bytes());
    hasher.update(&[channels]);
    hasher.update(&frame_count.unwrap_or(0).to_le_bytes());

    let mut packets_hashed = 0u64;
    let mut bytes_hashed = 0u64;
    while bytes_hashed < WINDOW_BYTES {
        let packet = match reader.next_packet() {
            Ok(Some(packet)) => packet,
            Ok(None) => break,
            // A damaged tail or a chained stream ends the window; what was read still identifies
            // the file, and the same damage gives the same id again.
            Err(SymphoniaError::ResetRequired) | Err(SymphoniaError::IoError(_)) => break,
            Err(SymphoniaError::DecodeError(_)) => break,
            Err(e) => return Err(IdentityError::Unsupported(e.to_string())),
        };
        if packet.track_id != track_id {
            continue;
        }
        hasher.update(&(packet.data.len() as u32).to_le_bytes());
        hasher.update(&packet.data);
        packets_hashed += 1;
        bytes_hashed += packet.data.len() as u64;
    }
    if packets_hashed == 0 {
        return Err(IdentityError::Empty);
    }

    let digest = hasher.finalize();
    let mut bytes = [0u8; 16];
    bytes.copy_from_slice(&digest.as_bytes()[..16]);
    Ok(Identity {
        song_id: SongId(bytes),
        codec,
        format,
        sample_rate,
        channels,
        frame_count,
        packets_hashed,
        bytes_hashed,
    })
}

/// Stable codec names owned by the spec, independent of symphonia's numbering.
fn codec_name(id: symphonia::core::codecs::audio::AudioCodecId) -> &'static str {
    match id {
        CODEC_ID_FLAC => "flac",
        CODEC_ID_ALAC => "alac",
        CODEC_ID_MP1 => "mp1",
        CODEC_ID_MP2 => "mp2",
        CODEC_ID_MP3 => "mp3",
        CODEC_ID_AAC => "aac",
        CODEC_ID_VORBIS => "vorbis",
        CODEC_ID_OPUS => "opus",
        // Every PCM layout is one family: the layout is in the packets themselves.
        _ if is_pcm(id) => "pcm",
        _ => "other",
    }
}

fn is_pcm(id: symphonia::core::codecs::audio::AudioCodecId) -> bool {
    use symphonia::core::codecs::audio::well_known::*;
    [
        CODEC_ID_PCM_S8,
        CODEC_ID_PCM_U8,
        CODEC_ID_PCM_S16LE,
        CODEC_ID_PCM_S16BE,
        CODEC_ID_PCM_U16LE,
        CODEC_ID_PCM_U16BE,
        CODEC_ID_PCM_S24LE,
        CODEC_ID_PCM_S24BE,
        CODEC_ID_PCM_U24LE,
        CODEC_ID_PCM_U24BE,
        CODEC_ID_PCM_S32LE,
        CODEC_ID_PCM_S32BE,
        CODEC_ID_PCM_U32LE,
        CODEC_ID_PCM_U32BE,
        CODEC_ID_PCM_F32LE,
        CODEC_ID_PCM_F32BE,
        CODEC_ID_PCM_F64LE,
        CODEC_ID_PCM_F64BE,
        CODEC_ID_PCM_ALAW,
        CODEC_ID_PCM_MULAW,
    ]
    .contains(&id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn song_id_round_trips_through_text() {
        let id = SongId::from_bytes([7; 16]);
        assert_eq!(id.to_string().parse::<SongId>().unwrap(), id);
        assert!("not an id".parse::<SongId>().is_err());
    }
}

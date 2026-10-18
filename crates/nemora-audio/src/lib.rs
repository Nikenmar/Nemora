//! Nemora desktop playback engine: decoding, rate conversion only when the device needs it, the
//! user's sound settings in float, and a WASAPI shared stream.

pub mod decode;
pub mod dsp;
pub mod output;
pub mod player;
pub mod resample;
pub mod source;
#[cfg(test)]
mod transparency;

pub use player::{Event, Player};

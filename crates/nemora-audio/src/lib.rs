//! Nemora desktop playback engine: decoding, rate conversion only when the device needs it, the
//! user's sound settings in float, and a WASAPI shared stream.

pub mod decode;
pub mod dsp;
pub mod output;
pub mod player;
pub mod resample;
pub mod reverb;
pub mod source;
pub mod stretch;
#[cfg(test)]
mod transparency;
pub mod vari;
pub mod visuals;

pub use player::{Event, Player};

//! The shared core of Nemora 2.0.
//!
//! The only code that reads or writes the library database, identifies tracks and decides what a
//! play, a skip or a duel result is. The desktop app links it directly; the Android app reaches it
//! through UniFFI. Format contracts live in `spec/`.

pub mod covers;
pub mod db;
pub mod error;
pub mod identity;
pub mod import;
pub mod ids;
pub mod scan;
pub mod tags;

pub use error::{Error, Result};

/// The core's version, shown by both apps for diagnostics.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

//! The shared core of Nemora 2.0.
//!
//! The only code that reads or writes the library database, identifies tracks and decides what a
//! play, a skip or a duel result is. The desktop app links it directly; the Android app reaches it
//! through UniFFI. Format contracts live in `spec/`.

// SQL rows are read as tuples; naming every one of them would not make the queries clearer.
#![allow(clippy::type_complexity)]

pub mod covers;
pub mod db;
pub mod elo;
pub mod error;
pub mod identity;
pub mod ids;
pub mod import;
pub mod library;
pub mod lyrics;
pub mod m3u;
pub mod playlists;
pub mod plays;
pub mod recap;
pub mod rediscover;
pub mod scan;
pub mod search;
pub mod settings;
pub mod shuffle;
pub mod stats;
pub mod tags;
pub mod time;
pub mod tournament;
pub mod transfer;

pub use error::{Error, Result};

/// The core's version, shown by both apps for diagnostics.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

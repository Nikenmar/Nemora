//! The device side: a WASAPI shared stream (through cpal) at the device's own mix format, fed from a
//! short buffer. The user's sound settings (equalizer, volume, fades) are applied here, as samples
//! leave, so a change is heard at once instead of after the buffered audio.
//!
//! The device is never taken: shared mode only, so other programs (a DAW included) keep playing.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{Receiver, Sender, channel};
use std::sync::{Arc, Mutex};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

use crate::dsp::Chain;

/// Settings sent to the device callback.
pub enum Control {
    Volume(f64),
    Equalizer([f64; 10]),
    /// Ramp the gain to `to` over `frames`; with `pause_after`, stop consuming once silent.
    Fade {
        to: f64,
        frames: u64,
        pause_after: bool,
    },
    Resume,
}

/// What the renderer and the player share with the callback.
pub struct Shared {
    pub buffer: Mutex<VecDeque<f32>>,
    /// Frames the device has taken from the buffer since the stream started.
    pub consumed: AtomicU64,
    /// Set by the callback when a pausing fade has finished; cleared by `Resume`.
    pub paused: AtomicBool,
}

pub struct Output {
    _stream: cpal::Stream,
    pub sample_rate: u32,
    pub channels: usize,
    pub shared: Arc<Shared>,
    control: Sender<Control>,
    pub failed: Arc<AtomicBool>,
}

impl Output {
    /// Opens the default output device at its mix format.
    pub fn open() -> Result<Self, String> {
        let host = cpal::default_host();
        let device = host.default_output_device().ok_or("no output device")?;
        let config = device.default_output_config().map_err(|e| e.to_string())?;
        if config.sample_format() != cpal::SampleFormat::F32 {
            return Err(format!("the device mixes in {:?}, not float", config.sample_format()));
        }
        let stream_config: cpal::StreamConfig = config.into();
        let sample_rate = stream_config.sample_rate;
        let channels = stream_config.channels as usize;
        let shared = Arc::new(Shared {
            buffer: Mutex::new(VecDeque::new()),
            consumed: AtomicU64::new(0),
            paused: AtomicBool::new(true),
        });
        let (control, controls) = channel();
        let failed = Arc::new(AtomicBool::new(false));
        let mut callback = Callback::new(Arc::clone(&shared), controls, sample_rate, channels);
        let failure = Arc::clone(&failed);
        let stream = device
            .build_output_stream(
                stream_config,
                move |data: &mut [f32], _: &cpal::OutputCallbackInfo| callback.fill(data),
                move |error| {
                    eprintln!("[nemora-audio] output stream: {error}");
                    failure.store(true, Ordering::SeqCst);
                },
                None,
            )
            .map_err(|e| e.to_string())?;
        stream.play().map_err(|e| e.to_string())?;
        Ok(Self { _stream: stream, sample_rate, channels, shared, control, failed })
    }

    pub fn send(&self, control: Control) {
        let _ = self.control.send(control);
    }
}

/// The device callback's state. It never allocates after the first call of a given size, and takes
/// the buffer lock only briefly; if the lock is busy it plays silence for that period rather than
/// wait.
pub(crate) struct Callback {
    shared: Arc<Shared>,
    controls: Receiver<Control>,
    chain: Chain,
    channels: usize,
    pause_after_fade: bool,
}

impl Callback {
    pub(crate) fn new(shared: Arc<Shared>, controls: Receiver<Control>, sample_rate: u32, channels: usize) -> Self {
        Self { shared, controls, chain: Chain::new(sample_rate, channels), channels, pause_after_fade: false }
    }

    pub(crate) fn fill(&mut self, data: &mut [f32]) {
        while let Ok(control) = self.controls.try_recv() {
            match control {
                Control::Volume(gain) => self.chain.set_volume(gain),
                Control::Equalizer(gains) => self.chain.equalizer.set_gains(gains),
                Control::Fade { to, frames, pause_after } => {
                    self.chain.start_fade(to, frames);
                    self.pause_after_fade = pause_after;
                }
                Control::Resume => self.shared.paused.store(false, Ordering::SeqCst),
            }
        }
        if self.shared.paused.load(Ordering::SeqCst) {
            data.fill(0.0);
            return;
        }
        let taken = match self.shared.buffer.try_lock() {
            Ok(mut buffer) => {
                let n = data.len().min(buffer.len()) / self.channels * self.channels;
                for (out, sample) in data.iter_mut().zip(buffer.drain(..n)) {
                    *out = sample;
                }
                n
            }
            Err(_) => 0,
        };
        data[taken..].fill(0.0);
        self.shared.consumed.fetch_add((taken / self.channels) as u64, Ordering::SeqCst);
        self.chain.process(&mut data[..taken]);
        if self.pause_after_fade && !self.chain.is_fading() && self.chain.fade_target() == 0.0 {
            self.pause_after_fade = false;
            self.shared.paused.store(true, Ordering::SeqCst);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn callback() -> (Callback, Arc<Shared>, Sender<Control>) {
        let shared = Arc::new(Shared {
            buffer: Mutex::new(VecDeque::new()),
            consumed: AtomicU64::new(0),
            paused: AtomicBool::new(false),
        });
        let (tx, rx) = channel();
        (Callback::new(Arc::clone(&shared), rx, 48_000, 2), shared, tx)
    }

    #[test]
    fn samples_leave_untouched_at_neutral_settings() {
        let (mut cb, shared, _tx) = callback();
        let input: Vec<f32> = (0..2048).map(|i| ((i * 7919) % 2001) as f32 / 1000.0 - 1.0).collect();
        shared.buffer.lock().unwrap().extend(&input);
        let mut out = vec![9.0f32; 2048];
        cb.fill(&mut out);
        assert!(input.iter().zip(&out).all(|(a, b)| a.to_bits() == b.to_bits()));
        assert_eq!(shared.consumed.load(Ordering::SeqCst), 1024);
    }

    #[test]
    fn a_pausing_fade_stops_consuming_once_silent() {
        let (mut cb, shared, tx) = callback();
        shared.buffer.lock().unwrap().extend(std::iter::repeat_n(0.5f32, 48_000));
        tx.send(Control::Fade { to: 0.0, frames: 100, pause_after: true }).unwrap();
        let mut out = vec![0.0f32; 400];
        cb.fill(&mut out);
        assert!(shared.paused.load(Ordering::SeqCst));
        let consumed = shared.consumed.load(Ordering::SeqCst);
        cb.fill(&mut out);
        assert_eq!(shared.consumed.load(Ordering::SeqCst), consumed, "a paused stream keeps its place");
        assert!(out.iter().all(|s| *s == 0.0));
        tx.send(Control::Resume).unwrap();
        tx.send(Control::Fade { to: 1.0, frames: 100, pause_after: false }).unwrap();
        cb.fill(&mut out);
        assert!(shared.consumed.load(Ordering::SeqCst) > consumed);
    }
}

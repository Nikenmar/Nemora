//! The player: one thread that keeps the device buffer topped up from the current track, takes
//! commands, and reports what is heard. Positions are counted in frames the device has actually
//! taken, so they describe what the listener hears, not what was decoded.
//!
//! Gapless: the owner may queue the track that follows. Once the current track is decoded to its
//! end, the following one continues in the same buffer from the very next frame, and its events
//! begin when the device plays its first frame.

use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender, channel};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use crate::decode::DecodeError;
use crate::dsp::perceptual_gain;
use crate::output::{Control, Output};
use crate::source::Source;
use crate::stretch::SPEED_RANGE;

/// About how much audio waits in the device buffer.
const BUFFER_SECONDS: f64 = 0.2;
/// 1.x faded play and pause over 250 ms.
const FADE_SECONDS: f64 = 0.25;
const POSITION_EVERY: Duration = Duration::from_millis(250);

/// What the player tells its owner. `token` is the one given with the track's `Load`, so events of
/// a track replaced in the meantime can be told apart.
#[derive(Debug, Clone, PartialEq)]
pub enum Event {
    Loaded {
        token: u64,
        duration: f64,
    },
    Playing {
        token: u64,
        position: f64,
    },
    Paused {
        token: u64,
        position: f64,
    },
    Position {
        token: u64,
        position: f64,
    },
    Seeked {
        token: u64,
        position: f64,
    },
    /// The track played to its end. `next` is the queued track that follows from the very next
    /// frame; its own `Loaded` and `Playing` come right after.
    Ended {
        token: u64,
        next: Option<u64>,
    },
    Error {
        token: u64,
        message: String,
    },
}

enum Command {
    Load { token: u64, path: PathBuf, play: bool, at: f64 },
    QueueNext { token: u64, path: Option<PathBuf> },
    Play,
    Pause,
    Seek(f64),
    Stop,
    Volume { percent: f64, muted: bool },
    Equalizer([f64; 10]),
    Speed(f64),
    Shutdown,
}

pub struct Player {
    commands: Sender<Command>,
    thread: Option<JoinHandle<()>>,
}

impl Player {
    /// Opens the default device and starts the player thread.
    pub fn start(on_event: impl Fn(Event) + Send + 'static) -> Result<Self, String> {
        let output = Output::open()?;
        let (commands, receiver) = channel();
        let thread = std::thread::Builder::new()
            .name("nemora-player".into())
            .spawn(move || Engine::new(output, Box::new(on_event)).run(receiver))
            .map_err(|e| e.to_string())?;
        Ok(Self { commands, thread: Some(thread) })
    }

    fn send(&self, command: Command) {
        let _ = self.commands.send(command);
    }

    pub fn load(&self, token: u64, path: PathBuf, play: bool, at: f64) {
        self.send(Command::Load { token, path, play, at });
    }
    /// The track to continue with when the current one ends; `None` withdraws it. A track whose
    /// first frames are already heard can no longer be withdrawn.
    pub fn queue_next(&self, token: u64, path: Option<PathBuf>) {
        self.send(Command::QueueNext { token, path });
    }
    pub fn play(&self) {
        self.send(Command::Play);
    }
    pub fn pause(&self) {
        self.send(Command::Pause);
    }
    pub fn seek(&self, seconds: f64) {
        self.send(Command::Seek(seconds));
    }
    pub fn stop(&self) {
        self.send(Command::Stop);
    }
    pub fn set_volume(&self, percent: f64, muted: bool) {
        self.send(Command::Volume { percent, muted });
    }
    pub fn set_equalizer(&self, gains_db: [f64; 10]) {
        self.send(Command::Equalizer(gains_db));
    }
    /// Playback speed with the pitch kept, within `stretch::SPEED_RANGE`.
    pub fn set_speed(&self, speed: f64) {
        self.send(Command::Speed(speed));
    }
}

impl Drop for Player {
    fn drop(&mut self) {
        self.send(Command::Shutdown);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

struct Current {
    token: u64,
    source: Source,
    /// The device frame count at which this track's first pushed frame plays.
    starts_at: u64,
    /// Track position (seconds) of that first pushed frame.
    start_position: f64,
    /// Frames pushed since `starts_at`.
    pushed: u64,
    drained: bool,
}

impl Current {
    fn new(token: u64, source: Source) -> Self {
        Self { token, source, starts_at: 0, start_position: 0.0, pushed: 0, drained: false }
    }
}

struct Engine {
    output: Output,
    on_event: Box<dyn Fn(Event) + Send>,
    current: Option<Current>,
    /// The queued track; its `starts_at` is set when its first frame is pushed.
    next: Option<Current>,
    playing: bool,
    volume: (f64, bool),
    equalizer: [f64; 10],
    speed: f64,
    last_position: Instant,
}

impl Engine {
    fn new(output: Output, on_event: Box<dyn Fn(Event) + Send>) -> Self {
        Self {
            output,
            on_event,
            current: None,
            next: None,
            playing: false,
            volume: (100.0, false),
            equalizer: [0.0; 10],
            speed: 1.0,
            last_position: Instant::now(),
        }
    }

    fn emit(&self, event: Event) {
        (self.on_event)(event);
    }

    fn frames(&self, seconds: f64) -> u64 {
        (seconds * self.output.sample_rate as f64) as u64
    }

    fn position(&self) -> f64 {
        let Some(c) = &self.current else { return 0.0 };
        let consumed = self.output.shared.consumed.load(Ordering::SeqCst);
        let played = consumed.saturating_sub(c.starts_at).min(c.pushed);
        // Everything waiting in the buffer was made at the current speed (a change restarts it).
        c.start_position + played as f64 * self.speed / self.output.sample_rate as f64
    }

    fn open(&self, path: &Path) -> Result<Source, DecodeError> {
        let mut source = Source::open(path, self.output.sample_rate, self.output.channels)?;
        source.set_speed(self.speed);
        Ok(source)
    }

    fn clear_buffer(&self) -> u64 {
        let mut buffer = self.output.shared.buffer.lock().unwrap_or_else(|e| e.into_inner());
        buffer.clear();
        self.output.shared.consumed.load(Ordering::SeqCst)
    }

    fn fade(&self, to: f64, pause_after: bool) {
        let frames = self.frames(FADE_SECONDS);
        self.output.send(Control::Fade { to, frames, pause_after });
    }

    fn apply_volume(&self) {
        let (percent, muted) = self.volume;
        self.output.send(Control::Volume(if muted { 0.0 } else { perceptual_gain(percent) }));
    }

    fn run(mut self, commands: Receiver<Command>) {
        self.apply_volume();
        loop {
            match commands.recv_timeout(Duration::from_millis(10)) {
                Ok(Command::Shutdown) | Err(RecvTimeoutError::Disconnected) => return,
                Ok(command) => self.handle(command),
                Err(RecvTimeoutError::Timeout) => {}
            }
            if self.output.failed.load(Ordering::SeqCst) {
                self.reopen();
            }
            self.top_up();
            self.report();
        }
    }

    fn handle(&mut self, command: Command) {
        match command {
            Command::Load { token, path, play, at } => {
                self.next = None;
                let starts_at = self.clear_buffer();
                match self.open(&path) {
                    Ok(mut source) => {
                        let start_position = if at > 0.0 { source.seek(at).unwrap_or(0.0) } else { 0.0 };
                        let duration = source.duration().unwrap_or(0.0);
                        self.current =
                            Some(Current { token, source, starts_at, start_position, pushed: 0, drained: false });
                        self.emit(Event::Loaded { token, duration });
                        if play {
                            self.start_playing();
                        }
                    }
                    Err(error) => {
                        self.current = None;
                        self.emit(Event::Error { token, message: error.to_string() });
                    }
                }
            }
            Command::QueueNext { token, path } => {
                if path.is_some() && self.next.as_ref().is_some_and(|n| n.token == token) {
                    return;
                }
                if !self.withdraw_next() {
                    return;
                }
                if let Some(path) = path {
                    match self.open(&path) {
                        Ok(source) => self.next = Some(Current::new(token, source)),
                        // The owner hears of it when it loads the track itself.
                        Err(error) => eprintln!("[nemora-audio] queueing {}: {error}", path.display()),
                    }
                }
            }
            Command::Play => self.start_playing(),
            Command::Pause => {
                if self.playing {
                    self.playing = false;
                    self.fade(0.0, true);
                    if let Some(c) = &self.current {
                        self.emit(Event::Paused { token: c.token, position: self.position() });
                    }
                }
            }
            Command::Seek(seconds) => {
                let position = self.position();
                let starts_at = self.clear_buffer();
                if let Some(c) = &mut self.current {
                    match c.source.seek(seconds) {
                        Ok(landed) => {
                            c.starts_at = starts_at;
                            c.start_position = landed;
                            c.pushed = 0;
                            c.drained = false;
                            let token = c.token;
                            self.rewind_next();
                            self.emit(Event::Seeked { token, position: landed });
                        }
                        Err(error) => {
                            let token = c.token;
                            self.emit(Event::Error { token, message: error.to_string() });
                            let _ = position;
                        }
                    }
                }
            }
            Command::Stop => {
                self.playing = false;
                self.clear_buffer();
                self.current = None;
                self.next = None;
                self.fade(0.0, true);
            }
            Command::Volume { percent, muted } => {
                self.volume = (percent, muted);
                self.apply_volume();
            }
            Command::Speed(speed) => {
                let speed = speed.clamp(SPEED_RANGE.0, SPEED_RANGE.1);
                if speed == self.speed {
                    return;
                }
                // What is buffered was made at the old speed: start over from what is heard now.
                let position = self.position();
                self.speed = speed;
                let starts_at = self.clear_buffer();
                if let Some(c) = &mut self.current {
                    c.source.set_speed(speed);
                    match c.source.seek(position) {
                        Ok(landed) => {
                            c.starts_at = starts_at;
                            c.start_position = landed;
                            c.pushed = 0;
                            c.drained = false;
                        }
                        Err(error) => {
                            let token = c.token;
                            self.emit(Event::Error { token, message: error.to_string() });
                        }
                    }
                }
                if let Some(next) = &mut self.next {
                    next.source.set_speed(speed);
                }
                self.rewind_next();
            }
            Command::Equalizer(gains) => {
                self.equalizer = gains;
                self.output.send(Control::Equalizer(gains));
            }
            Command::Shutdown => {}
        }
    }

    fn start_playing(&mut self) {
        let Some(c) = &self.current else { return };
        let token = c.token;
        self.playing = true;
        self.output.send(Control::Resume);
        self.fade(1.0, false);
        self.emit(Event::Playing { token, position: self.position() });
    }

    /// Takes the queued track back, with any of its frames still waiting in the buffer. Returns
    /// false when the device has already played some of them: it is playing by now.
    fn withdraw_next(&mut self) -> bool {
        let Some(next) = &self.next else { return true };
        if next.pushed > 0 {
            let mut buffer = self.output.shared.buffer.lock().unwrap_or_else(|e| e.into_inner());
            if self.output.shared.consumed.load(Ordering::SeqCst) > next.starts_at {
                return false;
            }
            let keep = buffer.len().saturating_sub(next.pushed as usize * self.output.channels);
            buffer.truncate(keep);
        }
        self.next = None;
        true
    }

    /// The buffer was cleared under a queued track that had begun: start it over.
    fn rewind_next(&mut self) {
        let Some(next) = &self.next else { return };
        if next.pushed == 0 && !next.drained {
            return;
        }
        let (token, path) = (next.token, next.source.path().to_owned());
        self.next = self.open(&path).ok().map(|source| Current::new(token, source));
    }

    /// Keeps about `BUFFER_SECONDS` waiting for the device: the current track, then the queued one
    /// from the frame right after the current track's last.
    fn top_up(&mut self) {
        let channels = self.output.channels;
        let target = self.frames(BUFFER_SECONDS) as usize * channels;
        let waiting = self.output.shared.buffer.lock().map_or(0, |b| b.len());
        if waiting >= target {
            return;
        }
        let Some(current) = &mut self.current else { return };
        let (track, is_next) = if !current.drained {
            (current, false)
        } else if let Some(next) = &mut self.next {
            if next.pushed == 0 {
                next.starts_at = current.starts_at + current.pushed;
            }
            (next, true)
        } else {
            return;
        };
        if track.drained {
            return;
        }
        let mut block = Vec::with_capacity(target - waiting);
        match track.source.fill(&mut block, (target - waiting) / channels) {
            Ok(more) => {
                track.pushed += (block.len() / channels) as u64;
                track.drained = !more;
                self.output.shared.buffer.lock().unwrap_or_else(|e| e.into_inner()).extend(block);
            }
            Err(error) if is_next => {
                // What of it was pushed stays; the owner hears of the fault when it loads it.
                eprintln!("[nemora-audio] decoding the queued track: {error}");
                track.drained = true;
            }
            Err(error) => {
                track.drained = true;
                let token = track.token;
                self.emit(Event::Error { token, message: error.to_string() });
            }
        }
    }

    /// Positions while playing, and the end once the device has played the last frame; a queued
    /// track takes over at that frame.
    fn report(&mut self) {
        let Some(c) = &self.current else { return };
        let token = c.token;
        let end = c.starts_at + c.pushed;
        let consumed = self.output.shared.consumed.load(Ordering::SeqCst);
        if c.drained && consumed >= end {
            self.emit(Event::Ended { token, next: self.next.as_ref().map(|n| n.token) });
            match self.next.take() {
                Some(mut next) => {
                    if next.pushed == 0 {
                        next.starts_at = end;
                    }
                    let (token, duration) = (next.token, next.source.duration().unwrap_or(0.0));
                    self.current = Some(next);
                    self.emit(Event::Loaded { token, duration });
                    if self.playing {
                        self.emit(Event::Playing { token, position: self.position() });
                    }
                    self.last_position = Instant::now();
                }
                None => {
                    self.current = None;
                    self.playing = false;
                }
            }
            return;
        }
        if self.playing && self.last_position.elapsed() >= POSITION_EVERY {
            self.last_position = Instant::now();
            self.emit(Event::Position { token, position: self.position() });
        }
    }

    /// The device went away or changed format: open the current default device and carry on from
    /// where the listener was.
    fn reopen(&mut self) {
        let position = self.position();
        let output = match Output::open() {
            Ok(output) => output,
            Err(error) => {
                eprintln!("[nemora-audio] reopening the output failed: {error}");
                std::thread::sleep(Duration::from_millis(500));
                return;
            }
        };
        self.output = output;
        self.apply_volume();
        self.output.send(Control::Equalizer(self.equalizer));
        let next = self.next.take().map(|n| (n.token, n.source.path().to_owned()));
        if let Some(c) = self.current.take() {
            let (token, path) = (c.token, c.source.path().to_owned());
            self.handle(Command::Load { token, path, play: self.playing, at: position });
        }
        if let Some((token, path)) = next {
            self.handle(Command::QueueNext { token, path: Some(path) });
        }
    }
}

#[cfg(test)]
mod gapless;
#[cfg(test)]
mod speed;

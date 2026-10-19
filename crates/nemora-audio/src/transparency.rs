//! The transparency rule, checked end to end without a device: at full volume, a flat equalizer, no
//! fade and the file's own rate, the samples the device would receive are bit-identical to the
//! decoded PCM, for every format the player reads.

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, AtomicU64};
use std::sync::mpsc::channel;
use std::sync::{Arc, Mutex};

use crate::decode::Decoder;
use crate::output::{Callback, Shared};
use crate::source::Source;

pub(crate) fn ffmpeg(args: &[&str]) -> bool {
    Command::new("ffmpeg")
        .args(["-hide_banner", "-loglevel", "error", "-y"])
        .args(args)
        .status()
        .is_ok_and(|s| s.success())
}

fn generated(dir: &Path, name: &str, codec_args: &[&str]) -> Option<PathBuf> {
    let path = dir.join(name);
    let mut args = vec!["-f", "lavfi", "-i", "sine=frequency=997:duration=3:sample_rate=44100", "-ac", "2"];
    args.extend_from_slice(codec_args);
    let target = path.to_string_lossy().into_owned();
    args.push(&target);
    ffmpeg(&args).then_some(path)
}

/// Everything a decoder gives for a file.
pub(crate) fn decoded(path: &Path) -> (Vec<f32>, u32, usize) {
    let mut decoder = Decoder::open(path).unwrap();
    let (rate, channels) = (decoder.sample_rate, decoder.channels);
    let (mut all, mut block) = (Vec::new(), Vec::new());
    while decoder.next_block(&mut block).unwrap() {
        all.extend_from_slice(&block);
    }
    (all, rate, channels)
}

/// Everything the device callback would hand out, pulled in device-sized periods.
fn through_the_engine(path: &Path, rate: u32, channels: usize) -> Vec<f32> {
    let mut source = Source::open(path, rate, channels).unwrap();
    assert!(source.is_direct(), "same rate and channels: no conversion in the way");
    let shared = Arc::new(Shared {
        buffer: Mutex::new(VecDeque::new()),
        consumed: AtomicU64::new(0),
        paused: AtomicBool::new(false),
    });
    let (_tx, rx) = channel();
    let mut callback = Callback::new(Arc::clone(&shared), rx, rate, channels);
    let mut out = Vec::new();
    let mut period = vec![0.0f32; 480 * channels];
    loop {
        let mut block = Vec::new();
        let more = source.fill(&mut block, 4096).unwrap();
        shared.buffer.lock().unwrap().extend(block);
        while shared.buffer.lock().unwrap().len() >= period.len() {
            callback.fill(&mut period);
            out.extend_from_slice(&period);
        }
        if !more {
            let rest = shared.buffer.lock().unwrap().len();
            if rest > 0 {
                let mut tail = vec![0.0f32; rest];
                callback.fill(&mut tail);
                out.extend_from_slice(&tail);
            }
            return out;
        }
    }
}

#[test]
fn every_format_leaves_the_engine_bit_identical() {
    if !ffmpeg(&["-version"]) {
        eprintln!("SKIPPED: ffmpeg is not on PATH");
        return;
    }
    let dir = std::env::temp_dir().join(format!("nemora-transparency-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let cases: [(&str, &[&str]); 6] = [
        ("s16.flac", &["-sample_fmt", "s16"]),
        ("s24.flac", &["-sample_fmt", "s32", "-bits_per_raw_sample", "24"]),
        ("s16.wav", &["-c:a", "pcm_s16le"]),
        ("a.mp3", &["-c:a", "libmp3lame", "-b:a", "192k"]),
        ("a.m4a", &["-c:a", "aac", "-b:a", "192k"]),
        ("a.ogg", &["-c:a", "libvorbis", "-q:a", "5"]),
    ];
    let mut checked = 0;
    for (name, args) in cases {
        let Some(path) = generated(&dir, name, args) else {
            eprintln!("SKIPPED {name}: this ffmpeg cannot encode it");
            continue;
        };
        let (reference, rate, channels) = decoded(&path);
        assert!(reference.len() > rate as usize, "{name}: decoded only {} samples", reference.len());
        let engine = through_the_engine(&path, rate, channels);
        assert_eq!(engine.len(), reference.len(), "{name}: length");
        let differing = reference.iter().zip(&engine).filter(|(a, b)| a.to_bits() != b.to_bits()).count();
        assert_eq!(differing, 0, "{name}: {differing} samples changed on the way");
        checked += 1;
    }
    assert!(checked >= 3, "only {checked} formats could be checked");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_seek_lands_on_the_requested_frame() {
    if !ffmpeg(&["-version"]) {
        eprintln!("SKIPPED: ffmpeg is not on PATH");
        return;
    }
    let dir = std::env::temp_dir().join(format!("nemora-seek-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    // Not on any packet boundary.
    let target = 1.234_567;
    let cases: [(&str, &[&str]); 3] = [
        ("s16.flac", &["-sample_fmt", "s16"]),
        ("s16.wav", &["-c:a", "pcm_s16le"]),
        ("a.mp3", &["-c:a", "libmp3lame"]),
    ];
    for (name, args) in cases {
        let Some(path) = generated(&dir, name, args) else {
            eprintln!("SKIPPED {name}: this ffmpeg cannot encode it");
            continue;
        };
        let (reference, rate, channels) = decoded(&path);
        let mut decoder = Decoder::open(&path).unwrap();
        let landed = decoder.seek(target).unwrap();
        let frame = (landed * rate as f64).round() as usize;
        assert!((landed - target).abs() * rate as f64 <= 1.0, "{name}: landed at {landed}, not {target}");
        let mut block = Vec::new();
        assert!(decoder.next_block(&mut block).unwrap());
        let expected = &reference[frame * channels..frame * channels + block.len().min(256)];
        let got = &block[..expected.len()];
        if name.ends_with(".mp3") {
            // A lossy decoder restarted mid-stream converges within a frame; the timing is what counts.
            let error = expected.iter().zip(got).map(|(a, b)| (a - b).abs()).fold(0.0f32, f32::max);
            assert!(error < 0.05, "{name}: {error} off the reference after the seek");
        } else {
            assert_eq!(got, expected, "{name}: different samples after the seek");
        }
    }
    let _ = std::fs::remove_dir_all(&dir);
}

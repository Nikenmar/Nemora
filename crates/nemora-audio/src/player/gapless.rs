//! Two consecutive parts of one recording, played as queued tracks, must come out of the device as
//! the recording itself: no frame lost and none added at the join.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use super::*;
use crate::transparency::{decoded, ffmpeg};

const RATE: u32 = 44_100;
/// Not a multiple of any codec's frame or packet size.
const SPLIT: u64 = 70_001;

fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("nemora-gapless-{name}-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn generate(source: &str, codec: &[&str], out: &Path) {
    let out = out.to_string_lossy();
    let mut args = vec!["-f", "lavfi", "-i", source, "-ac", "2"];
    args.extend_from_slice(codec);
    args.push(&out);
    assert!(ffmpeg(&args), "ffmpeg could not make {out}");
}

/// Cuts `whole` at `SPLIT` into two files of the given codec.
fn split(dir: &Path, whole: &Path, ext: &str, codec: &[&str]) -> (PathBuf, PathBuf) {
    let input = whole.to_string_lossy().into_owned();
    let parts = [
        (dir.join(format!("a.{ext}")), format!("atrim=end_sample={SPLIT}")),
        (dir.join(format!("b.{ext}")), format!("atrim=start_sample={SPLIT},asetpts=PTS-STARTPTS")),
    ];
    for (path, filter) in &parts {
        let out = path.to_string_lossy();
        let mut args = vec!["-i", &input, "-af", filter];
        args.extend_from_slice(codec);
        args.push(&out);
        assert!(ffmpeg(&args), "ffmpeg could not cut {out}");
    }
    let [(a, _), (b, _)] = parts;
    (a, b)
}

struct Run {
    samples: Vec<f32>,
    events: Vec<Event>,
}

/// Plays `a` with `b` queued, pulling device periods by hand. With `decoy`, that track is queued
/// first and replaced by `b` once some of it already waits in the buffer.
fn play(a: &Path, b: &Path, decoy: Option<&Path>) -> Run {
    let (output, mut callback) = Output::detached(RATE, 2);
    let events = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&events);
    let mut engine = Engine::new(output, Box::new(move |e| sink.lock().unwrap().push(e)));
    engine.apply_volume();
    engine.handle(Command::Load { token: 1, path: a.to_owned(), play: true, at: 0.0 });
    engine.handle(Command::QueueNext { token: 2, path: Some(decoy.unwrap_or(b).to_owned()) });
    let mut swapped = decoy.is_none();
    let mut samples = Vec::new();
    let mut period = vec![0.0f32; 441 * 2];
    for _ in 0..100_000 {
        engine.top_up();
        if !swapped && engine.next.as_ref().is_some_and(|n| n.pushed > 0) {
            engine.handle(Command::QueueNext { token: 3, path: Some(b.to_owned()) });
            assert!(engine.next.as_ref().is_some_and(|n| n.token == 3), "an unheard track can be replaced");
            swapped = true;
        }
        // Whole periods, silence included: a buffer that ran dry between the tracks is a gap.
        callback.fill(&mut period);
        samples.extend_from_slice(&period);
        engine.report();
        if engine.current.is_none() {
            break;
        }
    }
    // Only the silence after the last frame is not part of the music.
    samples.truncate(engine.output.shared.consumed.load(Ordering::SeqCst) as usize * 2);
    let events = events.lock().unwrap().clone();
    Run { samples, events }
}

fn kinds(events: &[Event]) -> Vec<String> {
    events
        .iter()
        .filter(|e| !matches!(e, Event::Position { .. }))
        .map(|e| match e {
            Event::Loaded { token, .. } => format!("loaded {token}"),
            Event::Playing { token, .. } => format!("playing {token}"),
            Event::Ended { token, next: Some(next) } => format!("ended {token}, {next} follows"),
            Event::Ended { token, next: None } => format!("ended {token}"),
            other => format!("{other:?}"),
        })
        .collect()
}

fn sine() -> String {
    format!("sine=frequency=997:duration=3:sample_rate={RATE}")
}

#[test]
fn lossless_parts_join_into_the_original_bit_for_bit() {
    if !ffmpeg(&["-version"]) {
        eprintln!("SKIPPED: ffmpeg is not on PATH");
        return;
    }
    let dir = temp_dir("flac");
    let whole = dir.join("whole.flac");
    generate(&sine(), &["-sample_fmt", "s16"], &whole);
    let (a, b) = split(&dir, &whole, "flac", &["-sample_fmt", "s16"]);
    let decoy = dir.join("decoy.flac");
    generate(&format!("anoisesrc=d=1:r={RATE}"), &["-sample_fmt", "s16"], &decoy);
    let (reference, _, _) = decoded(&whole);

    for decoy in [None, Some(decoy.as_path())] {
        let label = if decoy.is_some() { "with a replaced decoy" } else { "plain" };
        let run = play(&a, &b, decoy);
        let last = if decoy.is_some() { 3 } else { 2 };
        let expected = ["loaded 1".to_owned(), "playing 1".into(), format!("ended 1, {last} follows")]
            .into_iter()
            .chain([format!("loaded {last}"), format!("playing {last}"), format!("ended {last}")])
            .collect::<Vec<_>>();
        assert_eq!(kinds(&run.events), expected, "events, {label}");
        assert_eq!(run.samples.len(), reference.len(), "length, {label}");
        let differing = reference.iter().zip(&run.samples).filter(|(x, y)| x.to_bits() != y.to_bits()).count();
        assert_eq!(differing, 0, "{differing} samples differ from the original, {label}");
    }
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn lossy_parts_join_without_a_gap() {
    if !ffmpeg(&["-version"]) {
        eprintln!("SKIPPED: ffmpeg is not on PATH");
        return;
    }
    let dir = temp_dir("mp3");
    let whole = dir.join("whole.wav");
    generate(&sine(), &["-c:a", "pcm_s16le"], &whole);
    let (a, b) = split(&dir, &whole, "mp3", &["-c:a", "libmp3lame", "-b:a", "256k"]);
    let run = play(&a, &b, None);
    let frames = run.samples.len() / 2;
    assert!(frames.abs_diff(3 * RATE as usize) <= 2, "{frames} frames instead of {}", 3 * RATE);

    // A sine never stays near zero for long and never jumps: either would be a gap at the join.
    let left: Vec<f32> = run.samples.iter().step_by(2).copied().collect();
    let interior = &left[2_000..frames - 2_000];
    let longest_quiet = interior.split(|s| s.abs() >= 1e-3).map(<[f32]>::len).max().unwrap_or(0);
    assert!(longest_quiet < 4, "{longest_quiet} near-silent frames in a row");
    let largest_step = interior.windows(2).map(|w| (w[1] - w[0]).abs()).fold(0.0f32, f32::max);
    let sine_step = 2.0 * std::f32::consts::PI * 997.0 / RATE as f32 * 0.125;
    assert!(largest_step < 2.0 * sine_step, "a step of {largest_step} (a sine moves at most {sine_step})");
    let _ = std::fs::remove_dir_all(&dir);
}

//! Varispeed while a track plays (PLAN/18): the position keeps telling where in the music the
//! listener is through a rebuild and through glides, the track ends when its music is used up, and
//! back at 1x nothing stands between the file and the device.

use std::sync::{Arc, Mutex};

use super::*;
use crate::transparency::ffmpeg;
use crate::vari::factor_of_semitones;

const RATE: u32 = 44_100;

#[test]
fn varispeed_keeps_the_position_in_music_time() {
    if !ffmpeg(&["-version"]) {
        eprintln!("SKIPPED: ffmpeg is not on PATH");
        return;
    }
    let dir = std::env::temp_dir().join(format!("nemora-vari-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("tone.wav");
    let source = format!("sine=frequency=997:duration=5:sample_rate={RATE}");
    let out = path.to_string_lossy().into_owned();
    assert!(ffmpeg(&["-f", "lavfi", "-i", &source, "-ac", "2", "-c:a", "pcm_s16le", &out]));

    let (output, mut callback) = Output::detached(RATE, 2);
    let events = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&events);
    let mut engine = Engine::new(output, Box::new(move |e| sink.lock().unwrap().push(e)));
    engine.apply_volume();
    engine.handle(Command::Load { token: 1, path: path.clone(), play: true, at: 0.0 });

    let mut period = vec![0.0f32; 441 * 2];
    let mut device_seconds = 0.0f64;
    let mut run = |engine: &mut Engine, seconds: f64| {
        for _ in 0..(seconds * 100.0).round() as usize {
            engine.top_up();
            callback.fill(&mut period);
            engine.report();
            device_seconds += 0.01;
            if engine.current.is_none() {
                break;
            }
        }
    };

    run(&mut engine, 1.0);
    assert!((engine.position() - 1.0).abs() < 0.02, "1x: at {:.3} s", engine.position());

    // 1x -> Slowed: a rebuild (there was no varispeed stream to glide).
    let slowed = factor_of_semitones(-2.0);
    engine.handle(Command::Varispeed(slowed));
    run(&mut engine, 1.0);
    let expected = 1.0 + slowed;
    assert!((engine.position() - expected).abs() < 0.02, "slowed: at {:.3}, not {expected:.3}", engine.position());

    // Slowed -> Super Slowed: a glide, with the buffered frames still at the old pace.
    let super_slowed = factor_of_semitones(-4.0);
    assert!(engine.current.as_ref().is_some_and(|c| c.source.factor() == slowed));
    engine.handle(Command::Varispeed(super_slowed));
    run(&mut engine, 1.0);
    let expected = 1.0 + slowed + super_slowed;
    assert!(
        (engine.position() - expected).abs() < 0.03,
        "super slowed: at {:.3}, not {expected:.3}",
        engine.position()
    );

    // Back to 1x: rebuilt without any stage, so the samples pass untouched again.
    engine.handle(Command::Varispeed(1.0));
    assert!(engine.current.as_ref().is_some_and(|c| c.source.is_direct()), "back at 1x nothing resamples");
    let at = engine.position();
    run(&mut engine, 10.0);
    assert!(engine.current.is_none(), "the track ends when its music is used up");
    let total = 3.0 + (5.0 - at);
    assert!((device_seconds - total).abs() < 0.05, "it took {device_seconds:.2} s of device time, not {total:.2}");
    assert!(events.lock().unwrap().iter().any(|e| matches!(e, Event::Ended { token: 1, .. })));
    let _ = std::fs::remove_dir_all(&dir);
}

//! A change of speed while a track plays: the position keeps telling where in the music the
//! listener is, and the track ends when its music is used up.

use std::sync::{Arc, Mutex};

use super::*;
use crate::transparency::ffmpeg;

const RATE: u32 = 44_100;

#[test]
fn a_change_of_speed_keeps_the_position_in_music_time() {
    if !ffmpeg(&["-version"]) {
        eprintln!("SKIPPED: ffmpeg is not on PATH");
        return;
    }
    let dir = std::env::temp_dir().join(format!("nemora-speed-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("tone.wav");
    let source = format!("sine=frequency=997:duration=4:sample_rate={RATE}");
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

    engine.handle(Command::Speed(2.0));
    run(&mut engine, 1.0);
    assert!((engine.position() - 3.0).abs() < 0.02, "2x: at {:.3} s", engine.position());

    engine.handle(Command::Speed(0.5));
    run(&mut engine, 0.5);
    assert!((engine.position() - 3.25).abs() < 0.02, "0.5x: at {:.3} s", engine.position());

    engine.handle(Command::Speed(1.0));
    assert!(engine.current.as_ref().is_some_and(|c| c.source.is_direct()), "back at 1x nothing stretches");
    run(&mut engine, 10.0);
    assert!(engine.current.is_none(), "the track ends when its music is used up");
    // 1 s + 1 s + 0.5 s, then the last 0.75 s of music at 1x.
    assert!((device_seconds - 3.25).abs() < 0.03, "it took {device_seconds:.2} s of device time");
    assert!(events.lock().unwrap().iter().any(|e| matches!(e, Event::Ended { token: 1, .. })));
    let _ = std::fs::remove_dir_all(&dir);
}

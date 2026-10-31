//! Step timing for commands on a user's critical path (PLAN/15, performance): silent while quick, one
//! log line with every step's time when a step passes 50 ms or the whole command 150 ms. The
//! renderer's `other/trace.ts` does the same on its side, so a slow moment shows from both ends.

use std::time::Instant;

const SLOW_STEP_MS: u128 = 50;
const SLOW_TOTAL_MS: u128 = 150;

pub struct Trace {
    action: &'static str,
    start: Instant,
    last: Instant,
    steps: Vec<(&'static str, u128)>,
}

impl Trace {
    pub fn start(action: &'static str) -> Self {
        let now = Instant::now();
        Self { action, start: now, last: now, steps: Vec::new() }
    }

    /// Closes the step that ran since the last mark.
    pub fn step(&mut self, name: &'static str) {
        let now = Instant::now();
        self.steps.push((name, now.duration_since(self.last).as_millis()));
        self.last = now;
    }
}

impl Drop for Trace {
    fn drop(&mut self) {
        let total = self.start.elapsed().as_millis();
        if total > SLOW_TOTAL_MS || self.steps.iter().any(|(_, ms)| *ms > SLOW_STEP_MS) {
            let steps: Vec<String> = self.steps.iter().map(|(name, ms)| format!("{name} {ms} ms")).collect();
            log::warn!("[slow] {} took {total} ms: {}", self.action, steps.join(", "));
        }
    }
}

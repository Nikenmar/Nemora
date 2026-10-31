/**
 * Timing of a user action step by step (PLAN/15, performance). Silent while the action is quick;
 * a step over 50 ms or a whole action over 150 ms writes one line to the app's log with every
 * step's time, so a slow moment on the user's machine can be read afterwards instead of guessed.
 * The last traces also stay on `window.__nemoraTraces` for the stand.
 */

const SLOW_STEP_MS = 50;
const SLOW_ACTION_MS = 150;
const KEPT = 20;

export type Trace = {
  /** Closes the step that ran since the last mark. */
  step: (name: string) => void;
  /** Ends the trace once the screen has painted the result; returns the total. */
  end: (details?: Record<string, unknown>) => Promise<number>;
};

type Recorded = { action: string; total: number; steps: Record<string, number>; at: number };

const kept = (): Recorded[] => {
  const w = window as unknown as { __nemoraTraces?: Recorded[] };
  w.__nemoraTraces ??= [];
  return w.__nemoraTraces;
};

const painted = () =>
  new Promise<void>((resolve) => {
    // Rendering may be paused (a hidden window): never wait on it for long.
    const timeout = setTimeout(resolve, 500);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        clearTimeout(timeout);
        resolve();
      })
    );
  });

export function startTrace(action: string): Trace {
  const start = performance.now();
  let last = start;
  const steps: Record<string, number> = {};
  return {
    step(name) {
      const now = performance.now();
      steps[name] = Math.round(now - last);
      last = now;
    },
    async end(details) {
      await painted();
      const now = performance.now();
      steps.paint = Math.round(now - last);
      const total = Math.round(now - start);
      const log = kept();
      log.push({ action, total, steps, at: Date.now() });
      if (log.length > KEPT) log.shift();
      if (total > SLOW_ACTION_MS || Object.values(steps).some((ms) => ms > SLOW_STEP_MS))
        window.api.log
          .sendLogs(`[slow] ${action} took ${total} ms`, { steps, ...details }, 'WARN')
          .catch(() => undefined);
      return total;
    }
  };
}

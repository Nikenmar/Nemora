import { flushSync } from 'react-dom';

/**
 * Motion between views (PLAN/14 A1-A3): a same-document View Transition around a state change.
 *
 * The change runs inside the transition's callback under `flushSync`, so React has drawn the new
 * view before the browser takes its "after" picture. A transition still running when the next one
 * starts is skipped, never queued behind. Reduced motion (the app's switch, battery saving or the
 * system's setting) and a webview without the API both turn it into a plain cut.
 *
 * Elements that should travel between the two views (a cover into a hero header, the player into
 * the full-screen player) carry a `view-transition-name`, given for that one transition only by
 * `nameForTransition` so virtualised lists never hold the same name twice.
 */

export type TransitionDirection = 'forward' | 'back' | 'none';

let running: ViewTransition | null = null;
/** Elements named for the coming transition only; unnamed again once the old view is captured. */
let pending: (HTMLElement | SVGElement)[] = [];

export const isMotionReduced = () =>
  document.body.classList.contains('reduced-motion') ||
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const hasLanding = (name: string) =>
  [...document.querySelectorAll<HTMLElement>(`.${name}`)].some((e) => e.getBoundingClientRect().width > 0);

async function untilPresent(names: string[], timeout: number) {
  const start = performance.now();
  while (!names.every(hasLanding) && performance.now() - start < timeout) {
    // Not requestAnimationFrame: rendering is paused while this callback runs, so frames never come.
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
}

export function withViewTransition(
  update: () => void,
  direction: TransitionDirection = 'none',
  kind = 'page',
  /** Class-held names the new view must contain before it is captured (a lazily loaded view). */
  landings: string[] = []
): void {
  if (isMotionReduced() || typeof document.startViewTransition !== 'function') {
    for (const element of pending) element.style.viewTransitionName = '';
    pending = [];
    update();
    return;
  }
  running?.skipTransition();
  const root = document.documentElement;
  root.dataset.vtDirection = direction;
  root.dataset.vtKind = kind;
  const named = pending;
  pending = [];
  const travelling = [
    ...new Set([...named.map((e) => e.style.viewTransitionName), ...landings])
  ].filter((name) => name && name !== 'none');
  const transition = document.startViewTransition(async () => {
    // The "before" picture is taken by now: the old elements give their names up, so the new view
    // is the only one holding them.
    for (const element of named) element.style.viewTransitionName = '';
    flushSync(update);
    // A page that draws its hero header only once its data has loaded would have nothing for a
    // travelling cover to land on: hold the old picture until the target exists (600 ms at most; an album page needs ~340 ms in a debug build).
    if (travelling.length) await untilPresent(travelling, 600);
  });
  running = transition;
  transition.finished
    .catch(() => undefined)
    .finally(() => {
      if (running !== transition) return;
      running = null;
      delete root.dataset.vtDirection;
      delete root.dataset.vtKind;
    });
}

/**
 * Gives `element` a `view-transition-name` for the next `withViewTransition` only, so it travels to
 * the element of the same name in the next view. Call it right before `withViewTransition`. Other
 * elements already holding that name through a class (a hero header on the page being left) give it
 * up for the same transition, so the name is never held twice. If no transition comes within
 * 400 ms (the click did not navigate), everything is put back.
 */
export function nameForTransition(element: Element | null | undefined, name: string) {
  if (!(element instanceof HTMLElement || element instanceof SVGElement)) return;
  if (isMotionReduced()) return;
  for (const other of document.querySelectorAll<HTMLElement>(`.${name}`)) {
    if (other === element) continue;
    other.style.viewTransitionName = 'none';
    pending.push(other);
  }
  element.style.viewTransitionName = name;
  pending.push(element);
  const named = [...pending];
  setTimeout(() => {
    if (!named.every((e) => pending.includes(e))) return;
    for (const e of named) e.style.viewTransitionName = '';
    pending = pending.filter((e) => !named.includes(e));
  }, 400);
}

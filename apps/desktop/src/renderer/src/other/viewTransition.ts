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

export function withViewTransition(
  update: () => void,
  direction: TransitionDirection = 'none',
  kind = 'page'
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
  const transition = document.startViewTransition(() => {
    // The "before" picture is taken by now: the old elements give their names up, so the new view
    // is the only one holding them.
    for (const element of named) element.style.viewTransitionName = '';
    flushSync(update);
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
 * the element of the same name in the next view. Call it right before `withViewTransition`.
 */
export function nameForTransition(element: Element | null | undefined, name: string) {
  if (!(element instanceof HTMLElement || element instanceof SVGElement)) return;
  if (isMotionReduced()) return;
  element.style.viewTransitionName = name;
  pending.push(element);
}

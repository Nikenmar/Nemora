import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from '@tanstack/react-store';

import { store } from '@renderer/store';
import { isMotionReduced, nameForTransition } from './viewTransition';

/**
 * Motion helpers for what CSS alone cannot do (PLAN/14). The Web Animations API ignores the
 * stylesheet's reduced-motion rule, so every helper here checks it itself.
 */

const cssVar = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export const motionDuration = (token: 1 | 2 | 3 | 4) =>
  parseFloat(cssVar(`--dur-${token}`)) || [120, 180, 260, 360][token - 1];

export const springEasing = () => cssVar('--ease-spring') || 'cubic-bezier(0.23, 1, 0.32, 1)';

/** Plays keyframes on an element unless motion is reduced; returns the animation or null. */
export function animateIn(
  element: Element | null | undefined,
  keyframes: Keyframe[],
  options: { token?: 1 | 2 | 3 | 4; easing?: 'out' | 'spring'; delay?: number } = {}
): Animation | null {
  if (!element || isMotionReduced()) return null;
  return element.animate(keyframes, {
    duration: motionDuration(options.token ?? 3),
    easing: options.easing === 'spring' ? springEasing() : cssVar('--ease-out') || 'ease-out',
    delay: options.delay ?? 0,
    fill: 'backwards'
  });
}

/** A calm out-quint for what arrives, a short ease-in for what leaves. */
const ARRIVE = 'cubic-bezier(0.22, 1, 0.36, 1)';
const LEAVE = 'cubic-bezier(0.4, 0, 1, 1)';
/** For the heart: an ease-in-out-ish curve, smooth at both ends. */
const GLIDE = 'cubic-bezier(0.33, 0, 0.2, 1)';
const GHOST = 'track-ghost';
/** How long the old cover takes to go before the new one comes. */
const COVER_OUT = 140;

/** A copy of what the player bar shows, taken while it shows it, for the hand-over. */
type Snapshot = { cover: HTMLElement | null; lines: HTMLElement[]; width: number };

const quietCopy = (node: Element): HTMLElement => {
  const copy = node.cloneNode(true) as HTMLElement;
  for (const el of [copy, ...copy.querySelectorAll<HTMLElement>('*')]) {
    el.removeAttribute('id');
    el.removeAttribute('tabindex');
    // A copy must not play the line's own entrance again.
    el.classList.remove('appear-from-bottom');
  }
  copy.setAttribute('aria-hidden', 'true');
  return copy;
};

/**
 * Track change (A4): a hand-over rather than a cut, kept quiet. The moment the song changes, a copy
 * of the old cover and text sits over the new one: the old cover dims away where it is, then the new
 * one (once its picture has loaded) settles in, so only one cover shows at a time; the old text rises
 * away while the new title, then the artists, rise in under it; the heart glides to the new title's
 * end. Not on the first song (the restored session) and not under reduced motion.
 */
export function useTrackChangeMotion(
  coverRef: RefObject<Element | null>,
  textRef: RefObject<Element | null>
) {
  const songId = useStore(store, (state) => state.currentSongData.songId);
  const previous = useRef<{ songId: string } | null>(null);
  const snapshot = useRef<Snapshot | null>(null);

  // Every commit, before paint: hand over if the song changed, then keep a copy of what shows now.
  useLayoutEffect(() => {
    const before = previous.current;
    const old = snapshot.current;
    previous.current = { songId };
    if (before?.songId && before.songId !== songId && old && !isMotionReduced()) {
      handOver(coverRef.current, textRef.current, old);
    }
    const cover = coverRef.current?.querySelector(`img:not(.${GHOST})`);
    const text = textRef.current;
    snapshot.current = {
      cover: cover ? quietCopy(cover) : null,
      lines: text
        ? [...text.querySelectorAll(':scope > .song-title, :scope > .song-artists')].map(quietCopy)
        : [],
      width: text?.getBoundingClientRect().width ?? 0
    };
  });

  // The heart sits right after the title, so it moves whenever the text's width does: on a song
  // change, and again as the artists or Up next fill in. Each move glides from wherever the heart
  // shows at that moment (a move during a move continues, it does not restart from a jump), with no
  // delay and an easing without a sharp start.
  useEffect(() => {
    const text = textRef.current;
    if (!text) return undefined;
    let last: number | null = null;
    const follow = () => {
      const heart = heartOf(text);
      if (!heart) return;
      const layout = heart.offsetLeft;
      if (last === null || isMotionReduced()) {
        last = layout;
        return;
      }
      if (Math.abs(layout - last) < 0.5) return;
      const shown = getComputedStyle(heart).transform;
      const drift = shown && shown !== 'none' ? new DOMMatrixReadOnly(shown).m41 : 0;
      const from = last + drift - layout;
      last = layout;
      heart.getAnimations().forEach((a) => a.cancel());
      heart.animate([{ transform: `translateX(${from}px)` }, { transform: 'none' }], {
        duration: 460,
        easing: GLIDE
      });
    };
    // Called after layout and before paint, so the heart never shows a frame at its new place.
    const observer = new ResizeObserver(follow);
    observer.observe(text);
    follow();
    return () => observer.disconnect();
    // The refs are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/** The like button that follows the title in the bar. */
const heartOf = (text: Element | null) => text?.parentElement?.querySelector<HTMLElement>(':scope > .like-btn');

function handOver(cover: Element | null, text: Element | null, old: Snapshot) {
  // A change during a change: the newest one wins, the older copies go at once.
  for (const host of [cover, text]) host?.querySelectorAll(`.${GHOST}`).forEach((g) => g.remove());

  if (cover && old.cover) {
    const ghost = old.cover;
    ghost.classList.add(GHOST);
    Object.assign(ghost.style, { position: 'absolute', inset: '0', zIndex: '1', pointerEvents: 'none' });
    cover.appendChild(ghost);
    const fresh = cover.querySelector<HTMLImageElement>(`img:not(.${GHOST})`);
    let started = false;
    const start = () => {
      if (started) return;
      started = true;
      // One cover at a time: the old one dims away where it is, then the new one settles in.
      ghost
        .animate([{ opacity: 1 }, { opacity: 0 }], { duration: COVER_OUT, easing: LEAVE, fill: 'forwards' })
        .finished.catch(() => undefined)
        .finally(() => ghost.remove());
      fresh?.animate(
        [
          { opacity: 0, transform: 'scale(0.97)' },
          { opacity: 1, transform: 'none' }
        ],
        { duration: 300, easing: ARRIVE, delay: COVER_OUT, fill: 'backwards' }
      );
    };
    // The new picture comes in when it is there, not as an empty frame (at most 300 ms of waiting).
    if (fresh && !fresh.complete) {
      fresh.addEventListener('load', start, { once: true });
      fresh.addEventListener('error', start, { once: true });
      setTimeout(start, 300);
    } else start();
  }

  if (text && old.lines.length > 0) {
    const ghost = document.createElement('div');
    ghost.className = GHOST;
    ghost.setAttribute('aria-hidden', 'true');
    Object.assign(ghost.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      bottom: '0',
      width: `${old.width}px`,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'flex-start',
      gap: '2px',
      overflow: 'hidden',
      pointerEvents: 'none'
    });
    old.lines.forEach((line) => ghost.appendChild(line));
    text.appendChild(ghost);
    ghost
      .animate(
        [
          { opacity: 1, transform: 'none' },
          { opacity: 0, transform: 'translateY(-7px)' }
        ],
        { duration: 220, easing: LEAVE, fill: 'forwards' }
      )
      .finished.catch(() => undefined)
      .finally(() => ghost.remove());
    text.querySelectorAll(':scope > .song-title, :scope > .song-artists').forEach((line, k) =>
      line.animate(
        [
          { opacity: 0, transform: 'translateY(8px)' },
          { opacity: 1, transform: 'none' }
        ],
        { duration: 380, easing: ARRIVE, delay: 110 + k * 55, fill: 'backwards' }
      )
    );
  }
}

/** Covers a click can come from, in tiles and rows (A2). */
const COVER_SELECTOR = [
  '.song-card-cover',
  '.song-cover-and-play-btn-container',
  '.album-cover-and-play-btn-container',
  '.artist-img-container',
  '.playlist-cover-and-play-btn-container',
  '.genre-cover'
].join(',');

/** The one cover of the tile or row an event happened in, if it happened in one. */
function coverOf(target: EventTarget | null): Element | null {
  let element = target instanceof Element ? target : null;
  for (let depth = 0; element && depth < 8; depth += 1, element = element.parentElement) {
    if (element.matches(COVER_SELECTOR)) return element;
    const covers = element.querySelectorAll(COVER_SELECTOR);
    if (covers.length === 1) return covers[0];
    if (covers.length > 1) return null;
  }
  return null;
}

/** The cover whose context menu was opened last: where "Add to queue" flies from (A9). */
let menuSource: Element | null = null;

/**
 * Shared covers (A2): a click inside a tile or a row names that one cover `hero-cover` for the
 * next transition, so if the click opens a page with a hero header, the cover flies into it. The
 * tile is the nearest ancestor of the click holding exactly one cover, so a click on a page
 * header never picks a cover from the list below it.
 */
export function installSharedCovers() {
  const onClick = (event: MouseEvent) => {
    const cover = coverOf(event.target);
    if (cover) nameForTransition(cover, 'hero-cover');
  };
  const onMenu = (event: MouseEvent) => {
    menuSource = coverOf(event.target);
  };
  document.addEventListener('click', onClick, true);
  document.addEventListener('contextmenu', onMenu, true);
  return () => {
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('contextmenu', onMenu, true);
  };
}

/**
 * Add to queue / Play next (A9): a copy of the cover the menu was opened on flies in an arc to the
 * player's queue button, which bumps when it lands. Nothing flies without a cover or with reduced
 * motion; the queue change itself never waits for it.
 */
export function flyToQueue() {
  const source = menuSource;
  menuSource = null;
  const target = document.querySelector('.song-controls-container .queue-btn');
  const image = source?.querySelector('img');
  if (!source?.isConnected || !target || !image || isMotionReduced()) return;
  const from = source.getBoundingClientRect();
  const to = target.getBoundingClientRect();
  const size = Math.min(from.width, 64);
  const flyer = Object.assign(document.createElement('img'), { src: image.currentSrc || image.src, alt: '' });
  Object.assign(flyer.style, {
    position: 'fixed',
    left: `${from.left + (from.width - size) / 2}px`,
    top: `${from.top + (from.height - size) / 2}px`,
    width: `${size}px`,
    height: `${size}px`,
    borderRadius: '8px',
    objectFit: 'cover',
    zIndex: '200',
    pointerEvents: 'none',
    boxShadow: '0 10px 24px rgb(0 0 0 / 0.4)'
  });
  document.body.appendChild(flyer);
  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);
  const flight = flyer.animate(
    [
      { transform: 'translate(0, 0) scale(1)', opacity: 1 },
      { transform: `translate(${dx * 0.55}px, ${dy * 0.35 - 60}px) scale(0.7)`, opacity: 1, offset: 0.55 },
      { transform: `translate(${dx}px, ${dy}px) scale(0.2)`, opacity: 0.2 }
    ],
    { duration: 450, easing: 'cubic-bezier(0.5, 0, 0.75, 0.5)' }
  );
  flight.finished
    .then(() => target.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.25)', offset: 0.4 }, { transform: 'scale(1)' }], { duration: 300, easing: springEasing() }))
    .catch(() => undefined)
    .finally(() => flyer.remove());
}

/**
 * A number that counts up from zero the first time it comes into view (A15); strings such as
 * "2.56 K" or "~137 hours" count their leading number and keep the rest. Returns the text to show.
 */
export function useCountUp(value: string | number, ref: RefObject<Element | null>) {
  const text = String(value);
  const match = text.match(/^(\D*?)(\d+(?:[.,]\d+)?)(.*)$/s);
  const [shown, setShown] = useState(text);
  const done = useRef(false);

  useEffect(() => {
    setShown(text);
    if (done.current || !match || !ref.current || isMotionReduced()) return undefined;
    const [, before, digits, after] = match;
    const target = parseFloat(digits.replace(',', '.'));
    const decimals = (digits.split(/[.,]/)[1] ?? '').length;
    let frame = 0;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting || done.current) return;
      done.current = true;
      observer.disconnect();
      const start = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / 600);
        const eased = 1 - (1 - t) ** 3;
        setShown(`${before}${(target * eased).toFixed(decimals)}${after}`);
        if (t < 1) frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    });
    observer.observe(ref.current);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
    // The text is the only input; the ref is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  return shown;
}

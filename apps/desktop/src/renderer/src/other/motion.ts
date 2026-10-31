import { type RefObject, useEffect, useRef, useState } from 'react';
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

/**
 * Track change (A4): when the current song changes, the cover slides in from the side the queue
 * moved to (from the right on next, from the left on previous) and the text rises in. Not on the
 * first song: that one is the restored session.
 */
export function useTrackChangeMotion(
  coverRef: RefObject<Element | null>,
  textRef: RefObject<Element | null>
) {
  const songId = useStore(store, (state) => state.currentSongData.songId);
  const index = useStore(store, (state) => state.localStorage.queue.currentSongIndex ?? 0);
  const previous = useRef<{ songId: string; index: number } | null>(null);

  useEffect(() => {
    const before = previous.current;
    previous.current = { songId, index };
    if (!before || !before.songId || before.songId === songId) return;
    const direction = index < before.index ? -1 : 1;
    animateIn(
      coverRef.current,
      [
        { opacity: 0, transform: `translateX(${direction * 16}px) scale(0.94)` },
        { opacity: 1, transform: 'none' }
      ],
      { token: 3, easing: 'spring' }
    );
    animateIn(
      textRef.current,
      [
        { opacity: 0, transform: 'translateY(6px)' },
        { opacity: 1, transform: 'none' }
      ],
      { token: 3, delay: 40 }
    );
    // Only the song decides; the refs are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songId]);
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

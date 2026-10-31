import { type RefObject, useEffect, useRef } from 'react';
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

/**
 * Shared covers (A2): a click inside a tile or a row names that one cover `hero-cover` for the
 * next transition, so if the click opens a page with a hero header, the cover flies into it. The
 * tile is the nearest ancestor of the click holding exactly one cover, so a click on a page
 * header never picks a cover from the list below it.
 */
export function installSharedCovers() {
  const onClick = (event: MouseEvent) => {
    let element = event.target instanceof Element ? event.target : null;
    for (let depth = 0; element && depth < 8; depth += 1, element = element.parentElement) {
      if (element.matches(COVER_SELECTOR)) {
        nameForTransition(element, 'hero-cover');
        return;
      }
      const covers = element.querySelectorAll(COVER_SELECTOR);
      if (covers.length === 1) {
        nameForTransition(covers[0], 'hero-cover');
        return;
      }
      if (covers.length > 1) return;
    }
  };
  document.addEventListener('click', onClick, true);
  return () => document.removeEventListener('click', onClick, true);
}

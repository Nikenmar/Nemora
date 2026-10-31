import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { raiseToTopLayer, topModalDialog } from './topLayer';

/**
 * Two speeds, by what the tooltip is for:
 * - an icon with no words of its own (player controls, toolbar icons) says what it does after a
 *   short wait, and once one has shown, its neighbours follow after a shorter one, never at once;
 * - a hint on something that already has words, or a cut-off text, waits as long as the system's
 *   own tooltip would.
 * `data-tooltip-delay="quick" | "slow"` overrides the guess.
 */
const QUICK_MS = 600;
const QUICK_WARM_MS = 250;
const SLOW_MS = 1200;
const WARM_WINDOW_MS = 500;
const GAP = 8;

interface Shown {
  text: string;
  x: number;
  y: number;
  below: boolean;
  /** Over a modal dialog the tooltip is drawn inside it, in the top layer (topLayer.ts). */
  host: HTMLDialogElement | null;
}

const visibleText = (el: Element) => (el as HTMLElement).innerText?.trim() ?? '';

/**
 * A tooltip that only repeats text already on screen never shows, and a taken-over `title` on text
 * shows only while that text is cut off. What is left is icons and real hints.
 */
const isWorthShowing = (el: Element, text: string) => {
  const visible = visibleText(el);
  if (!visible) return true;
  if (el.scrollWidth > el.clientWidth + 1) return true;
  return visible !== text.trim() && !el.hasAttribute('data-tooltip-title');
};

const isQuick = (el: Element) => {
  const asked = el.getAttribute('data-tooltip-delay');
  if (asked) return asked === 'quick';
  return !visibleText(el);
};

/**
 * Turns a native `title` into `data-tooltip`, so the system tooltip can never show: on anything with
 * a title, now and whenever one is added or React writes it back on a re-render.
 */
const adoptTitle = (el: Element) => {
  if (el instanceof SVGElement) return;
  const title = el.getAttribute('title');
  if (title === null) return;
  el.removeAttribute('title');
  if (!title) return;
  if (!el.hasAttribute('data-tooltip') || el.hasAttribute('data-tooltip-title')) {
    el.setAttribute('data-tooltip', title);
    el.setAttribute('data-tooltip-title', '');
  }
};

const adoptTitlesIn = (root: ParentNode) => {
  if (root instanceof Element) adoptTitle(root);
  root.querySelectorAll?.('[title]').forEach(adoptTitle);
};

/** One tooltip for the whole app, in the app's own style. Mounted once, next to the context menu. */
const TooltipLayer = memo(() => {
  const [shown, setShown] = useState<Shown | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const lastHidden = useRef(0);
  const target = useRef<Element | null>(null);
  const isUp = useRef(false);
  const tooltipRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (shown?.host) raiseToTopLayer(tooltipRef.current);
  }, [shown]);

  useEffect(() => {
    adoptTitlesIn(document.body);
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'attributes') adoptTitle(record.target as Element);
        else record.addedNodes.forEach((node) => node instanceof Element && adoptTitlesIn(node));
      }
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['title']
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const hide = () => {
      window.clearTimeout(timer.current);
      if (isUp.current) lastHidden.current = performance.now();
      target.current = null;
      isUp.current = false;
      setShown(null);
    };

    const show = (el: Element) => {
      const text = el.getAttribute('data-tooltip');
      if (!text || !el.isConnected || target.current !== el || !isWorthShowing(el, text)) return;
      const rect = el.getBoundingClientRect();
      const below = rect.top < 56;
      isUp.current = true;
      setShown({
        text,
        x: rect.left + rect.width / 2,
        y: below ? rect.bottom + GAP : rect.top - GAP,
        below,
        host: topModalDialog()
      });
    };

    const onOver = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      const el = (event.target as Element | null)?.closest?.('[data-tooltip]') ?? null;
      if (el === target.current) return;
      window.clearTimeout(timer.current);
      if (!el) {
        if (target.current) hide();
        return;
      }
      const quick = isQuick(el);
      const warm =
        quick && (isUp.current || performance.now() - lastHidden.current < WARM_WINDOW_MS);
      if (isUp.current) lastHidden.current = performance.now();
      target.current = el;
      isUp.current = false;
      setShown(null);
      timer.current = window.setTimeout(
        () => show(el),
        quick ? (warm ? QUICK_WARM_MS : QUICK_MS) : SLOW_MS
      );
    };

    const onFocus = (event: FocusEvent) => {
      const el = (event.target as Element | null)?.closest?.('[data-tooltip]');
      if (!el || !(el as HTMLElement).matches(':focus-visible')) return;
      window.clearTimeout(timer.current);
      target.current = el;
      timer.current = window.setTimeout(() => show(el), QUICK_WARM_MS);
    };

    document.addEventListener('pointerover', onOver, { passive: true });
    document.addEventListener('focusin', onFocus);
    document.addEventListener('focusout', hide);
    document.addEventListener('pointerdown', hide, { passive: true });
    document.addEventListener('keydown', hide);
    window.addEventListener('scroll', hide, { capture: true, passive: true });
    window.addEventListener('blur', hide);
    return () => {
      window.clearTimeout(timer.current);
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('focusout', hide);
      document.removeEventListener('pointerdown', hide);
      document.removeEventListener('keydown', hide);
      window.removeEventListener('scroll', hide, { capture: true });
      window.removeEventListener('blur', hide);
    };
  }, []);

  if (!shown) return null;
  const tooltip = (
    <div
      ref={tooltipRef}
      role="tooltip"
      popover={shown.host ? 'manual' : undefined}
      className={`pointer-events-none fixed inset-auto z-[100] m-0 max-w-[22rem] -translate-x-1/2 animate-[tooltipIn_140ms_var(--ease-out)] overflow-visible rounded-lg border border-glass-border bg-surface-3 px-2.5 py-1.5 text-small text-ink shadow-float ${
        shown.below ? '' : '-translate-y-full'
      }`}
      style={{ left: Math.min(Math.max(shown.x, 16), window.innerWidth - 16), top: shown.y }}
    >
      {shown.text}
    </div>
  );
  return shown.host ? createPortal(tooltip, shown.host) : tooltip;
});

TooltipLayer.displayName = 'TooltipLayer';
export default TooltipLayer;

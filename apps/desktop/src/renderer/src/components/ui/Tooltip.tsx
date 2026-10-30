import { memo, useEffect, useRef, useState } from 'react';

/** The first tooltip waits; once one has shown, its neighbours appear at once. */
const FIRST_DELAY_MS = 500;
const WARM_WINDOW_MS = 400;
const GAP = 8;

interface Shown {
  text: string;
  x: number;
  y: number;
  below: boolean;
  instant: boolean;
}

/**
 * One tooltip for the whole app, drawn in the app's own style instead of the system's. Anything with
 * `data-tooltip` gets it; a native `title` is taken over the first time the pointer reaches it, so
 * the system tooltip never shows. Mounted once, next to the context menu.
 */
const TooltipLayer = memo(() => {
  const [shown, setShown] = useState<Shown | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const lastHidden = useRef(0);
  const target = useRef<Element | null>(null);
  const isUp = useRef(false);

  useEffect(() => {
    const hide = () => {
      window.clearTimeout(timer.current);
      if (target.current) lastHidden.current = performance.now();
      target.current = null;
      isUp.current = false;
      setShown(null);
    };

    const show = (el: Element, instant: boolean) => {
      const text = el.getAttribute('data-tooltip');
      if (!text || !el.isConnected) return;
      const rect = el.getBoundingClientRect();
      const below = rect.top < 48;
      isUp.current = true;
      setShown({
        text,
        x: rect.left + rect.width / 2,
        y: below ? rect.bottom + GAP : rect.top - GAP,
        below,
        instant
      });
    };

    const onOver = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      const start = event.target as Element | null;
      const titled = start?.closest?.('[title]');
      if (titled) {
        const title = titled.getAttribute('title');
        titled.removeAttribute('title');
        if (title && !titled.hasAttribute('data-tooltip')) titled.setAttribute('data-tooltip', title);
      }
      const el = start?.closest?.('[data-tooltip]') ?? null;
      if (el === target.current) return;
      window.clearTimeout(timer.current);
      if (!el) {
        if (target.current) hide();
        return;
      }
      const warm = isUp.current || performance.now() - lastHidden.current < WARM_WINDOW_MS;
      target.current = el;
      isUp.current = false;
      setShown(null);
      if (warm) show(el, true);
      else timer.current = window.setTimeout(() => show(el, false), FIRST_DELAY_MS);
    };

    const onFocus = (event: FocusEvent) => {
      const el = (event.target as Element | null)?.closest?.('[data-tooltip]');
      if (!el || !(el as HTMLElement).matches(':focus-visible')) return;
      target.current = el;
      show(el, true);
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
  return (
    <div
      role="tooltip"
      className={`pointer-events-none fixed z-[100] max-w-[22rem] -translate-x-1/2 rounded-lg border border-glass-border bg-surface-3 px-2.5 py-1.5 text-small text-ink shadow-float ${
        shown.below ? '' : '-translate-y-full'
      } ${shown.instant ? '' : 'animate-[tooltipIn_125ms_var(--ease-out)]'}`}
      style={{ left: Math.min(Math.max(shown.x, 16), window.innerWidth - 16), top: shown.y }}
    >
      {shown.text}
    </div>
  );
});

TooltipLayer.displayName = 'TooltipLayer';
export default TooltipLayer;

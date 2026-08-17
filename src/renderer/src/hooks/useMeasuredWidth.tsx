import { type RefObject, useEffect, useState } from 'react';

/**
 * Width of an element, kept current through a ResizeObserver of its own.
 *
 * Deliberately not `useResizeObserver`: that hook debounces through a
 * module-level timeout shared by every caller, so two measured elements on one
 * page cancel each other's update and one of them keeps a stale width.
 */
const useMeasuredWidth = (ref: RefObject<HTMLElement | null>) => {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;

    const observer = new ResizeObserver((entries) => setWidth(entries[0].contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return width;
};

export default useMeasuredWidth;

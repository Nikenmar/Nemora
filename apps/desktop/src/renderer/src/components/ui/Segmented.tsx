import { useLayoutEffect, useRef, useState } from 'react';
import { cn as twMerge } from './cn';

import Icon from './Icon';

export interface SegmentedOption<T extends string> {
  value: T;
  label?: string;
  iconName?: string;
  tooltip?: string;
}

interface SegmentedProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
  size?: 'sm' | 'md';
}

/** Two to four mutually exclusive options side by side; a surface-2 thumb slides to the chosen one (PLAN/14 A8). */
function Segmented<T extends string>({ options, value, onChange, label, className, size = 'md' }: SegmentedProps<T>) {
  const groupRef = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const on = groupRef.current?.querySelector<HTMLElement>('[aria-checked="true"]');
    setThumb(on ? { left: on.offsetLeft, width: on.offsetWidth } : null);
  }, [value, options.length]);

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label={label}
      className={twMerge(
        'relative inline-flex shrink-0 items-center rounded-full border border-line p-0.5',
        size === 'sm' ? 'h-7' : 'h-8',
        className
      )}
    >
      {thumb && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0.5 left-0 z-0 rounded-full bg-surface-2 transition-[transform,width] duration-m2 ease-spring"
          style={{ width: thumb.width, transform: `translateX(${thumb.left}px)` }}
        />
      )}
      {options.map((option) => {
        const isOn = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isOn}
            data-tooltip={option.tooltip}
            aria-label={option.label ? undefined : option.tooltip}
            onClick={() => onChange(option.value)}
            className={twMerge(
              'relative z-[1] inline-flex h-full items-center gap-1.5 rounded-full px-3 text-[13px] font-medium outline-none transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-echo',
              isOn ? 'text-ink' : 'text-ink-dim hover:text-ink'
            )}
          >
            {option.iconName && <Icon name={option.iconName} filled={isOn} size={16} />}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export default Segmented;

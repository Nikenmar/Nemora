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

/** Two to four mutually exclusive options side by side; the chosen one sits on surface-2. */
function Segmented<T extends string>({ options, value, onChange, label, className, size = 'md' }: SegmentedProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={twMerge(
        'inline-flex shrink-0 items-center rounded-full border border-line p-0.5',
        size === 'sm' ? 'h-7' : 'h-8',
        className
      )}
    >
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
              'inline-flex h-full items-center gap-1.5 rounded-full px-3 text-[13px] font-medium outline-none transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-echo',
              isOn ? 'bg-surface-2 text-ink' : 'text-ink-dim hover:text-ink'
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

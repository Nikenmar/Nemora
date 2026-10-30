import { memo } from 'react';
import { cn as twMerge } from './cn';

interface ToggleProps {
  id: string;
  isChecked: boolean;
  onChange: (isChecked: boolean) => void;
  /** Read by screen readers; the visible label usually sits next to it. */
  label: string;
  isDisabled?: boolean;
  className?: string;
}

/** An on/off switch: blue track when on. */
const Toggle = memo(({ id, isChecked, onChange, label, isDisabled = false, className }: ToggleProps) => (
  <button
    type="button"
    id={id}
    role="switch"
    aria-checked={isChecked}
    aria-label={label}
    disabled={isDisabled}
    onClick={() => onChange(!isChecked)}
    className={twMerge(
      'relative inline-flex h-[22px] w-[38px] shrink-0 cursor-pointer items-center rounded-full outline-none transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-echo',
      isChecked ? 'bg-accent' : 'bg-line',
      isDisabled && 'cursor-not-allowed opacity-40',
      className
    )}
  >
    <span
      className={twMerge(
        'absolute left-[3px] h-4 w-4 rounded-full shadow-sm transition-transform duration-200 ease-out',
        isChecked ? 'translate-x-4 bg-on-accent' : 'bg-ink'
      )}
    />
  </button>
));

Toggle.displayName = 'Toggle';
export default Toggle;

import { memo, type CSSProperties } from 'react';
import { cn as twMerge } from './cn';

interface IconProps {
  /** A Material Symbols Rounded name, such as `play_arrow`. */
  name: string;
  /** Filled marks what is selected or on; everything else is an outline at weight 300. */
  filled?: boolean;
  /** In px; the icon takes the font size of its parent otherwise. */
  size?: number;
  className?: string;
  /** Announced to screen readers; without it the icon is decoration. */
  label?: string;
  style?: CSSProperties;
}

/** One Material Symbols Rounded glyph, in the redesign's weights (styles.css `.ms-icon`). */
const Icon = memo(({ name, filled = false, size, className, label, style }: IconProps) => (
  <span
    className={twMerge('ms-icon', filled && 'ms-icon-filled', className)}
    style={size ? { fontSize: size, ...style } : style}
    aria-hidden={label ? undefined : true}
    aria-label={label}
    role={label ? 'img' : undefined}
  >
    {name}
  </span>
));

Icon.displayName = 'Icon';
export default Icon;

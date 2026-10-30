/**
 * Class lists the redesign repeats across components that are not worth a component of their own.
 * They are built from the tokens (styles.css, tailwind.config.js) and switch with the theme.
 */

/** A one-line text field: a pill on surface-2, the echo ring for the keyboard. */
export const fieldClass =
  'h-8 w-full rounded-full border border-transparent bg-surface-2 px-3.5 text-body text-ink outline-none transition-[border-color,background-color] duration-150 placeholder:text-ink-faint hover:border-line focus:border-line focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-echo disabled:cursor-not-allowed disabled:opacity-50';

/** A multi-line text field: radius 10, not a pill. */
export const areaClass =
  'w-full rounded-[10px] border border-transparent bg-surface-2 px-3.5 py-2.5 text-body text-ink outline-none transition-[border-color] duration-150 placeholder:text-ink-faint hover:border-line focus:border-line focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-echo';

/** A panel: surface-1 with the panel radius, no border and no shadow. */
export const panelClass = 'rounded-panel bg-surface-1';

/** What floats over the page: menus, popovers, toasts. */
export const floatClass = 'rounded-menu border border-glass-border bg-surface-3 shadow-float';

/** A row that lights up on hover. */
export const hoverRowClass =
  'rounded-lg transition-colors duration-150 hover:bg-surface-2 focus-visible:bg-surface-2';

/** Small secondary text. */
export const metaClass = 'text-small text-ink-dim';

/** Press feedback for anything clickable. */
export const pressClass = 'transition-transform duration-150 ease-out active:scale-[0.97]';

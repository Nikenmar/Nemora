import { forwardRef, type ReactNode } from 'react';
import { cn as twMerge } from './cn';

import Button from '../Button';
import Icon from './Icon';

interface GameDialogProps {
  label: string;
  /** Size and height; the shell itself is shared. */
  className?: string;
  /** Escape minimises a game rather than ending it. */
  onCancel: () => void;
  children: ReactNode;
}

/**
 * The window Duel and SongGuessr open in: the app's dialog surface (surface-3, a hairline edge, the
 * float shadow) over the scrim, so a game reads as a layer above the page and never blends into it.
 *
 * Centred with `inset-0 m-auto`, not a -50% translate: an odd height lands a translate on a half
 * pixel and softens the whole layer. `[&:not([open])]:hidden` keeps Minimize working, since any
 * author `display` beats the browser's own `dialog:not([open])` rule.
 */
export const GameDialog = forwardRef<HTMLDialogElement, GameDialogProps>(
  ({ label, className, onCancel, children }, ref) => (
    <dialog
      ref={ref}
      aria-label={label}
      className={twMerge(
        'fixed inset-0 m-auto flex max-h-[calc(100vh-3rem)] min-w-0 flex-col overflow-hidden rounded-dialog border border-glass-border bg-surface-3 p-0 text-ink shadow-float backdrop:bg-scrim backdrop:backdrop-blur-[2px] open:animate-[gameDialogIn_180ms_var(--ease-out)] [&:not([open])]:hidden',
        className
      )}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      {children}
    </dialog>
  )
);

GameDialog.displayName = 'GameDialog';

interface GameHeaderProps {
  icon: string;
  title: string;
  subtitle?: string;
  /** Mode switches and chips, between the title and the window buttons. */
  children?: ReactNode;
  onMinimize?: () => void;
  minimizeLabel?: string;
  onClose?: () => void;
  closeLabel?: string;
}

/** A fixed-height header: nothing in it may change height mid-round and shift the game below. */
export const GameHeader = ({
  icon,
  title,
  subtitle,
  children,
  onMinimize,
  minimizeLabel,
  onClose,
  closeLabel
}: GameHeaderProps) => (
  <header className="flex h-16 shrink-0 items-center gap-3 border-b border-line px-5">
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-echo">
      <Icon name={icon} filled size={20} />
    </span>
    <div className="flex min-w-0 flex-1 flex-col">
      <h1 className="truncate text-section font-semibold leading-tight text-ink">{title}</h1>
      {subtitle && <p className="truncate text-small text-ink-dim">{subtitle}</p>}
    </div>
    {children}
    {(onMinimize || onClose) && (
      <div className="ml-1 flex shrink-0 items-center gap-0.5">
        {onMinimize && (
          <Button
            iconName="remove"
            tooltipLabel={minimizeLabel}
            className="m-0"
            clickHandler={onMinimize}
          />
        )}
        {onClose && (
          <Button iconName="close" tooltipLabel={closeLabel} className="m-0" clickHandler={onClose} />
        )}
      </div>
    )}
  </header>
);

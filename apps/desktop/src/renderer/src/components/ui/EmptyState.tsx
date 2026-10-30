import type { ReactNode } from 'react';
import { cn as twMerge } from './cn';

import Icon from './Icon';

interface EmptyStateProps {
  iconName: string;
  title: string;
  /** One line on what to do next. */
  description?: ReactNode;
  /** Usually a primary Button that does exactly that. */
  action?: ReactNode;
  className?: string;
}

/** An empty place: what is missing and how to fill it. */
const EmptyState = ({ iconName, title, description, action, className }: EmptyStateProps) => (
  <div
    className={twMerge(
      'empty-state flex w-full flex-col items-center justify-center gap-3 px-8 py-16 text-center',
      className
    )}
  >
    <span className="mb-1 flex h-14 w-14 items-center justify-center rounded-full bg-surface-2 text-ink-dim">
      <Icon name={iconName} size={28} />
    </span>
    <p className="text-section font-semibold text-ink">{title}</p>
    {description && <p className="max-w-[26rem] text-body text-ink-dim">{description}</p>}
    {action && <div className="mt-2 flex items-center gap-2">{action}</div>}
  </div>
);

export default EmptyState;

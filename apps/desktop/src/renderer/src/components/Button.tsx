import {
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { cn as twMerge } from './ui/cn';

import Icon from './ui/Icon';

/**
 * - `primary`: the one main action of a place (Play, Save, Create), blue.
 * - `secondary`: the usual button, on surface-2.
 * - `outline`: a quieter labelled action.
 * - `ghost`: icon buttons and actions that should not draw the eye.
 * - `danger`: destructive actions.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';

export interface ButtonProps {
  id?: string;
  label?: string;
  /** One icon name, or several separated by `;`. */
  iconName?: string;
  className?: string;
  iconClassName?: string;
  pendingClassName?: string;
  clickHandler: (
    e: ReactMouseEvent<HTMLButtonElement, MouseEvent> | KeyboardEvent<HTMLButtonElement>,
    setIsDisabled: (state: boolean) => void,
    setIsPending: (state: boolean) => void
  ) => void;
  isDisabled?: boolean;
  isVisible?: boolean;
  tooltipLabel?: string;
  pendingAnimationOnDisabled?: boolean;
  style?: CSSProperties;
  onContextMenu?: (e: ReactMouseEvent<HTMLButtonElement, MouseEvent>) => void;
  removeFocusOnClick?: boolean;
  children?: string;
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  /** The icon drawn filled: the button's state is on. */
  isActive?: boolean;
  /** In a page header, the button moves into the ⋯ menu (TitleContainer). */
  inOverflowMenu?: boolean;
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-on-accent hover:bg-accent-hover',
  secondary: 'bg-surface-2 text-ink hover:bg-line/70',
  outline: 'border border-line text-ink hover:bg-surface-2',
  ghost: 'text-ink-dim hover:bg-glass-hover hover:text-ink',
  danger: 'bg-danger-soft text-danger hover:bg-danger hover:text-on-accent'
};

const SIZES = {
  sm: { labelled: 'h-7 gap-1.5 px-3 text-small', icon: 'h-7 w-7 text-[18px]', glyph: 16 },
  md: { labelled: 'h-8 gap-2 px-3.5 text-[13px]', icon: 'h-8 w-8 text-[20px]', glyph: 18 },
  lg: { labelled: 'h-10 gap-2 px-5 text-body', icon: 'h-10 w-10 text-[22px]', glyph: 20 }
};

const Button = memo((props: ButtonProps) => {
  const {
    id,
    className,
    iconName,
    iconClassName,
    pendingClassName,
    children,
    label = children,
    clickHandler,
    tooltipLabel = label,
    pendingAnimationOnDisabled = false,
    onContextMenu,
    isDisabled = false,
    isVisible = true,
    style,
    removeFocusOnClick = true,
    variant,
    size = 'md',
    isActive = false
  } = props;

  const [isButtonDisabled, setIsButtonDisabled] = useState(isDisabled);
  const [isStatusPending, setIsStatusPending] = useState(pendingAnimationOnDisabled);

  useEffect(() => {
    setIsButtonDisabled(isDisabled);
  }, [isDisabled]);

  const updateIsDisabled = (state: boolean) => setIsButtonDisabled(state);
  const updateIsPending = (state: boolean) => setIsStatusPending(state);

  // A heart that becomes liked pops and sends a ring out (PLAN/14 A6); never on first paint.
  const [popKey, setPopKey] = useState(0);
  const wasActive = useRef(isActive);
  useEffect(() => {
    if (isActive && !wasActive.current && iconName?.split(';').includes('favorite')) {
      setPopKey((key) => key + 1);
    }
    wasActive.current = isActive;
  }, [iconName, isActive]);

  const isIconOnly = !label && !!iconName;
  const look = variant ?? (isIconOnly ? 'ghost' : 'secondary');
  const sizing = SIZES[size];
  const isPendingNow = isStatusPending && isButtonDisabled;

  const buttonIcons = useMemo(() => {
    if (!iconName || isPendingNow) return [];
    return iconName
      .split(';')
      .map((name) => (
        <Icon
          key={`${name}-${popKey}`}
          name={name}
          filled={isActive || look === 'primary'}
          size={sizing.glyph}
          className={twMerge(
            'icon relative flex items-center justify-center',
            popKey > 0 && name === 'favorite' && 'like-pop',
            iconClassName
          )}
        />
      ));
  }, [iconClassName, iconName, isActive, isPendingNow, look, popKey, sizing.glyph]);

  return (
    <button
      type="button"
      id={id}
      className={twMerge(
        `button group relative mr-4 inline-flex shrink-0 cursor-pointer select-none items-center justify-center whitespace-nowrap rounded-full font-medium leading-none outline-none transition-[background-color,color,transform,opacity] duration-150 ease-out active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-echo`,
        isIconOnly ? sizing.icon : sizing.labelled,
        VARIANTS[look],
        isActive && look === 'ghost' && 'text-echo hover:text-echo',
        isButtonDisabled && '!cursor-not-allowed opacity-40 active:scale-100',
        !isVisible && 'hidden',
        className
      )}
      onClick={(e) => {
        if (!isButtonDisabled) {
          if (removeFocusOnClick) e.currentTarget.blur();
          clickHandler(e, updateIsDisabled, updateIsPending);
        }
      }}
      data-tooltip={tooltipLabel || undefined}
      aria-label={isIconOnly ? tooltipLabel || iconName : undefined}
      aria-pressed={isActive || undefined}
      disabled={isButtonDisabled}
      onContextMenu={onContextMenu}
      style={style}
    >
      {isPendingNow ? (
        <span
          className={twMerge(
            'relative flex h-4 w-4 animate-spin-ease items-center justify-center rounded-full border-2 border-current border-t-transparent',
            pendingClassName
          )}
          aria-hidden
        />
      ) : (
        buttonIcons
      )}
      {popKey > 0 && <span key={popKey} className="like-ring pointer-events-none absolute inset-0" aria-hidden />}
      {label && <span className="button-label-text w-max leading-none">{label}</span>}
    </button>
  );
});

Button.displayName = 'Button';
export default Button;

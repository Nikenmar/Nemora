import { Fragment, type ReactNode, useContext, useMemo, useRef } from 'react';
import { cn as twMerge } from './ui/cn';

import { AppUpdateContext } from '../contexts/AppUpdateContext';
import Button, { type ButtonProps } from './Button';
import Dropdown, { type DropdownProp } from './Dropdown';

interface ExtendedButtonProps extends ButtonProps {
  isVisible?: boolean;
}

type Props = {
  title: string;
  className?: string;
  titleClassName?: string;
  isButtonsAndDropdownsVisible?: boolean;
  /**
   * The page's actions. Order them by weight: the one `variant: 'primary'` (Play, Create) first,
   * then the secondary ones. Icon-only buttons render as quiet icons; `inOverflowMenu` moves the
   * rare and the destructive ones into the ⋯ menu.
   */
  buttons?: ExtendedButtonProps[];
  /** Sort and filter: chips on the right. */
  dropdowns?: DropdownProp<string>[];
  /** Next to the title: counts and similar meta. */
  otherItems?: ReactNode[];
};

const noop = () => undefined;

/**
 * The header of a list page: the title with its meta, then a row with the main action, the
 * secondary ones, quiet icon actions and a ⋯ menu on the left, sort and filter on the right.
 */
const TitleContainer = (props: Props) => {
  const {
    title,
    className,
    titleClassName,
    dropdowns = [],
    buttons = [],
    otherItems = [],
    isButtonsAndDropdownsVisible = true
  } = props;
  const { updateContextMenuData } = useContext(AppUpdateContext);
  const moreRef = useRef<HTMLDivElement>(null);

  const visible = useMemo(() => buttons.filter((button) => button.isVisible ?? true), [buttons]);
  const inline = useMemo(() => visible.filter((button) => !button.inOverflowMenu), [visible]);
  const overflow = useMemo(() => visible.filter((button) => button.inOverflowMenu), [visible]);

  const labelled = inline.filter((button) => button.label || button.children);
  const iconOnly = inline.filter((button) => !(button.label || button.children));

  const openOverflow = () => {
    const rect = moreRef.current?.getBoundingClientRect();
    if (!rect) return;
    updateContextMenuData(
      true,
      overflow.map((button) => ({
        label: button.label ?? button.children ?? button.tooltipLabel ?? '',
        iconName: button.iconName?.split(';')[0],
        class: button.variant === 'danger' ? 'menu-item-danger' : undefined,
        isDisabled: button.isDisabled,
        handlerFunction: () =>
          button.clickHandler(
            {} as Parameters<ButtonProps['clickHandler']>[0],
            noop as (state: boolean) => void,
            noop as (state: boolean) => void
          )
      })),
      rect.left,
      rect.bottom + 6
    );
  };

  return (
    <header className={twMerge('title-container mb-5 mt-1 flex flex-col gap-3 text-ink', className)}>
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className={twMerge('truncate text-page font-semibold text-ink', titleClassName)}>{title}</h1>
        {otherItems.map((item, index) => (
          // The items are fixed slots handed in by position.
          <Fragment key={index}>{item}</Fragment>
        ))}
      </div>
      {isButtonsAndDropdownsVisible && (inline.length > 0 || overflow.length > 0 || dropdowns.length > 0) && (
        <div className="other-controls-container flex flex-wrap items-center justify-between gap-2">
          <div className="buttons-container flex flex-wrap items-center gap-2">
            {labelled.map((button) => (
              <Button
                {...button}
                key={button.id || button.label || button.iconName}
                className={twMerge('!mr-0', button.className)}
              />
            ))}
            {iconOnly.length > 0 && (
              <div className={twMerge('flex items-center gap-0.5', labelled.length > 0 && 'ml-1')}>
                {iconOnly.map((button) => (
                  <Button
                    {...button}
                    key={button.id || button.iconName}
                    className={twMerge('!mr-0', button.className)}
                  />
                ))}
              </div>
            )}
            {overflow.length > 0 && (
              <div ref={moreRef}>
                <Button
                  iconName="more_horiz"
                  tooltipLabel="More"
                  className="!mr-0"
                  clickHandler={(e) => {
                    e.stopPropagation?.();
                    openOverflow();
                  }}
                />
              </div>
            )}
          </div>
          {dropdowns.length > 0 && (
            <div className="dropdowns-container flex flex-wrap items-center gap-2">
              {dropdowns.map((dropdown) => (
                <Dropdown key={dropdown.name} {...dropdown} className={twMerge('!ml-0', dropdown.className)} />
              ))}
            </div>
          )}
        </div>
      )}
    </header>
  );
};

export default TitleContainer;

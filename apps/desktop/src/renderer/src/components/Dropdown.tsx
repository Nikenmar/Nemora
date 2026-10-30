import { type ChangeEvent, useContext, useMemo, useRef } from 'react';
import { cn as twMerge } from './ui/cn';

import { AppUpdateContext } from '../contexts/AppUpdateContext';
import Icon from './ui/Icon';

export interface DropdownOption<T extends string> {
  label: string;
  value: T;
  isDisabled?: boolean;
}

export interface DropdownProp<T extends string> {
  name: string;
  className?: string;
  options: DropdownOption<T>[];
  value: T;
  onChange: (_e: ChangeEvent<HTMLSelectElement>) => void;
  isDisabled?: boolean;
  /** What the choice is about (`Sort By :`); shown as the chip's tooltip. */
  type?: string;
  /** The chip's icon; guessed from the name (sort, filter) when absent. */
  iconName?: string;
}

const guessIcon = (name: string) =>
  /sort/i.test(name) ? 'swap_vert' : /filter/i.test(name) ? 'filter_list' : 'tune';

/**
 * A choice among options, drawn as a chip that opens the app's glass menu. `onChange` receives an
 * object shaped like a select's change event (`currentTarget.value`), as the native select did.
 */
function Dropdown<T extends string>(props: DropdownProp<T>) {
  const { className, name, value, onChange, options, isDisabled = false, type = '', iconName } = props;
  const { updateContextMenuData } = useContext(AppUpdateContext);
  const ref = useRef<HTMLButtonElement>(null);

  const selected = useMemo(() => options.find((option) => option.value === value), [options, value]);
  const tooltip = `${type.replace(/\s*:\s*$/, '')}`.trim();

  const open = () => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const items: ContextMenuItem[] = options
      .filter((option) => !option.isDisabled)
      .map((option) => ({
        label: option.label,
        iconName: option.value === value ? 'check' : '',
        handlerFunction: () => {
          const target = { value: option.value, name } as unknown as HTMLSelectElement;
          onChange({ currentTarget: target, target } as ChangeEvent<HTMLSelectElement>);
        }
      }));
    updateContextMenuData(true, items, rect.left, rect.bottom + 6);
  };

  return (
    <button
      type="button"
      ref={ref}
      id={name}
      name={name}
      disabled={isDisabled}
      onClick={(e) => {
        e.stopPropagation();
        open();
      }}
      data-tooltip={tooltip || undefined}
      aria-haspopup="menu"
      className={twMerge(
        'dropdown ml-2 inline-flex h-8 max-w-[14rem] shrink-0 cursor-pointer items-center gap-1.5 rounded-full bg-surface-2 pl-3 pr-2 text-[13px] font-medium text-ink outline-none transition-[background-color,transform] duration-150 ease-out hover:bg-line/70 active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-echo',
        isDisabled && '!cursor-not-allowed opacity-40 active:scale-100',
        className
      )}
    >
      <Icon name={iconName ?? guessIcon(name)} size={16} className="text-ink-dim" />
      <span className="truncate">{selected?.label ?? value}</span>
      <Icon name="expand_more" size={18} className="text-ink-dim" />
    </button>
  );
}

export default Dropdown;

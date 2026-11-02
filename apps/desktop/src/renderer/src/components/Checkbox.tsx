 

import { type KeyboardEvent, memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import Icon from './ui/Icon';

interface CheckboxProp {
  id: string;
  className?: string;
  isChecked: boolean;
  checkedStateUpdateFunction: (_state: boolean) => void;
  labelContent?: string;
  isDisabled?: boolean;
  tooltipLabel?: string;
}

const Checkbox = memo((props: CheckboxProp) => {
  const { t } = useTranslation();

  const {
    id,
    checkedStateUpdateFunction,
    isChecked,
    labelContent,
    className,
    isDisabled = false,
    tooltipLabel
  } = props;

  const focusInput = useCallback((e: KeyboardEvent<HTMLLabelElement>) => {
    if (e.key === 'Enter') {
      e.stopPropagation();
      const inputId = e.currentTarget.htmlFor;
      const inputElement = document.getElementById(inputId);
      inputElement?.click();
    }
  }, []);

  return (
    <label
      htmlFor={id}
      className={`checkbox-and-labels-container group ml-2 mt-4 flex !w-fit items-center rounded-md text-body text-ink outline-none transition-opacity focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-echo ${
        isDisabled && '!cursor-not-allowed opacity-50'
      } ${className}`}
      tabIndex={isDisabled ? -1 : 0}
      onKeyDown={focusInput}
      title={(tooltipLabel ?? isDisabled) ? t('common.optionDisabled') : undefined}
    >
      <input
        type="checkbox"
        name={id}
        id={id}
        className="peer hidden"
        checked={isChecked}
        disabled={isDisabled}
        onChange={(e) => checkedStateUpdateFunction(e.currentTarget.checked)}
      />
      <label
        className={`checkmark flex h-[18px] w-[18px] shrink-0 cursor-pointer items-center justify-center rounded-[5px] border-[1.5px] border-ink-dim transition-[background-color,border-color] duration-150 group-hover:border-ink peer-checked:border-accent peer-checked:bg-accent ${
          isDisabled && '!cursor-not-allowed'
        }`}
        htmlFor={id}
      >
        <Icon name="check" filled size={14} className="icon text-on-accent opacity-0" />
      </label>
      {labelContent && (
        <label
          htmlFor={id}
          className={`info ml-3 cursor-pointer ${isDisabled && '!cursor-not-allowed'}`}
        >
          {labelContent}
        </label>
      )}
    </label>
  );
});

Checkbox.displayName = 'Checkbox';
export default Checkbox;

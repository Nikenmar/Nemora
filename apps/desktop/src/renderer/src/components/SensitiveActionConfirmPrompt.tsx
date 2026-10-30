import { type ReactNode, useContext } from 'react';
import { AppUpdateContext } from '../contexts/AppUpdateContext';

import Button, { type ButtonProps } from './Button';

interface SensitiveActionConfrimPromptProp {
  title: string;
  content: ReactNode;
  confirmButton: ButtonProps;
  closePromptOnButtonClick?: boolean;
}

const SensitiveActionConfirmPrompt = (props: SensitiveActionConfrimPromptProp) => {
  const { changePromptMenuData } = useContext(AppUpdateContext);
  const { title, confirmButton, content, closePromptOnButtonClick = true } = props;
  return (
    <>
      <div className="title-container mb-8 mt-1 flex items-center pr-4 text-title font-semibold text-ink">
        {title}
      </div>
      <div className="description">{content}</div>
      <div className="buttons-container flex items-center justify-end">
        <Button
          label={confirmButton.label}
          iconName={confirmButton.iconName}
          className={`remove-song-from-library-btn danger-btn float-right mt-8 h-10 w-48 cursor-pointer rounded-lg !bg-danger text-on-media outline-none ease-in-out hover:border-danger ${confirmButton.className}`}
          clickHandler={(e, setIsDisabled, setIsPending) => {
            if (closePromptOnButtonClick) changePromptMenuData(false);
            return confirmButton.clickHandler(e, setIsDisabled, setIsPending);
          }}
        />
      </div>
    </>
  );
};

export default SensitiveActionConfirmPrompt;

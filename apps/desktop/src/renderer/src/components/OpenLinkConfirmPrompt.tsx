import { useContext, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { AppUpdateContext } from '../contexts/AppUpdateContext';
import storage from '../utils/localStorage';

import Button from './Button';
import Checkbox from './Checkbox';
import { useStore } from '@tanstack/react-store';
import { store, selectPreferences } from '@renderer/store';

interface OpenLinkConfirmPromptProps {
  link: string;
  title?: string;
  buttonClassName?: string;
}

const OpenLinkConfirmPrompt = (props: OpenLinkConfirmPromptProps) => {
  const { title, link, buttonClassName } = props;
  const preferences = useStore(store, selectPreferences('doNotVerifyWhenOpeningLinks'));
  const { changePromptMenuData } = useContext(AppUpdateContext);
  const { t } = useTranslation();

  const [checkboxState, setCheckboxState] = useState(
    preferences?.doNotVerifyWhenOpeningLinks ?? false
  );

  return (
    <div>
      <div className="title-container mb-4 flex items-center text-title font-semibold text-ink">
        <span className="ms-icon mr-2 text-4xl">link</span> {title}
      </div>
      <div className="description">
        <Trans
          i18nKey="openLinkConfirmPrompt.description"
          components={{
            span: (
              <span
                className="cursor-pointer font-normal text-echo hover:underline"
                onClick={() => {
                  changePromptMenuData(false);
                  window.api.settingsHelpers.openInBrowser(link);
                }}
                onKeyDown={() => {
                  changePromptMenuData(false);
                  window.api.settingsHelpers.openInBrowser(link);
                }}
                role="link"
                tabIndex={0}
              >
                &apos;{link}&apos;
              </span>
            ),
            br: <br />
          }}
        />
      </div>
      <Checkbox
        id="doNotVerifyWhenOpeningLinks"
        isChecked={checkboxState}
        checkedStateUpdateFunction={(state) => setCheckboxState(state)}
        labelContent={t('openLinkConfirmPrompt.doNotVerifyLink')}
      />
      <div className="buttons-container mt-12 flex justify-end">
        <Button
          label={t('common.cancel')}
          className={`remove-song-from-library-btn w-[10rem] !py-3 text-ink hover:border-accent ${buttonClassName}`}
          clickHandler={() => {
            changePromptMenuData(false);
          }}
        />
        <Button
          label={t('openLinkConfirmPrompt.openLink')}
          className={`remove-song-from-library-btn w-[10rem] !bg-accent !py-3 text-on-accent hover:border-accent ${buttonClassName}`}
          clickHandler={() => {
            storage.preferences.setPreferences('doNotVerifyWhenOpeningLinks', checkboxState);
            window.api.settingsHelpers.openInBrowser(link);
            changePromptMenuData(false);
          }}
        />
      </div>
    </div>
  );
};

export default OpenLinkConfirmPrompt;

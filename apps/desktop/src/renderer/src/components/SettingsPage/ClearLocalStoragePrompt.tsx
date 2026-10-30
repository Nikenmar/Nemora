import { Trans, useTranslation } from 'react-i18next';

import storage from '../../utils/localStorage';

import Button from '../Button';

const ClearLocalStoragePrompt = () => {
  const { t } = useTranslation();

  const { resetLocalStorage } = storage;

  return (
    <>
      <div className="title-container mb-8 mt-1 flex items-center pr-4 text-title font-semibold text-ink">
        {t('clearLocalStoragePrompt.title')}
      </div>
      <p>{t('clearLocalStoragePrompt.description')}</p>

      <div className="info-about-affecting-files-container mt-4">
        <Trans
          i18nKey="clearLocalStoragePrompt.effect"
          components={{
            p: <p className="mb-1" />,
            ul: (
              <ul className="ml-4 list-inside list-disc marker:text-echo" />
            ),
            li: <li className="text-sm font-light" />
          }}
        />
      </div>

      <br />
      <p> {t('clearLocalStoragePrompt.restartNotice')}</p>
      <div className="buttons-container flex items-center justify-end">
        <Button
          label={t('settingsPage.clearOptionalData')}
          className="confirm-app-reset-btn danger-btn float-right mt-6 h-10 w-48 cursor-pointer rounded-lg !bg-danger text-on-media outline-none ease-in-out hover:border-danger "
          clickHandler={() => {
            resetLocalStorage();
            window.api.appControls.restartRenderer('LOCAL_STORAGE_CLEARED');
          }}
        />
      </div>
    </>
  );
};

export default ClearLocalStoragePrompt;

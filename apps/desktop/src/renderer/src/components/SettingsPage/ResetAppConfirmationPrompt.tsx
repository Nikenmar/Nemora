import { Trans, useTranslation } from 'react-i18next';
import Button from '../Button';

export const ResetAppConfirmationPrompt = () => {
  const { t } = useTranslation();
  return (
    <>
      <div className="title-container mb-8 mt-1 flex items-center pr-4 text-title font-semibold text-ink">
        {t('resetAppConfirmationPrompt.confirmAppReset')}
      </div>
      <p>
        <Trans
          i18nKey="resetAppConfirmationPrompt.message"
          components={{
            span: <span className="font-semibold text-danger" />
          }}
        />
      </p>
      <br />
      <p>{t('resetAppConfirmationPrompt.restartAfterReset')}</p>
      <div className="buttons-container flex items-center justify-end">
        <Button
          label={t('settingsPage.resetApp')}
          className="confirm-app-reset-btn danger-btn float-right mt-6 h-10 w-48 cursor-pointer rounded-lg !bg-danger text-on-media outline-none ease-in-out hover:border-danger "
          clickHandler={() => window.api.appControls.resetApp()}
        />
      </div>
    </>
  );
};

export default ResetAppConfirmationPrompt;

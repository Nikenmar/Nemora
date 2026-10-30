import { type ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import Button from './Button';
import Hyperlink from './Hyperlink';

import packageFile from '../../../../package.json';

interface ErrorPromptProps {
  reason: string;
  message?: ReactNode;
  showSendFeedbackBtn?: boolean;
}
const ErrorPrompt = (props: ErrorPromptProps) => {
  const { t } = useTranslation();

  const { reason, message, showSendFeedbackBtn } = props;
  return (
    <>
      <div className="alert-icon-container">
        <div className="title-container mb-4 mt-1 flex items-center text-3xl font-medium uppercase text-danger">
          <span className="ms-icon icon mr-4 text-4xl">warning</span>
          <span className="font-semibold">{t('errorPrompt.title')}</span>
        </div>
      </div>
      {message && <div>{message}</div>}
      {showSendFeedbackBtn && (
        <>
          <br />
          <div>
            <Trans
              i18nKey="errorPrompt.sendErrorInfo"
              components={{
                Hyperlink1: (
                  <Hyperlink
                    noValidityCheck
                    link="https://github.com/Nikenmar/Nemora/issues/new?template=bug_report.yml"
                  />
                ),
                Hyperlink2: <Hyperlink noValidityCheck linkTitle="" link={packageFile.bugs.url} />
              }}
            />
          </div>
        </>
      )}
      <div className="buttons-container flex items-center justify-end">
        <Button
          label={t('common.restartApp')}
          iconName="sync"
          className="mt-6 w-fit !bg-accent !text-on-accent hover:border-accent "
          clickHandler={() => window.api.appControls.restartRenderer(reason)}
        />
      </div>
    </>
  );
};

export default ErrorPrompt;

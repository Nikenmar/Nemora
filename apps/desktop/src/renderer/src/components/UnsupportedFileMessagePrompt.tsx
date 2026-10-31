import { useContext } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import Button from './Button';
import { AppUpdateContext } from '../contexts/AppUpdateContext';

import { appPreferences } from '../../../../package.json';

type Props = { filePath: string };
const { supportedMusicExtensions } = appPreferences;

const supportedExtensionComponents = supportedMusicExtensions.map((ext) => (
  <span className="mx-2" key={ext}>
    &bull; <span className="hover:underline">{ext}</span>
  </span>
));

const UnsupportedFileMessagePrompt = (props: Props) => {
  const { changePromptMenuData } = useContext(AppUpdateContext);
  const { t } = useTranslation();

  const { filePath } = props;
  const fileType = filePath.split('.').at(-1)?.replace('.', '') ?? filePath;

  return (
    <div>
      <div className="title-container mb-4 text-title font-semibold">
        {t('unsupportedFileMessagePrompt.title')}
      </div>
      <div className="description">
        <Trans
          i18nKey="unsupportedFileMessagePrompt.description"
          components={{
            span: <span className="underline">{fileType}</span>,
            div: <div className="mt-1">{supportedExtensionComponents}</div>,
            br: <br />
          }}
        />
      </div>
      <div className="buttons-container mt-12 flex justify-end">
        <Button
          label={t('common.ok')}
          className="ok-btn w-[10rem] rounded-md !bg-accent !text-on-accent hover:border-accent "
          clickHandler={() => {
            changePromptMenuData(false);
          }}
        />
      </div>
    </div>
  );
};

export default UnsupportedFileMessagePrompt;

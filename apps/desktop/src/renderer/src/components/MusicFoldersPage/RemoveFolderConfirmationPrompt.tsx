import { useContext } from 'react';
import { useTranslation } from 'react-i18next';
import { AppUpdateContext } from '../../contexts/AppUpdateContext';
import Button from '../Button';

const RemoveFolderConfrimationPrompt = (props: { folderName: string; absolutePath: string }) => {
  const { changePromptMenuData } = useContext(AppUpdateContext);
  const { t } = useTranslation();

  const { folderName, absolutePath } = props;
  return (
    <>
      <div className="title-container mb-4 mt-1 text-title font-semibold text-ink">
        {t('removeFolderConfirmationPrompt.title', { folderName })}
      </div>
      <div className="description">{t('removeFolderConfirmationPrompt.message')}</div>
      <div className="buttons-container flex items-center justify-end">
        <Button
          className="remove-folder-confirm-btn danger-btn float-right mt-8 h-10 w-48 cursor-pointer rounded-lg !bg-danger font-medium text-on-media outline-none ease-in-out hover:border-danger "
          label={t('removeFolderConfirmationPrompt.removeFolder')}
          clickHandler={() => {
            window.api.folderData
              .removeAMusicFolder(absolutePath)
              .then(() => changePromptMenuData(false))
              .catch((err) => console.error(err));
          }}
        />
      </div>
    </>
  );
};

export default RemoveFolderConfrimationPrompt;

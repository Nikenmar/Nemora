import { useContext, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

// import { AppContext } from '../../contexts/AppContext';
import { AppUpdateContext } from '../../contexts/AppUpdateContext';

import Button from '../Button';
import Checkbox from '../Checkbox';

const BlacklistFolderConfrimPrompt = (props: { folderPaths: string[]; folderName?: string }) => {
  // const { isMultipleSelectionEnabled } = useContext(AppContext);
  const { addNewNotifications, changePromptMenuData } = useContext(AppUpdateContext);
  const { t } = useTranslation();

  const { folderPaths, folderName } = props;
  const [isDoNotShowAgain, setIsDoNotShowAgain] = useState(false);
  return (
    <>
      <div className="title-container mb-8 mt-1 flex items-center pr-4 text-title font-semibold text-ink">
        Confirm Blacklisting{' '}
        {folderPaths.length === 1 && folderName ? (
          <>&apos;{folderName}&apos; folder</>
        ) : (
          `${folderPaths.length} folders`
        )}
        .
      </div>
      <div className="description">
        {t('blacklistFolderConfirmPrompt.message', {
          count: folderPaths.length
        })}

        <div className="mt-4">
          {t('blacklistFolderConfirmPrompt.effectTitle')}
          <ul className="list-inside list-disc pl-4 marker:text-echo">
            <li>
              <Trans
                i18nKey="blacklistFolderConfirmPrompt.effect1"
                components={{
                  span: (
                    <span className="ms-icon text-echo" />
                  )
                }}
              />
            </li>
            <li>{t('blacklistFolderConfirmPrompt.effect2')}</li>
          </ul>
        </div>
        <div className="mt-4">
          {t('blacklistFolderConfirmPrompt.effectTitle2')}
          <ul className="list-inside list-disc pl-4 marker:text-echo">
            <li>
              <Trans
                i18nKey="blacklistSongConfirmPrompt.effect1"
                components={{
                  span: (
                    <span className="ms-icon text-echo">
                      block
                    </span>
                  )
                }}
              />
            </li>
            <li>
              <Trans
                i18nKey="blacklistSongConfirmPrompt.effect2"
                components={{
                  span: (
                    <span className="text-echo" />
                  )
                }}
              />
            </li>
            <li>
              <Trans
                i18nKey="blacklistSongConfirmPrompt.effect3"
                components={{
                  span: (
                    <span className="text-echo" />
                  )
                }}
              />
            </li>
          </ul>
        </div>
      </div>
      <Checkbox
        id="doNotShowAgainCheckbox"
        className="no-blacklist-song-confirm-checkbox-container mt-8"
        labelContent={t('common.doNotShowThisMessageAgain')}
        isChecked={isDoNotShowAgain}
        checkedStateUpdateFunction={(state) => {
          setIsDoNotShowAgain(state);
        }}
      />
      <div className="buttons-container flex items-center justify-end">
        <Button
          label={`Blacklist Folder${folderPaths.length !== 1 ? 's' : ''}`}
          className="blacklist-folders-btn mt-4 !bg-accent px-8 text-lg text-on-accent hover:border-accent "
          clickHandler={() => {
            return window.api.folderData.blacklistFolders(folderPaths).then(() => {
              addNewNotifications([
                {
                  id: `${folderName}Blacklisted`,
                  duration: 5000,
                  content: t('blacklistFolderConfirmPrompt.folderBlacklisted', {
                    count: folderPaths.length
                  }),
                  iconName: 'block'
                }
              ]);
              return changePromptMenuData(false);
            });
          }}
        />
      </div>
    </>
  );
};

export default BlacklistFolderConfrimPrompt;

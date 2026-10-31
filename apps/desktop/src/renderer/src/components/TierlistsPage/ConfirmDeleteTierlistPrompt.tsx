import { useCallback, useContext } from 'react';
import { useTranslation } from 'react-i18next';

import { AppUpdateContext } from '../../contexts/AppUpdateContext';
import Button from '../Button';

interface ConfirmDeleteTierlistProps {
  tierlist: SavableTierlist;
}

const ConfirmDeleteTierlistPrompt = ({ tierlist }: ConfirmDeleteTierlistProps) => {
  const { addNewNotifications, changePromptMenuData } = useContext(AppUpdateContext);
  const { t } = useTranslation();

  const deleteTierlist = useCallback(() => {
    window.api.tierlistsData
      .removeTierlists([tierlist.tierlistId])
      .then(() => {
        changePromptMenuData(false);
        return addNewNotifications([
          {
            id: 'tierlistDeleted',
            duration: 5000,
            content: t('tierlistsPage.deleteTierlist')
          }
        ]);
      })
      .catch((err) => console.error(err));
  }, [addNewNotifications, changePromptMenuData, t, tierlist.tierlistId]);

  return (
    <>
      <div className="title-container mb-8 mt-1 flex items-center pr-4 text-title font-semibold text-ink">
        {t('tierlistsPage.deleteTierlist')} — {tierlist.name}
      </div>
      <div className="description">{t('tierlistsPage.confirmDeleteMessage')}</div>
      <div className="buttons-container mt-8 flex w-full justify-end">
        <Button
          label={t('tierlistsPage.deleteTierlist')}
          className="delete-tierlist-btn danger-btn float-right h-10 w-48 cursor-pointer rounded-lg border-[transparent] !bg-danger text-on-media outline-none ease-in-out hover:border-danger "
          clickHandler={deleteTierlist}
        />
      </div>
    </>
  );
};

export default ConfirmDeleteTierlistPrompt;

import { lazy, useCallback, useContext, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AppUpdateContext } from '../../contexts/AppUpdateContext';
import storage from '../../utils/localStorage';
import i18n from '../../i18n';

import Dropdown, { type DropdownOption } from '../Dropdown';
import MainContainer from '../MainContainer';
import Button from '../Button';
import TierlistCard from './TierlistCard';
import TierSuggestionsPrompt from './TierSuggestionsPrompt';
import EmptyState from '../ui/EmptyState';


const NewTierlistPrompt = lazy(() => import('./NewTierlistPrompt'));

const tierlistSortTypes: DropdownOption<TierlistSortTypes>[] = [
  { label: i18n.t('sortTypes.aToZ'), value: 'aToZ' },
  { label: i18n.t('sortTypes.zToA'), value: 'zToA' },
  // Tierlists sort by date the opposite way to songs (oldest first for `dateAddedAscending`, as
  // in 1.x and in saved settings), so the shared "Newest" / "Oldest" labels are swapped here.
  { label: i18n.t('sortTypes.dateAddedDescending'), value: 'dateAddedAscending' },
  { label: i18n.t('sortTypes.dateAddedAscending'), value: 'dateAddedDescending' }
];

const TierlistsPage = () => {
  const { changePromptMenuData } = useContext(AppUpdateContext);
  const { t } = useTranslation();

  const [tierlists, setTierlists] = useState<SavableTierlist[]>([]);
  const [sortingOrder, setSortingOrder] = useState<TierlistSortTypes>(
    storage.sortingStates.getSortingStates('tierlistsPage') || 'dateAddedDescending'
  );

  const fetchTierlists = useCallback(() => {
    window.api.tierlistsData
      .getTierlistData([], sortingOrder)
      .then((res) => setTierlists(Array.isArray(res) ? res : []))
      .catch((err) => console.error(err));
  }, [sortingOrder]);

  useEffect(() => {
    fetchTierlists();
    const manageTierlistUpdates = (e: Event) => {
      if ('detail' in e) {
        const dataEvents = (e as DetailAvailableEvent<DataUpdateEvent[]>).detail;
        for (let i = 0; i < dataEvents.length; i += 1) {
          if (dataEvents[i].dataType.startsWith('tierlists')) fetchTierlists();
        }
      }
    };
    document.addEventListener('app/dataUpdates', manageTierlistUpdates);
    return () => document.removeEventListener('app/dataUpdates', manageTierlistUpdates);
  }, [fetchTierlists]);

  useEffect(() => {
    storage.sortingStates.setSortingStates('tierlistsPage', sortingOrder);
  }, [sortingOrder]);

  const openCreatePrompt = useCallback(
    () => changePromptMenuData(true, <NewTierlistPrompt />),
    [changePromptMenuData]
  );

  return (
    <MainContainer className="tierlists-page appear-from-bottom !h-full overflow-hidden !pb-0 text-ink">
      <>
        <div className="title-container mb-5 mt-1 flex flex-col gap-3 pr-4 text-ink">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="text-page font-semibold text-ink">{t('tierlistsPage.title')}</h1>
            <div className="other-stats-container flex items-center text-small text-ink-dim">
              {tierlists.length > 0 && (
                <span className="no-of-tierlists">
                  {t('tierlistsPage.tierlistWithCount', { count: tierlists.length })}
                </span>
              )}
            </div>
          </div>
          <div className="other-controls-container flex flex-wrap items-center gap-2">
            <Button
              label={t('tierlistsPage.addTierlist')}
              iconName="add"
              variant="primary"
              className="add-tierlist-btn !mr-0"
              clickHandler={openCreatePrompt}
            />
            {tierlists.length > 0 && (
              <Button
                label={t('tierSuggestions.open')}
                iconName="swap_vert"
                className="tier-suggestions-btn !mr-0"
                clickHandler={() =>
                  changePromptMenuData(true, <TierSuggestionsPrompt />, '!max-w-[40rem]')
                }
              />
            )}
            {tierlists.length > 0 && (
              <Dropdown
                name="tierlistSortDropdown"
                value={sortingOrder}
                options={tierlistSortTypes}
                onChange={(e) => setSortingOrder(e.currentTarget.value as TierlistSortTypes)}
              />
            )}
          </div>
        </div>

        {tierlists.length > 0 ? (
          <div className="tierlists-container flex h-full flex-wrap content-start gap-4 overflow-auto p-1 pb-8">
            {tierlists.map((tierlist) => (
              <TierlistCard key={tierlist.tierlistId} tierlist={tierlist} />
            ))}
          </div>
        ) : (
          <EmptyState
            className="no-tierlists-container h-full"
            iconName="leaderboard"
            title={t('tierlistsPage.empty')}
            action={
              <Button
                label={t('tierlistsPage.addTierlist')}
                iconName="add"
                variant="primary"
                className="!mr-0"
                clickHandler={openCreatePrompt}
              />
            }
          />
        )}
      </>
    </MainContainer>
  );
};

export default TierlistsPage;

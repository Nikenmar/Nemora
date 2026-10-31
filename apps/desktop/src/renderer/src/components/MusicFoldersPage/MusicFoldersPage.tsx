import { lazy, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppUpdateContext } from '../../contexts/AppUpdateContext';
import useSelectAllHandler from '../../hooks/useSelectAllHandler';
import storage from '../../utils/localStorage';
import i18n from '../../i18n';

import Button from '../Button';
import Folder from './Folder';
import Dropdown, { type DropdownOption } from '../Dropdown';
import MainContainer from '../MainContainer';

const AddMusicFoldersPrompt = lazy(() => import('./AddMusicFoldersPrompt'));

import { useStore } from '@tanstack/react-store';
import { store } from '@renderer/store';
import EmptyState from '../ui/EmptyState';

const folderDropdownOptions: DropdownOption<FolderSortTypes>[] = [
  { label: i18n.t('sortTypes.aToZ'), value: 'aToZ' },
  { label: i18n.t('sortTypes.zToA'), value: 'zToA' },
  {
    label: i18n.t('sortTypes.noOfSongsDescending'),
    value: 'noOfSongsDescending'
  },
  {
    label: i18n.t('sortTypes.noOfSongsAscending'),
    value: 'noOfSongsAscending'
  },
  {
    label: i18n.t('sortTypes.blacklistedFolders'),
    value: 'blacklistedFolders'
  },
  {
    label: i18n.t('sortTypes.whitelistedFolders'),
    value: 'whitelistedFolders'
  }
];

const MusicFoldersPage = () => {
  const isMultipleSelectionEnabled = useStore(
    store,
    (state) => state.multipleSelectionsData.isEnabled
  );
  const multipleSelectionsData = useStore(store, (state) => state.multipleSelectionsData);
  const currentlyActivePage = useStore(store, (state) => state.currentlyActivePage);
  const sortingStates = useStore(store, (state) => state.localStorage.sortingStates);

  const { updateCurrentlyActivePageData, toggleMultipleSelections, changePromptMenuData } =
    useContext(AppUpdateContext);
  const { t } = useTranslation();

  const [musicFolders, setMusicFolders] = useState<MusicFolder[]>([]);
  const [sortingOrder, setSortingOrder] = useState<FolderSortTypes>(
    (currentlyActivePage?.data?.sortingOrder as FolderSortTypes) ||
      sortingStates?.musicFoldersPage ||
      'aToZ'
  );

  // const scrollOffsetTimeoutIdRef = useRef(null as ReturnType<typeof setTimeout> | null);
  const foldersContainerRef = useRef(null as HTMLDivElement | null);
  // const { width, height } = useResizeObserver(foldersContainerRef);

  const fetchFoldersData = useCallback(
    () =>
      window.api.folderData
        .getFolderData([], sortingOrder)
        .then((res) => {
          if (Array.isArray(res) && res.length > 0) return setMusicFolders(res);
          return undefined;
        })
        .catch((err) => console.error(err)),
    [sortingOrder]
  );

  useEffect(() => {
    fetchFoldersData();
    const manageFolderDataUpdatesInMusicFoldersPage = (e: Event) => {
      if ('detail' in e) {
        const dataEvents = (e as DetailAvailableEvent<DataUpdateEvent[]>).detail;
        for (let i = 0; i < dataEvents.length; i += 1) {
          const event = dataEvents[i];
          if (
            event.dataType === 'userData/musicFolder' ||
            event.dataType === 'blacklist/folderBlacklist' ||
            event.dataType === 'songs/deletedSong' ||
            event.dataType === 'songs/newSong'
          )
            fetchFoldersData();
        }
      }
    };
    document.addEventListener('app/dataUpdates', manageFolderDataUpdatesInMusicFoldersPage);
    return () => {
      document.removeEventListener('app/dataUpdates', manageFolderDataUpdatesInMusicFoldersPage);
    };
  }, [fetchFoldersData]);

  useEffect(() => {
    storage.sortingStates.setSortingStates('musicFoldersPage', sortingOrder);
  }, [sortingOrder]);

  const musicFoldersWithPaths = useMemo(
    () => musicFolders.map((x) => ({ ...x, folderPath: x.path })),
    [musicFolders]
  );

  const selectAllHandler = useSelectAllHandler(musicFoldersWithPaths, 'folder', 'folderPath');

  const folderComponents = useMemo(() => {
    return musicFolders.map((musicFolder, index) => {
      const { path, songIds, isBlacklisted, subFolders } = musicFolder;
      return (
        <Folder
          key={path}
          folderPath={path}
          subFolders={subFolders}
          index={index}
          isBlacklisted={isBlacklisted}
          songIds={songIds}
          selectAllHandler={selectAllHandler}
        />
      );
    });
  }, [musicFolders, selectAllHandler]);

  const addNewFolder = useCallback(() => {
    changePromptMenuData(true, <AddMusicFoldersPrompt onFailure={(err) => console.error(err)} />);
  }, [changePromptMenuData]);

  return (
    <MainContainer
      className="music-folders-page appear-from-bottom relative !h-full !pb-0 !pr-4"
      focusable
      onKeyDown={(e) => {
        if (e.ctrlKey && e.key === 'a') {
          e.stopPropagation();
          selectAllHandler();
        }
      }}
    >
      <>
        {musicFolders && musicFolders.length > 0 && (
          <div className="title-container mb-5 mt-1 flex flex-col gap-3 pr-4 text-ink">
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
              <h1 className="text-page font-semibold text-ink">{t('foldersPage.musicFolders')}</h1>
              <div className="other-stats-container flex items-center text-small text-ink-dim">
                {isMultipleSelectionEnabled &&
                multipleSelectionsData.multipleSelections.length > 0 ? (
                  <div className="text-small font-medium text-echo">
                    {t('common.selectionWithCount', {
                      count: multipleSelectionsData.multipleSelections.length
                    })}
                  </div>
                ) : (
                  musicFolders.length > 0 && (
                    <span className="no-of-folders">
                      {t('common.folderWithCount', {
                        count: musicFolders.length
                      })}
                    </span>
                  )
                )}
              </div>
            </div>
            {musicFolders.length > 0 && (
              <div className="other-controls-container flex flex-wrap items-center gap-2">
                <Button
                  label={t('foldersPage.addFolder')}
                  iconName="create_new_folder"
                  variant="primary"
                  className="!mr-0"
                  pendingAnimationOnDisabled
                  clickHandler={addNewFolder}
                />
                <Button
                  className="select-btn !mr-0"
                  iconName={isMultipleSelectionEnabled ? 'remove_done' : 'checklist'}
                  isActive={isMultipleSelectionEnabled}
                  clickHandler={() =>
                    toggleMultipleSelections(!isMultipleSelectionEnabled, 'folder')
                  }
                  tooltipLabel={t(
                    `common.${isMultipleSelectionEnabled ? 'unselectAll' : 'select'}`
                  )}
                />
                <Dropdown
                  name="folderSortDropdown"
                  value={sortingOrder}
                  options={folderDropdownOptions}
                  onChange={(e) => {
                    updateCurrentlyActivePageData((currentData) => ({
                      ...currentData,
                      sortingOrder: e.currentTarget.value as ArtistSortTypes
                    }));
                    setSortingOrder(e.currentTarget.value as GenreSortTypes);
                  }}
                />
              </div>
            )}
          </div>
        )}

        <div
          className={`folders-container [scrollbar-gutter:stable] ${
            musicFolders && musicFolders.length > 0 && 'h-full'
          }`}
          ref={foldersContainerRef}
        >
          {folderComponents}
        </div>

        {musicFolders.length === 0 && (
          <EmptyState
            className="no-folders-container h-full"
            iconName="folder_open"
            title={t('foldersPage.empty')}
            action={
              <Button
                label={t('foldersPage.addFolder')}
                variant="primary"
                className="!mr-0"
                iconName="create_new_folder"
                pendingAnimationOnDisabled
                clickHandler={addNewFolder}
              />
            }
          />
        )}
      </>
    </MainContainer>
  );
};

export default MusicFoldersPage;

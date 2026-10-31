import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import Button from '../../Button';
import calculateElapsedTime from '../../../utils/calculateElapsedTime';
import parseByteSizes from '../../../utils/parseByteSizes';

const StorageSettings = () => {
  const { t } = useTranslation();

  const [storageMetrics, setStorageMetrics] = useState<StorageMetrics | null | undefined>();

  const fetchStorageUsageData = useCallback((forceRefresh = false) => {
    return window.api.storageData
      .getStorageUsage(forceRefresh)
      .then((res) => {
        if (!res || res.totalSize === 0) return setStorageMetrics(undefined);
        return setStorageMetrics(res);
      })
      .catch((err) => {
        console.error(err);
        return setStorageMetrics(null);
      });
  }, []);

  useEffect(() => {
    fetchStorageUsageData();
  }, [fetchStorageUsageData]);

  const appStorageBarWidths = useMemo(() => {
    if (storageMetrics) {
      const { appDataSizes, totalSize, appFolderSize, rootSizes } = storageMetrics;
      const {
        // appDataSize,
        artworkCacheSize,
        tempArtworkCacheSize,
        // totalArtworkCacheSize,
        logSize,
        songDataSize,
        artistDataSize,
        albumDataSize,
        genreDataSize,
        playlistDataSize,
        paletteDataSize,
        userDataSize
        // totalKnownItemsSize,
        // otherSize,
      } = appDataSizes;
      return {
        artworkCacheSizeWidth: (artworkCacheSize / rootSizes.size) * 100,
        tempArtworkCacheSizeWidth: (tempArtworkCacheSize / rootSizes.size) * 100,
        logSizeWidth: (logSize / rootSizes.size) * 100,
        songDataSizeWidth: (songDataSize / rootSizes.size) * 100,
        artistDataSizeWidth: (artistDataSize / rootSizes.size) * 100,
        albumDataSizeWidth: (albumDataSize / rootSizes.size) * 100,
        genreDataSizeWidth: (genreDataSize / rootSizes.size) * 100,
        userDataSizeWidth: (userDataSize / rootSizes.size) * 100,
        playlistDataSizeWidth: (playlistDataSize / rootSizes.size) * 100,
        paletteDataSizeWidth: (paletteDataSize / rootSizes.size) * 100,
        appFolderSizeWidth: (appFolderSize / rootSizes.size) * 100,
        otherApplicationSizesWidth:
          ((rootSizes.size - rootSizes.freeSpace - totalSize) / rootSizes.size) * 100
      };
    }
    return undefined;
  }, [storageMetrics]);

  const appDataStorageBarWidths = useMemo(() => {
    if (storageMetrics) {
      const { appDataSizes } = storageMetrics;
      const {
        songDataSize,
        artistDataSize,
        albumDataSize,
        genreDataSize,
        playlistDataSize,
        paletteDataSize,
        librarySize
      } = appDataSizes;

      return {
        songDataSizeWidth: (songDataSize / librarySize) * 100,
        artistDataSizeWidth: (artistDataSize / librarySize) * 100,
        albumDataSizeWidth: (albumDataSize / librarySize) * 100,
        genreDataSizeWidth: (genreDataSize / librarySize) * 100,
        playlistDataSizeWidth: (playlistDataSize / librarySize) * 100,
        paletteDataSizeWidth: (paletteDataSize / librarySize) * 100
      };
    }
    return undefined;
  }, [storageMetrics]);

  const appStorageBarCssProperties: CSSProperties = {};
  const appDataStorageBarCssProperties: CSSProperties = {};

  appStorageBarCssProperties['--other-applications-size-storage-bar-width'] =
    `${appStorageBarWidths?.otherApplicationSizesWidth || 0}%`;
  appStorageBarCssProperties['--app-folder-size-storage-bar-width'] = `${
    appStorageBarWidths?.appFolderSizeWidth || 0
  }%`;
  appStorageBarCssProperties['--artwork-cache-size-storage-bar-width'] = `${
    appStorageBarWidths?.artworkCacheSizeWidth || 0
  }%`;
  appStorageBarCssProperties['--temp-artwork-cache-size-storage-bar-width'] =
    `${appStorageBarWidths?.tempArtworkCacheSizeWidth || 0}%`;
  appStorageBarCssProperties['--song-data-size-storage-bar-width'] = `${
    appStorageBarWidths?.songDataSizeWidth || 0
  }%`;
  appStorageBarCssProperties['--artist-data-size-storage-bar-width'] = `${
    appStorageBarWidths?.artistDataSizeWidth || 0
  }%`;
  appStorageBarCssProperties['--album-data-size-storage-bar-width'] = `${
    appStorageBarWidths?.albumDataSizeWidth || 0
  }%`;
  appStorageBarCssProperties['--playlist-data-size-storage-bar-width'] = `${
    appStorageBarWidths?.playlistDataSizeWidth || 0
  }%`;
  appStorageBarCssProperties['--palette-data-size-storage-bar-width'] = `${
    appStorageBarWidths?.paletteDataSizeWidth || 0
  }%`;
  appStorageBarCssProperties['--genre-data-size-storage-bar-width'] = `${
    appStorageBarWidths?.genreDataSizeWidth || 0
  }%`;
  appStorageBarCssProperties['--user-data-size-storage-bar-width'] = `${
    appStorageBarWidths?.userDataSizeWidth || 0
  }%`;
  appStorageBarCssProperties['--log-size-storage-bar-width'] = `${
    appStorageBarWidths?.logSizeWidth || 0
  }%`;

  appDataStorageBarCssProperties['--song-data-size-storage-bar-width'] = `${
    appDataStorageBarWidths?.songDataSizeWidth || 0
  }%`;
  appDataStorageBarCssProperties['--artist-data-size-storage-bar-width'] = `${
    appDataStorageBarWidths?.artistDataSizeWidth || 0
  }%`;
  appDataStorageBarCssProperties['--album-data-size-storage-bar-width'] = `${
    appDataStorageBarWidths?.albumDataSizeWidth || 0
  }%`;
  appDataStorageBarCssProperties['--playlist-data-size-storage-bar-width'] = `${
    appDataStorageBarWidths?.playlistDataSizeWidth || 0
  }%`;
  appDataStorageBarCssProperties['--palette-data-size-storage-bar-width'] = `${
    appDataStorageBarWidths?.paletteDataSizeWidth || 0
  }%`;
  appDataStorageBarCssProperties['--genre-data-size-storage-bar-width'] = `${
    appDataStorageBarWidths?.genreDataSizeWidth || 0
  }%`;

  return (
    <li className="main-container storage-settings-container mb-16">
      <div className="title-container mb-4 mt-1 flex items-center text-title font-semibold text-ink">
        <span className="ms-icon mr-2">hard_drive</span>
        {t('settingsPage.storage')}
      </div>
      <p>{t('settingsPage.storageDescription')}</p>

      {storageMetrics && (
        <div>
          <div className="mx-auto mt-6 w-4/5">
            <div className="flex items-center justify-between text-sm opacity-50">
              <span> {t('settingsPage.fullStorageSpace')}</span>{' '}
              <span>
                {t('settingsPage.fullStorageOutOfUsage', {
                  value: parseByteSizes(storageMetrics?.totalSize)?.size,
                  total: parseByteSizes(storageMetrics?.rootSizes.size)?.size
                })}
              </span>
            </div>

            <div
              className="mt-2 flex h-4 overflow-hidden rounded-md bg-surface-2"
              style={appStorageBarCssProperties}
              title={t('settingsPage.freeSpace')}
            >
              <div
                className="!h-full w-[var(--other-applications-size-storage-bar-width)] cursor-pointer bg-[oklch(0.7_0.12_258)] opacity-75 transition-opacity hover:opacity-100"
                title={t('settingsPage.otherApplications')}
              />
              <div
                className="!h-full w-[var(--artwork-cache-size-storage-bar-width)] cursor-pointer bg-[oklch(0.7_0.12_288)] opacity-75 transition-opacity hover:opacity-100"
                title={t('settingsPage.artworkCache')}
              />
              <div
                className="!h-full w-[var(--temp-artwork-cache-size-storage-bar-width)] cursor-pointer bg-[oklch(0.7_0.12_318)] opacity-75 transition-opacity hover:opacity-100"
                title={t('settingsPage.tempArtworkCache')}
              />
              <div
                className="!h-full w-[var(--song-data-size-storage-bar-width)] cursor-pointer bg-[oklch(0.7_0.12_348)] opacity-75 transition-opacity hover:opacity-100"
                title={t('settingsPage.songsData')}
              />
              <div
                className="!h-full w-[var(--artist-data-size-storage-bar-width)] cursor-pointer bg-[oklch(0.7_0.12_18)] opacity-75 transition-opacity hover:opacity-100"
                title={t('settingsPage.artistsData')}
              />
              <div
                className="!h-full w-[var(--album-data-size-storage-bar-width)] cursor-pointer bg-[oklch(0.7_0.12_48)] opacity-75 transition-opacity hover:opacity-100"
                title={t('settingsPage.albumsData')}
              />
              <div
                className="!h-full w-[var(--playlist-data-size-storage-bar-width)] cursor-pointer bg-[oklch(0.7_0.12_78)] opacity-75 transition-opacity hover:opacity-100"
                title={t('settingsPage.playlistsData')}
              />
              <div
                className="!h-full w-[var(--palette-data-size-storage-bar-width)] cursor-pointer bg-[oklch(0.7_0.12_108)] opacity-75 transition-opacity hover:opacity-100"
                title={t('settingsPage.palettesData')}
              />
              <div
                className="!h-full w-[var(--genre-data-size-storage-bar-width)] cursor-pointer bg-[oklch(0.7_0.12_138)] opacity-75 transition-opacity hover:opacity-100"
                title={t('settingsPage.genresData')}
              />
              <div
                className="!h-full w-[var(--log-size-storage-bar-width)] cursor-pointer bg-[oklch(0.7_0.12_168)] opacity-75 transition-opacity hover:opacity-100"
                title={t('settingsPage.appLogs')}
              />
              <div
                className="!h-full w-[var(--user-data-size-storage-bar-width)] cursor-pointer bg-[oklch(0.7_0.12_198)] opacity-75 transition-opacity hover:opacity-100"
                title={t('settingsPage.userData')}
              />
              <div
                className="!h-full w-[var(--app-folder-size-storage-bar-width)] cursor-pointer bg-[oklch(0.7_0.12_228)] opacity-75 transition-opacity hover:opacity-100"
                title={t('settingsPage.internalAppFiles')}
              />
            </div>

            <div className="mt-10 flex items-center justify-between text-sm opacity-50">
              <span> {t('settingsPage.storageUseForLibraryData')}</span>{' '}
              <span>{parseByteSizes(storageMetrics?.appDataSizes.librarySize)?.size}</span>
            </div>

            <div
              className="mt-2 flex h-4 overflow-hidden rounded-md bg-surface-2"
              style={appDataStorageBarCssProperties}
            >
              <div
                className="!h-full w-[var(--song-data-size-storage-bar-width)] cursor-pointer bg-[oklch(0.7_0.12_348)] opacity-75 transition-opacity hover:opacity-100"
                title={t('settingsPage.songsData')}
              />
              <div
                className="!h-full w-[var(--artist-data-size-storage-bar-width)] cursor-pointer bg-[oklch(0.7_0.12_18)] opacity-75 transition-opacity hover:opacity-100"
                title={t('settingsPage.artistsData')}
              />
              <div
                className="!h-full w-[var(--album-data-size-storage-bar-width)] cursor-pointer bg-[oklch(0.7_0.12_48)] opacity-75 transition-opacity hover:opacity-100"
                title={t('settingsPage.albumsData')}
              />
              <div
                className="!h-full w-[var(--playlist-data-size-storage-bar-width)] cursor-pointer bg-[oklch(0.7_0.12_78)] opacity-75 transition-opacity hover:opacity-100"
                title={t('settingsPage.playlistsData')}
              />
              <div
                className="!h-full w-[var(--palette-data-size-storage-bar-width)] cursor-pointer bg-[oklch(0.7_0.12_108)] opacity-75 transition-opacity hover:opacity-100"
                title={t('settingsPage.palettesData')}
              />
              <div
                className="!h-full w-[var(--genre-data-size-storage-bar-width)] cursor-pointer bg-[oklch(0.7_0.12_138)] opacity-75 transition-opacity hover:opacity-100"
                title={t('settingsPage.genresData')}
              />
              {/* <div className="!h-full w-[var(--log-size-storage-bar-width)] bg-[oklch(0.7_0.12_168)]" /> */}
              {/* <div className="!h-full w-[var(--user_data-size-storage-bar-width)] bg-[oklch(0.7_0.12_198)]" /> */}
            </div>
          </div>

          <ul className="mt-10 flex flex-wrap items-center justify-center px-8">
            <li className="mb-4 mr-8 flex items-center">
              <div className="mr-4 h-4 w-4 rounded-full bg-[oklch(0.7_0.12_258)]" />
              {t('settingsPage.otherAppFiles')} :{' '}
              <span className="ml-2 font-medium tabular-nums text-ink">
                {
                  parseByteSizes(
                    storageMetrics.rootSizes.size -
                      storageMetrics.rootSizes.freeSpace -
                      storageMetrics.totalSize
                  )?.size
                }
              </span>
            </li>
            <li className="mb-4 mr-8 flex items-center">
              <div className="mr-4 h-4 w-4 rounded-full bg-[oklch(0.7_0.12_228)]" />
              {t('settingsPage.internalAppFiles')} :{' '}
              <span className="ml-2 font-medium tabular-nums text-ink">
                {parseByteSizes(storageMetrics?.appFolderSize)?.size}
              </span>
            </li>
            <li className="mb-4 mr-8 flex items-center">
              <div className="mr-4 h-4 w-4 rounded-full bg-[oklch(0.7_0.12_288)]" />
              {t('settingsPage.artworkCache')} :{' '}
              <span className="ml-2 font-medium tabular-nums text-ink">
                {parseByteSizes(storageMetrics?.appDataSizes.artworkCacheSize)?.size}
              </span>
            </li>
            <li className="mb-4 mr-8 flex items-center">
              <div className="mr-4 h-4 w-4 rounded-full bg-[oklch(0.7_0.12_318)]" />
              {t('settingsPage.tempArtworkCache')} :{' '}
              <span className="ml-2 font-medium tabular-nums text-ink">
                {parseByteSizes(storageMetrics?.appDataSizes.tempArtworkCacheSize)?.size}
              </span>
            </li>
            <li className="mb-4 mr-8 flex items-center">
              <div className="mr-4 h-4 w-4 rounded-full bg-[oklch(0.7_0.12_348)]" />
              {t('settingsPage.songsData')}{' '}
              <span className="ml-2 font-medium tabular-nums text-ink">
                {parseByteSizes(storageMetrics?.appDataSizes.songDataSize)?.size}
              </span>
            </li>
            <li className="mb-4 mr-8 flex items-center">
              <div className="mr-4 h-4 w-4 rounded-full bg-[oklch(0.7_0.12_18)]" />
              {t('settingsPage.artistsData')}{' '}
              <span className="ml-2 font-medium tabular-nums text-ink">
                {parseByteSizes(storageMetrics?.appDataSizes.artistDataSize)?.size}
              </span>
            </li>
            <li className="mb-4 mr-8 flex items-center">
              <div className="mr-4 h-4 w-4 rounded-full bg-[oklch(0.7_0.12_48)]" />
              {t('settingsPage.albumsData')}{' '}
              <span className="ml-2 font-medium tabular-nums text-ink">
                {parseByteSizes(storageMetrics?.appDataSizes.albumDataSize)?.size}
              </span>
            </li>
            <li className="mb-4 mr-8 flex items-center">
              <div className="mr-4 h-4 w-4 rounded-full bg-[oklch(0.7_0.12_78)]" />
              {t('settingsPage.playlistsData')}{' '}
              <span className="ml-2 font-medium tabular-nums text-ink">
                {parseByteSizes(storageMetrics?.appDataSizes.playlistDataSize)?.size}
              </span>
            </li>
            <li className="mb-4 mr-8 flex items-center">
              <div className="mr-4 h-4 w-4 rounded-full bg-[oklch(0.7_0.12_108)]" />
              {t('settingsPage.palettesData')}{' '}
              <span className="ml-2 font-medium tabular-nums text-ink">
                {parseByteSizes(storageMetrics?.appDataSizes.paletteDataSize)?.size}
              </span>
            </li>
            <li className="mb-4 mr-8 flex items-center">
              <div className="mr-4 h-4 w-4 rounded-full bg-[oklch(0.7_0.12_138)]" />
              {t('settingsPage.genresData')}{' '}
              <span className="ml-2 font-medium tabular-nums text-ink">
                {parseByteSizes(storageMetrics?.appDataSizes.genreDataSize)?.size}
              </span>
            </li>
            <li className="mb-4 mr-8 flex items-center">
              <div className="mr-4 h-4 w-4 rounded-full bg-[oklch(0.7_0.12_198)]" />
              {t('settingsPage.userData')}{' '}
              <span className="ml-2 font-medium tabular-nums text-ink">
                {parseByteSizes(storageMetrics?.appDataSizes.userDataSize)?.size}
              </span>
            </li>
            <li className="mb-4 mr-8 flex items-center">
              <div className="mr-4 h-4 w-4 rounded-full bg-[oklch(0.7_0.12_168)]" />
              {t('settingsPage.appLogs')}{' '}
              <span className="ml-2 font-medium tabular-nums text-ink">
                {parseByteSizes(storageMetrics?.appDataSizes.logSize)?.size}
              </span>
            </li>
          </ul>

          <div className="group flex items-center justify-center py-4 text-xs opacity-50">
            <span title={`Generated on ${storageMetrics.generatedDate}.`}>
              {t('settingsPage.generated')}{' '}
              <span>{calculateElapsedTime(storageMetrics.generatedDate)?.elapsedString}</span>
            </span>
            <span className="mx-2">&bull;</span>
            <Button
              className="!m-0 !rounded-none !border-0 !p-0 !text-xs outline-1 outline-offset-2 hover:underline focus-visible:!outline"
              label={t('settingsPage.generateStorageMetricsAgain')}
              clickHandler={(_, setIsDisabled, setIsPending) => {
                setIsDisabled(true);
                setIsPending(true);
                fetchStorageUsageData(true)
                  .finally(() => {
                    setIsDisabled(false);
                    setIsPending(false);
                  })
                  .catch((err) => console.error(err));
              }}
            />
          </div>
        </div>
      )}

      {storageMetrics === undefined && (
        <div className="flex flex-col items-center justify-center pt-12">
          <span className="ms-icon mr-2 text-4xl opacity-50">hard_drive</span>
          <p className="mt-4 opacity-50">{t('settingsPage.generateStorageMetricsAgain')}</p>
          <p className="mt-1 px-8 text-center text-sm font-light opacity-50">
            {t('settingsPage.storageMetricsGenerationDisclaimer')}
          </p>
          <Button
            className="!mr-0 mt-4"
            label={t('settingsPage.generateStorageMetrics')}
            iconName="hourglass_empty"
            clickHandler={(_, setIsDisabled, setIsPending) => {
              setIsDisabled(true);
              setIsPending(true);
              fetchStorageUsageData(true)
                .finally(() => {
                  setIsDisabled(false);
                  setIsPending(false);
                })
                .catch((err) => console.error(err));
            }}
          />
        </div>
      )}

      {storageMetrics === null && (
        <div className="flex flex-col items-center justify-center pt-12 opacity-50">
          <span className="ms-icon text-4xl">running_with_errors</span>
          <p className="mt-4">{t('settingsPage.storageMetricsGenerationError')}</p>
          <Button
            className="!mr-0 mt-4 !rounded-none !border-0 !p-0 !text-xs outline-1 outline-offset-2 hover:underline focus-visible:!outline"
            label={t('settingsPage.generateStorageMetricsAgain')}
            clickHandler={(_, setIsDisabled, setIsPending) => {
              setIsDisabled(true);
              setIsPending(true);
              fetchStorageUsageData(true)
                .finally(() => {
                  setIsDisabled(false);
                  setIsPending(false);
                })
                .catch((err) => console.error(err));
            }}
          />
        </div>
      )}
    </li>
  );
};

export default StorageSettings;

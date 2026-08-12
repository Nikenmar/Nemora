import { lazy, useContext, useEffect, useMemo, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { AppUpdateContext } from '../../../contexts/AppUpdateContext';

import Img from '../../Img';
import Hyperlink from '../../Hyperlink';
import Button from '../../Button';
import AppStats from './AppStats';

import calculateElapsedTime from '../../../utils/calculateElapsedTime';

import { version, author, homepage, bugs, urls } from '../../../../../../package.json';
import openSourceLicenses from '../../../../../../open_source_licenses.txt?raw';
import appLicense from '../../../../../../LICENSE?raw';
import localReleaseNotes from '../../../../../../release-notes.json';

import AppIcon from '../../../assets/images/webp/logo_light_mode.webp';
import GithubDarkIcon from '../../../assets/images/svg/github.svg';
import GithubLightIcon from '../../../assets/images/svg/github-white.svg';
import { store } from '@renderer/store';
import { useStore } from '@tanstack/react-store';

const ReleaseNotesPrompt = lazy(() => import('../../ReleaseNotesPrompt/ReleaseNotesPrompt'));
const ResetAppConfirmationPrompt = lazy(() => import('../ResetAppConfirmationPrompt'));
const SensitiveActionConfirmPrompt = lazy(() => import('../../SensitiveActionConfirmPrompt'));
const AppShortcutsPrompt = lazy(() => import('../AppShortcutsPrompt'));
const ClearLocalStoragePrompt = lazy(() => import('../ClearLocalStoragePrompt'));
const OpenLinkConfirmPrompt = lazy(() => import('../../OpenLinkConfirmPrompt'));
const NoraImportPrompt = lazy(() => import('../NoraImportPrompt'));

const AboutSettings = () => {
  const isDarkMode = useStore(store, (state) => state.isDarkMode);
  const { changePromptMenuData, addNewNotifications } = useContext(AppUpdateContext);
  const { t } = useTranslation();

  // The action only exists for users coming from Nora, so it is offered only
  // when a Nora profile is actually sitting in %APPDATA%. Detection is a
  // handful of existence checks, and absence is the normal case, not an error.
  const [hasNoraProfile, setHasNoraProfile] = useState(false);

  useEffect(() => {
    let cancelled = false;
    window.api.noraImport
      .detectSource()
      .then((inventory) => {
        if (!cancelled) setHasNoraProfile(inventory !== null);
        return undefined;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const currentVersionReleasedDate = useMemo(() => {
    const { versions } = localReleaseNotes;

    for (let i = 0; i < versions.length; i += 1) {
      if (versions[i].version === version) {
        return versions[i].releaseDate;
      }
    }
    return undefined;
  }, []);

  const elapsed = useMemo(() => {
    if (currentVersionReleasedDate) {
      return calculateElapsedTime(currentVersionReleasedDate);
    }
    return undefined;
  }, [currentVersionReleasedDate]);

  return (
    <li className="main-container about-container">
      <div className="title-container mb-4 mt-1 flex items-center text-2xl font-medium text-font-color-highlight dark:text-dark-font-color-highlight">
        <span className="material-icons-round-outlined mr-2">info</span>
        About
      </div>
      <div className="pl-2">
        <div className="mb-2 flex items-center justify-between p-2 text-lg">
          <div className="flex items-center">
            <Img src={AppIcon} className="aspect-square max-h-12 rounded-md shadow-md" alt="" />
            <div className="ml-4 flex flex-col">
              <span className="block font-medium">Nemora (f.k.a. CMR Fork)</span>
              <span className="text-sm font-light">
                v{version}{' '}
                {elapsed && (
                  <>
                    &bull;{' '}
                    <span
                      title={
                        currentVersionReleasedDate
                          ? t('settingsPage.releasedOn', {
                              val: new Date(currentVersionReleasedDate),
                              formatParams: {
                                val: {
                                  weekday: 'long',
                                  year: 'numeric',
                                  month: 'long',
                                  day: 'numeric'
                                }
                              }
                            })
                          : undefined
                      }
                    >
                      ({elapsed.elapsedString})
                    </span>
                  </>
                )}
              </span>
            </div>
          </div>
          <div className="flex items-center justify-center gap-6">
            <Button
              className="about-link !mr-0 block w-fit cursor-pointer !rounded-none !border-0 bg-transparent !p-0 leading-[0] opacity-70 outline-1 outline-offset-2 transition-opacity hover:bg-transparent hover:opacity-100 focus-visible:!outline dark:bg-transparent dark:hover:bg-transparent"
              iconName="language"
              iconClassName="!text-2xl !leading-none"
              tooltipLabel={t('settingsPage.noraWebsite')}
              clickHandler={() =>
                changePromptMenuData(
                  true,
                  <OpenLinkConfirmPrompt
                    link={urls.website_url}
                    title={t('settingsPage.noraWebsite')}
                  />,
                  'flex flex-col'
                )
              }
            />
            <Img
              src={isDarkMode ? GithubLightIcon : GithubDarkIcon}
              className="w-6 cursor-pointer !opacity-70 !transition-opacity hover:!opacity-100"
              alt={t('settingsPage.noraGithubRepo')}
              showAltAsTooltipLabel
              onClick={() =>
                changePromptMenuData(
                  true,
                  <OpenLinkConfirmPrompt
                    link={homepage}
                    title={t('settingsPage.noraGithubRepo')}
                  />,
                  'flex flex-col'
                )
              }
              tabIndex={0}
            />
          </div>
        </div>
        <div className="mb-4 flex items-center gap-4">
          {/*
            The badges that used to live here counted downloads, issues and
            translation progress for Sandakan/Nora and its Crowdin project.
            Nemora is a different application by a different author, so showing
            another project's numbers as its own would simply be false. They are
            removed rather than repointed: Nemora has no download history to
            report and no translation project to link to yet.
          */}
          <Hyperlink linkTitle={t('settingsPage.noraGithubIssues')} link={`${homepage}/issues`}>
            <img alt="GitHub issues" src={`https://img.shields.io/github/issues/Nikenmar/Nemora`} />
          </Hyperlink>
        </div>
        <ul className="mb-4 list-disc pl-4 text-sm">
          <li>{t('settingsPage.noraDescription')}</li>
          <li>
            {/*
              The lineage, stated once and linked at every name: Nemora is a
              descendant of Nora, and it shipped for a while under the CMR-Fork
              name. Someone arriving from either project should be able to get
              back to it from here.
            */}
            <Trans
              i18nKey="settingsPage.basedOnNora"
              components={{
                NoraLink: (
                  <Hyperlink
                    linkTitle={t('settingsPage.noraRepo')}
                    link="https://github.com/Sandakan/Nora"
                  />
                ),
                SandakanLink: (
                  <Hyperlink
                    linkTitle={t('settingsPage.sandakanProfile')}
                    link="https://github.com/Sandakan"
                  />
                ),
                ForkLink: (
                  <Hyperlink
                    linkTitle={t('settingsPage.cmrForkRepo')}
                    link="https://github.com/Nikenmar/Nora-CMRFork"
                  />
                )
              }}
            />
          </li>
          <li>
            <Trans
              i18nKey="settingsPage.noraLicenseNotice"
              components={{
                Button: (
                  <Button
                    className="show-app-licence-btn about-link !inline w-fit cursor-pointer !rounded-none !border-0 bg-transparent !p-0 text-sm text-font-color-highlight-2 !outline-1 outline-offset-1 hover:bg-transparent hover:underline focus:!outline dark:bg-transparent dark:!text-dark-font-color-highlight-2 dark:hover:bg-transparent"
                    clickHandler={() =>
                      changePromptMenuData(
                        true,
                        <>
                          <div className="mb-4 w-full text-center text-3xl font-medium">
                            {t('settingsPage.appLicense')}
                          </div>
                          <pre className="relative max-h-full w-full overflow-y-auto px-4">
                            {appLicense}
                          </pre>
                        </>,
                        'flex flex-col'
                      )
                    }
                  />
                )
              }}
            />
          </li>
        </ul>
        <div className="mt-12 flex flex-wrap items-center justify-center px-8">
          <Button
            iconName="new_releases"
            iconClassName="material-icons-round-outlined"
            className="release-notes-prompt-btn mb-4"
            label={t('settingsPage.releaseNotes')}
            clickHandler={() =>
              changePromptMenuData(true, <ReleaseNotesPrompt />, 'release-notes px-8 py-4')
            }
          />
          <Button
            iconName="receipt_long"
            className="open-source-licenses-btn mb-4"
            label={t('settingsPage.openSourceLicenses')}
            clickHandler={() =>
              changePromptMenuData(
                true,
                <>
                  <div className="mb-4 w-full text-center text-3xl font-medium">
                    {t('settingsPage.openSourceLicenses')}
                  </div>
                  <div className="relative max-h-full w-full overflow-y-auto whitespace-pre-wrap px-4 text-sm">
                    {openSourceLicenses}
                  </div>
                </>,
                'flex flex-col'
              )
            }
          />
          <Button
            iconName="description"
            iconClassName="material-icons-round-outlined"
            className="about-link mb-4"
            label={t('settingsPage.openLogFile')}
            clickHandler={() => window.api.log.openLogFile()}
          />
          <Button
            label={t('settingsPage.openDevtools')}
            iconName="code"
            className="mb-4"
            clickHandler={() => window.api.settingsHelpers.openDevtools()}
          />
          <Button
            label={t('settingsPage.resyncLibrary')}
            iconName="sync"
            className="mb-4"
            clickHandler={() => window.api.audioLibraryControls.resyncSongsLibrary()}
          />
          <Button
            label={t('settingsPage.generatePalettes')}
            iconName="temp_preferences_custom"
            className="mb-4"
            clickHandler={() => window.api.audioLibraryControls.generatePalettes()}
          />
          <Button
            label={t('settingsPage.appShortcuts')}
            iconName="trail_length_short"
            className="mb-4"
            iconClassName="material-icons-round-outlined"
            clickHandler={() => changePromptMenuData(true, <AppShortcutsPrompt />)}
          />
        </div>

        <AppStats />

        <div className="about-buttons-container mb-4 flex flex-wrap justify-center">
          <Button
            label={t('settingsPage.importFromNora')}
            iconName="move_down"
            className="mb-4"
            isVisible={hasNoraProfile}
            clickHandler={() =>
              changePromptMenuData(true, <NoraImportPrompt />, 'confirm-app-reset')
            }
          />
          <Button
            label={t('settingsPage.resetApp')}
            iconName="auto_mode"
            className="mb-4"
            clickHandler={() =>
              changePromptMenuData(true, <ResetAppConfirmationPrompt />, 'confirm-app-reset')
            }
          />
          <Button
            label={t('settingsPage.clearOptionalData')}
            iconName="delete"
            className="mb-4"
            iconClassName="material-icons-round-outlined"
            clickHandler={() =>
              changePromptMenuData(true, <ClearLocalStoragePrompt />, 'confirm-app-reset')
            }
          />

          <Button
            label={t('settingsPage.clearHistory')}
            iconName="clear"
            className="mb-4"
            clickHandler={() => {
              changePromptMenuData(
                true,
                <SensitiveActionConfirmPrompt
                  title={t('settingsPage.confirmSongHistoryDeletion')}
                  content={<div>{t('settingsPage.songHistoryDeletionDisclaimer')}</div>}
                  confirmButton={{
                    label: t('settingsPage.clearHistory'),
                    clickHandler: () => {
                      window.api.audioLibraryControls
                        .clearSongHistory()
                        .then((res) => {
                          if (res.success) {
                            addNewNotifications([
                              {
                                id: 'songHistoryCleared',
                                duration: 5000,
                                content: <span>{t('settingsPage.songHistoryDeletionSuccess')}</span>
                              }
                            ]);
                          }
                          return changePromptMenuData(false);
                        })
                        .catch((err) => console.error(err));
                    }
                  }}
                />
              );
            }}
          />
        </div>
        <div className="about-description mt-4 text-sm font-light">
          <div>
            <Trans
              i18nKey="settingsPage.contact"
              components={{
                Hyperlink: (
                  <Hyperlink
                    link={`${bugs.url}/new/choose`}
                    linkTitle={t('settingsPage.createIssueOnNoraGithubRepo')}
                  />
                )
              }}
            />
          </div>
          {/*
            "or contact me through my email" pointed at Sandakan's personal
            inbox. Nemora is not his to support, so the offer is withdrawn
            rather than repointed — the issue tracker above is the one channel
            that actually reaches the maintainer.
          */}
          <div className="mt-6 text-sm">
            <Trans
              i18nKey="settingsPage.loveNora"
              components={{
                span: (
                  <span className="heart text-font-color-crimson dark:text-font-color-crimson" />
                ),
                Hyperlink: (
                  <Hyperlink
                    link={author.url}
                    linkTitle={t('settingsPage.sandakanGithubProfile')}
                    className="mr-1"
                  />
                )
              }}
            />

            <div className="mt-6 border-t border-background-color-2 pt-4 dark:border-dark-background-color-2">
              <div className="mb-1 text-xs font-medium uppercase tracking-wider text-font-color-highlight opacity-90 dark:text-dark-font-color-highlight">
                {t('settingsPage.origins')}
              </div>
              <p className="max-w-prose text-xs font-light leading-relaxed text-font-color-black opacity-80 dark:text-font-color-white">
                <Trans
                  i18nKey="settingsPage.originsNote"
                  components={{
                    Hyperlink: (
                      <Hyperlink
                        link="https://github.com/nikenmar"
                        linkTitle={t('settingsPage.sandakanGithubProfile')}
                        className="font-normal underline"
                      />
                    )
                  }}
                />
              </p>
            </div>
          </div>
        </div>
      </div>
    </li>
  );
};

export default AboutSettings;

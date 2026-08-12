import { useCallback, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import Button from '../Button';

type NoraImportReport = Awaited<ReturnType<typeof window.api.noraImport.importProfile>>;

type Phase = 'confirm' | 'running' | 'done' | 'failed';

/**
 * Migration from Nora into Nemora.
 *
 * Deliberately NOT built on SensitiveActionConfirmPrompt: that one closes
 * itself the moment the button is pressed, and this operation copies hundreds
 * of megabytes of artwork. Closing the dialog would leave the user staring at
 * an app that appears idle while its entire profile is being replaced, with no
 * way to learn whether it worked. The prompt stays open and owns the outcome.
 */
const NoraImportPrompt = () => {
  const { t } = useTranslation();

  const [phase, setPhase] = useState<Phase>('confirm');
  const [report, setReport] = useState<NoraImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runImport = useCallback(() => {
    setPhase('running');
    window.api.noraImport
      .importProfile()
      .then((result) => {
        setReport(result);
        setPhase(result.success ? 'done' : 'failed');
        if (!result.success) setError(result.message ?? null);
        return undefined;
      })
      .catch((err: unknown) => {
        console.error('The Nora import failed.', err);
        setError(err instanceof Error ? err.message : String(err));
        setPhase('failed');
      });
  }, []);

  return (
    <>
      <div className="title-container mb-8 mt-1 flex items-center pr-4 text-3xl font-medium text-font-color-highlight dark:text-dark-font-color-highlight">
        {t('noraImportPrompt.title')}
      </div>

      {phase === 'confirm' && (
        <>
          <p className="description">
            <Trans
              i18nKey="noraImportPrompt.message"
              components={{ span: <span className="font-semibold text-font-color-crimson" /> }}
            />
          </p>
          <br />
          <p className="description">{t('noraImportPrompt.backupNote')}</p>
          <div className="buttons-container flex items-center justify-end">
            <Button
              label={t('noraImportPrompt.startImport')}
              iconName="move_down"
              className="import-from-nora-btn danger-btn float-right mt-6 h-10 w-48 cursor-pointer rounded-lg !bg-font-color-crimson text-font-color-white outline-none ease-in-out hover:border-font-color-crimson dark:!bg-font-color-crimson dark:text-font-color-white dark:hover:border-font-color-crimson"
              clickHandler={runImport}
            />
          </div>
        </>
      )}

      {phase === 'running' && (
        <p className="description">{t('noraImportPrompt.importing')}</p>
      )}

      {phase === 'done' && report && (
        <>
          <p className="description">
            {t('noraImportPrompt.imported', {
              songs: report.counts.songs,
              playlists: report.counts.playlists,
              listens: report.counts.listeningRows,
              artworks: report.counts.artworkFiles
            })}
          </p>
          <br />
          <p className="description">{t('noraImportPrompt.restartRequired')}</p>
          <div className="buttons-container flex items-center justify-end">
            <Button
              label={t('noraImportPrompt.restartNow')}
              iconName="restart_alt"
              className="restart-after-nora-import-btn float-right mt-6 h-10 w-48 cursor-pointer rounded-lg"
              clickHandler={() => window.api.appControls.restartApp('Nora profile imported')}
            />
          </div>
        </>
      )}

      {phase === 'failed' && (
        <>
          <p className="description">{t('noraImportPrompt.failed')}</p>
          {error && (
            <p className="description mt-2 font-semibold text-font-color-crimson">{error}</p>
          )}
          <br />
          {/*
            The importer refuses to write a partial profile: either it aborted
            before touching anything, or it made a verified backup first. Saying
            so is the difference between a user who retries and a user who
            assumes their library is gone.
          */}
          <p className="description">
            {report?.backupPath
              ? t('noraImportPrompt.failedAfterBackup', { path: report.backupPath })
              : t('noraImportPrompt.failedUntouched')}
          </p>
        </>
      )}
    </>
  );
};

export default NoraImportPrompt;

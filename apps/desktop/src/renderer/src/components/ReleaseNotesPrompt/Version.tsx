import { useTranslation } from 'react-i18next';

import calculateElapsedTime from '../../utils/calculateElapsedTime';

import { version as appVersion } from '../../../../../package.json';
import VersionNote, { type VersionNoteProps } from './VersionNote';

interface VersionProp {
  version: string;
  releaseDate: string;
  isLatest: boolean;
  notes: {
    new?: VersionNoteProps[];
    fixed?: VersionNoteProps[];
    knownIssues?: VersionNoteProps[];
    developerUpdates?: VersionNoteProps[];
  };
}

const Version = (props: VersionProp) => {
  const { t } = useTranslation();

  const { version, releaseDate, isLatest, notes } = props;
  const elapsed = calculateElapsedTime(releaseDate);
  const localeReleaseDate = new Date(releaseDate).toLocaleDateString();
  return (
    <div key={version} className="app-version group mb-8 px-4 pb-4 last:pb-8">
      <div className="version-info mb-4 flex justify-between text-lg font-medium">
        <span className="version text-echo">
          v{version} {version === appVersion && `(${t('releaseNotesPrompt.current')})`}
        </span>
        <span className="release-date">
          {elapsed && !elapsed.isFuture ? (
            <span
              className="text-echo"
              title={t('settingsPage.releasedOn', {
                val: new Date(releaseDate),
                formatParams: {
                  val: {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                  }
                }
              })}
            >
              {isLatest ? <>{t('releaseNotesPrompt.latest')} &bull; </> : ''}(
              {elapsed.elapsedString})
            </span>
          ) : (
            localeReleaseDate
          )}
        </span>
      </div>
      {Array.isArray(notes.new) && notes.new.length > 0 && (
        <>
          <h3 className="mb-2 px-4 text-lg">{t('releaseNotesPrompt.newFeaturesAndUpdates')}</h3>
          <ul className="notes list-disc px-8 font-light text-shade/80 marker:text-echo ">
            {notes.new.map((note, index) => (
              <VersionNote
                key={`${version}-feature-${index}`}
                note={note.note}
                artworkPath={note.artworkPath}
              />
            ))}
          </ul>
        </>
      )}
      {Array.isArray(notes.fixed) && notes.fixed.length > 0 && (
        <>
          <h3 className="mb-2 px-4 text-lg">{t('releaseNotesPrompt.fixesAndImprovements')}</h3>
          <ul className="notes list-disc px-8 font-light text-shade/80 marker:text-echo ">
            {notes.fixed.map((note, index) => (
              <VersionNote
                key={`${version}-fix-${index}`}
                note={note.note}
                artworkPath={note.artworkPath}
              />
            ))}
          </ul>
        </>
      )}
      {Array.isArray(notes.knownIssues) && notes.knownIssues.length > 0 && (
        <>
          <h3 className="mb-2 px-4 text-lg">{t('releaseNotesPrompt.issuesAndBugs')}</h3>
          <ul className="notes list-disc px-8 font-light text-shade/80 marker:text-echo ">
            {notes.knownIssues.map((note, index) => (
              <VersionNote
                key={`${version}-issue-${index}`}
                note={note.note}
                artworkPath={note.artworkPath}
              />
            ))}
          </ul>
        </>
      )}
      {Array.isArray(notes.developerUpdates) && notes.developerUpdates.length > 0 && (
        <>
          <h3 className="mb-2 px-4 text-lg">{t('releaseNotesPrompt.developerUpdates')}</h3>
          <ul className="notes list-disc px-8 font-light text-shade/80 marker:text-echo ">
            {notes.developerUpdates.map((note, index) => (
              <VersionNote
                key={`${version}-issue-${index}`}
                note={note.note}
                artworkPath={note.artworkPath}
              />
            ))}
          </ul>
        </>
      )}
      <div className="mb-4 mt-8 h-[2px] w-full bg-line/60 group-last:invisible" />
    </div>
  );
};

export default Version;

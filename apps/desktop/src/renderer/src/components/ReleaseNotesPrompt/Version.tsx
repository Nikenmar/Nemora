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
    removed?: VersionNoteProps[];
    knownIssues?: VersionNoteProps[];
    developerUpdates?: VersionNoteProps[];
  };
}

const NoteSection = (props: { title: string; notes?: VersionNoteProps[]; id: string }) => {
  const { title, notes, id } = props;
  if (!Array.isArray(notes) || notes.length === 0) return null;
  return (
    <section className="mt-5">
      <h3 className="mb-2 text-small font-semibold uppercase tracking-wide text-ink-faint">
        {title}
      </h3>
      <ul className="notes list-disc pl-5 text-body leading-relaxed text-ink-dim marker:text-ink-faint">
        {notes.map((note, index) => (
          <VersionNote key={`${id}-${index}`} note={note.note} artworkPath={note.artworkPath} />
        ))}
      </ul>
    </section>
  );
};

const Version = (props: VersionProp) => {
  const { t } = useTranslation();

  const { version, releaseDate, isLatest, notes } = props;
  const elapsed = calculateElapsedTime(releaseDate);
  const localeReleaseDate = new Date(releaseDate).toLocaleDateString();
  const isCurrent = version === appVersion;
  return (
    <div
      key={version}
      className="app-version border-b border-line py-6 first:pt-2 last:border-b-0 last:pb-2"
    >
      <div className="version-info flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="version text-section font-semibold text-ink">v{version}</span>
        {isCurrent && (
          <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-micro font-semibold text-echo">
            {t('releaseNotesPrompt.current')}
          </span>
        )}
        {isLatest && !isCurrent && (
          <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-micro font-semibold text-ink-dim">
            {t('releaseNotesPrompt.latest')}
          </span>
        )}
        <span className="release-date ml-auto text-small text-ink-faint">
          {elapsed && !elapsed.isFuture ? (
            <span
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
              {elapsed.elapsedString}
            </span>
          ) : (
            localeReleaseDate
          )}
        </span>
      </div>
      <NoteSection
        id={`${version}-feature`}
        title={t('releaseNotesPrompt.newFeaturesAndUpdates')}
        notes={notes.new}
      />
      <NoteSection
        id={`${version}-fix`}
        title={t('releaseNotesPrompt.fixesAndImprovements')}
        notes={notes.fixed}
      />
      <NoteSection
        id={`${version}-removed`}
        title={t('releaseNotesPrompt.removed')}
        notes={notes.removed}
      />
      <NoteSection
        id={`${version}-issue`}
        title={t('releaseNotesPrompt.issuesAndBugs')}
        notes={notes.knownIssues}
      />
      <NoteSection
        id={`${version}-developer`}
        title={t('releaseNotesPrompt.developerUpdates')}
        notes={notes.developerUpdates}
      />
    </div>
  );
};

export default Version;

import { useTranslation } from 'react-i18next';

/**
 * What Nemora does with the user's data, said plainly (Settings, About, Privacy): what goes over the internet and when, what
 * stays on this computer, and when it changes the music files. Every line is checked against the
 * code (2026-11-06); a new online feature adds its line here.
 */
const ONLINE = [
  'updates',
  'lyrics',
  'pages',
  'tagSearch',
  'translation',
  'autoEq',
  'agents',
  'spotify'
] as const;
const LOCAL = ['nothingCounted', 'discord', 'obs', 'profile'] as const;
const FILES = ['tagEditor', 'switchVersion', 'delete', 'chosen'] as const;

const Group = ({ title, rows }: { title: string; rows: [string, string][] }) => (
  <section className="mb-5 last:mb-0">
    <h3 className="mb-2 text-body font-medium text-ink">{title}</h3>
    <ul className="flex flex-col gap-2">
      {rows.map(([name, what]) => (
        <li key={name} className="grid grid-cols-[11rem_minmax(0,1fr)] gap-x-4 text-small sm:grid-cols-1">
          <span className="font-medium text-ink">{name}</span>
          <span className="text-ink-dim">{what}</span>
        </li>
      ))}
    </ul>
  </section>
);

const PrivacyPrompt = () => {
  const { t } = useTranslation();
  return (
    <div className="privacy-prompt w-full px-2 pb-2">
      <h2 className="mb-2 flex items-center text-title font-semibold text-ink">
        <span className="ms-icon mr-2">shield</span>
        {t('privacySettings.title')}
      </h2>
      <p className="mb-5 text-small text-ink-dim">{t('privacySettings.intro')}</p>
      <Group
        title={t('privacySettings.onlineTitle')}
        rows={ONLINE.map((i) => [t(`privacySettings.online.${i}.name`), t(`privacySettings.online.${i}.what`)])}
      />
      <Group
        title={t('privacySettings.localTitle')}
        rows={LOCAL.map((i) => [t(`privacySettings.local.${i}.name`), t(`privacySettings.local.${i}.what`)])}
      />
      <Group
        title={t('privacySettings.filesTitle')}
        rows={FILES.map((i) => [t(`privacySettings.files.${i}.name`), t(`privacySettings.files.${i}.what`)])}
      />
    </div>
  );
};

export default PrivacyPrompt;

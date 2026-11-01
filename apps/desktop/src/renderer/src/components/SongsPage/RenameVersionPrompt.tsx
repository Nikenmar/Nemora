import { useContext, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppUpdateContext } from '../../contexts/AppUpdateContext';
import Button from '../Button';

type Props = { versionId: number; title: string };

/** Renames a version (PLAN/18 D6): the row reads "Title - <name>". */
const RenameVersionPrompt = ({ versionId, title }: Props) => {
  const { t } = useTranslation();
  const { changePromptMenuData } = useContext(AppUpdateContext);
  const current = title.includes(' - ') ? title.slice(title.lastIndexOf(' - ') + 3) : '';
  const [name, setName] = useState(current);
  const save = () => {
    if (!name.trim()) return;
    window.api.tierlistsData
      .versionRename(versionId, name)
      .then(() => changePromptMenuData(false))
      .catch((error) => console.error(error));
  };
  return (
    <div className="w-[26rem] max-w-full">
      <h2 className="text-title font-semibold text-ink">{t('versions.renameTitle')}</h2>
      <p className="mt-1 truncate text-small text-ink-dim">{title}</p>
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && save()}
        aria-label={t('versions.renameTitle')}
        className="mt-4 h-9 w-full rounded-lg bg-surface-2 px-3 text-ink outline-none focus-visible:outline-2 focus-visible:outline-echo"
      />
      <div className="mt-4 flex justify-end gap-2">
        <Button label={t('common.cancel')} className="!mr-0" clickHandler={() => changePromptMenuData(false)} />
        <Button label={t('versions.save')} variant="primary" className="!mr-0" isDisabled={!name.trim()} clickHandler={save} />
      </div>
    </div>
  );
};

export default RenameVersionPrompt;

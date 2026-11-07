import { useCallback, useContext, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ipc, type AgentSettings, type AgentTarget } from '@platform/ipc';
import { AppUpdateContext } from '../../../contexts/AppUpdateContext';

import Button from '../../Button';
import Segmented from '../../ui/Segmented';

type Access = 'off' | 'read' | 'control' | 'full';
const LEVELS: Access[] = ['off', 'read', 'control', 'full'];

/**
 * AI agents (PLAN/22): what agents may do through nemora-mcp, the command to add it to an agent,
 * a one-click setup for the agents found here, and what agents did. Nemora enforces the level;
 * the agent cannot raise it.
 */
const AgentsSettings = () => {
  const { addNewNotifications } = useContext(AppUpdateContext);
  const { t } = useTranslation();
  const [settings, setSettings] = useState<AgentSettings | null>(null);
  const [targets, setTargets] = useState<AgentTarget[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    ipc('agent_settings').then(setSettings).catch((error: unknown) => console.warn('[agents]', error));
    ipc('agent_targets').then(setTargets).catch((error: unknown) => console.warn('[agents]', error));
  }, []);
  useEffect(load, [load]);

  const notify = (content: string, iconName = 'smart_toy') =>
    addNewNotifications([{ id: `agents-${Date.now()}`, content, iconName, duration: 6000 }]);

  const setAccess = (access: Access) => {
    ipc('agent_set_access', { access })
      .then(load)
      .catch((error: unknown) => notify(String(error), 'error'));
  };

  const command = settings?.mcpPath ? `"${settings.mcpPath}"` : null;
  const copy = (text: string) =>
    navigator.clipboard
      .writeText(text)
      .then(() => notify(t('agentsSettings.copied')))
      .catch((error: unknown) => console.warn('[agents] not copied', error));

  const setUp = (target: AgentTarget) => {
    setBusy(target.id);
    ipc('agent_setup', { target: target.id })
      .then((done) => {
        notify(
          done.already
            ? t('agentsSettings.already', { name: target.name })
            : t('agentsSettings.done', { name: target.name, file: done.file }) +
                (done.backup ? ` ${t('agentsSettings.backup', { file: done.backup })}` : '')
        );
        load();
      })
      .catch((error: unknown) => notify(String(error), 'error'))
      .finally(() => setBusy(null));
  };

  const access = (settings?.access ?? 'control') as Access;
  return (
    <li className="main-container agents-settings-container mb-16">
      <div className="title-container mb-4 mt-1 flex items-center text-title font-semibold text-ink">
        <span className="ms-icon mr-2">smart_toy</span>
        {t('agentsSettings.title')}
      </div>
      <p className="mb-4 text-small text-ink-dim">{t('agentsSettings.intro')}</p>

      <section className="mb-5">
        <h3 className="mb-2 text-body font-medium text-ink">{t('agentsSettings.accessTitle')}</h3>
        <Segmented
          label={t('agentsSettings.accessTitle')}
          value={access}
          onChange={setAccess}
          options={LEVELS.map((level) => ({ value: level, label: t(`agentsSettings.level.${level}`) }))}
        />
        <p className="mt-2 text-small text-ink-dim">{t(`agentsSettings.levelHint.${access}`)}</p>
      </section>

      <section className="mb-5">
        <h3 className="mb-2 text-body font-medium text-ink">{t('agentsSettings.connectTitle')}</h3>
        {command ? (
          <>
            <p className="mb-2 text-small text-ink-dim">{t('agentsSettings.connectHint')}</p>
            <div className="mb-3 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg bg-surface-2 px-3 py-2 text-small text-ink">{command}</code>
              <Button label={t('agentsSettings.copy')} iconName="content_copy" size="sm" className="!mr-0" clickHandler={() => copy(command)} />
            </div>
            <ul className="flex flex-col gap-1.5">
              {targets.map((target) => (
                <li key={target.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-surface-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-body text-ink">{target.name}</div>
                    <div className="truncate text-small text-ink-dim">{target.place}</div>
                  </div>
                  {target.configured ? (
                    <span className="flex items-center gap-1 text-small text-ink-dim">
                      <span className="ms-icon text-[18px] text-echo">check_circle</span>
                      {t('agentsSettings.configured')}
                    </span>
                  ) : (
                    <Button
                      label={target.detected ? t('agentsSettings.setUp') : t('agentsSettings.setUpAnyway')}
                      iconName="add_link"
                      size="sm"
                      className="!mr-0"
                      isDisabled={busy !== null}
                      clickHandler={() => setUp(target)}
                    />
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-small text-ink-dim">{t('agentsSettings.setupHint')}</p>
          </>
        ) : (
          <p className="text-small text-ink-dim">{t('agentsSettings.noServer')}</p>
        )}
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-body font-medium text-ink">{t('agentsSettings.logTitle')}</h3>
          {settings && settings.log.length > 0 && (
            <Button
              label={t('agentsSettings.clearLog')}
              iconName="delete_sweep"
              size="sm"
              className="!mr-0"
              clickHandler={() => {
                ipc('agent_log_clear').then(load).catch((error: unknown) => console.warn('[agents]', error));
              }}
            />
          )}
        </div>
        {settings && settings.log.length > 0 ? (
          <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
            {settings.log.slice(0, 50).map((entry) => (
              <li key={`${entry.at}-${entry.detail}`} className="grid grid-cols-[9rem_8rem_minmax(0,1fr)] gap-x-3 text-small sm:grid-cols-1">
                <span className="text-ink-dim">{new Date(entry.at).toLocaleString()}</span>
                <span className="truncate font-medium text-ink">{entry.agent}</span>
                <span className="truncate text-ink-dim">{entry.detail}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-small text-ink-dim">{t('agentsSettings.noLog')}</p>
        )}
      </section>
    </li>
  );
};

export default AgentsSettings;

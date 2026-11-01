import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@tanstack/react-store';
import { invoke } from '@tauri-apps/api/core';

import storage from '../../../utils/localStorage';
import { store } from '@renderer/store';
import Checkbox from '../../Checkbox';

type Status = { done: number; total: number; running: boolean; error: string | null };

/** Starts or stops the background job (PLAN/19 D5), answering how far it got. */
export const lyricsLibrary = (start?: boolean) => invoke<Status>('lyrics_library', { start: start ?? null });

/**
 * Settings > Lyrics > Fetch lyrics for my library: off by default, as it sends song names to
 * LRCLIB. On, a background job finds lyrics song by song; this shows how far it got.
 */
const LyricsLibrary = () => {
  const { t } = useTranslation();
  const isOn = useStore(store, (state) => !!state.localStorage.preferences.isLyricsLibraryEnabled);
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    let isLive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = () =>
      lyricsLibrary()
        .then((next) => {
          if (!isLive) return;
          setStatus(next);
          if (next.running) timer = setTimeout(poll, 2000);
        })
        .catch(() => undefined);
    poll();
    return () => {
      isLive = false;
      clearTimeout(timer);
    };
  }, [isOn]);

  return (
    <li className="secondary-container lyrics-library mb-4">
      <div className="description">{t('lyricsLibrary.description')}</div>
      <Checkbox
        id="lyricsLibrary"
        isChecked={isOn}
        checkedStateUpdateFunction={(state) => {
          storage.preferences.setPreferences('isLyricsLibraryEnabled', state);
          lyricsLibrary(state)
            .then(setStatus)
            .catch(() => undefined);
        }}
        labelContent={t('lyricsLibrary.label')}
      />
      {status && (
        <div className="ml-8 mt-1 text-small tabular-nums text-ink-dim">
          {t('lyricsLibrary.progress', { done: status.done, total: status.total })}
          {status.running && ` · ${t('lyricsLibrary.running')}`}
          {status.error && !status.running && isOn && (
            <span className="text-danger"> · {t('lyricsLibrary.stopped', { error: status.error })}</span>
          )}
        </div>
      )}
    </li>
  );
};

export default LyricsLibrary;

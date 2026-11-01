import type { TFunction } from 'i18next';
import { invoke } from '@tauri-apps/api/core';

export type FileFormat = 'wav24' | 'float';

type SoundToSave = { name: string; semitones: number; keepPitch: boolean; reverb: number; size: string };
type Notify = (notifications: AppNotification[]) => void;

/**
 * "Save as file…" (PLAN/18 D4): asks where, then renders the song with the sound offline (the
 * version's own, or `sound` when given) into a WAV carrying the song's tags and cover, titled
 * "Title (Name)". Says when it is done, and if any sample went past full scale.
 */
export const saveSoundAsFile = async (
  songId: string,
  title: string,
  name: string,
  format: FileFormat,
  t: TFunction,
  notify: Notify,
  sound?: SoundToSave
) => {
  const { save } = await import('@tauri-apps/plugin-dialog');
  const destination = await save({
    title: t('versions.saveFile'),
    defaultPath: `${`${title} (${name})`.replace(/[\\/:*?"<>|]/g, '_')}.wav`,
    filters: [{ name: format === 'float' ? 'WAV 32-bit float' : 'WAV 24-bit', extensions: ['wav'] }]
  });
  if (typeof destination !== 'string') return;
  const id = `soundFile-${Date.now()}`;
  notify([{ id, duration: 60_000, content: t('versions.saving', { name }) }]);
  try {
    const saved = await invoke<{ seconds: number; overs: number }>('version_render', {
      songId,
      sound: sound ?? null,
      format,
      path: destination
    });
    notify([
      {
        id,
        duration: 6000,
        content:
          saved.overs > 0 && format === 'wav24'
            ? t('versions.savedClipped', { name, count: saved.overs })
            : t('versions.saved', { name })
      }
    ]);
  } catch (error) {
    console.error(error);
    notify([{ id, duration: 8000, content: t('versions.saveFailed', { error: String(error) }) }]);
  }
};

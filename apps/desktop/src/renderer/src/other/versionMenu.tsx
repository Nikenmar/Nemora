import type { ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { PRESETS, REVERB_CHIP, effectName, soundPanelStore, soundStore, versionStore } from './soundEffects';
import RenameVersionPrompt from '../components/SongsPage/RenameVersionPrompt';
import { store } from '../store';
import { saveSoundAsFile } from './saveSoundFile';

/** The version a view id names (`<song>:v<id>`), if it is one. */
export const versionIdOf = (songId: string): number | null => {
  const match = /:v(\d+)$/.exec(songId);
  return match ? Number(match[1]) : null;
};

type Prompt = (isVisible: boolean, content?: ReactNode, className?: string) => void;
type Notify = (notifications: AppNotification[]) => void;

/**
 * Versions in a song's menu (PLAN/18 D6): "Make version" with the presets and the current sound;
 * on a version's own row, Rename, Change sound, Save as file (WAV 24-bit or 32-bit float) and Remove.
 */
export const versionMenuItems = (
  songId: string,
  title: string,
  t: TFunction,
  prompt: Prompt,
  notify: Notify
): ContextMenuItem[] => {
  const version = versionIdOf(songId);
  if (version !== null) {
    const isPlaying = store.state.currentSongData.songId === songId;
    // The row reads "Title - Name"; the file is "Title (Name)".
    const cut = title.lastIndexOf(' - ');
    const [base, name] = cut > 0 ? [title.slice(0, cut), title.slice(cut + 3)] : [title, ''];
    return [
      {
        label: t('versions.rename'),
        iconName: 'edit',
        handlerFunction: () => prompt(true, <RenameVersionPrompt versionId={version} title={title} />)
      },
      {
        label: isPlaying ? t('versions.changeSound') : t('versions.changeSoundPlayFirst'),
        iconName: 'speed',
        isDisabled: !isPlaying,
        handlerFunction: () => soundPanelStore.setState(() => true)
      },
      {
        label: t('versions.saveFile'),
        iconName: 'save',
        handlerFunction: null,
        innerContextMenus: (['wav24', 'float'] as const).map((format) => ({
          label: t(`versions.format.${format}`),
          handlerFunction: () =>
            saveSoundAsFile(songId, base, name, format, t, notify).catch((error) => console.error(error))
        }))
      },
      {
        label: t('versions.remove'),
        iconName: 'delete',
        handlerFunction: () => {
          window.api.tierlistsData.versionRemove(version).catch((error) => console.error(error));
          if (versionStore.state?.id === version) versionStore.setState(() => null);
        }
      }
    ];
  }
  const make = (name: string, semitones: number, reverb = 0) => () =>
    window.api.tierlistsData
      .versionCreate(songId, { name, semitones, keepPitch: false, reverb, size: REVERB_CHIP.size })
      .catch((error) => console.error(error));
  const presets = PRESETS.filter((p) => p.id !== 'original').map((p) => ({
    label: t(`sound.preset.${p.id}`),
    handlerFunction: make(t(`sound.preset.${p.id}`), p.semitones)
  }));
  const current = soundStore.state;
  const currentName = effectName(current, (id) => t(`sound.preset.${id}`));
  return [
    {
      label: t('versions.make'),
      iconName: 'library_add',
      handlerFunction: null,
      innerContextMenus: [
        ...presets,
        {
          label: `${t('sound.preset.slowed')} + Reverb`,
          handlerFunction: make(`${t('sound.preset.slowed')} + Reverb`, -2, REVERB_CHIP.reverb)
        },
        { label: '', isContextMenuItemSeperator: true, handlerFunction: () => true },
        {
          label: currentName ? t('versions.fromCurrent', { name: currentName }) : t('versions.fromCurrentNone'),
          isDisabled: !currentName,
          handlerFunction: () =>
            window.api.tierlistsData
              .versionCreate(songId, {
                name: currentName,
                semitones: current.semitones,
                keepPitch: current.keepPitch,
                reverb: current.reverb,
                size: current.size
              })
              .catch((error) => console.error(error))
        }
      ]
    }
  ];
};

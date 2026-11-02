import type { ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { PRESETS, REVERB_CHIP, soundPanelStore, soundStore, versionStore } from './soundEffects';
import { soundTag, versionTag } from './soundTag';
import { songOf, songSoundStore, switchSongSound } from './songSound';
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
  notify: Notify,
  ownVersion?: SongVersion | null
): ContextMenuItem[] => {
  const version = versionIdOf(songId);
  if (version !== null) {
    const isPlaying = store.state.currentSongData.songId === songId;
    // The row reads "Title - Name"; the file is "Title (Name)".
    // The file is "Title (Tag)".
    const [base, name] = [title, ownVersion ? (versionTag(ownVersion) ?? ownVersion.name) : ''];
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
    handlerFunction: make(soundTag({ semitones: p.semitones, reverb: 0 }) ?? t(`sound.preset.${p.id}`), p.semitones)
  }));
  const current = soundStore.state;
  const currentName = soundTag(current) ?? '';
  // Switch version: the song itself takes the sound, no second row (other/songSound.ts).
  const switched = songSoundStore.state[songOf(songId)];
  const switchTo = (semitones: number, reverb = 0) => () =>
    switchSongSound(songId, { semitones, keepPitch: false, reverb, size: REVERB_CHIP.size });
  const switchItems: ContextMenuItem[] = [
    ...PRESETS.filter((p) => p.id !== 'original').map((p) => ({
      label: t(`sound.preset.${p.id}`),
      handlerFunction: switchTo(p.semitones)
    })),
    { label: 'Slowed + Reverb', handlerFunction: switchTo(-2, REVERB_CHIP.reverb) },
    { label: '', isContextMenuItemSeperator: true, handlerFunction: () => true },
    {
      label: currentName ? t('versions.fromCurrent', { name: currentName }) : t('versions.fromCurrentNone'),
      isDisabled: !currentName,
      handlerFunction: () =>
        switchSongSound(songId, {
          semitones: current.semitones,
          keepPitch: current.keepPitch,
          reverb: current.reverb,
          size: current.size
        })
    },
    ...(switched
      ? [
          {
            label: t('versions.backToOriginal'),
            iconName: 'undo',
            handlerFunction: () => switchSongSound(songId, null)
          }
        ]
      : [])
  ];
  return [
    {
      label: t('versions.make'),
      iconName: 'library_add',
      handlerFunction: null,
      innerContextMenus: [
        ...presets,
        {
          label: `${t('sound.preset.slowed')} + Reverb`,
          handlerFunction: make('Slowed + Reverb', -2, REVERB_CHIP.reverb)
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
    },
    {
      label: switched ? t('versions.switchedTo', { name: versionTag(switched) ?? switched.name }) : t('versions.switch'),
      iconName: 'swap_horiz',
      handlerFunction: null,
      innerContextMenus: switchItems
    }
  ];
};

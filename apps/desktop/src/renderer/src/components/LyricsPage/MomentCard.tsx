import { useContext, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@tanstack/react-store';

import { AppUpdateContext } from '../../contexts/AppUpdateContext';
import { store } from '../../store';
import Button from '../Button';

import DefaultSongCover from '../../assets/images/webp/song_cover_default.webp';

const clock = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

type Props = { line: string; start?: number };

/**
 * A moment card (PLAN/19 D7): the cover, a line of the lyrics, the song and the time, drawn in the
 * app's own colours (the theme it is in) and saved as a PNG to the clipboard or a file. The PNG is
 * this very element, drawn at twice its size.
 */
const MomentCard = ({ line, start }: Props) => {
  const { t } = useTranslation();
  const { addNewNotifications, changePromptMenuData } = useContext(AppUpdateContext);
  const song = useStore(store, (state) => state.currentSongData);
  const cardRef = useRef<HTMLDivElement>(null);
  const [isBusy, setIsBusy] = useState(false);

  const draw = async () => {
    const { toBlob } = await import('html-to-image');
    if (!cardRef.current) throw new Error('nothing to draw');
    const blob = await toBlob(cardRef.current, { cacheBust: true, pixelRatio: 2 });
    if (!blob) throw new Error('The card could not be drawn.');
    return blob;
  };
  // The stand checks the PNG against the view through this (only when the stand is running).
  const shots = (window as unknown as { __nemoraShots?: Record<string, unknown> }).__nemoraShots;
  if (shots) shots.drawMoment = draw;
  const notify = (id: string, content: string) => addNewNotifications([{ id, duration: 5000, content }]);
  const run = (task: () => Promise<boolean>, done: string) => {
    setIsBusy(true);
    task()
      .then((isDone) => {
        if (!isDone) return;
        notify('momentCard', done);
        changePromptMenuData(false);
      })
      .catch((error) => {
        console.error(error);
        notify('momentCard', t('moment.failed'));
      })
      .finally(() => setIsBusy(false));
  };

  const copy = () =>
    run(async () => {
      const blob = await draw();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      return true;
    }, t('moment.copied'));

  const save = () =>
    run(async () => {
      const [{ save: saveDialog }, { writeFile }] = await Promise.all([
        import('@tauri-apps/plugin-dialog'),
        import('@tauri-apps/plugin-fs')
      ]);
      const destination = await saveDialog({
        title: t('moment.save'),
        defaultPath: `${(song.title || 'moment').replace(/[\\/:*?"<>|]/g, '_')}.png`,
        filters: [{ name: 'PNG', extensions: ['png'] }]
      });
      if (typeof destination !== 'string') return false;
      await writeFile(destination, new Uint8Array(await (await draw()).arrayBuffer()));
      return true;
    }, t('moment.saved'));

  const artists = song.artists?.map((a) => a.name).join(', ') || t('common.unknownArtist');

  return (
    <div className="moment-card-prompt flex flex-col items-center gap-5">
      <h2 className="self-start text-title font-semibold text-ink">{t('moment.title')}</h2>
      <div
        ref={cardRef}
        className="moment-card relative flex w-[30rem] flex-col gap-6 overflow-hidden rounded-panel border border-line bg-surface-1 p-8 text-ink"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(26rem_16rem_at_15%_0%,color-mix(in_srgb,var(--cover-glow)_var(--cover-glow-strength),transparent),transparent_75%)]"
        />
        <div className="relative flex items-center gap-4">
          <img
            src={song.artworkPath || DefaultSongCover}
            alt=""
            className="h-20 w-20 shrink-0 rounded-cover-lg object-cover shadow-[0_10px_26px_rgb(0_0_0/0.3)]"
          />
          <div className="min-w-0">
            <p className="truncate text-body font-semibold">{song.title}</p>
            <p className="truncate text-small text-ink-dim">{artists}</p>
          </div>
        </div>
        <p className="relative text-balance text-[1.75rem] font-semibold leading-[1.2]">{line}</p>
        <div className="relative flex items-center justify-between text-small text-ink-dim">
          <span>{start !== undefined ? t('moment.at', { time: clock(start) }) : ''}</span>
          <span className="font-semibold tracking-wide">Nemora</span>
        </div>
      </div>
      <div className="flex gap-2 self-end">
        <Button label={t('moment.copy')} iconName="content_copy" isDisabled={isBusy} clickHandler={copy} />
        <Button label={t('moment.save')} iconName="save" variant="primary" isDisabled={isBusy} clickHandler={save} />
      </div>
    </div>
  );
};

export default MomentCard;

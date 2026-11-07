import { useContext, useEffect, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@tanstack/react-store';
import { store } from '@renderer/store';
import { AppUpdateContext } from '../../contexts/AppUpdateContext';
import { saveSoundAsFile } from '../../other/saveSoundFile';
import { soundTag } from '../../other/soundTag';
import { OWN_SOUND_ID, saveOwnSound } from '../../other/songSound';
import Icon from '../ui/Icon';
import {
  PRESETS,
  RANGE,
  REVERB_CHIP,
  factorOf,
  isEffectOn,
  presetOf,
  saveVersionSound,
  setSound,
  soundPanelStore,
  soundStore,
  speedLabel,
  takeClipped,
  versionStore,
  type Size,
  type Unit
} from '../../other/soundEffects';

const SLIDER =
  "seek-bar-slider thumb-visible relative h-6 w-full appearance-none bg-[transparent] p-0 outline-none outline-1 outline-offset-1 before:absolute before:left-0 before:top-1/2 before:h-1 before:w-[var(--seek-before-width)] before:-translate-y-1/2 before:rounded-3xl before:bg-echo before:content-[''] focus-visible:!outline";

const formatLength = (seconds: number) => {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * Slowed & reverb (PLAN/18 D3): a small panel over the player bar's right side. Speed in semitones
 * (or x, or %), the presets, the reverb and its size, Keep pitch, the real length at this speed and
 * a peak lamp. Changes apply at once; the pitch glides like a turntable while the slider moves.
 */
const SoundPanel = () => {
  const { t } = useTranslation();
  const globalSound = useStore(soundStore, (s) => s);
  // While a version plays (PLAN/18 D6) the panel shows and edits its sound.
  const playing = useStore(versionStore, (s) => s);
  const sound = playing?.sound ?? globalSound;
  const isOpen = useStore(soundPanelStore, (s) => s);
  const duration = useStore(store, (state) => state.currentSongData.duration ?? 0);
  const songId = useStore(store, (state) => state.currentSongData.songId);
  const songTitle = useStore(store, (state) => state.currentSongData.title ?? '');
  const { addNewNotifications } = useContext(AppUpdateContext);
  const [clipped, setClipped] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on Escape or a click outside (the button toggles it itself).
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && soundPanelStore.setState(() => false);
    const onDown = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (panelRef.current?.contains(target) || target?.closest('.sound-btn')) return;
      soundPanelStore.setState(() => false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [isOpen]);

  // The peak lamp: lit for a while after a sample went past 0 dBFS.
  useEffect(() => {
    if (!isOpen) return undefined;
    let isLive = true;
    let litUntil = 0;
    const id = setInterval(() => {
      takeClipped()
        .then((over) => {
          if (!isLive) return;
          if (over) litUntil = Date.now() + 2000;
          setClipped(Date.now() < litUntil);
        })
        .catch(() => undefined);
    }, 400);
    return () => {
      isLive = false;
      clearInterval(id);
    };
  }, [isOpen]);

  // Open and close with a short scale and fade from the button's corner; kept mounted while it closes.
  const [isShown, setIsShown] = useState(isOpen);
  useEffect(() => {
    if (isOpen) return setIsShown(true);
    const done = setTimeout(() => setIsShown(false), 140);
    return () => clearTimeout(done);
  }, [isOpen]);

  if (!isShown) return null;

  const factor = factorOf(sound.semitones);
  const preset = presetOf(sound);
  const centre = 50;
  const at = ((sound.semitones + RANGE) / (2 * RANGE)) * 100;
  const fill: CSSProperties = {
    left: `${Math.min(centre, at)}%`,
    width: `${Math.abs(at - centre)}%`
  };
  const segment = (isActive: boolean) =>
    `h-7 flex-1 rounded-md px-2 text-small font-medium outline-none transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-echo ${
      isActive ? 'bg-accent text-on-accent shadow-sm' : 'text-ink-dim hover:bg-line/50 hover:text-ink'
    }`;
  const units: Unit[] = ['st', 'x', '%'];
  const sizes: Size[] = ['room', 'hall', 'vast'];
  const hasReverbChip = Math.abs(sound.reverb - REVERB_CHIP.reverb) < 1e-6 && sound.size === REVERB_CHIP.size;
  const tag = soundTag(sound);
  // Save as file (PLAN/18 D4): the song with this sound, named after its tag or the version.
  const fileName = tag ?? playing?.name ?? '';
  const saveFile = (format: 'wav24' | 'float') =>
    saveSoundAsFile(songId, songTitle, fileName, format, t, addNewNotifications, {
      name: fileName,
      semitones: sound.semitones,
      keepPitch: sound.keepPitch,
      reverb: sound.reverb,
      size: sound.size
    }).catch((error) => console.error(error));
  const label = 'text-micro font-semibold uppercase tracking-[0.08em] text-ink-faint';

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={t('sound.title')}
      className={`sound-panel absolute bottom-[calc(100%+0.75rem)] right-0 z-50 w-[22rem] origin-bottom-right rounded-xl border border-glass-border bg-surface-3 text-ink shadow-float ${
        isOpen ? 'sound-panel-in' : 'sound-panel-out'
      }`}
    >
      {/* Header: the name of the sound as it is now, the peak lamp, Reset. */}
      <div className="flex items-start justify-between gap-3 px-4 pb-3 pt-4">
        <div className="min-w-0">
          <h2 className="text-body font-semibold">{t('sound.title')}</h2>
          <p className="mt-1 h-4 truncate text-small text-ink-dim">
            {tag ? <span className="sound-tag inline-block font-medium text-echo">{tag}</span> : t('sound.originalSound')}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span
            className={`h-2 w-2 rounded-full transition-colors duration-150 ${clipped ? 'bg-warning' : 'bg-line'}`}
            title={t('sound.peak')}
            aria-label={clipped ? t('sound.peakOn') : t('sound.peak')}
          />
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-md text-ink-dim outline-none transition-colors duration-150 hover:bg-line/50 hover:text-ink focus-visible:outline-2 focus-visible:outline-echo disabled:pointer-events-none disabled:opacity-35"
            disabled={!isEffectOn(sound) && !sound.keepPitch}
            onClick={() => setSound({ semitones: 0, reverb: 0, keepPitch: false })}
            aria-label={t('sound.reset')}
            data-tooltip={t('sound.reset')}
          >
            <Icon name="restart_alt" size={18} />
          </button>
        </div>
      </div>

      {playing && (
        <div className="mx-4 mb-3 flex items-center justify-between gap-2 rounded-lg bg-accent-soft px-3 py-2 text-small">
          <span className="truncate text-ink">
            {playing.id === OWN_SOUND_ID ? t('versions.editingSwitched', { name: playing.name }) : t('versions.editing', { name: playing.name })}
          </span>
          <button
            type="button"
            disabled={!playing.isChanged}
            className="shrink-0 rounded-md bg-accent px-2.5 py-1 font-medium text-on-accent outline-none focus-visible:outline-2 focus-visible:outline-echo disabled:opacity-40"
            onClick={() =>
              playing.id === OWN_SOUND_ID ? saveOwnSound() : saveVersionSound().catch((error) => console.error(error))
            }
          >
            {t('versions.saveSound')}
          </button>
        </div>
      )}

      {/* Speed */}
      <section className="border-t border-line px-4 py-3">
        <div className="flex items-center justify-between">
          <span className={label}>{t('sound.speed')}</span>
          <div className="flex items-center gap-2">
            <span className="text-body font-semibold tabular-nums">{speedLabel(sound.semitones, sound.unit)}</span>
            <div className="flex rounded-md bg-surface-2 p-0.5">
              {units.map((u) => (
                <button
                  key={u}
                  type="button"
                  aria-pressed={sound.unit === u}
                  className={`h-6 min-w-7 rounded px-1.5 text-[11px] font-medium outline-none focus-visible:outline-2 focus-visible:outline-echo ${
                    sound.unit === u ? 'bg-surface-3 text-ink shadow-sm' : 'text-ink-dim hover:text-ink'
                  }`}
                  onClick={() => setSound({ unit: u })}
                >
                  {u === 'st' ? t('sound.unitSt') : u}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="relative mt-2">
          <div className="pointer-events-none absolute left-0 right-0 top-1/2 h-1 -translate-y-1/2 rounded-3xl bg-line" />
          <div className="pointer-events-none absolute top-1/2 h-1 -translate-y-1/2 rounded-3xl bg-echo" style={fill} />
          <div className="pointer-events-none absolute left-1/2 top-1/2 h-3 w-px -translate-y-1/2 bg-ink-dim" />
          <input
            type="range"
            aria-label={t('sound.speed')}
            className={SLIDER}
            style={{ '--seek-before-width': '0%' } as CSSProperties}
            min={-RANGE}
            max={RANGE}
            step={0.1}
            value={sound.semitones}
            onChange={(e) => setSound({ semitones: Math.round(e.currentTarget.valueAsNumber * 10) / 10 })}
            onDoubleClick={() => setSound({ semitones: 0 })}
          />
        </div>
        <div className="mt-2 grid grid-cols-3 gap-1 rounded-lg bg-surface-2 p-1">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={preset === p.id}
              className={segment(preset === p.id)}
              onClick={() => setSound({ semitones: p.semitones })}
            >
              {t(`sound.preset.${p.id}`)}
            </button>
          ))}
        </div>
      </section>

      {/* Reverb */}
      <section className="border-t border-line px-4 py-3">
        <div className="flex items-center justify-between">
          <span className={label}>{t('sound.reverb')}</span>
          <div className="flex items-center gap-2">
            <span className="text-body font-semibold tabular-nums">{Math.round(sound.reverb * 100)} %</span>
            <button
              type="button"
              aria-pressed={hasReverbChip}
              className={`h-6 rounded-md px-2 text-[11px] font-medium outline-none transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-echo ${
                hasReverbChip ? 'bg-accent text-on-accent' : 'bg-surface-2 text-ink-dim hover:text-ink'
              }`}
              onClick={() => setSound(hasReverbChip ? { reverb: 0 } : { ...REVERB_CHIP })}
            >
              {t('sound.plusReverb')}
            </button>
          </div>
        </div>
        <input
          type="range"
          aria-label={t('sound.reverb')}
          className={`${SLIDER} mt-2`}
          style={{ '--seek-before-width': `${sound.reverb * 100}%` } as CSSProperties}
          min={0}
          max={1}
          step={0.01}
          value={sound.reverb}
          onChange={(e) => setSound({ reverb: e.currentTarget.valueAsNumber })}
          onDoubleClick={() => setSound({ reverb: 0 })}
        />
        <div className="mt-2 flex gap-1 rounded-lg bg-surface-2 p-1">
          {sizes.map((size) => (
            <button
              key={size}
              type="button"
              aria-pressed={sound.size === size}
              className={segment(sound.size === size)}
              onClick={() => setSound({ size })}
            >
              {t(`sound.size.${size}`)}
            </button>
          ))}
        </div>
      </section>

      {/* Keep pitch and the length */}
      <section className="border-t border-line px-4 py-3">
        <button
          type="button"
          role="switch"
          aria-checked={sound.keepPitch}
          className="flex w-full items-center justify-between gap-3 rounded-md text-left outline-none focus-visible:outline-2 focus-visible:outline-echo"
          onClick={() => setSound({ keepPitch: !sound.keepPitch })}
        >
          <span className="min-w-0">
            <span className="block text-body font-medium">{t('sound.keepPitch')}</span>
            <span className="block text-small text-ink-dim">{t('sound.keepPitchShort')}</span>
          </span>
          <span
            className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-150 ${sound.keepPitch ? 'bg-accent' : 'bg-line'}`}
            aria-hidden
          >
            <span
              className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-150 ${
                sound.keepPitch ? 'translate-x-[1.125rem]' : 'translate-x-0.5'
              }`}
            />
          </span>
        </button>
        {duration > 0 && Math.abs(factor - 1) > 1e-6 && (
          <div className="mt-2 flex items-center gap-1.5 text-small text-ink-dim">
            <Icon name="schedule" size={14} />
            {t('sound.length', { length: formatLength(duration / factor), original: formatLength(duration) })}
          </div>
        )}
      </section>

      {/* Save as file */}
      <div className="flex items-center justify-between gap-2 rounded-b-xl border-t border-line bg-surface-2/50 px-4 py-2.5">
        <span className="text-small text-ink-dim">{t('versions.saveFile')}</span>
        <div className="flex gap-1">
          {(['wav24', 'float'] as const).map((format) => (
            <button
              key={format}
              type="button"
              disabled={!songId || !fileName}
              className="flex h-7 items-center gap-1 rounded-md px-2 text-small font-medium text-ink outline-none transition-colors duration-150 hover:bg-line/50 focus-visible:outline-2 focus-visible:outline-echo disabled:pointer-events-none disabled:opacity-40"
              onClick={() => saveFile(format)}
            >
              <Icon name="download" size={15} />
              {t(`versions.format.${format}`)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default SoundPanel;

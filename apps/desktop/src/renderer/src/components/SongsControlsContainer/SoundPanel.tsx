import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@tanstack/react-store';
import { store } from '@renderer/store';
import Checkbox from '../Checkbox';
import Icon from '../ui/Icon';
import {
  PRESETS,
  RANGE,
  REVERB_CHIP,
  factorOf,
  isEffectOn,
  presetOf,
  setSound,
  soundPanelStore,
  soundStore,
  speedLabel,
  takeClipped,
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
  const sound = useStore(soundStore, (s) => s);
  const isOpen = useStore(soundPanelStore, (s) => s);
  const duration = useStore(store, (state) => state.currentSongData.duration ?? 0);
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

  if (!isOpen) return null;

  const factor = factorOf(sound.semitones);
  const preset = presetOf(sound);
  const centre = 50;
  const at = ((sound.semitones + RANGE) / (2 * RANGE)) * 100;
  const fill: CSSProperties = {
    left: `${Math.min(centre, at)}%`,
    width: `${Math.abs(at - centre)}%`
  };
  const chip = (isActive: boolean) =>
    `inline-flex h-7 items-center rounded-full px-2.5 text-small outline-none transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-echo ${
      isActive ? 'bg-accent text-on-accent' : 'bg-surface-2 text-ink hover:bg-line/70'
    }`;
  const units: Unit[] = ['st', 'x', '%'];
  const sizes: Size[] = ['room', 'hall', 'vast'];
  const hasReverbChip = Math.abs(sound.reverb - REVERB_CHIP.reverb) < 1e-6 && sound.size === REVERB_CHIP.size;

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={t('sound.title')}
      className="sound-panel absolute bottom-[calc(100%+0.75rem)] right-0 z-50 w-[22rem] rounded-xl bg-surface-3 p-4 text-ink shadow-float"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">{t('sound.title')}</h2>
        <div className="flex items-center gap-2">
          <span
            className={`h-2 w-2 rounded-full ${clipped ? 'bg-danger' : 'bg-line'}`}
            title={t('sound.peak')}
            aria-label={clipped ? t('sound.peakOn') : t('sound.peak')}
          />
          <button
            type="button"
            className="rounded px-1.5 text-small text-ink-dim hover:text-ink focus-visible:outline-2 focus-visible:outline-echo disabled:opacity-40"
            disabled={!isEffectOn(sound) && !sound.keepPitch}
            onClick={() => setSound({ semitones: 0, reverb: 0, keepPitch: false })}
          >
            {t('sound.reset')}
          </button>
        </div>
      </div>

      {/* Speed */}
      <div className="mt-3 flex items-center justify-between text-small">
        <span className="text-ink-dim">{t('sound.speed')}</span>
        <div className="flex items-center gap-2">
          <span className="font-medium tabular-nums">{speedLabel(sound.semitones, sound.unit)}</span>
          <div className="flex overflow-hidden rounded-full bg-surface-2">
            {units.map((u) => (
              <button
                key={u}
                type="button"
                aria-pressed={sound.unit === u}
                className={`px-2 py-0.5 text-[11px] outline-none focus-visible:outline-2 focus-visible:outline-echo ${
                  sound.unit === u ? 'bg-accent text-on-accent' : 'text-ink-dim hover:text-ink'
                }`}
                onClick={() => setSound({ unit: u })}
              >
                {u === 'st' ? t('sound.unitSt') : u}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="relative mt-1">
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
      <div className="mt-2 flex flex-wrap gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={preset === p.id}
            className={chip(preset === p.id)}
            onClick={() => setSound({ semitones: p.semitones })}
          >
            {t(`sound.preset.${p.id}`)}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={hasReverbChip}
          className={chip(hasReverbChip)}
          onClick={() => setSound(hasReverbChip ? { reverb: 0 } : { ...REVERB_CHIP })}
        >
          {t('sound.plusReverb')}
        </button>
      </div>

      {/* Reverb */}
      <div className="mt-4 flex items-center justify-between text-small">
        <span className="text-ink-dim">{t('sound.reverb')}</span>
        <span className="font-medium tabular-nums">{Math.round(sound.reverb * 100)} %</span>
      </div>
      <input
        type="range"
        aria-label={t('sound.reverb')}
        className={`${SLIDER} mt-1`}
        style={{ '--seek-before-width': `${sound.reverb * 100}%` } as CSSProperties}
        min={0}
        max={1}
        step={0.01}
        value={sound.reverb}
        onChange={(e) => setSound({ reverb: e.currentTarget.valueAsNumber })}
        onDoubleClick={() => setSound({ reverb: 0 })}
      />
      <div className="mt-2 flex gap-1.5">
        {sizes.map((size) => (
          <button
            key={size}
            type="button"
            aria-pressed={sound.size === size}
            className={chip(sound.size === size)}
            onClick={() => setSound({ size })}
          >
            {t(`sound.size.${size}`)}
          </button>
        ))}
      </div>

      <div className="mt-4 border-t border-line pt-3">
        <Checkbox
          id="soundKeepPitch"
          isChecked={sound.keepPitch}
          checkedStateUpdateFunction={(state) => setSound({ keepPitch: state })}
          labelContent={t('sound.keepPitch')}
        />
        <div className="ml-8 text-small text-ink-dim">{t('sound.keepPitchDescription')}</div>
        {duration > 0 && Math.abs(factor - 1) > 1e-6 && (
          <div className="mt-2 flex items-center gap-1.5 text-small text-ink-dim">
            <Icon name="schedule" size={14} />
            {t('sound.length', { length: formatLength(duration / factor), original: formatLength(duration) })}
          </div>
        )}
      </div>
    </div>
  );
};

export default SoundPanel;

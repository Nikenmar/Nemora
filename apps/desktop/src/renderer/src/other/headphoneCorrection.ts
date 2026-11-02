import { Store } from '@tanstack/react-store';
import { ipc } from '@platform/ipc';
import type { Filter, Headphone_Serialize, Preview_Serialize } from '@platform/ipc';

/** Headphone correction (PLAN/18 D5): off by default; the profile is kept as its text. */
export type Correction = { isOn: boolean; name: string; source: string; text: string };

// The core's types (generated from Rust).
export type Headphone = Headphone_Serialize;
export type CorrectionFilter = Filter;
export type CorrectionPreview = Preview_Serialize;

const KEY = 'nemora.correction';
const OFF: Correction = { isOn: false, name: '', source: '', text: '' };

const load = (): Correction => {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Correction> | null;
    return saved && typeof saved.text === 'string' ? { ...OFF, ...saved } : OFF;
  } catch {
    return OFF;
  }
};

export const correctionStore = new Store<Correction>(load());

const apply = () => {
  const { isOn, text } = correctionStore.state;
  void ipc('engine_correction', { text: isOn && text ? text : null }).catch((error) => console.error(error));
};

/** At startup: the engine gets the saved correction (nothing when it is off). */
export const applySavedCorrection = () => {
  if (correctionStore.state.isOn) apply();
};

export const setCorrection = (change: Partial<Correction>) => {
  correctionStore.setState((state) => ({ ...state, ...change }));
  try {
    localStorage.setItem(KEY, JSON.stringify(correctionStore.state));
  } catch {
    /* the setting simply is not remembered */
  }
  apply();
};

export const previewCorrection = (text: string) => ipc('correction_preview', { text });

/** The AutoEQ list: the cached copy, or fetched from GitHub when `refresh` or not cached yet. */
export const autoEqIndex = (refresh = false) => ipc('autoeq_index', { refresh });

export const autoEqProfile = (headphone: Headphone) => ipc('autoeq_profile', { headphone });

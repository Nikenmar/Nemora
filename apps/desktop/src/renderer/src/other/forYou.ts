import { Store } from '@tanstack/react-store';
import { invoke } from '@tauri-apps/api/core';
import type { TFunction } from 'i18next';
import { currentIntensity, shuffleOptions } from './smartShuffle';

/** Home's For you (PLAN/19): the smart lists and the mix of the day, from the core. */
export type SmartListId = 'rediscover' | 'onRepeat' | 'caughtYou' | 'thisHour' | 'energetic' | 'calm' | 'neverHeard';
export type SmartReason = { key: string; count?: number; total?: number; name?: string };
export type SmartEntry = { songId: string; reason: SmartReason };
export type SmartList = { id: SmartListId; entries: SmartEntry[] };
export type MixPart = 'favourite' | 'forgotten' | 'new' | 'island';
export type Mix = {
  day: string;
  round: number;
  songs: { songId: string; part: MixPart }[];
  newArtist?: string | null;
  island?: string | null;
};

/** The local day as the core keys the mix by it. */
export const today = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export const mixStore = new Store<Mix | null>(null);
export const smartListsStore = new Store<SmartList[] | null>(null);

export const loadMix = async (fresh = false) => {
  const mix = await invoke<Mix>('mix_of_day', {
    today: today(),
    fresh,
    options: shuffleOptions(),
    intensity: currentIntensity()
  });
  mixStore.setState(() => mix);
  return mix;
};

export const loadSmartLists = async () => {
  const lists = await invoke<SmartList[]>('smart_lists', { options: shuffleOptions(), intensity: currentIntensity() });
  smartListsStore.setState(() => lists);
  return lists;
};

/** The sentence under a song: why it is in the list or the mix. */
export const reasonText = (reason: SmartReason, t: TFunction) =>
  // The key comes from the core, so it is a string here rather than one of the typed keys.
  (t as unknown as (key: string, options: Record<string, unknown>) => string)(`forYou.reason.${reason.key}`, {
    count: reason.count ?? 0,
    total: reason.total ?? 0,
    name: reason.name ?? ''
  });

export const partText = (part: MixPart, mix: Mix | null, t: TFunction) =>
  t(`forYou.part.${part}`, { island: mix?.island ?? '' });

/** The mix card's subtitle: what is in it, in a few words. */
export const mixSummary = (mix: Mix, t: TFunction) => {
  const has = (part: MixPart) => mix.songs.some((s) => s.part === part);
  const bits = [
    has('forgotten') ? t('forYou.summary.forgotten') : '',
    has('new') ? (mix.newArtist ? t('forYou.summary.newFrom', { name: mix.newArtist }) : t('forYou.summary.new')) : '',
    has('island') && mix.island ? t('forYou.summary.island', { name: mix.island }) : ''
  ].filter(Boolean);
  return bits.length > 0 ? bits.join(', ') : t('forYou.summary.favourites');
};

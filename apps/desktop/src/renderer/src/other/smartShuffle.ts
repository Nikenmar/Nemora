import { Store } from '@tanstack/react-store';
import storage from '../utils/localStorage';
import { store } from '../store';
import megaShuffleQueue from './megaShuffleQueue';
import { startTrace } from './trace';

/**
 * Smart Shuffle as the view holds it (PLAN/14 C1-C4): the weights of the whole library, the session's
 * steering and filters, and the reasons behind an order. Steering lives until the app closes and
 * reorders only the part of the queue that has not played yet; the current song keeps playing.
 */

/** The weights the queue is ordered by; App reads and refreshes it (`tierShuffleDataRef`). */
export const smartShuffleData: { current: MegaShuffleData } = {
  current: { weights: {}, pairFeedback: [] }
};

/** Plus "Not now" songs, which go to the end of the queue, and the titles the chips show for song ids. */
export type Steering = ShuffleSteering & { notNow: string[]; titles: Record<string, string> };

export const NO_STEERING: Steering = {
  lessArtists: [],
  moreLike: [],
  onlyUnheard: false,
  onlyRanked: false,
  boostNew: false,
  notNow: [],
  titles: {}
};

export const steeringStore = new Store<Steering>(NO_STEERING);

// From the store: `getPreferences` throws for a preference that was never set.
const preferences = () => store.state.localStorage.preferences;
const intensity = () => preferences().tierShuffleIntensity ?? 0.6;
/** The model's options from the user's settings (PLAN/15); the nudge has no setting. */
export const shuffleOptions = (): ShuffleOptions => {
  const p = preferences();
  return {
    nudge: true,
    skipAware: !p.isSkipAwareDisabled,
    learn: !p.isListeningLearningDisabled,
    adaptive: !p.isAdaptiveShuffleDisabled,
    implicitDuels: !p.isImplicitDuelsDisabled,
    freshnessByDays: !p.isFreshnessByDaysDisabled,
    fairRotation: !p.isFairRotationDisabled,
    forgottenFavourites: !p.isForgottenFavouritesDisabled,
    artistFatigue: !!p.isArtistFatigueEnabled,
    night: !!p.isNightShuffleEnabled,
    followMap: !!p.isFollowTasteMapEnabled
  };
};

const coreSteering = (): ShuffleSteering | undefined => {
  const { lessArtists, moreLike, onlyUnheard, onlyRanked, boostNew } = steeringStore.state;
  const filters = !!preferences().isSessionFiltersEnabled;
  const steering = {
    lessArtists,
    moreLike,
    onlyUnheard: filters && onlyUnheard,
    onlyRanked: filters && onlyRanked,
    boostNew: filters && boostNew
  };
  const isEmpty =
    lessArtists.length === 0 && moreLike.length === 0 && !steering.onlyUnheard && !steering.onlyRanked && !steering.boostNew;
  return isEmpty ? undefined : steering;
};

/** Fetches the weights of the whole library with the session's steering and keeps them. */
export async function loadShuffleData(): Promise<MegaShuffleData> {
  const data = await window.api.tierlistsData.getMegaShuffleData([], intensity(), {
    options: shuffleOptions(),
    steering: coreSteering()
  });
  smartShuffleData.current = data;
  explanations.clear();
  return data;
}

/**
 * Reorders the not-yet-played part of the queue by the current weights, keeping what has played and
 * the current song where they are. `queueBeforeShuffle` is composed with the reorder, so turning
 * Smart Shuffle off still restores the original order.
 */
export function reorderRemaining() {
  const queue = store.state.localStorage.queue;
  const current = queue.currentSongIndex ?? -1;
  const from = current + 1;
  if (from >= queue.queue.length) return;
  const rest = queue.queue.slice(from);
  const { shuffledQueue } = megaShuffleQueue(rest, smartShuffleData.current);
  const notNow = new Set(steeringStore.state.notNow);
  const ordered = [
    ...shuffledQueue.filter((id) => !notNow.has(id)),
    ...shuffledQueue.filter((id) => notNow.has(id))
  ];
  // Where each old position goes; duplicates are matched in order.
  const taken = new Map<string, number[]>();
  ordered.forEach((id, index) => taken.set(id, [...(taken.get(id) ?? []), from + index]));
  const moved = queue.queue.map((id, index) => (index < from ? index : (taken.get(id)?.shift() ?? index)));
  const nextQueue = [...queue.queue.slice(0, from), ...ordered];
  const before = queue.queueBeforeShuffle;
  storage.queue.setQueue({
    ...queue,
    queue: nextQueue,
    queueBeforeShuffle: Array.isArray(before) && before.length > 0 ? before.map((p) => moved[p] ?? p) : before
  });
}

export type SteeringAction =
  | { kind: 'lessArtist'; artist: string }
  | { kind: 'moreLike'; songId: string; title: string }
  | { kind: 'notNow'; songId: string; title: string }
  | { kind: 'filter'; filter: 'onlyUnheard' | 'onlyRanked' | 'boostNew'; isOn: boolean }
  | { kind: 'remove'; what: 'lessArtists' | 'moreLike' | 'notNow'; value: string }
  | { kind: 'clear' };

const added = (list: string[], value: string) => (list.includes(value) ? list : [...list, value]);

/** Applies a steering action, refreshes the weights and reorders the rest of the queue. */
export async function steer(action: SteeringAction) {
  const trace = startTrace(`Smart Shuffle steer ${action.kind}`);
  steeringStore.setState((state) => {
    switch (action.kind) {
      case 'lessArtist':
        return { ...state, lessArtists: added(state.lessArtists, action.artist) };
      case 'moreLike':
        return {
          ...state,
          moreLike: added(state.moreLike, action.songId),
          titles: { ...state.titles, [action.songId]: action.title }
        };
      case 'notNow':
        return {
          ...state,
          notNow: added(state.notNow, action.songId),
          titles: { ...state.titles, [action.songId]: action.title }
        };
      case 'filter':
        return { ...state, [action.filter]: action.isOn };
      case 'remove':
        return { ...state, [action.what]: state[action.what].filter((v) => v !== action.value) };
      case 'clear':
        return NO_STEERING;
      default:
        return state;
    }
  });
  trace.step('steering');
  if (!store.state.player.isTierShuffling) return;
  await loadShuffleData();
  trace.step('weights');
  reorderRemaining();
  trace.step('reorder');
  await trace.end({ queue: store.state.localStorage.queue.queue.length });
}

const explanations = new Map<string, Promise<ShuffleExplanation | undefined>>();
let batch: { ids: string[]; resolve: (all: Record<string, ShuffleExplanation>) => void } | null = null;
let batchResult: Promise<Record<string, ShuffleExplanation>> = Promise.resolve({});

/** Why `songId` plays where it does; requests made together go in one call, cached until the weights change. */
export function explainSong(songId: string): Promise<ShuffleExplanation | undefined> {
  let pending = explanations.get(songId);
  if (!pending) {
    if (!batch) {
      let resolve!: (all: Record<string, ShuffleExplanation>) => void;
      const all = new Promise<Record<string, ShuffleExplanation>>((r) => (resolve = r));
      batch = { ids: [], resolve };
      batchResult = all;
      setTimeout(() => {
        const { ids, resolve: done } = batch!;
        batch = null;
        window.api.tierlistsData
          .explainShuffle(ids, intensity(), shuffleOptions())
          .then(done)
          .catch(() => done({}));
      }, 30);
    }
    batch.ids.push(songId);
    pending = batchResult.then((all) => all[songId]);
    explanations.set(songId, pending);
  }
  return pending;
}

export type ReasonKey =
  | 'tier'
  | 'artist'
  | 'duels'
  | 'listens'
  | 'notHeard'
  | 'neverHeard'
  | 'skipped'
  | 'recent'
  | 'nudged'
  | 'ownPicks'
  | 'replays'
  | 'scrubbed'
  | 'rotation'
  | 'fatigue'
  | 'plain';
export type Reason = { key: ReasonKey; values?: Record<string, string | number>; strength: number };

const daysSince = (day: string) => {
  const [y, m, d] = day.split('-').map(Number);
  const then = Date.UTC(y, m - 1, d);
  return Math.floor((Date.now() - then) / 86_400_000);
};

/**
 * The parts of an explanation as reasons (keys under `smartShuffle.reasons`), strongest first. The
 * strength is the part's share of the score, so "S tier" outranks a slight listening lead.
 */
export function reasonsOf(e: ShuffleExplanation): Reason[] {
  const reasons: Reason[] = [];
  const tierShare = e.elo === null ? 0.5 : 0.45;
  const artistShare = e.elo === null ? 0.4 : 0.35;
  if (e.skip < 1) reasons.push({ key: 'skipped', strength: 2 });
  if (e.tier > 0 && e.tierName)
    reasons.push({
      key: 'tier',
      values: { tier: e.tierName, tierlist: e.tierlist ?? '' },
      strength: tierShare * e.tier
    });
  if (e.artist >= 0.35) reasons.push({ key: 'artist', strength: artistShare * e.artist });
  if (e.eloPercentile !== null && e.eloPercentile >= 0.8)
    reasons.push({
      key: 'duels',
      values: { percent: Math.max(1, Math.round((1 - e.eloPercentile) * 100)) },
      strength: 0.1 * (e.elo ?? 0) + 0.05
    });
  if (e.fullListens > 0 && e.listens >= 0.3)
    reasons.push({ key: 'listens', values: { count: e.fullListens }, strength: 0.1 * e.listens });
  if (e.lastDay) {
    const days = daysSince(e.lastDay);
    if (days >= 28)
      reasons.push({ key: 'notHeard', values: { weeks: Math.floor(days / 7) }, strength: 0.12 });
  } else reasons.push({ key: 'neverHeard', strength: 0.08 });
  if (e.freshness < 0.75) reasons.push({ key: 'recent', strength: 1.5 });
  // A placed song below the unplaced median got a little lift (PLAN/15 F1).
  if (e.nudge > 0) reasons.push({ key: 'nudged', strength: 0.11 });
  // Variety (PLAN/15 V2, V3).
  if (e.rotation >= 1.3) reasons.push({ key: 'rotation', strength: 0.2 });
  if (e.fatigue < 0.8) reasons.push({ key: 'fatigue', strength: 1.1 });
  // How it is listened to (PLAN/15 L1), when learning is on.
  if (e.engagement !== null) {
    if (e.replays >= 2) reasons.push({ key: 'replays', strength: 0.3 });
    else if (e.ownPicks >= 2)
      reasons.push({ key: 'ownPicks', values: { count: e.ownPicks }, strength: 0.25 });
    if (e.scrubSkips >= 2 && e.engagement < 0.5) reasons.push({ key: 'scrubbed', strength: 1.2 });
  }
  return reasons.sort((a, b) => b.strength - a.strength);
}

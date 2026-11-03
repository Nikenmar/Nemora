// PLAN/21 P21.5: moved from App.tsx as it was. The queue's operations - shuffling (plain and
// Smart Shuffle), creating a queue, updating it - and Smart Shuffle's data; App calls the hook
// where they were, so the hooks keep their order.
import { useCallback, useEffect } from 'react';
import type { TFunction } from 'i18next';

import { dispatch, store } from '../store';
import storage from '../utils/localStorage';
import { loadShuffleData, smartShuffleData } from '../other/smartShuffle';
// PLAN/21 P21.6: megaShuffleQueue as it was, with the core's port asked for the same order in shadow.
import megaShuffleQueue from '../other/megaOrderShadow';
import shuffleQueueRandomly from '../other/shuffleQueueRandomly';
import { startTrace } from '../other/trace';
import type { StartReason } from '../other/listeningDataSession';

export type UseQueueOperationsDeps = {
  t: TFunction;
  addNewNotifications: (newNotifications: AppNotification[]) => void;
  changeQueueCurrentSongIndex: (currentSongIndex: number, isPlaySong?: boolean) => void;
  playSong: (songId: string, isStartPlay?: boolean, playAsCurrentSongIndex?: boolean) => void;
  setStartReason: (reason: StartReason) => void;
};

export const useQueueOperations = ({ t, addNewNotifications, changeQueueCurrentSongIndex, playSong, setStartReason }: UseQueueOperationsDeps) => {
  const toggleShuffling = useCallback((isShuffling?: boolean) => {
    dispatch({ type: 'TOGGLE_SHUFFLE_STATE', data: isShuffling });
  }, []);

  // Cached per-song weights for the Smart Shuffle, so building a fresh queue can
  // be weighted synchronously (just like the normal shuffle) — fixes the "play a
  // track and it goes linear" bug. Warmed whenever Smart Shuffle turns on.
  // Held by other/smartShuffle.ts, which also applies the session's steering (PLAN/14 C2).
  const tierShuffleDataRef = smartShuffleData;

  useEffect(() => {
    const refreshDuelFeedback = (event: Event) => {
      if (!('detail' in event) || !store.state.player.isTierShuffling) return;
      const updates = (event as DetailAvailableEvent<DataUpdateEvent[]>).detail;
      if (!updates.some(({ dataType }) => dataType === 'eloDuels')) return;
      loadShuffleData().catch((error) => console.error(error));
    };

    document.addEventListener('app/dataUpdates', refreshDuelFeedback);
    return () => document.removeEventListener('app/dataUpdates', refreshDuelFeedback);
  }, []);

  const shuffleQueue = useCallback(
    (songIds: string[], currentSongIndex?: number) => {
      // If Smart Shuffle is on, weight the order instead of pure random. Don't
      // flip the normal-shuffle flag here — the two modes are exclusive.
      if (store.state.player.isTierShuffling) {
        return megaShuffleQueue(songIds, tierShuffleDataRef.current, currentSongIndex);
      }
      toggleShuffling(true);
      return shuffleQueueRandomly(songIds, currentSongIndex);
    },
    [tierShuffleDataRef, toggleShuffling]
  );

  const createQueue = useCallback(
    (
      newQueue: string[],
      queueType: QueueTypes,
      isShuffleQueue = store.state.player.isShuffling || store.state.player.isTierShuffling,
      queueId?: string,
      startPlaying = false
    ) => {
      const queue = {
        currentSongIndex: 0,
        queue: newQueue,
        queueId,
        queueType
      } as Queue;

      if (isShuffleQueue) {
        const { shuffledQueue, positions } = shuffleQueue(queue.queue);
        queue.queue = shuffledQueue;

        if (positions.length > 0) queue.queueBeforeShuffle = positions;
        queue.currentSongIndex = 0;
      } else {
        // A non-shuffled queue was requested: turn BOTH shuffle modes off so Smart
        // Shuffle behaves exactly like the normal one (no "lit button, linear queue").
        toggleShuffling(false);
        if (store.state.player.isTierShuffling)
          dispatch({ type: 'TOGGLE_TIER_SHUFFLE_STATE', data: false });
      }

      storage.queue.setQueue(queue);
      // Play buttons of a whole list: the user chose the list, the queue chose its first song.
      if (startPlaying) {
        setStartReason('auto');
        changeQueueCurrentSongIndex(0);
      }
    },
    // setStartReason only writes App's ref; the list is App's, as it was.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [changeQueueCurrentSongIndex, shuffleQueue, toggleShuffling]
  );

  // Mega Smart Shuffle (Tierlist Value Shuffle): like the normal shuffle, but it
  // weighted-reorders the CURRENT queue (keeping the playing track up front) so
  // you stay in the same context (all songs / a playlist) — it just leans the
  // upcoming tracks toward what you rate highly. Mutually exclusive with shuffle.
  const toggleTierShuffle = useCallback(
    (force?: boolean) => {
      const next = force ?? !store.state.player.isTierShuffling;

      if (!next) {
        const wasOn = store.state.player.isTierShuffling;
        dispatch({ type: 'TOGGLE_TIER_SHUFFLE_STATE', data: false });
        // Restore the original order, exactly like turning the normal shuffle off.
        const q = store.state.localStorage.queue;
        if (wasOn && Array.isArray(q.queueBeforeShuffle) && q.queueBeforeShuffle.length > 0) {
          const playing = q.queue[q.currentSongIndex ?? 0];
          const restored = q.queueBeforeShuffle.map((pos) => q.queue[pos]);
          storage.queue.setQueue({
            ...q,
            queue: restored,
            queueBeforeShuffle: [],
            currentSongIndex: playing ? restored.indexOf(playing) : (q.currentSongIndex ?? 0)
          });
        }
        return;
      }

      const currentQueue = store.state.localStorage.queue;
      const baseQueue = [...currentQueue.queue];
      if (baseQueue.length === 0) {
        addNewNotifications([
          { id: 'tierShuffleEmpty', duration: 5000, content: t('player.tierShuffleEmpty') }
        ]);
        return;
      }

      const trace = startTrace('Smart Shuffle on');
      window.api.tierlistsData
        .getTierlistData()
        .then((tierlists) => {
          trace.step('tierlists');
          const hasInfluencing = (tierlists || []).some((tl) => tl.influencesShuffle);
          if (!hasInfluencing) {
            // No tierlist feeds the shuffle — don't enable, just tell the user.
            addNewNotifications([
              {
                id: 'tierShuffleNoInfluence',
                duration: 6000,
                content: t('player.tierShuffleNoInfluence')
              }
            ]);
            return null;
          }
          // Weights for the WHOLE library, so later queue rebuilds stay smart too.
          return loadShuffleData();
        })
        .then((data) => {
          if (!data) return; // aborted (no influencing tierlists)
          trace.step('weights');
          const { shuffledQueue, positions } = megaShuffleQueue(
            baseQueue,
            data,
            currentQueue.currentSongIndex ?? undefined
          );
          trace.step('order');
          storage.queue.setQueue({
            ...currentQueue,
            queue: shuffledQueue,
            queueBeforeShuffle: positions,
            currentSongIndex: 0
          });
          trace.step('queue');
          toggleShuffling(false); // mutual exclusivity with the normal shuffle
          dispatch({ type: 'TOGGLE_TIER_SHUFFLE_STATE', data: true });
          trace.step('state');
          // No playSong() call — the current track keeps playing seamlessly.
          addNewNotifications([
            { id: 'tierShuffleOn', duration: 4000, content: t('player.tierShuffleOn') }
          ]);
          trace.step('toast');
          void trace.end({ queue: baseQueue.length });
        })
        .catch((err) => console.error(err));
    },
    [addNewNotifications, t, toggleShuffling]
  );

  const updateQueueData = useCallback(
    (
      currentSongIndex?: number | null,
      newQueue?: string[],
      isShuffleQueue = false,
      playCurrentSongIndex = true,
      restoreAndClearPreviousQueue = false
    ) => {
      const currentQueue = store.state.localStorage.queue;
      const queue: Queue = {
        ...currentQueue,
        currentSongIndex:
          typeof currentSongIndex === 'number' || currentSongIndex === null
            ? currentSongIndex
            : currentQueue.currentSongIndex,
        queue: newQueue ?? currentQueue.queue
      };

      if (
        restoreAndClearPreviousQueue &&
        Array.isArray(queue.queueBeforeShuffle) &&
        queue.queueBeforeShuffle.length > 0
      ) {
        const currentQueuePlayingSong = queue.queue.at(currentQueue.currentSongIndex ?? 0);
        const restoredQueue: string[] = [];

        for (let i = 0; i < queue.queueBeforeShuffle.length; i += 1) {
          restoredQueue.push(queue.queue[queue.queueBeforeShuffle[i]]);
        }

        queue.queue = restoredQueue;
        queue.queueBeforeShuffle = [];
        if (currentQueuePlayingSong)
          queue.currentSongIndex = queue.queue.indexOf(currentQueuePlayingSong);
      }

      if (queue.queue.length > 1 && isShuffleQueue) {
        // toggleShuffling will be called in the shuffleQueue function
        const { shuffledQueue, positions } = shuffleQueue(
          // Clone the songIds array because tanstack store thinks its values aren't changed if we don't do this
          [...queue.queue],
          queue.currentSongIndex ?? currentQueue.currentSongIndex ?? undefined
        );
        queue.queue = shuffledQueue;
        if (positions.length > 0) queue.queueBeforeShuffle = positions;
        queue.currentSongIndex = 0;
      } else {
        // A non-shuffled queue was requested: turn BOTH shuffle modes off so Smart
        // Shuffle behaves exactly like the normal one (no "lit button, linear queue").
        toggleShuffling(false);
        if (store.state.player.isTierShuffling)
          dispatch({ type: 'TOGGLE_TIER_SHUFFLE_STATE', data: false });
      }

      storage.queue.setQueue(queue);
      if (playCurrentSongIndex && typeof currentSongIndex === 'number')
        playSong(currentQueue.queue[currentSongIndex]);
    },
    [playSong, shuffleQueue, toggleShuffling]
  );

  return { toggleShuffling, createQueue, toggleTierShuffle, updateQueueData };
};

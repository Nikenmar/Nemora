import { describe, expect, it } from 'vitest';
import { store } from '@renderer/store';
import storage from '@renderer/utils/localStorage';
import { FROM_CORE_KEY, adoptCoreOrder, isCoreOrderOn } from '@renderer/other/megaOrderShadow';

/** PLAN/21 P21.6, the switch: the core's order replaces the TypeScript one only while nothing moved. */
const made = { shuffledQueue: ['a', 'b', 'c', 'd'], positions: [0, 1, 2, 3] };
const core = { shuffledQueue: ['a', 'c', 'b', 'd'], positions: [0, 2, 1, 3] };
const setQueue = (queue: string[], currentSongIndex: number) =>
  storage.queue.setQueue({ ...store.state.localStorage.queue, queue, currentSongIndex, queueType: 'songs' });

describe('adopting the core order', () => {
  it('is on unless turned off', () => {
    localStorage.removeItem(FROM_CORE_KEY);
    expect(isCoreOrderOn()).toBe(true);
    localStorage.setItem(FROM_CORE_KEY, '0');
    expect(isCoreOrderOn()).toBe(false);
    localStorage.removeItem(FROM_CORE_KEY);
  });

  it('takes the core order while the queue is the one just made, on its first song', () => {
    setQueue(made.shuffledQueue, 0);
    expect(adoptCoreOrder(made, core)).toBe(true);
    expect(store.state.localStorage.queue.queue).toEqual(core.shuffledQueue);
    expect(store.state.localStorage.queue.queueBeforeShuffle).toEqual(core.positions);
  });

  it('leaves a queue that moved on or changed', () => {
    setQueue(made.shuffledQueue, 1);
    expect(adoptCoreOrder(made, core)).toBe(false);
    expect(store.state.localStorage.queue.queue).toEqual(made.shuffledQueue);
    setQueue(['x', 'y'], 0);
    expect(adoptCoreOrder(made, core)).toBe(false);
    expect(store.state.localStorage.queue.queue).toEqual(['x', 'y']);
  });

  it('never moves the current song', () => {
    setQueue(made.shuffledQueue, 0);
    expect(adoptCoreOrder(made, { shuffledQueue: ['b', 'a', 'c', 'd'], positions: [1, 0, 2, 3] })).toBe(false);
  });
});

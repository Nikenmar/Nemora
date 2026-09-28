import { describe, expect, test } from '@jest/globals';

import type { StoreFile, StoreName, StorePort } from '../../contracts/store';
import { CachedStores, createDefaultStoreFiles, StoreWriteError } from '../storeCache';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** A port whose writes fail while `failing` is above zero, like a file another process holds. */
class FlakyPort implements StorePort {
  readonly files = new Map<StoreName, StoreFile<unknown>>();
  failing = 0;
  attempts = 0;

  async exists(store: StoreName): Promise<boolean> {
    return this.files.has(store);
  }

  async read<T>(store: StoreName): Promise<StoreFile<T>> {
    return clone(this.files.get(store)) as StoreFile<T>;
  }

  async write<T>(store: StoreName, file: StoreFile<T>): Promise<void> {
    this.attempts += 1;
    if (this.failing > 0) {
      this.failing -= 1;
      throw new Error(
        'ReplaceFileW: The process cannot access the file because it is being used by another process. (0x80070020)'
      );
    }
    this.files.set(store, clone(file) as StoreFile<unknown>);
  }
}

/** Runs scheduled retries by hand, recording the delays asked for. */
const manualClock = () => {
  const queue: Array<{ task: () => void; delayMs: number }> = [];
  return {
    delays: () => queue.map((entry) => entry.delayMs),
    schedule: (task: () => void, delayMs: number) => queue.push({ task, delayMs }),
    runNext: () => queue.shift()?.task(),
    size: () => queue.length
  };
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('a store write that fails is retried, not given up on', () => {
  test('the store is written once the file is free again, with every change made meanwhile', async () => {
    const port = new FlakyPort();
    const clock = manualClock();
    const errors: number[] = [];
    const recovered: number[] = [];
    const cache = new CachedStores(port, createDefaultStoreFiles('1.1.8-stable'), {
      schedule: clock.schedule,
      onWriteError: (_store, _error, attempt) => errors.push(attempt),
      onWriteRecovered: (_store, attempts) => recovered.push(attempts)
    });
    await cache.hydrate();

    port.failing = 2;
    cache.set('listeningData', [{ songId: 'a', listens: [] }]);
    await settle();
    // The failure is reported, with its cause, and a retry is waiting.
    await expect(cache.flush('listeningData')).rejects.toThrow(/being used by another process/u);
    await expect(cache.flush('listeningData')).rejects.toBeInstanceOf(StoreWriteError);
    expect(clock.size()).toBe(1);

    // A listen recorded while the file is held is not lost: it rides on the retry.
    cache.set('listeningData', [
      { songId: 'a', listens: [] },
      { songId: 'b', listens: [] }
    ]);
    clock.runNext();
    await settle();
    expect(errors).toEqual([1, 2]);
    clock.runNext();
    await settle();

    await expect(cache.flush('listeningData')).resolves.toBeUndefined();
    expect(port.files.get('listeningData')?.payload).toEqual([
      { songId: 'a', listens: [] },
      { songId: 'b', listens: [] }
    ]);
    expect(recovered).toEqual([2]);
    expect(clock.size()).toBe(0);
  });

  test('the waits grow and then repeat for as long as the failure lasts', async () => {
    const port = new FlakyPort();
    const clock = manualClock();
    const cache = new CachedStores(port, createDefaultStoreFiles('1.1.8-stable'), {
      schedule: clock.schedule
    });
    await cache.hydrate();
    port.failing = 7;
    cache.set('playlists', []);
    const asked: number[] = [];
    for (let round = 0; round < 7; round += 1) {
      await settle();
      asked.push(...clock.delays());
      clock.runNext();
    }
    expect(asked).toEqual([250, 1_000, 3_000, 10_000, 30_000, 30_000, 30_000]);
  });

  test('other stores keep writing while one is failing', async () => {
    const port = new FlakyPort();
    const clock = manualClock();
    const cache = new CachedStores(port, createDefaultStoreFiles('1.1.8-stable'), {
      schedule: clock.schedule
    });
    await cache.hydrate();
    port.failing = 1;
    cache.set('playlists', [{ playlistId: 'x' }]);
    await settle();
    cache.set('songs', [{ songId: 's' }]);
    await cache.flush('songs');
    expect(port.files.get('songs')?.payload).toEqual([{ songId: 's' }]);
  });

  test('a sealed cache does not retry; unsealing picks the retry up again', async () => {
    const port = new FlakyPort();
    const clock = manualClock();
    const cache = new CachedStores(port, createDefaultStoreFiles('1.1.8-stable'), {
      schedule: clock.schedule
    });
    await cache.hydrate();
    port.failing = 1;
    cache.set('playlists', [{ playlistId: 'x' }]);
    await settle();
    cache.seal();
    clock.runNext();
    await settle();
    expect(port.files.has('playlists')).toBe(false);

    cache.unseal();
    expect(clock.size()).toBe(1);
    clock.runNext();
    await settle();
    await cache.flush('playlists');
    expect(port.files.get('playlists')?.payload).toEqual([{ playlistId: 'x' }]);
  });
});

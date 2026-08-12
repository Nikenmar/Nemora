import { describe, expect, test } from '@jest/globals';

import { isConnectedToInternet } from '../isOnline';

const setNavigatorOnline = (value: boolean) => {
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: value },
    configurable: true,
    writable: true
  });
};

describe('isConnectedToInternet', () => {
  test('reports the browser online state', () => {
    setNavigatorOnline(true);
    expect(isConnectedToInternet()).toBe(true);

    setNavigatorOnline(false);
    expect(isConnectedToInternet()).toBe(false);
  });

  test('assumes online when no navigator exists (tests, workers)', () => {
    const previous = globalThis.navigator;
    Object.defineProperty(globalThis, 'navigator', { value: undefined, configurable: true });

    expect(isConnectedToInternet()).toBe(true);

    Object.defineProperty(globalThis, 'navigator', { value: previous, configurable: true });
    expect(isConnectedToInternet()).toBe(previous ? (previous as Navigator).onLine : true);
  });
});

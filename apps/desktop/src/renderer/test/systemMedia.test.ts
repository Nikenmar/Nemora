import { beforeEach, describe, expect, it } from 'vitest';
import { updateSystemMedia } from '@renderer/other/systemMedia';
import { apiCalls } from './setup';

/** Windows' media controls: a song with no title yet (the player's empty start) clears them. */
const sent = () =>
  apiCalls.filter((c) => c.path === 'invoke.smtc_update').map((c) => (c.args[0] as { now: unknown }).now);
const state = { duration: 200, position: 10, playing: true };
const fallbacks = { artist: 'Unknown artist', album: 'Unknown album' };

describe('Windows media controls', () => {
  beforeEach(() => {
    apiCalls.length = 0;
  });

  it('sends the playing song', () => {
    updateSystemMedia({ title: 'Reverie', artists: [{ artistId: 'a', name: 'Mika Nakashima' }], album: undefined, artworkPath: 'x' } as never, state, fallbacks);
    expect(sent()).toEqual([
      { title: 'Reverie', artist: 'Mika Nakashima', album: 'Unknown album', artwork: 'x', duration: 200, position: 10, playing: true }
    ]);
  });

  it('clears them for the empty song the player starts with, instead of a call Rust refuses', () => {
    updateSystemMedia({} as never, state, fallbacks);
    updateSystemMedia(undefined, state, fallbacks);
    expect(sent()).toEqual([null, null]);
  });
});

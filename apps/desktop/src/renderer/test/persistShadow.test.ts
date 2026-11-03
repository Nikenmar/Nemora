import '@renderer/store';
import { describe, expect, it } from 'vitest';
import { SLICES, canonical, compareSlices } from '@renderer/other/persistShadow';

/** PLAN/21 P21.4: the shadow read's comparison of the core's copy with the view's blob. */
const blob = () =>
  ({
    preferences: { b: 1, a: [1, 2, { y: 2, x: 1 }] },
    playback: { currentSong: { songId: 's2', stoppedPosition: 12.5 } },
    queue: { currentSongIndex: 1, queue: ['s1', 's2:3', 's3'], queueType: 'songs' },
    ignoredSeparateArtists: [],
    ignoredSongsWithFeatArtists: [],
    ignoredDuplicates: { albums: [], artists: [], genres: [] },
    sortingStates: {},
    equalizerPreset: { thirtyTwoHertzFilter: 0 },
    lyricsEditorSettings: { offset: 0 },
    duels: { history: [] }
  }) as unknown as LocalStorage;

const coreOf = (b: LocalStorage) => ({
  ...Object.fromEntries(SLICES.map((s) => [s, JSON.parse(JSON.stringify(b[s]))])),
  coreQueue: { songIds: ['s1', 's2', 's3'], index: 1, positionMs: 12500 }
});

describe('persist shadow', () => {
  it('keys in any order are the same JSON', () => {
    expect(canonical({ b: 1, a: { d: 1, c: [{ z: 1, y: 2 }] } })).toBe(canonical({ a: { c: [{ y: 2, z: 1 }], d: 1 }, b: 1 }));
    expect(canonical([1, 2])).not.toBe(canonical([2, 1]));
  });

  it('a core copy equal to the blob shows nothing', () => {
    const b = blob();
    expect(compareSlices(b, coreOf(b))).toEqual([]);
  });

  it('every differing or missing slice is named', () => {
    const b = blob();
    const core = coreOf(b) as Record<string, unknown>;
    (core.preferences as Record<string, unknown>).b = 2;
    delete core.duels;
    core.coreQueue = { songIds: ['s1', 's3'], index: 1, positionMs: 0 };
    const found = compareSlices(b, core).map((d) => d.slice);
    expect(found).toEqual(['preferences', 'duels', 'queue_items']);
  });
});

import { describe, expect, test } from '@jest/globals';

import { pathArtwork } from '../artworkSource';
import { DEFAULT_SONG_PALETTE, PaletteGenerator, type PaletteExtractor } from '../palette';

describe('browser Vibrant palette adapter', () => {
  test('preserves the 10-letter palette ID and exact legacy swatch rounding', async () => {
    const extractor: PaletteExtractor = {
      extract: async () => ({
        Vibrant: {
          hex: '#123456',
          hsl: [0.123456, 0.654321, 0.456789],
          population: 17
        },
        DarkMuted: null
      })
    };
    const generator = new PaletteGenerator(
      extractor,
      undefined,
      () => 'AbCdEfGhIj',
      (path) => `nemora://fixture/${encodeURIComponent(path)}`
    );

    const palette = await generator.generate(pathArtwork('E:\\tmp\\cover.webp'));

    expect(palette).toEqual({
      paletteId: 'AbCdEfGhIj',
      Vibrant: { hex: '#123456', hsl: [0.123, 0.654, 0.457], population: 17 },
      LightVibrant: undefined,
      DarkVibrant: undefined,
      Muted: undefined,
      LightMuted: undefined,
      DarkMuted: undefined
    });
  });

  test('uses the unchanged default palette only when artwork is absent', async () => {
    const generator = new PaletteGenerator({
      extract: async () => {
        throw new Error('extractor must not run');
      }
    });

    await expect(generator.generate()).resolves.toBe(DEFAULT_SONG_PALETTE);
  });
});

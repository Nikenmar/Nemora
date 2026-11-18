import { describe, expect, it } from 'vitest';
import { accentTokens, coverAccentTokens } from '../src/other/accentPalette';
import { coverToneOf } from '../src/other/coverTone';

const luminance = ([r, g, b]: number[]) => {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const contrastWithWhite = (rgb: number[]) => 1.05 / (luminance(rgb) + 0.05);

const pixels = (rgb: [number, number, number]) => {
  const data = new Uint8ClampedArray(32 * 32 * 4);
  for (let i = 0; i < data.length; i += 4) data.set([...rgb, 255], i);
  return data;
};

describe('the accent from the cover', () => {
  it('is graphite for a grey cover and the preset itself at the preset hue', () => {
    for (const theme of ['light', 'dark'] as const) {
      expect(coverAccentTokens({ hue: 0, vividness: 0 }, theme)).toEqual(accentTokens('graphite', theme));
      expect(coverAccentTokens({ hue: 300, vividness: 1 }, theme)).toEqual(accentTokens('violet', theme));
    }
  });

  it('keeps white text readable on the accent at every hue and colourfulness', () => {
    let lowest = Infinity;
    for (const theme of ['light', 'dark'] as const) {
      for (let hue = 0; hue < 360; hue += 5) {
        for (const vividness of [0, 0.3, 0.6, 1]) {
          const { accent } = coverAccentTokens({ hue, vividness }, theme);
          lowest = Math.min(lowest, contrastWithWhite(accent));
        }
      }
    }
    expect(lowest).toBeGreaterThan(7);
  });

  it('reads a grey cover as no colour and a red one as a vivid red', () => {
    expect(coverToneOf(pixels([128, 128, 128]))?.accent.vividness).toBe(0);
    const red = coverToneOf(pixels([200, 30, 40]))?.accent;
    expect(red?.vividness).toBe(1);
    // OKLCH red sits near 25 degrees.
    expect(red!.hue).toBeGreaterThan(10);
    expect(red!.hue).toBeLessThan(40);
  });
});

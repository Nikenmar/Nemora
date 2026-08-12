import { convertFileSrc } from '@tauri-apps/api/core';
import { Vibrant } from 'node-vibrant/browser';

import type { ArtworkSource } from './artworkSource';
import type { ArtworkLogger } from './logger';
import { silentArtworkLogger } from './logger';
import { generatePaletteId } from './randomId';

interface VibrantSwatchLike {
  hex: string;
  hsl: [number, number, number];
  population: number;
}

interface VibrantPaletteLike {
  DarkMuted?: VibrantSwatchLike | null;
  DarkVibrant?: VibrantSwatchLike | null;
  LightMuted?: VibrantSwatchLike | null;
  LightVibrant?: VibrantSwatchLike | null;
  Muted?: VibrantSwatchLike | null;
  Vibrant?: VibrantSwatchLike | null;
}

export interface PaletteExtractor {
  extract(sourceUrl: string): Promise<VibrantPaletteLike>;
}

export class BrowserVibrantPaletteExtractor implements PaletteExtractor {
  async extract(sourceUrl: string): Promise<VibrantPaletteLike> {
    return (await Vibrant.from(sourceUrl).getPalette()) as VibrantPaletteLike;
  }
}

export const DEFAULT_SONG_PALETTE: PaletteData = {
  paletteId: 'DEFAULT_PALETTE',
  DarkMuted: { hex: '#104888', hsl: [0.589, 0.789, 0.3], population: 0 },
  DarkVibrant: { hex: '#0d3e76', hsl: [0.589, 0.789, 0.26], population: 0 },
  LightMuted: { hex: '#154383', hsl: [0.597, 0.716, 0.3], population: 0 },
  LightVibrant: { hex: '#8cb4ec', hsl: [0.597, 0.716, 0.737], population: 8 },
  Muted: { hex: '#104888', hsl: [0.589, 0.789, 0.3], population: 0 },
  Vibrant: { hex: '#3c8ce8', hsl: [0.589, 0.789, 0.576], population: 2 }
};

const roundTo = (value: number, decimalPlaces: number): number => {
  const power = 10 ** decimalPlaces;
  const adjusted = parseFloat((value * power).toFixed(decimalPlaces - 1));
  return parseFloat((Math.round(adjusted) / power).toFixed(decimalPlaces));
};

const convertSwatch = (
  swatch: VibrantSwatchLike | null | undefined
): NodeVibrantPaletteSwatch | undefined => {
  if (!swatch || !Array.isArray(swatch.hsl)) return undefined;
  const [h, s, l] = swatch.hsl;
  return {
    population: swatch.population,
    hex: swatch.hex,
    hsl: [roundTo(h, 3), roundTo(s, 3), roundTo(l, 3)]
  };
};

export class PaletteGenerator {
  private readonly extractor: PaletteExtractor;
  private readonly logger: ArtworkLogger;
  private readonly createId: () => string;
  private readonly pathToUrl: (path: string) => string;

  constructor(
    extractor: PaletteExtractor = new BrowserVibrantPaletteExtractor(),
    logger: ArtworkLogger = silentArtworkLogger,
    createId: () => string = generatePaletteId,
    pathToUrl: (path: string) => string = (path) => convertFileSrc(path, 'nemora')
  ) {
    this.extractor = extractor;
    this.logger = logger;
    this.createId = createId;
    this.pathToUrl = pathToUrl;
  }

  async generate(source?: ArtworkSource): Promise<PaletteData | undefined> {
    if (!source) return DEFAULT_SONG_PALETTE;

    let objectUrl: string | undefined;
    try {
      if (source.kind === 'blob') objectUrl = URL.createObjectURL(source.blob);
      const sourceUrl =
        source.kind === 'path'
          ? this.pathToUrl(source.path)
          : source.kind === 'url'
            ? source.url
            : objectUrl;
      if (!sourceUrl) throw new Error('failed to create an artwork URL for palette extraction');

      const palette = await this.extractor.extract(sourceUrl);
      return {
        paletteId: this.createId(),
        Vibrant: convertSwatch(palette.Vibrant),
        LightVibrant: convertSwatch(palette.LightVibrant),
        DarkVibrant: convertSwatch(palette.DarkVibrant),
        Muted: convertSwatch(palette.Muted),
        LightMuted: convertSwatch(palette.LightMuted),
        DarkMuted: convertSwatch(palette.DarkMuted)
      };
    } catch (error) {
      this.logger.error('Failed to parse artwork to get a color palette.', { error });
      return undefined;
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    }
  }
}

import { readCoverTone } from './coverTone';

/**
 * Cover light: the playing song's cover tones, set as `--cover-glow` (primary) and `--cover-glow-2`
 * (secondary) on the document. The page glow, the player tint and the Hero backgrounds read them; they
 * change per song and crossfade (registered `@property`s in styles.css).
 *
 * The tones come from the cover's own pixels (other/coverTone.ts, the Android app's algorithm), so a
 * grey cover gives grey light instead of an invented hue and a pastel one a muted tone.
 *
 * `coverGlow` below, from a stored palette, is kept for the genre tiles, which have no single cover
 * to read at the moment they draw.
 */

const GLOW_LIGHTNESS = 0.35;
const GLOW_MAX_CHROMA = 0.12;

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function hexToOklch(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16);
  const r = toLinear(((n >> 16) & 255) / 255);
  const g = toLinear(((n >> 8) & 255) / 255);
  const b = toLinear((n & 255) / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), (Math.atan2(B, A) * 180) / Math.PI];
}

function oklchToLinear(L: number, C: number, H: number): [number, number, number] {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  ];
}

const inGamut = (rgb: number[]) => rgb.every((c) => c >= -0.0005 && c <= 1.0005);

/** The glow colour for a cover palette, as `rgb(r g b)`; null without a usable swatch. */
export function coverGlow(palette?: NodeVibrantPalette | null): string | null {
  const swatch = palette?.DarkVibrant ?? palette?.Vibrant ?? palette?.Muted;
  if (!swatch?.hex) return null;
  const [, chroma, hue] = hexToOklch(swatch.hex);
  let c = Math.min(chroma, GLOW_MAX_CHROMA);
  // Pull the chroma in until the colour exists on an sRGB screen.
  while (c > 0 && !inGamut(oklchToLinear(GLOW_LIGHTNESS, c, hue))) c -= 0.005;
  const rgb = oklchToLinear(GLOW_LIGHTNESS, Math.max(c, 0), hue).map((v) =>
    Math.round(Math.min(1, Math.max(0, toGamma(Math.min(1, Math.max(0, v))))) * 255)
  );
  return `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})`;
}

let request = 0;

const clear = () => {
  const root = document.documentElement;
  root.style.removeProperty('--cover-glow');
  root.style.removeProperty('--cover-glow-2');
};

/**
 * Sets the cover light from the cover at `artworkPath`, or clears it without one; returns the
 * function that clears it. Reading is asynchronous, so only the latest call may set the colours.
 */
export function applyCoverLight(artworkPath?: string | null): () => void {
  const ticket = ++request;
  if (!artworkPath) clear();
  else
    readCoverTone(artworkPath)
      .then((tone) => {
        if (ticket !== request) return undefined;
        if (!tone) return clear();
        const root = document.documentElement;
        root.style.setProperty('--cover-glow', tone.primary);
        root.style.setProperty('--cover-glow-2', tone.secondary);
        return undefined;
      })
      .catch(() => ticket === request && clear());
  return () => {
    if (ticket === request) {
      request++;
      clear();
    }
  };
}

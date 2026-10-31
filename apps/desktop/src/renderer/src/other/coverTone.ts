/**
 * The cover's colours, read from its own pixels in OKLab: a port of the Android app's CoverTone
 * (apps/android/.../ui/theme/CoverTone.kt), kept step for step so both apps light a cover alike.
 * `primary` washes the top of the page and the player, `secondary` lights the far corner, `light` is
 * the cover's colour as a light.
 *
 * A cover is as colourful as its pixels are, not as its most vivid detail: a white or a black-and-
 * silver cover gives a grey as light as the cover is, a colourful one a deep tone of the hue that
 * covers most of it.
 */

export interface CoverTone {
  primary: string;
  secondary: string;
  light: string;
}

const SIDE = 32;
const BINS = 36;

const cache = new Map<string, CoverTone | null>();
const CACHE_SIZE = 96;

const toLinear = (channel: number) => {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

const toSrgb = (linear: number) => {
  const c = Math.min(1, Math.max(0, linear));
  return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
};

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const degrees = (radians: number) => (radians * 180) / Math.PI;
const circular = (a: number, b: number) => Math.min(Math.abs(a - b), BINS - Math.abs(a - b));

function oklab(r8: number, g8: number, b8: number): [number, number, number] {
  const r = toLinear(r8);
  const g = toLinear(g8);
  const b = toLinear(b8);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  ];
}

/** OKLCH to `rgb(r g b)`, giving up chroma until the colour fits the screen's gamut. */
function oklch(l: number, chroma: number, hue: number): string {
  let c = chroma;
  for (;;) {
    const h = (hue * Math.PI) / 180;
    const a = c * Math.cos(h);
    const b = c * Math.sin(h);
    const l1 = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m1 = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s1 = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
    const rgb = [
      4.0767416621 * l1 - 3.3077115913 * m1 + 0.2309699292 * s1,
      -1.2684380046 * l1 + 2.6097574011 * m1 - 0.3413193965 * s1,
      -0.0041960863 * l1 - 0.7034186147 * m1 + 1.707614701 * s1
    ];
    const fits = rgb.every((v) => v >= -0.001 && v <= 1.001);
    if (fits || c < 0.005) {
      const [r, g, bl] = rgb.map((v) => Math.round(toSrgb(v) * 255));
      return `rgb(${r} ${g} ${bl})`;
    }
    c *= 0.9;
  }
}

const grey = (l: number) => oklch(l, 0, 0);

/** A deep yellow reads as olive: yellows deepen towards amber, as dark gold does. */
function deepHue(hue: number) {
  const h = (hue + 360) % 360;
  return h >= 80 && h <= 115 ? 62 + (h - 80) * 0.3 : h;
}

/** The tone of a cover given as RGBA pixels (canvas ImageData order). */
export function coverToneOf(pixels: Uint8ClampedArray): CoverTone | null {
  const weights = new Float64Array(BINS);
  const sumA = new Float64Array(BINS);
  const sumB = new Float64Array(BINS);
  const sumC = new Float64Array(BINS);
  let colour = 0;
  let light = 0;
  let count = 0;
  let meanA = 0;
  let meanB = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue;
    const [l, a, b] = oklab(pixels[i], pixels[i + 1], pixels[i + 2]);
    const c = Math.hypot(a, b);
    count++;
    light += l;
    meanA += a;
    meanB += b;
    // A pixel is colour by its chroma, less so near black and white where hue is noise.
    const w = Math.max(0, c - 0.03) * (1 - Math.abs(l - 0.6) * 0.8);
    if (w <= 0) continue;
    colour += Math.min(1, w / 0.08);
    const bin = Math.min(
      BINS - 1,
      Math.max(0, Math.floor((((degrees(Math.atan2(b, a)) + 360) % 360) / 360) * BINS))
    );
    weights[bin] += w;
    sumA[bin] += a * w;
    sumB[bin] += b * w;
    sumC[bin] += c * w;
  }
  if (count === 0) return null;
  const colourful = colour / count;
  const meanLight = light / count;
  // How much of the tone is hue: none for a cover with only specks of colour, all of it from 16%.
  const amount = smoothstep(0.04, 0.16, colourful);
  // A grey as light as the cover: a white cover gives silver, a black one a near black.
  const greyLight = 0.22 + 0.58 * Math.min(1, Math.max(0, (meanLight - 0.2) / 0.6));
  const smooth = Array.from(
    { length: BINS },
    (_, i) => weights[(i + BINS - 1) % BINS] * 0.5 + weights[i] + weights[(i + 1) % BINS] * 0.5
  );
  const first = smooth.reduce((best, value, i) => (value > smooth[best] ? i : best), 0);
  if (amount <= 0 || smooth[first] <= 0) {
    return { primary: grey(greyLight), secondary: grey(greyLight * 0.72), light: grey(0.72) };
  }
  let second: number | undefined;
  smooth.forEach((value, i) => {
    if (circular(i, first) >= 5 && value >= smooth[first] * 0.35) {
      if (second === undefined || value > smooth[second]) second = i;
    }
  });

  const cluster = (peak: number): [number, number] => {
    let a = 0;
    let b = 0;
    let c = 0;
    let w = 0;
    for (let d = -1; d <= 1; d++) {
      const i = (peak + d + BINS) % BINS;
      a += sumA[i];
      b += sumB[i];
      c += sumC[i];
      w += weights[i];
    }
    return [(degrees(Math.atan2(b, a)) + 360) % 360, c / w];
  };

  // A light cover gives a lighter tone, a dark one a deeper one.
  const colourLight = Math.max(0.28, 0.36 + (meanLight - 0.5) * 0.4);
  const l = lerp(greyLight, colourLight, amount);
  // How much the cover's colours agree: the chroma of its average colour. A pastel cover of blue sky,
  // pink and white averages to nearly grey, so its loudest hue is given muted (a slate, not navy).
  const agree = 0.25 + 0.75 * smoothstep(0.015, 0.06, Math.hypot(meanA / count, meanB / count));
  const strength = amount * agree;
  const [hue, chroma] = cluster(first);
  const primary = oklch(l, Math.min(chroma, 0.13) * strength, deepHue(hue));
  let secondary: string;
  if (second !== undefined) {
    const [hue2, chroma2] = cluster(second);
    secondary = oklch(l * 0.92, Math.min(chroma2, 0.13) * strength, deepHue(hue2));
  } else {
    // One colour: its neighbour on the wheel, a shade deeper, gives the corner some depth.
    secondary = oklch(l * 0.85, Math.min(chroma, 0.13) * strength, deepHue(hue + 22));
  }
  return { primary, secondary, light: oklch(0.72, Math.min(chroma, 0.16) * strength, hue) };
}

function loadPixels(url: string): Promise<Uint8ClampedArray | null> {
  return new Promise((resolve) => {
    const image = new Image();
    // The artwork protocol answers with permissive CORS, so the canvas stays readable.
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = SIDE;
        canvas.height = SIDE;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) return resolve(null);
        context.imageSmoothingQuality = 'high';
        context.drawImage(image, 0, 0, SIDE, SIDE);
        return resolve(context.getImageData(0, 0, SIDE, SIDE).data);
      } catch {
        return resolve(null);
      }
    };
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

/** The tone of the cover at `url`, read from a 32 px copy of it; null when it cannot be read. */
export async function readCoverTone(url: string): Promise<CoverTone | null> {
  if (cache.has(url)) {
    const tone = cache.get(url) ?? null;
    // Most recently used last.
    cache.delete(url);
    cache.set(url, tone);
    return tone;
  }
  const pixels = await loadPixels(url);
  const tone = pixels ? coverToneOf(pixels) : null;
  cache.set(url, tone);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value as string);
  return tone;
}

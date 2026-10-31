/**
 * The accent colour. Blue is the design's own and needs nothing: styles.css carries it. Every other
 * choice is the same palette turned to another hue: each accent token (accent, its hover, its soft
 * wash, the echo) keeps blue's lightness and chroma in OKLCH and only rotates, so a violet or a teal
 * sits exactly where the blue sat, as deep, as loud, and as readable (white on every accent stays
 * above 8.5:1, every echo above 6:1 on the dark canvas). Graphite drops the chroma altogether.
 *
 * The result goes into one constructed stylesheet with doubled selectors, so it outranks both themes'
 * own tokens (`:root, .light` and `.dark` in styles.css) without touching the stylesheet. Not a
 * <style> element: Tauri puts a nonce on its own style tags, and with a nonce in the CSP the
 * browser ignores 'unsafe-inline', so a script-made <style> is dropped without a word. CSSOM is not
 * subject to style-src. */

export type AccentId = 'blue' | 'violet' | 'pink' | 'red' | 'orange' | 'green' | 'teal' | 'graphite';

/** In the order the picker shows them. `hue` is the accent's OKLCH hue; null is colourless. */
export const ACCENT_PRESETS: { id: AccentId; hue: number | null }[] = [
  { id: 'blue', hue: 264 },
  { id: 'violet', hue: 300 },
  { id: 'pink', hue: 345 },
  { id: 'red', hue: 25 },
  { id: 'orange', hue: 50 },
  { id: 'green', hue: 150 },
  { id: 'teal', hue: 190 },
  { id: 'graphite', hue: null }
];

export const DEFAULT_ACCENT: AccentId = 'blue';

type Rgb = [number, number, number];
type Tokens = Record<'accent' | 'accent-hover' | 'accent-soft' | 'echo', Rgb>;

/** The blue tokens exactly as styles.css declares them; the other accents are turned from these. */
const BLUE: Record<'light' | 'dark', Tokens> = {
  light: {
    accent: [29, 64, 148],
    'accent-hover': [16, 49, 132],
    'accent-soft': [216, 221, 234],
    echo: [29, 64, 148]
  },
  dark: {
    accent: [29, 64, 148],
    'accent-hover': [42, 79, 164],
    'accent-soft': [20, 33, 68],
    echo: [99, 151, 241]
  }
};

const toLinear = (channel: number) => {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

const toSrgb = (linear: number) => {
  const c = Math.min(1, Math.max(0, linear));
  return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
};

function toOklch([r8, g8, b8]: Rgb): [number, number, number] {
  const r = toLinear(r8);
  const g = toLinear(g8);
  const b = toLinear(b8);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360];
}

/** OKLCH to sRGB, giving up chroma until the colour exists on screen. */
function fromOklch(L: number, chroma: number, hue: number): Rgb {
  let c = chroma;
  for (;;) {
    const h = (hue * Math.PI) / 180;
    const a = c * Math.cos(h);
    const b = c * Math.sin(h);
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    const linear = [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
    ];
    if (linear.every((v) => v >= -0.0005 && v <= 1.0005) || c < 0.002) {
      return linear.map((v) => Math.round(toSrgb(v) * 255)) as Rgb;
    }
    c -= 0.002;
  }
}

const BLUE_HUE = toOklch(BLUE.dark.accent)[2];

/** One theme's accent tokens for a preset. */
export function accentTokens(id: AccentId, theme: 'light' | 'dark'): Tokens {
  const preset = ACCENT_PRESETS.find((p) => p.id === id) ?? ACCENT_PRESETS[0];
  if (preset.id === 'blue') return BLUE[theme];
  const turn = (rgb: Rgb): Rgb => {
    const [L, C, H] = toOklch(rgb);
    return preset.hue === null ? fromOklch(L, 0, 0) : fromOklch(L, C, (H + preset.hue - BLUE_HUE + 360) % 360);
  };
  const blue = BLUE[theme];
  return {
    accent: turn(blue.accent),
    'accent-hover': turn(blue['accent-hover']),
    'accent-soft': turn(blue['accent-soft']),
    echo: turn(blue.echo)
  };
}

let sheet: CSSStyleSheet | null = null;

const declarations = (tokens: Tokens) =>
  Object.entries(tokens)
    .map(([name, rgb]) => `--${name}: ${rgb.join(' ')};`)
    .join(' ');

/** Applies the chosen accent to the whole app; blue (or an unknown id) clears the override. */
export function applyAccent(id?: string | null) {
  const preset = ACCENT_PRESETS.find((p) => p.id === id);
  if (!sheet) {
    sheet = new CSSStyleSheet();
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  }
  sheet.replaceSync(
    !preset || preset.id === DEFAULT_ACCENT
      ? ''
      : `:root:root, .light.light { ${declarations(accentTokens(preset.id, 'light'))} }
.dark.dark { ${declarations(accentTokens(preset.id, 'dark'))} }`
  );
}

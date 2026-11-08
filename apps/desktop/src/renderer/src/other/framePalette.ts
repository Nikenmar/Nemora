/**
 * The dark theme's frame (title bar, sidebar, player), a shade the user picks. Black is the design's
 * own and needs nothing: styles.css carries it. The light theme's frame is white and is not offered
 * this.
 *
 * The shades go from the design's near-black to a neutral grey, and stop where the frame's dimmest
 * text is still readable. As with the accent, a constructed stylesheet with doubled selectors
 * outranks the theme's own token; a script-made <style> would be dropped by the CSP
 * (other/accentPalette.ts says why).
 */

export type FrameShadeId = 'black' | 'charcoal' | 'graphite' | 'grey' | 'lightGrey';

/** In the order the picker shows them, darkest first. */
export const FRAME_SHADES: { id: FrameShadeId; rgb: [number, number, number] }[] = [
  { id: 'black', rgb: [8, 9, 12] },
  { id: 'charcoal', rgb: [14, 15, 19] },
  { id: 'graphite', rgb: [21, 22, 26] },
  { id: 'grey', rgb: [29, 30, 33] },
  { id: 'lightGrey', rgb: [38, 39, 42] }
];

export const DEFAULT_FRAME_SHADE: FrameShadeId = 'black';

let sheet: CSSStyleSheet | null = null;

/** Applies the chosen shade to the dark theme; black (or an unknown id) clears the override. */
export function applyFrameShade(id?: string | null) {
  const shade = FRAME_SHADES.find((s) => s.id === id);
  if (!sheet) {
    sheet = new CSSStyleSheet();
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  }
  sheet.replaceSync(
    !shade || shade.id === DEFAULT_FRAME_SHADE ? '' : `.dark.dark { --chrome: ${shade.rgb.join(' ')}; }`
  );
}

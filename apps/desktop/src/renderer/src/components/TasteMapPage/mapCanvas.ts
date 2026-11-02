/**
 * The taste map's drawing (PLAN/17): a camera over the map's 0..1 square, a grid index for hit
 * tests, the density terrain with contour lines (computed once per map), the dots in six colour
 * modes, covers at close zoom, atlas labels for islands, and the overlay (hover links, trail, the
 * queue's route, the lasso). Pure functions over a 2D context; the page owns state and events.
 */

import type { Island_Serialize, Point_Serialize, TasteMap_Serialize } from '@platform/ipc';

// The core's map (generated from Rust).
export type MapPoint = Point_Serialize;
export type MapIsland = Island_Serialize;
export type TasteMapData = TasteMap_Serialize;

export type ColourMode = 'cover' | 'island' | 'tier' | 'shuffle' | 'fresh' | 'energy';
export const COLOUR_MODES: ColourMode[] = ['cover', 'island', 'shuffle', 'tier', 'fresh', 'energy'];

export const LINK_SESSION = 1;
export const LINK_ARTIST = 2;
export const LINK_TIER = 4;

/** Screen = offset + world * k. */
export type Camera = { k: number; ox: number; oy: number };

export const PAD = 28;
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 40;

export const fitCamera = (width: number, height: number): Camera => {
  const k = Math.max(1, Math.min(width, height) - PAD * 2);
  return { k, ox: (width - k) / 2, oy: (height - k) / 2 };
};

/** Zoom by `factor` keeping the world point under (sx, sy) where it is, within the zoom limits. */
export const zoomAt = (camera: Camera, fit: Camera, sx: number, sy: number, factor: number): Camera => {
  const k = Math.min(fit.k * MAX_ZOOM, Math.max(fit.k * MIN_ZOOM, camera.k * factor));
  const f = k / camera.k;
  return { k, ox: sx - (sx - camera.ox) * f, oy: sy - (sy - camera.oy) * f };
};

/** A camera centred on world (x, y) at zoom `k`. */
export const centreOn = (x: number, y: number, k: number, width: number, height: number): Camera => ({
  k,
  ox: width / 2 - x * k,
  oy: height / 2 - y * k
});

export const lerpCamera = (a: Camera, b: Camera, t: number): Camera => {
  // Zoom moves in log space, so a fly-in feels even.
  const k = Math.exp(Math.log(a.k) + (Math.log(b.k) - Math.log(a.k)) * t);
  // Keep the world point at the screen centre moving linearly.
  return { k, ox: a.ox + (b.ox - a.ox) * t, oy: a.oy + (b.oy - a.oy) * t };
};

/** How much bigger than the fitted map the view is: 1 when fitted. */
export const zoomOf = (camera: Camera, fit: Camera) => camera.k / fit.k;

/** A dot's radius on screen: larger for songs Smart Shuffle favours, growing a little with zoom. */
export const radiusOf = (p: MapPoint, zoom: number) => (2 + 4.5 * p.weight) * Math.min(2.4, Math.max(1, Math.sqrt(zoom)));

/** Points by cell of a GRID x GRID world grid, for hit tests and lassos. */
export type GridIndex = { size: number; cells: number[][] };

export const buildIndex = (points: MapPoint[], size = 64): GridIndex => {
  const cells: number[][] = Array.from({ length: size * size }, () => []);
  points.forEach((p, i) => {
    const cx = Math.min(size - 1, Math.max(0, Math.floor(p.x * size)));
    const cy = Math.min(size - 1, Math.max(0, Math.floor(p.y * size)));
    cells[cy * size + cx].push(i);
  });
  return { size, cells };
};

/** The point nearest the screen position within `reach` px of its edge, or -1. */
export const hitTest = (
  points: MapPoint[],
  index: GridIndex,
  camera: Camera,
  zoom: number,
  sx: number,
  sy: number,
  reach = 8
): number => {
  const wx = (sx - camera.ox) / camera.k;
  const wy = (sy - camera.oy) / camera.k;
  const worldReach = (reach + 12) / camera.k;
  const { size, cells } = index;
  const x0 = Math.max(0, Math.floor((wx - worldReach) * size));
  const x1 = Math.min(size - 1, Math.floor((wx + worldReach) * size));
  const y0 = Math.max(0, Math.floor((wy - worldReach) * size));
  const y1 = Math.min(size - 1, Math.floor((wy + worldReach) * size));
  let best = -1;
  let bestDistance = reach;
  for (let cy = y0; cy <= y1; cy += 1) {
    for (let cx = x0; cx <= x1; cx += 1) {
      for (const i of cells[cy * size + cx]) {
        const p = points[i];
        const d = Math.hypot(camera.ox + p.x * camera.k - sx, camera.oy + p.y * camera.k - sy) - radiusOf(p, zoom);
        if (d < bestDistance) {
          bestDistance = d;
          best = i;
        }
      }
    }
  }
  return best;
};

/** Indices of points inside a polygon given in world coordinates. */
export const insidePolygon = (points: MapPoint[], polygon: { x: number; y: number }[]): number[] => {
  if (polygon.length < 3) return [];
  const out: number[] = [];
  points.forEach((p, i) => {
    let inside = false;
    for (let a = 0, b = polygon.length - 1; a < polygon.length; b = a, a += 1) {
      const [pa, pb] = [polygon[a], polygon[b]];
      if (pa.y > p.y !== pb.y > p.y && p.x < ((pb.x - pa.x) * (p.y - pa.y)) / (pb.y - pa.y) + pa.x) inside = !inside;
    }
    if (inside) out.push(i);
  });
  return out;
};

/** The theme's colours, read from the design tokens. */
export type Palette = {
  ink: string;
  inkDim: string;
  inkFaint: string;
  accent: string;
  surface1: string;
  surface2: string;
  surface3: string;
  line: string;
  isDark: boolean;
};

const rgb = (style: CSSStyleDeclaration, name: string, alpha = 1) => {
  const v = style.getPropertyValue(name).trim().replace(/\s+/g, ', ');
  return alpha === 1 ? `rgb(${v})` : `rgba(${v}, ${alpha})`;
};

export const readPalette = (element: Element): Palette => {
  const style = getComputedStyle(element);
  const surface = style.getPropertyValue('--surface-1').trim().split(/\s+/).map(Number);
  return {
    ink: rgb(style, '--ink'),
    inkDim: rgb(style, '--ink-dim'),
    inkFaint: rgb(style, '--ink-faint'),
    accent: rgb(style, '--accent'),
    surface1: rgb(style, '--surface-1'),
    surface2: rgb(style, '--surface-2'),
    surface3: rgb(style, '--surface-3'),
    line: rgb(style, '--line'),
    isDark: (surface[0] ?? 0) + (surface[1] ?? 0) + (surface[2] ?? 0) < 384
  };
};

/** The island's hue: spread by the golden angle so neighbours in the list differ. */
export const islandColour = (island: number, palette: Palette, alpha = 1) =>
  `hsla(${Math.round((island * 137.508) % 360)}, ${palette.isDark ? 58 : 52}%, ${palette.isDark ? 62 : 44}%, ${alpha})`;

const mix = (a: [number, number, number], b: [number, number, number], t: number) =>
  `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)}, ${Math.round(a[1] + (b[1] - a[1]) * t)}, ${Math.round(a[2] + (b[2] - a[2]) * t)})`;

const COOL: [number, number, number] = [86, 118, 168];
const WARM: [number, number, number] = [236, 128, 64];
const CALM: [number, number, number] = [70, 140, 200];
const LOUD: [number, number, number] = [226, 72, 86];

/** Days since the epoch now, local. */
export const today = () => Math.floor((Date.now() - new Date().getTimezoneOffset() * 60_000) / 86_400_000);

export const neverHeard = (p: MapPoint) => p.plays === 0 && p.heardMs === 0;

/** A dot's fill in a colour mode, and how strongly it shows (0..1). */
export const colourOf = (p: MapPoint, mode: ColourMode, palette: Palette, day: number): [string, number] => {
  switch (mode) {
    case 'island':
      return [islandColour(p.island, palette), 0.9];
    case 'tier':
      return p.tierValue === null ? [palette.inkFaint, 0.5] : [mix(COOL, WARM, p.tierValue), 0.95];
    case 'shuffle':
      return [mix(COOL, WARM, Math.pow(p.weight, 0.7)), 0.35 + 0.65 * p.weight];
    case 'fresh': {
      if (p.lastDay === null) return [palette.inkFaint, 0.4];
      const age = Math.min(1, Math.max(0, day - p.lastDay) / 180);
      return [palette.accent, 1 - 0.8 * age];
    }
    case 'energy':
      return p.energy === null ? [palette.inkFaint, 0.4] : [mix(CALM, LOUD, p.energy), 0.95];
    default:
      return [p.tone ?? palette.inkDim, 0.9];
  }
};

/**
 * The density terrain: a SIZE x SIZE field of how many songs are near, smoothed, 0..1. It covers the
 * map with a margin of `TERRAIN_MARGIN` on every side, so the land around songs at the map's edge is
 * not cut straight.
 */
export type Terrain = { size: number; field: Float32Array; contours: { level: number; segments: Float32Array }[] };

/** World units of land drawn beyond the 0..1 square on every side. */
export const TERRAIN_MARGIN = 0.1;
const SPAN = 1 + 2 * TERRAIN_MARGIN;
/** The shore: density from which a cell is land. */
const SHORE = 0.07;
/** The land bitmap's side: fine enough that the shore stays sharp when the map is zoomed in. */
const LAND_PIXELS = 1024;

export const buildTerrain = (points: MapPoint[], size = 200): Terrain => {
  const field = new Float32Array(size * size);
  // A wide kernel: land masses with smooth shores rather than a bubble around every song.
  const radius = 6;
  const sigma = 2.6;
  const kernel: number[] = [];
  for (let dy = -radius; dy <= radius; dy += 1)
    for (let dx = -radius; dx <= radius; dx += 1) kernel.push(Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma)));
  for (const p of points) {
    const cx = Math.round(((p.x + TERRAIN_MARGIN) / SPAN) * (size - 1));
    const cy = Math.round(((p.y + TERRAIN_MARGIN) / SPAN) * (size - 1));
    let k = 0;
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1, k += 1) {
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && y >= 0 && x < size && y < size) field[y * size + x] += kernel[k];
      }
    }
  }
  // Normalise by a high quantile, so one dense cluster does not flatten the rest.
  const sorted = Array.from(field).filter((v) => v > 0).sort((a, b) => a - b);
  const top = sorted[Math.floor(sorted.length * 0.97)] ?? 1;
  for (let i = 0; i < field.length; i += 1) field[i] = Math.min(1, field[i] / top);
  const contours = [SHORE, 0.3, 0.6].map((level) => ({ level, segments: marchingSquares(field, size, level) }));
  return { size, field, contours };
};

/** Contour segments of `field` at `level`, as world coordinates [x1, y1, x2, y2, ...]. */
const marchingSquares = (field: Float32Array, size: number, level: number): Float32Array => {
  const out: number[] = [];
  const at = (x: number, y: number) => field[y * size + x];
  const scale = SPAN / (size - 1);
  const edge = (x0: number, y0: number, x1: number, y1: number) => {
    const [a, b] = [at(x0, y0), at(x1, y1)];
    const t = a === b ? 0.5 : (level - a) / (b - a);
    return [(x0 + (x1 - x0) * t) * scale - TERRAIN_MARGIN, (y0 + (y1 - y0) * t) * scale - TERRAIN_MARGIN];
  };
  for (let y = 0; y < size - 1; y += 1) {
    for (let x = 0; x < size - 1; x += 1) {
      const c =
        (at(x, y) >= level ? 8 : 0) |
        (at(x + 1, y) >= level ? 4 : 0) |
        (at(x + 1, y + 1) >= level ? 2 : 0) |
        (at(x, y + 1) >= level ? 1 : 0);
      if (c === 0 || c === 15) continue;
      const top = () => edge(x, y, x + 1, y);
      const right = () => edge(x + 1, y, x + 1, y + 1);
      const bottom = () => edge(x, y + 1, x + 1, y + 1);
      const left = () => edge(x, y, x, y + 1);
      const pairs: (() => number[])[][] = {
        1: [[left, bottom]],
        2: [[bottom, right]],
        3: [[left, right]],
        4: [[top, right]],
        5: [[left, top], [bottom, right]],
        6: [[top, bottom]],
        7: [[left, top]],
        8: [[left, top]],
        9: [[top, bottom]],
        10: [[left, bottom], [top, right]],
        11: [[top, right]],
        12: [[left, right]],
        13: [[bottom, right]],
        14: [[left, bottom]]
      }[c] ?? [];
      for (const [a, b] of pairs) out.push(...a(), ...b());
    }
  }
  return new Float32Array(out);
};

/**
 * The land as a bitmap, drawn under the dots and scaled with the camera. Sampled from the field
 * bilinearly at LAND_PIXELS, with a shore one pixel wide, so it stays crisp instead of a stretched
 * blur of the coarse field.
 */
export const terrainBitmap = (terrain: Terrain, palette: Palette): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');
  canvas.width = LAND_PIXELS;
  canvas.height = LAND_PIXELS;
  const context = canvas.getContext('2d');
  if (!context) return canvas;
  const image = context.createImageData(LAND_PIXELS, LAND_PIXELS);
  const land = palette.isDark ? [52, 63, 90] : [205, 214, 231];
  const high = palette.isDark ? [92, 106, 144] : [166, 180, 208];
  const alpha = palette.isDark ? 190 : 175;
  const { size, field } = terrain;
  const step = (size - 1) / (LAND_PIXELS - 1);
  // The shore's width in field units: about one bitmap pixel.
  const soft = 0.004;
  for (let py = 0; py < LAND_PIXELS; py += 1) {
    const fy = py * step;
    const y0 = Math.min(size - 2, Math.floor(fy));
    const ty = fy - y0;
    for (let px = 0; px < LAND_PIXELS; px += 1) {
      const fx = px * step;
      const x0 = Math.min(size - 2, Math.floor(fx));
      const tx = fx - x0;
      const a = field[y0 * size + x0];
      const b = field[y0 * size + x0 + 1];
      const c = field[(y0 + 1) * size + x0];
      const d = field[(y0 + 1) * size + x0 + 1];
      const v = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
      const o = (py * LAND_PIXELS + px) * 4;
      if (v < SHORE - soft) continue;
      const shore = Math.min(1, (v - (SHORE - soft)) / (2 * soft + 1e-6));
      const t = Math.min(1, Math.max(0, (v - SHORE) / (1 - SHORE)));
      image.data[o] = land[0] + (high[0] - land[0]) * t;
      image.data[o + 1] = land[1] + (high[1] - land[1]) * t;
      image.data[o + 2] = land[2] + (high[2] - land[2]) * t;
      image.data[o + 3] = Math.round(shore * alpha);
    }
  }
  context.putImageData(image, 0, 0);
  return canvas;
};

export type Label = { text: string; x: number; y: number; size: number; island: number };

/** Atlas labels: island names where they fit, larger islands first; more appear as the map zooms. */
export const placeLabels = (
  context: CanvasRenderingContext2D,
  islands: (MapIsland & { label: string })[],
  camera: Camera,
  zoom: number,
  total: number,
  width: number,
  height: number,
  font: string
): Label[] => {
  const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
  const out: Label[] = [];
  const minimum = Math.max(5, total / (40 * zoom * zoom));
  const sorted = [...islands].filter((i) => !i.loose && i.size >= minimum).sort((a, b) => b.size - a.size);
  for (const island of sorted) {
    const share = island.size / Math.max(1, total);
    const size = Math.round(Math.min(22, Math.max(11, 11 + 60 * share)));
    context.font = `600 ${size}px ${font}`;
    const text = island.label.toUpperCase();
    const w = context.measureText(text).width + text.length * size * 0.12;
    const sx = camera.ox + island.x * camera.k;
    const sy = camera.oy + island.y * camera.k;
    const box = { x0: sx - w / 2 - 6, y0: sy - size, x1: sx + w / 2 + 6, y1: sy + 6 };
    if (box.x1 < 0 || box.x0 > width || box.y1 < 0 || box.y0 > height) continue;
    if (placed.some((b) => b.x0 < box.x1 && box.x0 < b.x1 && b.y0 < box.y1 && box.y0 < b.y1)) continue;
    placed.push(box);
    out.push({ text, x: sx, y: sy, size, island: island.id });
  }
  return out;
};

export type BaseScene = {
  points: MapPoint[];
  islands: (MapIsland & { label: string })[];
  terrain: Terrain | null;
  land: HTMLCanvasElement | null;
  camera: Camera;
  zoom: number;
  mode: ColourMode;
  palette: Palette;
  width: number;
  height: number;
  selected: Set<string> | null;
  covers: Map<string, HTMLImageElement>;
  /** 0..1 while the map appears. */
  intro: number;
  font: string;
};

/** Draws the land, contours, dots (covers when close), glows and island labels. Returns the songs
 * close enough to show covers, so the page can load them, and the labels placed, for hovering. */
export const drawBase = (
  context: CanvasRenderingContext2D,
  scene: BaseScene
): { covers: string[]; labels: Label[] } => {
  const { points, camera, zoom, mode, palette, width, height, selected, covers, intro } = scene;
  context.clearRect(0, 0, width, height);
  // Land and contours.
  if (scene.land && scene.terrain) {
    const s = camera.k;
    context.imageSmoothingEnabled = true;
    context.globalAlpha = intro;
    context.drawImage(
      scene.land,
      camera.ox - TERRAIN_MARGIN * s,
      camera.oy - TERRAIN_MARGIN * s,
      SPAN * s,
      SPAN * s
    );
    context.lineWidth = 1;
    for (const { level, segments } of scene.terrain.contours) {
      context.strokeStyle = palette.isDark
        ? `rgba(200, 210, 235, ${0.07 + level * 0.12})`
        : `rgba(60, 70, 100, ${0.08 + level * 0.14})`;
      context.beginPath();
      for (let i = 0; i < segments.length; i += 4) {
        context.moveTo(camera.ox + segments[i] * s, camera.oy + segments[i + 1] * s);
        context.lineTo(camera.ox + segments[i + 2] * s, camera.oy + segments[i + 3] * s);
      }
      context.stroke();
    }
  }
  const day = today();
  const margin = 40;
  const visible: number[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    const x = camera.ox + p.x * camera.k;
    const y = camera.oy + p.y * camera.k;
    if (x > -margin && y > -margin && x < width + margin && y < height + margin) visible.push(i);
  }
  const showCovers = zoom >= 7 && visible.length <= 500;
  const coverRadius = Math.min(26, 6 + zoom * 1.4);
  // Glows for the songs Smart Shuffle favours most.
  context.globalAlpha = 0.16 * intro;
  context.fillStyle = palette.accent;
  context.beginPath();
  for (const i of visible) {
    const p = points[i];
    if (p.weight < 0.72 || (selected && !selected.has(p.songId))) continue;
    const r = (showCovers ? coverRadius : radiusOf(p, zoom)) * 2.2 * intro;
    const x = camera.ox + p.x * camera.k;
    const y = camera.oy + p.y * camera.k;
    context.moveTo(x + r, y);
    context.arc(x, y, r, 0, Math.PI * 2);
  }
  context.fill();
  const loose = new Set(scene.islands.filter((i) => i.loose).map((i) => i.id));
  // Dots, batched by colour and strength.
  const batches = new Map<string, { fill: Path2D; ring: Path2D; colour: string; alpha: number }>();
  const wantCovers: string[] = [];
  for (const i of visible) {
    const p = points[i];
    const [colour, strength] = colourOf(p, mode, palette, day);
    const dim = selected && !selected.has(p.songId);
    // Songs on no island yet stay quiet, so the islands read at a glance.
    const isLoose = loose.has(p.island);
    const alpha = Math.round((dim ? 0.15 : isLoose && !showCovers ? strength * 0.4 : strength) * 20) / 20;
    const key = `${colour}|${alpha}`;
    let batch = batches.get(key);
    if (!batch) {
      batch = { fill: new Path2D(), ring: new Path2D(), colour, alpha };
      batches.set(key, batch);
    }
    const x = camera.ox + p.x * camera.k;
    const y = camera.oy + p.y * camera.k;
    if (showCovers && !dim) {
      wantCovers.push(p.songId);
      const image = covers.get(p.songId);
      if (image?.complete && image.naturalWidth > 0) {
        context.save();
        context.globalAlpha = intro;
        context.beginPath();
        context.arc(x, y, coverRadius, 0, Math.PI * 2);
        context.clip();
        context.drawImage(image, x - coverRadius, y - coverRadius, coverRadius * 2, coverRadius * 2);
        context.restore();
        continue;
      }
    }
    const r = (showCovers ? coverRadius * 0.6 : radiusOf(p, zoom) * (isLoose ? 0.7 : 1)) * intro;
    const path = neverHeard(p) ? batch.ring : batch.fill;
    path.moveTo(x + r, y);
    path.arc(x, y, Math.max(0.5, r), 0, Math.PI * 2);
  }
  for (const { fill, ring, colour, alpha } of batches.values()) {
    context.globalAlpha = alpha * intro;
    context.fillStyle = colour;
    context.fill(fill);
    context.strokeStyle = colour;
    context.lineWidth = 1.2;
    context.stroke(ring);
  }
  // Titles under covers.
  if (showCovers) {
    context.globalAlpha = intro;
    context.font = `500 11px ${scene.font}`;
    context.textAlign = 'center';
    context.fillStyle = palette.ink;
    for (const i of visible) {
      const p = points[i];
      if (selected && !selected.has(p.songId)) continue;
      const x = camera.ox + p.x * camera.k;
      const y = camera.oy + p.y * camera.k;
      const title = p.title.length > 22 ? `${p.title.slice(0, 21)}…` : p.title;
      context.fillText(title, x, y + coverRadius + 13);
    }
  }
  // Island names, set like an atlas: spaced capitals with a halo.
  const labels = placeLabels(context, scene.islands, camera, zoom, points.length, width, height, scene.font);
  context.textAlign = 'center';
  for (const label of labels) {
    context.font = `600 ${label.size}px ${scene.font}`;
    const spaced = label.text.split('').join(' ');
    context.globalAlpha = 0.9 * intro;
    context.lineWidth = 4;
    context.strokeStyle = palette.surface1;
    context.strokeText(spaced, label.x, label.y);
    context.fillStyle = palette.isDark ? 'rgba(232, 236, 248, 0.92)' : 'rgba(30, 36, 52, 0.88)';
    context.fillText(spaced, label.x, label.y);
  }
  context.globalAlpha = 1;
  return { covers: showCovers ? wantCovers : [], labels };
};

export type OverlayScene = {
  points: MapPoint[];
  byId: Map<string, number>;
  camera: Camera;
  zoom: number;
  palette: Palette;
  width: number;
  height: number;
  hovered: number;
  trail: string[];
  route: string[];
  current: string | null;
  /** 0..1, for the current song's pulse. */
  pulse: number;
  lasso: { x: number; y: number }[];
  area: { x: number; y: number; r: number } | null;
  journey: string[];
};

const LINK_COLOURS: Record<number, string> = {
  [LINK_SESSION]: 'rgba(236, 128, 64, 0.85)',
  [LINK_ARTIST]: 'rgba(96, 160, 240, 0.85)',
  [LINK_TIER]: 'rgba(160, 120, 230, 0.85)'
};

/** The strongest kind of a link, for its colour: heard together over artist over tier. */
export const kindOf = (bits: number) =>
  bits & LINK_SESSION ? LINK_SESSION : bits & LINK_ARTIST ? LINK_ARTIST : LINK_TIER;

export const drawOverlay = (context: CanvasRenderingContext2D, scene: OverlayScene) => {
  const { points, byId, camera, zoom, palette, width, height } = scene;
  context.clearRect(0, 0, width, height);
  const at = (id: string) => {
    const i = byId.get(id);
    if (i === undefined) return null;
    const p = points[i];
    return [camera.ox + p.x * camera.k, camera.oy + p.y * camera.k] as const;
  };
  const line = (ids: string[], colour: string, widthPx: number, dash: number[]) => {
    const spots = ids.map(at).filter((s): s is readonly [number, number] => s !== null);
    if (spots.length < 2) return;
    context.setLineDash(dash);
    context.lineWidth = widthPx;
    context.strokeStyle = colour;
    context.lineJoin = 'round';
    context.lineCap = 'round';
    context.beginPath();
    spots.forEach(([x, y], k) => (k === 0 ? context.moveTo(x, y) : context.lineTo(x, y)));
    context.stroke();
    context.setLineDash([]);
  };
  // The session's trail, then the queue's route ahead and a journey.
  line(scene.trail, palette.isDark ? 'rgba(232, 236, 248, 0.35)' : 'rgba(30, 36, 52, 0.3)', 2, []);
  context.globalAlpha = 0.6;
  line(scene.route, palette.accent, 2, [5, 6]);
  context.globalAlpha = 1;
  for (const id of scene.route) {
    const s = at(id);
    if (!s) continue;
    context.fillStyle = palette.accent;
    context.beginPath();
    context.arc(s[0], s[1], 2.5, 0, Math.PI * 2);
    context.fill();
  }
  line(scene.journey, 'rgba(236, 128, 64, 0.9)', 3, []);
  // Hover: the links, coloured by what they are made of.
  if (scene.hovered >= 0) {
    const p = points[scene.hovered];
    const [hx, hy] = [camera.ox + p.x * camera.k, camera.oy + p.y * camera.k];
    p.neighbours.forEach((id, k) => {
      const s = at(id);
      if (!s) return;
      context.strokeStyle = LINK_COLOURS[kindOf(p.linkKinds[k] ?? LINK_TIER)];
      context.lineWidth = 1.5;
      context.beginPath();
      context.moveTo(hx, hy);
      context.lineTo(s[0], s[1]);
      context.stroke();
    });
    context.strokeStyle = palette.ink;
    context.lineWidth = 2;
    context.beginPath();
    context.arc(hx, hy, radiusOf(p, zoom) + 3, 0, Math.PI * 2);
    context.stroke();
  }
  // You are here.
  if (scene.current) {
    const s = at(scene.current);
    if (s) {
      const r = 6 + scene.pulse * 10;
      context.strokeStyle = palette.accent;
      context.globalAlpha = 1 - scene.pulse * 0.85;
      context.lineWidth = 2;
      context.beginPath();
      context.arc(s[0], s[1], r, 0, Math.PI * 2);
      context.stroke();
      context.globalAlpha = 1;
      context.fillStyle = palette.accent;
      context.beginPath();
      context.arc(s[0], s[1], 4, 0, Math.PI * 2);
      context.fill();
    }
  }
  // The area being picked and the lasso.
  if (scene.area) {
    context.fillStyle = palette.accent;
    context.globalAlpha = 0.12;
    context.beginPath();
    context.arc(scene.area.x, scene.area.y, scene.area.r, 0, Math.PI * 2);
    context.fill();
    context.globalAlpha = 0.6;
    context.strokeStyle = palette.accent;
    context.lineWidth = 1.5;
    context.stroke();
    context.globalAlpha = 1;
  }
  if (scene.lasso.length > 1) {
    context.setLineDash([4, 4]);
    context.strokeStyle = palette.accent;
    context.lineWidth = 1.5;
    context.beginPath();
    scene.lasso.forEach(({ x, y }, k) => {
      const [sx, sy] = [camera.ox + x * camera.k, camera.oy + y * camera.k];
      if (k === 0) context.moveTo(sx, sy);
      else context.lineTo(sx, sy);
    });
    context.closePath();
    context.stroke();
    context.setLineDash([]);
  }
};

/** The minimap: the land and every song as a pixel, cached per map and theme. */
export const minimapBitmap = (points: MapPoint[], land: HTMLCanvasElement | null, palette: Palette, size: number) => {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) return canvas;
  if (land) context.drawImage(land, -TERRAIN_MARGIN * size, -TERRAIN_MARGIN * size, SPAN * size, SPAN * size);
  context.fillStyle = palette.ink;
  context.globalAlpha = 0.55;
  for (const p of points) context.fillRect(p.x * (size - 2), p.y * (size - 2), 1.5, 1.5);
  return canvas;
};

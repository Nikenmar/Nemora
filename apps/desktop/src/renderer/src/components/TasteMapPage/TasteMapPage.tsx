import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { useStore } from '@tanstack/react-store';
import { store } from '@renderer/store';
import { AppUpdateContext } from '../../contexts/AppUpdateContext';
import MainContainer from '../MainContainer';
import Button from '../Button';
import EmptyState from '../ui/EmptyState';
import Icon from '../ui/Icon';
import { currentIntensity, shuffleOptions, steer } from '../../other/smartShuffle';
import {
  COLOUR_MODES,
  LINK_ARTIST,
  LINK_SESSION,
  buildIndex,
  buildTerrain,
  centreOn,
  drawBase,
  drawOverlay,
  fitCamera,
  hitTest,
  insidePolygon,
  kindOf,
  lerpCamera,
  minimapBitmap,
  readPalette,
  terrainBitmap,
  today,
  zoomAt,
  zoomOf,
  type Camera,
  type ColourMode,
  type Label,
  type MapPoint,
  type TasteMapData
} from './mapCanvas';

/** Fewer plays than this and the map leans on artists and tiers (core `tastemap::FEW_PLAYS`). */
const FEW_PLAYS = 200;
/** The area tool picks songs within this many pixels of the click. */
const PICK_PX = 56;
const MINIMAP = 148;
const ROUTE_LENGTH = 12;
type Tool = 'island' | 'area' | 'lasso';
type Selection = { ids: Set<string>; island: number | null };

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * Stats > Taste map (PLAN/14 C5, PLAN/17): the library laid out by how it is listened to, as a map
 * one can zoom, pan and read. Islands are groups of songs heard together; dots are sized by Smart
 * Shuffle as it runs now and coloured in six ways; the playing song, the session's trail and the
 * queue's route are drawn live; selections become a Smart Shuffle queue, a lens, a playlist; a
 * journey walks the map from one song to another.
 */
const TasteMapPage = () => {
  const { t } = useTranslation();
  const { createQueue, toggleTierShuffle, changeCurrentActivePage, updateContextMenuData, addNewNotifications } =
    useContext(AppUpdateContext);
  const isTierShuffling = useStore(store, (state) => state.player.isTierShuffling);
  const isDarkMode = useStore(store, (state) => state.isDarkMode);
  const currentSongId = useStore(store, (state) => state.currentSongData?.songId ?? null);
  const queue = useStore(store, (state) => state.localStorage.queue);

  const [map, setMap] = useState<TasteMapData | null>();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [mode, setMode] = useState<ColourMode>('cover');
  const [tool, setTool] = useState<Tool>('island');
  const [hovered, setHovered] = useState(-1);
  const [hoveredIsland, setHoveredIsland] = useState<number | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [query, setQuery] = useState('');
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [trail, setTrail] = useState<string[]>([]);
  const [journeyFrom, setJourneyFrom] = useState<MapPoint | null>(null);
  const [journey, setJourney] = useState<string[]>([]);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [isRedrawing, setIsRedrawing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [, setCameraTick] = useState(0);

  const boxRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const camera = useRef<Camera | null>(null);
  const lastFit = useRef<Camera | null>(null);
  const sizeBefore = useRef({ width: 0, height: 0 });
  const frame = useRef(0);
  const animation = useRef(0);
  const intro = useRef(1);
  const pulse = useRef(0);
  const labels = useRef<Label[]>([]);
  const lasso = useRef<{ x: number; y: number }[]>([]);
  const area = useRef<{ x: number; y: number; r: number } | null>(null);
  const drag = useRef<{ x: number; y: number; moved: boolean; lasso: boolean } | null>(null);
  const covers = useRef(new Map<string, HTMLImageElement>());
  const pendingCovers = useRef(new Set<string>());

  // Load (and reload after a rename or a redraw), sized by Smart Shuffle as it runs now.
  const load = useCallback((fresh = false) => {
    return invoke<TasteMapData>('taste_map', { options: shuffleOptions(), intensity: currentIntensity(), fresh })
      .then((loaded) => setMap(loaded))
      .catch(() => setMap(null));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return undefined;
    const observer = new ResizeObserver(([entry]) =>
      setSize({ width: Math.floor(entry.contentRect.width), height: Math.floor(entry.contentRect.height) })
    );
    observer.observe(box);
    return () => observer.disconnect();
  }, [map, isFullScreen]);

  const fit = useMemo(() => fitCamera(size.width, size.height), [size]);
  const points = useMemo(() => map?.points ?? [], [map]);
  const index = useMemo(() => buildIndex(points), [points]);
  const byId = useMemo(() => new Map(points.map((p, i) => [p.songId, i])), [points]);
  const terrain = useMemo(() => (map ? buildTerrain(map.points) : null), [map]);
  const hasBox = size.width > 0;
  const palette = useMemo(
    () => (hasBox && boxRef.current ? readPalette(boxRef.current) : null),
    // The theme decides the palette; the box appears with the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isDarkMode, hasBox]
  );
  const land = useMemo(() => (terrain && palette ? terrainBitmap(terrain, palette) : null), [terrain, palette]);
  const minimap = useMemo(
    () => (palette && map ? minimapBitmap(map.points, land, palette, MINIMAP) : null),
    [map, land, palette]
  );
  const islands = useMemo(
    () =>
      (map?.islands ?? []).map((island) => ({
        ...island,
        label: island.loose
          ? t('tasteMap.loose')
          : (island.userName ?? island.name ?? t('tasteMap.islandN', { n: island.id + 1 }))
      })),
    [map, t]
  );
  const route = useMemo(() => {
    const from = (queue.currentSongIndex ?? -1) + 1;
    return queue.queue.slice(Math.max(0, from - 1), from + ROUTE_LENGTH).filter((id) => byId.has(id));
  }, [queue, byId]);

  // The session's trail, after every song change.
  useEffect(() => {
    let isLive = true;
    invoke<string[]>('taste_map_session')
      .then((songs) => {
        if (!isLive) return;
        setTrail(currentSongId && songs.at(-1) !== currentSongId ? [...songs, currentSongId] : songs);
      })
      .catch(() => undefined);
    return () => {
      isLive = false;
    };
  }, [currentSongId]);

  // Everything the drawing reads, current at every frame.
  const scene = useRef({ map, mode, selection, hovered, trail, route, currentSongId, journey, islands });
  scene.current = { map, mode, selection, hovered, trail, route, currentSongId, journey, islands };

  const requestDrawRef = useRef<() => void>(() => undefined);

  const drawNow = useCallback(() => {
    const base = baseRef.current?.getContext('2d');
    const overlay = overlayRef.current?.getContext('2d');
    const s = scene.current;
    const cam = camera.current;
    if (!base || !overlay || !s.map || !palette || !cam || size.width === 0) return;
    const zoom = zoomOf(cam, fit);
    const font = getComputedStyle(baseRef.current as Element).fontFamily;
    const drawn = drawBase(base, {
      points: s.map.points,
      islands: s.islands,
      terrain,
      land,
      camera: cam,
      zoom,
      mode: s.mode,
      palette,
      width: size.width,
      height: size.height,
      selected: s.selection?.ids ?? null,
      covers: covers.current,
      intro: intro.current,
      font
    });
    labels.current = drawn.labels;
    drawOverlay(overlay, {
      points: s.map.points,
      byId,
      camera: cam,
      zoom,
      palette,
      width: size.width,
      height: size.height,
      hovered: s.hovered,
      trail: s.trail,
      route: s.route,
      current: s.currentSongId,
      pulse: pulse.current,
      lasso: lasso.current,
      area: area.current,
      journey: s.journey
    });
    // The minimap, with the view's frame.
    const mini = minimapRef.current?.getContext('2d');
    if (mini && minimap) {
      mini.clearRect(0, 0, MINIMAP, MINIMAP);
      mini.drawImage(minimap, 0, 0);
      mini.strokeStyle = palette.accent;
      mini.lineWidth = 1.5;
      mini.strokeRect(
        (-cam.ox / cam.k) * MINIMAP,
        (-cam.oy / cam.k) * MINIMAP,
        (size.width / cam.k) * MINIMAP,
        (size.height / cam.k) * MINIMAP
      );
    }
    // Covers the view wants and nobody asked for yet.
    const missing = drawn.covers
      .filter((id) => !covers.current.has(id) && !pendingCovers.current.has(id))
      .slice(0, 80);
    if (missing.length > 0) {
      missing.forEach((id) => pendingCovers.current.add(id));
      window.api.tierlistsData
        .getTierlistArtworks(missing)
        .then((urls) => {
          for (const id of missing) {
            const url = urls[id];
            if (!url) continue;
            const image = new Image();
            image.onload = () => requestDrawRef.current();
            image.src = url;
            covers.current.set(id, image);
          }
        })
        .catch(() => undefined);
    }
  }, [palette, size, fit, terrain, land, byId, minimap]);

  const requestDraw = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      drawNow();
    });
  }, [drawNow]);
  requestDrawRef.current = requestDraw;

  // Canvas sizes, and the camera fitted when the map first shows.
  useEffect(() => {
    const scale = window.devicePixelRatio || 1;
    for (const canvas of [baseRef.current, overlayRef.current]) {
      if (!canvas) continue;
      canvas.width = Math.round(size.width * scale);
      canvas.height = Math.round(size.height * scale);
      canvas.getContext('2d')?.setTransform(scale, 0, 0, scale, 0, 0);
    }
    const mini = minimapRef.current;
    if (mini) {
      mini.width = MINIMAP * scale;
      mini.height = MINIMAP * scale;
      mini.getContext('2d')?.setTransform(scale, 0, 0, scale, 0, 0);
    }
    // A new size keeps what is in the middle of the view, at the same zoom over the fitted map.
    const before = lastFit.current;
    if (size.width > 0) {
      const cam = camera.current;
      if (!cam || !before) camera.current = fit;
      else if (before.k !== fit.k || before.ox !== fit.ox || before.oy !== fit.oy) {
        const [cx, cy] = [(sizeBefore.current.width / 2 - cam.ox) / cam.k, (sizeBefore.current.height / 2 - cam.oy) / cam.k];
        camera.current = centreOn(cx, cy, (cam.k / before.k) * fit.k, size.width, size.height);
      }
      lastFit.current = fit;
      sizeBefore.current = size;
    }
    requestDraw();
  }, [size, fit, requestDraw]);

  // The map appears: dots grow in (instantly under reduced motion).
  const hash = map?.hash;
  useEffect(() => {
    if (!hash) return undefined;
    if (prefersReducedMotion()) {
      intro.current = 1;
      requestDrawRef.current();
      return undefined;
    }
    intro.current = 0;
    const start = performance.now();
    let id = 0;
    const step = (now: number) => {
      intro.current = easeOut(Math.min(1, (now - start) / 650));
      requestDrawRef.current();
      if (intro.current < 1) id = requestAnimationFrame(step);
    };
    id = requestAnimationFrame(step);
    return () => cancelAnimationFrame(id);
  }, [hash]);

  useEffect(() => {
    requestDraw();
  }, [mode, selection, hovered, trail, route, journey, islands, requestDraw]);

  // You are here: a pulse around the playing song.
  useEffect(() => {
    if (!currentSongId || !byId.has(currentSongId) || prefersReducedMotion()) {
      pulse.current = 0;
      requestDraw();
      return undefined;
    }
    let id = 0;
    const step = (now: number) => {
      pulse.current = (now % 1600) / 1600;
      requestDraw();
      id = requestAnimationFrame(step);
    };
    id = requestAnimationFrame(step);
    return () => cancelAnimationFrame(id);
  }, [currentSongId, byId, requestDraw]);

  const setCamera = useCallback(
    (next: Camera) => {
      camera.current = next;
      requestDraw();
      setCameraTick((n) => n + 1);
    },
    [requestDraw]
  );

  const animateTo = useCallback(
    (target: Camera) => {
      cancelAnimationFrame(animation.current);
      const from = camera.current ?? fit;
      if (prefersReducedMotion()) {
        setCamera(target);
        return;
      }
      const start = performance.now();
      const step = (now: number) => {
        const k = easeOut(Math.min(1, (now - start) / 420));
        camera.current = lerpCamera(from, target, k);
        drawNow();
        if (k < 1) animation.current = requestAnimationFrame(step);
        else setCameraTick((n) => n + 1);
      };
      animation.current = requestAnimationFrame(step);
    },
    [fit, drawNow, setCamera]
  );

  const flyTo = useCallback(
    (p: MapPoint, zoom = 9) => {
      const k = Math.max(fit.k * zoom, camera.current?.k ?? fit.k);
      animateTo(centreOn(p.x, p.y, k, size.width, size.height));
    },
    [fit, animateTo, size]
  );

  // Wheel zoom towards the cursor (a trackpad pinch arrives as a wheel with Ctrl).
  useEffect(() => {
    const canvas = overlayRef.current;
    if (!canvas) return undefined;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const cam = camera.current;
      if (!cam) return;
      const rect = canvas.getBoundingClientRect();
      const speed = e.ctrlKey ? 0.012 : 0.0016;
      cancelAnimationFrame(animation.current);
      setCamera(zoomAt(cam, fit, e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * speed)));
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [fit, setCamera, map, isFullScreen]);

  const local = (e: { clientX: number; clientY: number }) => {
    const rect = overlayRef.current?.getBoundingClientRect();
    return rect ? { x: e.clientX - rect.left, y: e.clientY - rect.top } : { x: 0, y: 0 };
  };
  const toWorld = (sx: number, sy: number) => {
    const cam = camera.current ?? fit;
    return { x: (sx - cam.ox) / cam.k, y: (sy - cam.oy) / cam.k };
  };

  const selectIds = (ids: string[], island: number | null, add: boolean) => {
    if (ids.length === 0) return;
    setSelection((current) => {
      if (add && current) return { ids: new Set([...current.ids, ...ids]), island: null };
      return { ids: new Set(ids), island };
    });
  };
  const selectIsland = (island: number, add: boolean) =>
    selectIds(
      points.filter((p) => p.island === island).map((p) => p.songId),
      island,
      add
    );

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    const { x, y } = local(e);
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    const isLasso = tool === 'lasso' || e.altKey;
    drag.current = { x, y, moved: false, lasso: isLasso };
    if (isLasso) lasso.current = [toWorld(x, y)];
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { x, y } = local(e);
    const d = drag.current;
    if (d) {
      if (!d.moved && Math.hypot(x - d.x, y - d.y) > 4) {
        d.moved = true;
        setIsDragging(true);
      }
      if (d.moved) {
        if (d.lasso) {
          lasso.current.push(toWorld(x, y));
          requestDraw();
        } else if (camera.current) {
          const cam = camera.current;
          camera.current = { ...cam, ox: cam.ox + x - d.x, oy: cam.oy + y - d.y };
          d.x = x;
          d.y = y;
          if (hovered !== -1) setHovered(-1);
          requestDraw();
        }
        return;
      }
    }
    const cam = camera.current;
    if (!cam || !map) return;
    const hit = hitTest(points, index, cam, zoomOf(cam, fit), x, y);
    if (hit !== hovered) setHovered(hit);
    const label =
      hit < 0
        ? labels.current.find((l) => Math.abs(l.x - x) < 70 && y < l.y + 6 && y > l.y - l.size - 4)
        : undefined;
    const islandUnder = label ? label.island : null;
    if (islandUnder !== hoveredIsland) setHoveredIsland(islandUnder);
    if (tool === 'area') {
      area.current = { x, y, r: PICK_PX };
      requestDraw();
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    drag.current = null;
    setIsDragging(false);
    if (!d) return;
    const { x, y } = local(e);
    if (d.moved) {
      if (d.lasso) {
        const inside = insidePolygon(points, lasso.current).map((i) => points[i].songId);
        lasso.current = [];
        selectIds(inside, null, e.shiftKey);
        requestDraw();
      } else {
        setCameraTick((n) => n + 1);
      }
      return;
    }
    // A click.
    const cam = camera.current ?? fit;
    if (tool === 'area') {
      const w = toWorld(x, y);
      const r = PICK_PX / cam.k;
      selectIds(
        points.filter((p) => Math.hypot(p.x - w.x, p.y - w.y) <= r).map((p) => p.songId),
        null,
        e.shiftKey
      );
      return;
    }
    const hit = hitTest(points, index, cam, zoomOf(cam, fit), x, y, 24);
    if (hit >= 0) selectIsland(points[hit].island, e.shiftKey);
    else if (hoveredIsland !== null) selectIsland(hoveredIsland, e.shiftKey);
    else if (!e.shiftKey) setSelection(null);
  };

  const onPointerLeave = () => {
    setHovered(-1);
    setHoveredIsland(null);
    area.current = null;
    requestDraw();
  };

  // Right-click a song: play it, a radio from it, more like it, a journey, its page.
  const radioFrom = useCallback(
    (p: MapPoint) => {
      const rest = points.filter((q) => q.songId !== p.songId).map((q) => q.songId);
      createQueue([p.songId, ...rest], 'songs', false, undefined, true);
      steer({ kind: 'follow', on: true, name: p.title }).catch(() => undefined);
      if (!store.state.player.isTierShuffling) toggleTierShuffle(true);
    },
    [points, createQueue, toggleTierShuffle]
  );

  const endJourney = useCallback(
    (to: MapPoint) => {
      if (!journeyFrom) return;
      invoke<string[]>('taste_map_journey', { from: journeyFrom.songId, to: to.songId, length: 20 })
        .then((way) => {
          if (way.length === 0)
            addNewNotifications([{ id: 'tasteMapJourney', duration: 5000, content: t('tasteMap.journeyNone') }]);
          setJourney(way);
        })
        .catch(() => undefined);
    },
    [journeyFrom, addNewNotifications, t]
  );

  const onContextMenu = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const cam = camera.current ?? fit;
    const { x, y } = local(e);
    const hit = hitTest(points, index, cam, zoomOf(cam, fit), x, y, 16);
    if (hit < 0) return;
    const p = points[hit];
    updateContextMenuData(
      true,
      [
        {
          label: t('tasteMap.playNow'),
          iconName: 'play_arrow',
          iconClassName: 'ms-icon mr-2',
          handlerFunction: () => createQueue([p.songId], 'songs', false, undefined, true)
        },
        {
          label: t('tasteMap.radio'),
          iconName: 'radio',
          iconClassName: 'ms-icon mr-2',
          handlerFunction: () => radioFrom(p)
        },
        {
          label: t('smartShuffle.moreLike'),
          iconName: 'auto_fix',
          iconClassName: 'ms-icon mr-2',
          handlerFunction: () => {
            steer({ kind: 'moreLike', songId: p.songId, title: p.title }).catch(() => undefined);
          }
        },
        { label: '', isContextMenuItemSeperator: true, handlerFunction: () => true },
        journeyFrom && journeyFrom.songId !== p.songId
          ? {
              label: t('tasteMap.journeyEnd'),
              iconName: 'flag',
              iconClassName: 'ms-icon mr-2',
              handlerFunction: () => endJourney(p)
            }
          : {
              label: t('tasteMap.journeyStart'),
              iconName: 'route',
              iconClassName: 'ms-icon mr-2',
              handlerFunction: () => {
                setJourneyFrom(p);
                setJourney([]);
              }
            },
        {
          label: t('tasteMap.songInfo'),
          iconName: 'info',
          iconClassName: 'ms-icon mr-2',
          handlerFunction: () => changeCurrentActivePage('SongInfo', { songId: p.songId })
        }
      ],
      e.pageX,
      e.pageY
    );
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const cam = camera.current;
    if (!cam) return;
    const [cx, cy] = [size.width / 2, size.height / 2];
    if (e.key === '+' || e.key === '=') animateTo(zoomAt(cam, fit, cx, cy, 1.6));
    else if (e.key === '-') animateTo(zoomAt(cam, fit, cx, cy, 1 / 1.6));
    else if (e.key === '0') animateTo(fit);
    else if (e.key === 'Escape') {
      if (selection) setSelection(null);
      else if (isFullScreen) setIsFullScreen(false);
    } else return;
    e.preventDefault();
  };

  // Moving the view from the minimap.
  const onMinimap = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.type === 'pointermove' && e.buttons !== 1) return;
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const cam = camera.current ?? fit;
    setCamera(
      centreOn((e.clientX - rect.left) / MINIMAP, (e.clientY - rect.top) / MINIMAP, cam.k, size.width, size.height)
    );
  };

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return points
      .filter((p) => p.title.toLowerCase().includes(q) || (p.artist ?? '').toLowerCase().includes(q))
      .slice(0, 8);
  }, [query, points]);

  // The selection's (or hovered island's) numbers: songs, hours, artists, tiers, shuffle share.
  const summary = useMemo(() => {
    const chosen = selection
      ? points.filter((p) => selection.ids.has(p.songId))
      : hoveredIsland !== null
        ? points.filter((p) => p.island === hoveredIsland)
        : [];
    if (chosen.length === 0) return null;
    const totalWeight = points.reduce((s, p) => s + p.weight, 0) || 1;
    const weight = chosen.reduce((s, p) => s + p.weight, 0);
    const artists = new Map<string, number>();
    const tiers = new Map<string, number>();
    let lastDay: number | null = null;
    for (const p of chosen) {
      if (p.artist) artists.set(p.artist, (artists.get(p.artist) ?? 0) + 1);
      if (p.tier) tiers.set(p.tier, (tiers.get(p.tier) ?? 0) + 1);
      if (p.lastDay !== null && (lastDay === null || p.lastDay > lastDay)) lastDay = p.lastDay;
    }
    const top = (m: Map<string, number>, n: number) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
    const island = selection ? selection.island : hoveredIsland;
    return {
      count: chosen.length,
      ids: chosen.map((p) => p.songId),
      hours: chosen.reduce((s, p) => s + p.heardMs, 0) / 3_600_000,
      artists: top(artists, 3),
      tiers: top(tiers, 4),
      lastDay,
      libraryShare: chosen.length / Math.max(1, points.length),
      shuffleShare: weight / totalWeight,
      island,
      name: island !== null ? (islands[island]?.label ?? null) : null
    };
  }, [selection, hoveredIsland, points, islands]);

  const whenHeard = (day: number | null) => {
    if (day === null) return t('tasteMap.never');
    const days = today() - day;
    return days <= 0 ? t('tasteMap.today') : t('tasteMap.daysAgo', { count: days });
  };

  const playSelection = () => {
    if (!summary) return;
    if (isTierShuffling) createQueue(summary.ids, 'songs', true, undefined, true);
    else {
      createQueue(summary.ids, 'songs', false, undefined, true);
      toggleTierShuffle(true);
    }
  };
  const leanToSelection = () => {
    if (!summary) return;
    const name = summary.name ?? t('tasteMap.selection', { count: summary.count });
    steer({ kind: 'lens', songs: summary.ids, name }).catch(() => undefined);
    if (!store.state.player.isTierShuffling) toggleTierShuffle(true);
  };
  const saveSelection = () => {
    if (!summary) return;
    const name = summary.name ?? t('tasteMap.selectionPlaylist');
    window.api.playlistsData
      .addNewPlaylist(name, summary.ids)
      .then((res) =>
        addNewNotifications([
          {
            id: 'tasteMapPlaylist',
            duration: 5000,
            content: res.success ? t('tasteMap.saved', { name }) : (res.message ?? t('tasteMap.saveFailed'))
          }
        ])
      )
      .catch(() => undefined);
  };
  const rename = (name: string) => {
    if (summary?.island === null || summary?.island === undefined) return;
    invoke('taste_map_rename', { island: summary.island, name })
      .then(() => load())
      .catch(() => undefined);
    setRenaming(null);
  };
  const playJourney = () => {
    if (journey.length === 0) return;
    if (store.state.player.isTierShuffling) toggleTierShuffle(false);
    createQueue(journey, 'songs', false, undefined, true);
  };

  const hoveredPoint = hovered >= 0 ? points[hovered] : null;
  const cam = camera.current;
  const hoveredAt = hoveredPoint && cam ? [cam.ox + hoveredPoint.x * cam.k, cam.oy + hoveredPoint.y * cam.k] : null;
  const why = hoveredPoint
    ? hoveredPoint.neighbours.slice(0, 3).map((id, k) => {
        const kind = kindOf(hoveredPoint.linkKinds[k] ?? 0);
        const other = byId.has(id) ? points[byId.get(id) as number] : null;
        return {
          title: other?.title ?? id,
          kind: t(
            kind === LINK_SESSION
              ? 'tasteMap.linkSession'
              : kind === LINK_ARTIST
                ? 'tasteMap.linkArtist'
                : 'tasteMap.linkTier'
          )
        };
      })
    : [];

  const modeLabel: Record<ColourMode, string> = {
    cover: t('tasteMap.modeCover'),
    island: t('tasteMap.modeIsland'),
    shuffle: t('tasteMap.modeShuffle'),
    tier: t('tasteMap.modeTier'),
    fresh: t('tasteMap.modeFresh'),
    energy: t('tasteMap.modeEnergy')
  };
  const legend: Record<ColourMode, string> = {
    cover: t('tasteMap.legendCover'),
    island: t('tasteMap.legendIsland'),
    shuffle: t('tasteMap.legendShuffle'),
    tier: t('tasteMap.legendTier'),
    fresh: t('tasteMap.legendFresh'),
    energy: t('tasteMap.legendEnergy')
  };
  const toolLabel: Record<Tool, string> = {
    island: t('tasteMap.toolIsland'),
    area: t('tasteMap.toolArea'),
    lasso: t('tasteMap.toolLasso')
  };
  const chip = (isActive: boolean) =>
    `inline-flex h-7 items-center rounded-full px-3 text-small outline-none transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-echo ${
      isActive ? 'bg-accent text-on-accent' : 'bg-surface-2 text-ink hover:bg-line/70'
    }`;

  const content = (
    <div className={`flex h-full min-h-0 flex-col ${isFullScreen ? 'p-4' : ''}`}>
      <div className="title-container mb-2 mt-1 flex flex-wrap items-center justify-between gap-2 pr-4 text-page font-semibold text-ink">
        <div className="container flex items-center">{t('tasteMap.title')}</div>
        <div className="other-controls-container relative flex items-center gap-2 text-base font-normal">
          <div className="relative">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('tasteMap.searchPlaceholder')}
              aria-label={t('tasteMap.searchPlaceholder')}
              className="h-8 w-56 rounded-full bg-surface-2 px-4 text-small text-ink outline-none placeholder:text-ink-dim focus-visible:outline-2 focus-visible:outline-echo"
            />
            {results.length > 0 && (
              <ul className="absolute right-0 top-9 z-20 w-72 overflow-hidden rounded-lg bg-surface-3 py-1 shadow-float">
                {results.map((p) => (
                  <li key={p.songId}>
                    <button
                      type="button"
                      className="block w-full truncate px-3 py-1.5 text-left text-small text-ink hover:bg-line/60"
                      onClick={() => {
                        setQuery('');
                        flyTo(p);
                        setHovered(byId.get(p.songId) ?? -1);
                      }}
                    >
                      <span className="font-medium">{p.title}</span>
                      {p.artist && <span className="text-ink-dim"> · {p.artist}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <Button label={t('tasteMap.fit')} iconName="fit_screen" className="!mr-0 text-sm" clickHandler={() => animateTo(fit)} />
          <Button
            tooltipLabel={t('tasteMap.redrawHint')}
            label={t('tasteMap.redraw')}
            iconName="refresh"
            className="!mr-0 text-sm"
            isDisabled={isRedrawing}
            clickHandler={() => {
              setIsRedrawing(true);
              load(true).finally(() => setIsRedrawing(false));
            }}
          />
          <Button
            tooltipLabel={isFullScreen ? t('tasteMap.exitFullScreen') : t('tasteMap.fullScreen')}
            iconName={isFullScreen ? 'close_fullscreen' : 'open_in_full'}
            className="!mr-0 text-sm"
            clickHandler={() => setIsFullScreen((v) => !v)}
          />
        </div>
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-2 pr-4">
        {COLOUR_MODES.map((m) => (
          <button key={m} type="button" aria-pressed={mode === m} className={chip(mode === m)} onClick={() => setMode(m)}>
            {modeLabel[m]}
          </button>
        ))}
        <span className="ml-3 mr-1 text-small text-ink-dim">{t('tasteMap.tools')}</span>
        {(['island', 'area', 'lasso'] as Tool[]).map((k) => (
          <button key={k} type="button" aria-pressed={tool === k} className={chip(tool === k)} onClick={() => setTool(k)}>
            {toolLabel[k]}
          </button>
        ))}
      </div>
      <p className="mb-3 pr-4 text-small text-ink-dim">
        {map && map.plays < FEW_PLAYS ? `${t('tasteMap.fewPlays', { count: map.plays })} ` : ''}
        {legend[mode]} {t('tasteMap.howTo')}
      </p>
      {map === null && <EmptyState className="h-full" iconName="bubble_chart" title={t('tasteMap.unavailable')} />}
      {map === undefined && <div className="h-full animate-pulse rounded-panel bg-surface-1" />}
      {map && (
        <div
          ref={boxRef}
          tabIndex={0}
          role="application"
          aria-label={t('tasteMap.title')}
          onKeyDown={onKeyDown}
          className="taste-map-box relative mb-4 mr-4 min-h-0 flex-1 overflow-hidden rounded-panel bg-surface-1 outline-none focus-visible:outline-2 focus-visible:outline-echo"
        >
          <canvas ref={baseRef} className="absolute inset-0 h-full w-full" />
          <canvas
            ref={overlayRef}
            className={`absolute inset-0 h-full w-full ${
              isDragging ? 'cursor-grabbing' : tool === 'island' ? 'cursor-pointer' : 'cursor-crosshair'
            }`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerLeave}
            onContextMenu={onContextMenu}
            onDoubleClick={() => hoveredPoint && changeCurrentActivePage('SongInfo', { songId: hoveredPoint.songId })}
          />
          <canvas
            ref={minimapRef}
            className="absolute bottom-3 right-3 cursor-pointer rounded-lg bg-surface-2/80 shadow-float"
            style={{ width: MINIMAP, height: MINIMAP }}
            onPointerDown={onMinimap}
            onPointerMove={onMinimap}
            aria-hidden
          />
          {hoveredPoint && hoveredAt && !isDragging && (
            <div
              className="pointer-events-none absolute z-10 w-64 -translate-x-1/2 rounded-lg bg-surface-3 px-3 py-2 text-small shadow-float"
              style={{
                left: Math.min(size.width - 136, Math.max(136, hoveredAt[0])),
                top: hoveredAt[1] + 16 > size.height - 150 ? hoveredAt[1] - 150 : hoveredAt[1] + 16
              }}
            >
              <div className="truncate font-medium text-ink">{hoveredPoint.title}</div>
              {hoveredPoint.artist && <div className="truncate text-ink-dim">{hoveredPoint.artist}</div>}
              <div className="mt-1 text-ink-dim">
                {[
                  hoveredPoint.tier,
                  t('tasteMap.plays', { count: hoveredPoint.plays }),
                  `${t('tasteMap.lastHeard')} ${whenHeard(hoveredPoint.lastDay)}`
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
              {why.length > 0 && (
                <div className="mt-1.5 border-t border-line pt-1.5">
                  <div className="text-ink-dim">{t('tasteMap.whyHere')}</div>
                  {why.map((w) => (
                    <div key={w.title} className="truncate text-ink">
                      {w.title} <span className="text-ink-dim">· {w.kind}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {summary && (
            <div className="absolute left-3 top-3 z-10 w-72 rounded-lg bg-surface-3/95 px-4 py-3 text-small shadow-float">
              <div className="flex items-center justify-between gap-2">
                {renaming !== null ? (
                  <input
                    autoFocus
                    value={renaming}
                    onChange={(e) => setRenaming(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') rename(renaming);
                      if (e.key === 'Escape') setRenaming(null);
                    }}
                    onBlur={() => rename(renaming)}
                    placeholder={t('tasteMap.renamePlaceholder')}
                    aria-label={t('tasteMap.rename')}
                    className="h-7 min-w-0 flex-1 rounded bg-surface-2 px-2 text-ink outline-none focus-visible:outline-2 focus-visible:outline-echo"
                  />
                ) : (
                  <div className="truncate text-base font-semibold text-ink">
                    {summary.name ?? t('tasteMap.selection', { count: summary.count })}
                  </div>
                )}
                {summary.island !== null && !islands[summary.island]?.loose && selection && renaming === null && (
                  <button
                    type="button"
                    className="rounded p-1 text-ink-dim hover:text-ink focus-visible:outline-2 focus-visible:outline-echo"
                    aria-label={t('tasteMap.rename')}
                    onClick={() => setRenaming(islands[summary.island as number]?.userName ?? '')}
                  >
                    <Icon name="edit" size={16} />
                  </button>
                )}
              </div>
              <div className="mt-1 text-ink-dim">
                {t('tasteMap.songsCount', { count: summary.count })} ·{' '}
                {t('tasteMap.hours', { hours: summary.hours.toFixed(summary.hours < 10 ? 1 : 0) })} ·{' '}
                {t('tasteMap.lastHeard')} {whenHeard(summary.lastDay)}
              </div>
              <div className="mt-2">
                <div className="flex justify-between text-ink">
                  <span>{t('tasteMap.libraryShare')}</span>
                  <span className="tabular-nums">{(summary.libraryShare * 100).toFixed(1)} %</span>
                </div>
                <div className="flex justify-between text-ink">
                  <span>{t('tasteMap.shuffleShare')}</span>
                  <span className="tabular-nums">{(summary.shuffleShare * 100).toFixed(1)} %</span>
                </div>
                <div className="mt-1 text-ink-dim">
                  {summary.shuffleShare > summary.libraryShare * 1.15
                    ? t('tasteMap.shareMore')
                    : summary.shuffleShare < summary.libraryShare * 0.85
                      ? t('tasteMap.shareLess')
                      : t('tasteMap.shareEven')}
                </div>
              </div>
              {summary.artists.length > 0 && (
                <div className="mt-2 truncate text-ink-dim">
                  {summary.artists.map(([a, n]) => `${a} (${n})`).join(', ')}
                </div>
              )}
              {summary.tiers.length > 0 && (
                <div className="truncate text-ink-dim">{summary.tiers.map(([a, n]) => `${a} ${n}`).join(' · ')}</div>
              )}
              {selection && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Button
                    label={t('tasteMap.play')}
                    iconName="auto_fix"
                    variant="primary"
                    className="!mr-0 text-sm"
                    clickHandler={playSelection}
                  />
                  <Button
                    label={t('tasteMap.lean')}
                    iconName="filter_center_focus"
                    className="!mr-0 text-sm"
                    clickHandler={leanToSelection}
                  />
                  <Button
                    label={t('tasteMap.savePlaylist')}
                    iconName="playlist_add"
                    className="!mr-0 text-sm"
                    clickHandler={saveSelection}
                  />
                  <Button
                    label={t('tasteMap.clear')}
                    iconName="close"
                    className="!mr-0 text-sm"
                    clickHandler={() => setSelection(null)}
                  />
                </div>
              )}
            </div>
          )}
          {journeyFrom && (
            <div className="absolute bottom-3 left-3 z-10 flex max-w-[60%] items-center gap-2 rounded-lg bg-surface-3/95 px-3 py-2 text-small shadow-float">
              <Icon name="route" size={16} />
              <span className="truncate text-ink">
                {journey.length > 0
                  ? t('tasteMap.journeyReady', { from: journeyFrom.title, count: journey.length })
                  : t('tasteMap.journeyPick', { name: journeyFrom.title })}
              </span>
              {journey.length > 0 && (
                <Button
                  label={t('tasteMap.journeyPlay')}
                  iconName="play_arrow"
                  variant="primary"
                  className="!mr-0 text-sm"
                  clickHandler={playJourney}
                />
              )}
              <Button
                tooltipLabel={t('tasteMap.clear')}
                iconName="close"
                className="!mr-0 text-sm"
                clickHandler={() => {
                  setJourneyFrom(null);
                  setJourney([]);
                }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );

  // Full screen goes to the body: the page sits in an animated (transformed) container, inside which
  // `fixed` is relative to the container, not the window.
  return isFullScreen ? (
    createPortal(
      <div className="taste-map-full-screen taste-map-page fixed inset-0 z-50 bg-canvas text-ink">{content}</div>,
      document.body
    )
  ) : (
    <MainContainer className="taste-map-page appear-from-bottom !h-full overflow-hidden !pb-0 text-ink">
      {content}
    </MainContainer>
  );
};

declare global {
  interface Window {
    /** For the stand (PLAN/17 budgets): draws a synthetic map of `n` songs and times a frame. */
    __nemoraTasteMapBench?: (n: number) => Record<string, number>;
  }
}

window.__nemoraTasteMapBench = (n: number): Record<string, number> => {
  const canvas = document.createElement('canvas');
  const [width, height] = [1200, 800];
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return {};
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const centres = Array.from({ length: 40 }, () => [0.1 + random() * 0.8, 0.1 + random() * 0.8]);
  const points: MapPoint[] = Array.from({ length: n }, (_, i) => {
    const c = centres[i % 40];
    return {
      songId: `s${i}`,
      x: Math.min(1, Math.max(0, c[0] + (random() - 0.5) * 0.12)),
      y: Math.min(1, Math.max(0, c[1] + (random() - 0.5) * 0.12)),
      weight: random(),
      title: `Song ${i}`,
      artist: `Artist ${i % 300}`,
      tone: `hsl(${i % 360}, 50%, 50%)`,
      neighbours: [],
      linkKinds: [],
      island: i % 40,
      plays: i % 3,
      heardMs: 1000,
      lastDay: today() - (i % 200),
      tier: null,
      tierValue: null,
      energy: null
    };
  });
  const palette = readPalette(document.documentElement);
  const index = buildIndex(points);
  const terrainStart = performance.now();
  const terrain = buildTerrain(points);
  const land = terrainBitmap(terrain, palette);
  const terrainMs = performance.now() - terrainStart;
  const fit = fitCamera(width, height);
  const islands = centres.map((c, id) => ({
    id,
    name: `Island ${id}`,
    userName: null,
    loose: false,
    size: n / 40,
    x: c[0],
    y: c[1],
    label: `Island ${id}`
  }));
  const frameMs = (camera: Camera) => {
    const start = performance.now();
    for (let k = 0; k < 5; k += 1)
      drawBase(context, {
        points,
        islands,
        terrain,
        land,
        camera,
        zoom: zoomOf(camera, fit),
        mode: 'cover',
        palette,
        width,
        height,
        selected: null,
        covers: new Map(),
        intro: 1,
        font: 'sans-serif'
      });
    return (performance.now() - start) / 5;
  };
  const hitStart = performance.now();
  for (let k = 0; k < 1000; k += 1) hitTest(points, index, fit, 1, random() * width, random() * height);
  return {
    terrainMs,
    frameFitMs: frameMs(fit),
    frameZoom3Ms: frameMs(zoomAt(fit, fit, width / 2, height / 2, 3)),
    frameZoom10Ms: frameMs(zoomAt(fit, fit, width / 2, height / 2, 10)),
    hoverMs: (performance.now() - hitStart) / 1000
  };
};

export default TasteMapPage;

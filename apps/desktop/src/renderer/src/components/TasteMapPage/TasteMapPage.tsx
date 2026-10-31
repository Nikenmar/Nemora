import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { useStore } from '@tanstack/react-store';
import { store } from '@renderer/store';
import { AppUpdateContext } from '../../contexts/AppUpdateContext';
import MainContainer from '../MainContainer';
import Button from '../Button';
import EmptyState from '../ui/EmptyState';

type Point = {
  songId: string;
  x: number;
  y: number;
  weight: number;
  title: string;
  artist: string | null;
  tone: string | null;
  neighbours: string[];
};
type TasteMap = { points: Point[]; plays: number; hash: string };

/** Fewer plays than this and the map leans on artists and tiers (core `tastemap::FEW_PLAYS`). */
const FEW_PLAYS = 200;
/** A click selects the songs within this share of the map around it; shift-click adds to it. */
const PICK_RADIUS = 0.07;
const PAD = 28;
const LABEL_GRID = 5;

const radiusOf = (p: Point) => 2.5 + 4.5 * p.weight;

/**
 * Stats > Taste map (PLAN/14 C5): the library laid out by how it is listened to (core
 * `tastemap.rs`). Songs heard together, by the same artist or in the same tier sit together; dots are
 * tinted by their covers and larger for songs Smart Shuffle favours. Hover shows a song and its
 * links, a click selects the area around it, and Play this area starts a Smart Shuffle queue from it.
 */
const TasteMapPage = () => {
  const { t } = useTranslation();
  const { createQueue, toggleTierShuffle, changeCurrentActivePage } = useContext(AppUpdateContext);
  const isTierShuffling = useStore(store, (state) => state.player.isTierShuffling);
  const [map, setMap] = useState<TasteMap | null>();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [hovered, setHovered] = useState<Point | null>(null);
  const [areas, setAreas] = useState<{ x: number; y: number }[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let current = true;
    invoke<TasteMap>('taste_map')
      .then((loaded) => current && setMap(loaded))
      .catch(() => current && setMap(null));
    return () => {
      current = false;
    };
  }, []);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return undefined;
    const observer = new ResizeObserver(([entry]) =>
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    );
    observer.observe(box);
    return () => observer.disconnect();
  }, [map]);

  // The map is square; it sits in the middle of the box.
  const frame = useMemo(() => {
    const side = Math.max(0, Math.min(size.width, size.height) - PAD * 2);
    return { side, left: (size.width - side) / 2, top: (size.height - side) / 2 };
  }, [size]);
  const toScreen = useCallback(
    (p: { x: number; y: number }) => [frame.left + p.x * frame.side, frame.top + p.y * frame.side] as const,
    [frame]
  );

  const selected = useMemo(() => {
    if (!map || areas.length === 0) return [];
    return map.points.filter((p) => areas.some((a) => Math.hypot(p.x - a.x, p.y - a.y) <= PICK_RADIUS));
  }, [map, areas]);

  // Labels: the artist that dominates a stretch of the map names it.
  const labels = useMemo(() => {
    if (!map) return [];
    const cells = new Map<string, Point[]>();
    for (const p of map.points) {
      const key = `${Math.min(LABEL_GRID - 1, Math.floor(p.x * LABEL_GRID))}:${Math.min(LABEL_GRID - 1, Math.floor(p.y * LABEL_GRID))}`;
      cells.set(key, [...(cells.get(key) ?? []), p]);
    }
    const out: { text: string; x: number; y: number }[] = [];
    for (const points of cells.values()) {
      const counts = new Map<string, Point[]>();
      for (const p of points) if (p.artist) counts.set(p.artist, [...(counts.get(p.artist) ?? []), p]);
      const [artist, theirs] = [...counts.entries()].sort((a, b) => b[1].length - a[1].length)[0] ?? [];
      if (!artist || !theirs || theirs.length < 6 || theirs.length < points.length * 0.25) continue;
      const x = theirs.reduce((s, p) => s + p.x, 0) / theirs.length;
      const y = theirs.reduce((s, p) => s + p.y, 0) / theirs.length;
      out.push({ text: artist, x, y });
    }
    return out;
  }, [map]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context || !map) return;
    const scale = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.width * scale);
    canvas.height = Math.round(size.height * scale);
    context.setTransform(scale, 0, 0, scale, 0, 0);
    context.clearRect(0, 0, size.width, size.height);
    const style = getComputedStyle(canvas);
    const ink = `rgb(${style.getPropertyValue('--ink').trim()})`;
    const accent = `rgb(${style.getPropertyValue('--accent').trim()})`;
    const chosen = new Set(selected.map((p) => p.songId));
    const byId = new Map(map.points.map((p) => [p.songId, p]));

    for (const area of areas) {
      const [x, y] = toScreen(area);
      context.beginPath();
      context.arc(x, y, PICK_RADIUS * frame.side, 0, Math.PI * 2);
      context.fillStyle = accent;
      context.globalAlpha = 0.14;
      context.fill();
      context.strokeStyle = accent;
      context.globalAlpha = 0.6;
      context.lineWidth = 1.5;
      context.stroke();
    }
    if (hovered) {
      const [hx, hy] = toScreen(hovered);
      context.strokeStyle = ink;
      context.globalAlpha = 0.25;
      context.lineWidth = 1;
      context.beginPath();
      for (const id of hovered.neighbours) {
        const other = byId.get(id);
        if (!other) continue;
        const [ox, oy] = toScreen(other);
        context.moveTo(hx, hy);
        context.lineTo(ox, oy);
      }
      context.stroke();
    }
    for (const p of map.points) {
      const [x, y] = toScreen(p);
      context.beginPath();
      context.arc(x, y, radiusOf(p), 0, Math.PI * 2);
      context.fillStyle = p.tone ?? ink;
      context.globalAlpha = areas.length > 0 && !chosen.has(p.songId) ? 0.18 : 0.9;
      context.fill();
      if (p === hovered || chosen.has(p.songId)) {
        context.globalAlpha = 1;
        context.lineWidth = p === hovered ? 2 : 1;
        context.strokeStyle = p === hovered ? ink : accent;
        context.stroke();
      }
    }
    context.globalAlpha = 1;
    context.font = `600 12px ${style.fontFamily}`;
    context.textAlign = 'center';
    context.fillStyle = ink;
    for (const label of labels) {
      const [x, y] = toScreen(label);
      context.globalAlpha = 0.7;
      context.fillText(label.text, x, y - 12);
    }
    context.globalAlpha = 1;
  }, [map, size, frame, hovered, areas, selected, labels, toScreen]);

  const pointAt = useCallback(
    (clientX: number, clientY: number) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect || !map) return null;
      const [mx, my] = [clientX - rect.left, clientY - rect.top];
      let best: Point | null = null;
      let bestDistance = 10;
      for (const p of map.points) {
        const [x, y] = toScreen(p);
        const d = Math.hypot(x - mx, y - my) - radiusOf(p);
        if (d < bestDistance) {
          best = p;
          bestDistance = d;
        }
      }
      return { point: best, x: (mx - frame.left) / frame.side, y: (my - frame.top) / frame.side };
    },
    [map, toScreen, frame]
  );

  const playArea = useCallback(() => {
    const ids = selected.map((p) => p.songId);
    if (ids.length === 0) return;
    if (isTierShuffling) createQueue(ids, 'songs', true, undefined, true);
    else {
      createQueue(ids, 'songs', false, undefined, true);
      toggleTierShuffle(true);
    }
  }, [selected, isTierShuffling, createQueue, toggleTierShuffle]);

  const hoveredAt = hovered ? toScreen(hovered) : null;

  return (
    <MainContainer className="taste-map-page appear-from-bottom !h-full overflow-hidden !pb-0 text-ink">
      <div className="flex h-full min-h-0 flex-col">
        <div className="title-container mb-2 mt-1 flex items-center justify-between pr-4 text-page font-semibold text-ink">
          <div className="container flex items-center">{t('tasteMap.title')}</div>
          <div className="other-controls-container flex items-center">
            {areas.length > 0 && (
              <Button
                label={t('tasteMap.clear')}
                iconName="close"
                className="mr-2 text-sm"
                clickHandler={() => setAreas([])}
              />
            )}
            <Button
              label={t('tasteMap.playArea', { count: selected.length })}
              iconName="auto_fix"
              variant="primary"
              className="mr-4 text-sm"
              isDisabled={selected.length === 0}
              clickHandler={playArea}
            />
          </div>
        </div>
        <p className="mb-3 pr-4 text-small text-ink-dim">
          {map && map.plays < FEW_PLAYS ? t('tasteMap.fewPlays', { count: map.plays }) : t('tasteMap.description')}
        </p>
        {map === null && (
          <EmptyState className="h-full" iconName="bubble_chart" title={t('tasteMap.unavailable')} />
        )}
        {map === undefined && <div className="h-full animate-pulse rounded-panel bg-surface-1" />}
        {map && (
          <div ref={boxRef} className="relative mb-4 mr-4 min-h-0 flex-1 rounded-panel bg-surface-1">
            <canvas
              ref={canvasRef}
              className="absolute inset-0 h-full w-full cursor-crosshair"
              aria-label={t('tasteMap.title')}
              onPointerMove={(e) => {
                const hit = pointAt(e.clientX, e.clientY);
                setHovered(hit?.point ?? null);
              }}
              onPointerLeave={() => setHovered(null)}
              onClick={(e) => {
                const hit = pointAt(e.clientX, e.clientY);
                if (!hit) return;
                const area = { x: hit.x, y: hit.y };
                setAreas((current) => (e.shiftKey ? [...current, area] : [area]));
              }}
              onDoubleClick={() => hovered && changeCurrentActivePage('SongInfo', { songId: hovered.songId })}
            />
            {hovered && hoveredAt && (
              <div
                className="pointer-events-none absolute z-10 max-w-[16rem] -translate-x-1/2 rounded-lg bg-surface-3 px-3 py-2 text-small shadow-float"
                style={{ left: hoveredAt[0], top: hoveredAt[1] + 14 }}
              >
                <div className="truncate font-medium text-ink">{hovered.title}</div>
                {hovered.artist && <div className="truncate text-ink-dim">{hovered.artist}</div>}
              </div>
            )}
          </div>
        )}
      </div>
    </MainContainer>
  );
};

export default TasteMapPage;

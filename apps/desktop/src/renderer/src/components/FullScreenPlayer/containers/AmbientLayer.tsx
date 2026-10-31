import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '@tanstack/react-store';
import { store } from '@renderer/store';
import { readCoverTone } from '../../../other/coverTone';
import useAudioVisual, { follow } from '../../../hooks/useAudioVisual';

/**
 * Ambient full screen (PLAN/14 B3): over the blurred cover, two slow-drifting fields in the cover's
 * two tones (other/coverTone.ts) that breathe with the track's loudness. Drawn only while `isOn`;
 * the drift is a transform animation and the breath the layer's opacity, both on the compositor.
 */
const AmbientLayer = memo(({ isOn }: { isOn: boolean }) => {
  const artworkPath = useStore(store, (state) => state.currentSongData.artworkPath);
  const [tone, setTone] = useState<{ primary: string; secondary: string } | null>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const level = useRef(0.6);

  useEffect(() => {
    let current = true;
    if (artworkPath)
      readCoverTone(artworkPath)
        .then((read) => current && setTone(read))
        .catch(() => current && setTone(null));
    return () => {
      current = false;
    };
  }, [artworkPath]);

  const onFrame = useCallback((frame: Float32Array, elapsed: number) => {
    const goal = Math.min(1, Math.max(0, (frame[0] - 0.55) / 0.35));
    level.current = follow(level.current, goal, elapsed, 0.6, 1.2);
    if (layerRef.current) layerRef.current.style.opacity = (0.55 + 0.45 * level.current).toFixed(3);
  }, []);
  useAudioVisual(isOn, onFrame, undefined, 15);

  if (!isOn) return null;
  const primary = tone?.primary ?? 'rgb(var(--accent))';
  const secondary = tone?.secondary ?? primary;
  return (
    <div className="ambient-layer pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <div ref={layerRef} className="absolute inset-0 will-change-[opacity]">
        <div
          className="ambient-field absolute -left-1/4 -top-1/4 h-[90vh] w-[90vw] will-change-transform"
          style={{ background: `radial-gradient(closest-side, ${primary}, transparent)` }}
        />
        <div
          className="ambient-field ambient-field-2 absolute -bottom-1/4 -right-1/4 h-[80vh] w-[80vw] will-change-transform"
          style={{ background: `radial-gradient(closest-side, ${secondary}, transparent)` }}
        />
      </div>
    </div>
  );
});

AmbientLayer.displayName = 'AmbientLayer';
export default AmbientLayer;

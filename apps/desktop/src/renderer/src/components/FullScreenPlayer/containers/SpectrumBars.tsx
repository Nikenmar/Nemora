import { memo, useCallback, useRef } from 'react';
import useAudioVisual, { follow, Range } from '../../../hooks/useAudioVisual';

const COUNT = 24;
const BAR = 3;
const HEIGHT = 32;

/**
 * Bars under the full-screen cover (PLAN/14 B4): the envelope's 12 bands spread over 24 thin bars,
 * each between its two nearest bands, each scaled to its own recent range. One small canvas,
 * redrawn per frame: cheaper than restyling 24 elements.
 */
const SpectrumBars = memo(() => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const levels = useRef(new Float32Array(COUNT));
  const ranges = useRef(Array.from({ length: COUNT }, () => new Range()));

  const onFrame = useCallback((frame: Float32Array, elapsed: number) => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const scale = window.devicePixelRatio || 1;
    const width = Math.round(canvas.clientWidth * scale);
    const height = Math.round(HEIGHT * scale);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    context.clearRect(0, 0, width, height);
    context.fillStyle = 'rgb(255 255 255 / 0.6)';
    const bar = BAR * scale;
    const step = (width - bar) / (COUNT - 1);
    const bands = frame.length - 1;
    context.beginPath();
    for (let i = 0; i < COUNT; i += 1) {
      const at = (i / (COUNT - 1)) * (bands - 1);
      const low = Math.floor(at);
      const high = Math.min(bands - 1, low + 1);
      const value = frame[1 + low] + (frame[1 + high] - frame[1 + low]) * (at - low);
      const goal = Math.max(0.04, ranges.current[i].read(value, elapsed) ** 1.5);
      levels.current[i] = follow(levels.current[i], goal, elapsed, 0.03, 0.18);
      const h = Math.max(bar, levels.current[i] * height);
      context.roundRect(i * step, height - h, bar, h, bar / 2);
    }
    context.fill();
  }, []);
  useAudioVisual(true, onFrame, canvasRef);

  return (
    <canvas
      ref={canvasRef}
      className="full-screen-spectrum -mt-1 block w-full"
      style={{ height: HEIGHT }}
      aria-hidden
    />
  );
});

SpectrumBars.displayName = 'SpectrumBars';
export default SpectrumBars;

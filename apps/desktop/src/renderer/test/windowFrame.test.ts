import { describe, expect, it } from 'vitest';
import { clientSizeFor } from '@platform/shell/geometry';

/**
 * The saved window rectangle is the outer one and `setSize` sets the client area: the frame comes
 * off first, or the window grows by it at every start (measured: 2089x1285 -> 2105x1294 -> 2121x1303).
 */
describe('restoring the window size', () => {
  it('takes the frame off the outer size it sets', () => {
    const outer = { width: 2105, height: 1294 };
    const client = { width: 2089, height: 1285 };
    expect(clientSizeFor({ width: 2089, height: 1285 }, outer, client)).toEqual({ width: 2073, height: 1276 });
  });

  it('applied again, lands on the same outer size (no growth)', () => {
    const frame = { width: 16, height: 9 };
    let outer = { width: 2089, height: 1285 };
    for (let start = 0; start < 10; start += 1) {
      const client = { width: outer.width - frame.width, height: outer.height - frame.height };
      const set = clientSizeFor(outer, outer, client);
      outer = { width: set.width + frame.width, height: set.height + frame.height };
    }
    expect(outer).toEqual({ width: 2089, height: 1285 });
  });

  it('a window without a frame, or a strange answer, is never made bigger or empty', () => {
    expect(clientSizeFor({ width: 800, height: 600 }, { width: 800, height: 600 }, { width: 800, height: 600 })).toEqual({ width: 800, height: 600 });
    expect(clientSizeFor({ width: 800, height: 600 }, { width: 700, height: 500 }, { width: 800, height: 600 })).toEqual({ width: 800, height: 600 });
    expect(clientSizeFor({ width: 10, height: 10 }, { width: 900, height: 900 }, { width: 10, height: 10 })).toEqual({ width: 1, height: 1 });
  });
});

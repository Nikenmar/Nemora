import { describe, expect, test } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `additionalBrowserArgs` carries two unrelated obligations, and both fail
 * silently when the string is edited without knowing why each part is there.
 *
 * 1. OBS "Application Audio Capture" targets the process id of the window it
 *    was pointed at — for us `nemora.exe` — and captures that process TREE.
 *    Audio is not rendered by `nemora.exe` at all: WebView2 renders it, and by
 *    default Chromium puts the renderer of audio in its own
 *    `audio.mojom.AudioService` utility process, a child of the WebView2
 *    browser process, which makes it a GRANDCHILD of `nemora.exe`. The capture
 *    then initializes without an error and delivers pure silence, which is why
 *    this cost a real investigation rather than a glance at a log: OBS reports
 *    `[VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK] initialized` in exactly the same
 *    way whether or not any audio reaches it. Measured against the players that
 *    do work: Opera renders audio in a DIRECT child of `opera.exe`, and
 *    Electron did the same from its main process, so the audio session was one
 *    level below the target in both. Disabling `AudioServiceOutOfProcess` moves
 *    audio into the WebView2 browser process, which is a direct child of
 *    `nemora.exe`, and the capture works.
 *
 * 2. Setting the property REPLACES Tauri's own default arguments rather than
 *    appending to them, so `msWebOOUI` and `msPdfOOUI` have to be repeated here
 *    or the out-of-process WebView UI comes back with them.
 *
 * A string comparison over a config file rather than a unit test of logic, for
 * the same reason scheme.test.ts and capabilities.test.ts are: this seam is
 * where the drift happens and nothing in the compiler watches it.
 */

const repoRoot = join(__dirname, '..', '..', '..', '..');
const read = (...segments: string[]) => readFileSync(join(repoRoot, ...segments), 'utf8');

const REQUIRED_DISABLED_FEATURES = [
  // Tauri's defaults, lost the moment this property is set at all.
  'msWebOOUI',
  'msPdfOOUI',
  // Keeps the audio session inside the WebView2 browser process, one level
  // below nemora.exe, so a process-tree audio capture can see it.
  'AudioServiceOutOfProcess'
];

describe('additionalBrowserArgs', () => {
  const config = JSON.parse(read('src-tauri', 'tauri.conf.json')) as {
    app: { windows: { additionalBrowserArgs?: string }[] };
  };
  const args = config.app.windows[0]?.additionalBrowserArgs ?? '';

  test('disables every feature the window depends on being disabled', () => {
    const match = /--disable-features=([^\s"]+)/u.exec(args);
    expect(match).not.toBeNull();

    const disabled = (match?.[1] ?? '').split(',');
    for (const feature of REQUIRED_DISABLED_FEATURES) {
      expect(disabled).toContain(feature);
    }
  });
});

import { describe, expect, test } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const rendererBootstrap = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/index.tsx'),
  'utf8'
);
const rustBootstrap = readFileSync(resolve(process.cwd(), 'src-tauri/src/main.rs'), 'utf8');

describe('startup visibility contract', () => {
  test('registers and reads an explicit auto-launch marker', () => {
    expect(rustBootstrap).toContain('.args(["--autostart"])');
    expect(rendererBootstrap).toContain("const AUTO_LAUNCH_ARGUMENT = '--autostart'");
    expect(rendererBootstrap).toContain('startupArgs.includes(AUTO_LAUNCH_ARGUMENT)');
  });

  test('only suppresses the successful reveal for a proven hidden auto-launch', () => {
    expect(rendererBootstrap).toContain(
      'userData.preferences?.openWindowAsHiddenOnSystemStart === true'
    );
    expect(rendererBootstrap).toContain(
      'if (revealWindowOnSuccessfulMount) revealWindowAfterPaint()'
    );
    expect(rendererBootstrap.match(/revealWindowAfterPaint\(\);/gu)).toHaveLength(2);
  });

  test('repairs a legacy markerless registration only once', () => {
    expect(rendererBootstrap).toContain("const AUTO_LAUNCH_REPAIR_VERSION = '1'");
    expect(rendererBootstrap).toContain('await window.api.settingsHelpers.toggleAutoLaunch(true)');
    expect(rendererBootstrap).toContain(
      'writeStartupState(AUTO_LAUNCH_REPAIR_KEY, AUTO_LAUNCH_REPAIR_VERSION)'
    );
  });
});

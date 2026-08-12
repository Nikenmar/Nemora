import { describe, expect, test } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The custom scheme is declared in four places that must agree, and when they
 * disagree the app does not crash — it quietly shows default artwork and
 * refuses to play anything.
 *
 * That is not hypothetical. After the rename to `nemora://`, the meta CSP in
 * index.html still allowed only `nora.localhost`. A meta CSP INTERSECTS with
 * the header CSP from tauri.conf.json rather than replacing it, so the
 * intersection for img-src and media-src became empty: WebView2 blocked every
 * cover and every track before the request reached the Rust handler, which
 * meant nothing was logged server-side either. The visible symptom was
 * "the artwork is gone" with a bare MediaError and no explanation.
 *
 * These checks are string comparisons across config files rather than unit
 * tests of logic, because that is exactly the seam where the drift happened.
 */

const repoRoot = join(__dirname, '..', '..', '..', '..');
const read = (...segments: string[]) => readFileSync(join(repoRoot, ...segments), 'utf8');

const SCHEME = 'nemora';
const CSP_DIRECTIVES = ['connect-src', 'media-src', 'img-src'] as const;

describe('custom scheme declarations agree', () => {
  test('the Rust handler, tauri.conf.json and the renderer all name the same scheme', () => {
    const mainRs = read('src-tauri', 'src', 'main.rs');
    const match = /register_asynchronous_uri_scheme_protocol\(\s*"([a-z0-9-]+)"/u.exec(mainRs);
    expect(match?.[1]).toBe(SCHEME);

    const config = JSON.parse(read('src-tauri', 'tauri.conf.json')) as {
      app: { security: { csp: Record<string, string> } };
    };
    for (const directive of CSP_DIRECTIVES) {
      expect(config.app.security.csp[directive]).toContain(`http://${SCHEME}.localhost`);
    }
  });

  test('the meta CSP allows the scheme, since it intersects with the header CSP', () => {
    // HTML comments first: index.html keeps an older policy commented out, and
    // a checker that reads a disabled tag proves nothing about what ships.
    const html = read('src', 'renderer', 'index.html').replace(/<!--[\s\S]*?-->/gu, '');
    const meta = /http-equiv="Content-Security-Policy"\s*\n?\s*content="([^"]+)"/u.exec(html);
    expect(meta).not.toBeNull();
    const policy = meta?.[1] ?? '';

    for (const directive of CSP_DIRECTIVES) {
      const value = new RegExp(`${directive}([^;]*)`, 'u').exec(policy)?.[1] ?? '';
      expect(value).toContain(`http://${SCHEME}.localhost`);
    }

    // The old scheme is a prefix-free distinct host: allowing it is harmless,
    // but allowing ONLY it is what emptied the intersection.
    expect(policy).not.toMatch(/[^e]nora\.localhost/u);
  });
});

import { Buffer } from 'buffer';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Must happen before any dynamic import below. node-id3 and the base64 helpers
// pulled in by the tag and artwork paths are CommonJS packages that expect a
// GLOBAL Buffer to exist while their module body is evaluated - not merely an
// importable one. Electron's renderer had it; WebView2 does not, and the
// failure surfaces as "ReferenceError: Buffer is not defined" during startup,
// far from the package that actually needs it.
if (typeof (globalThis as { Buffer?: unknown }).Buffer === 'undefined') {
  (globalThis as { Buffer?: unknown }).Buffer = Buffer;
}

const container = document.getElementById('root') as HTMLElement;
const root = createRoot(container);

/** True inside the Tauri shell; false under Electron and in plain browsers. */
const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/**
 * The window starts hidden and is revealed once there is something to show.
 *
 * `transparent: true` is what stops WebView2 from leaving black or white bars
 * along the edges during a resize - the webview surface is anchored top-left
 * and repaints asynchronously, so the right and bottom always trail the drag,
 * whichever edge is being pulled. The cost of that flag is a flash on the very
 * first paint, and hiding the window until the app has painted is what pays it.
 *
 * REVEALING MUST NOT DEPEND ON STARTUP SUCCEEDING. A window that is never shown
 * is an app that did not start, with no error on screen to say so - which is
 * worse than any flash. Hence: a timer arms the reveal immediately, the error
 * path reveals too, and the call is idempotent.
 */
const REVEAL_DEADLINE_MS = 4000;
let windowRevealed = false;

const revealWindow = (): void => {
  if (!isTauri || windowRevealed) return;
  windowRevealed = true;
  void import('@tauri-apps/api/window')
    .then(async ({ getCurrentWindow }) => {
      const appWindow = getCurrentWindow();
      await appWindow.show();
      await appWindow.setFocus();
    })
    .catch((error: unknown) => console.error('Failed to reveal the window', error));
};

/** Reveals after the frame that actually paints, not the one that schedules it. */
const revealWindowAfterPaint = (): void => {
  requestAnimationFrame(() => requestAnimationFrame(revealWindow));
};

if (isTauri) setTimeout(revealWindow, REVEAL_DEADLINE_MS);

/** Everything console.error saw, so the self-check can fail on silent errors. */
const capturedConsoleErrors: string[] = [];

/**
 * Startup order matters here, and every step exists because something broke
 * without it.
 *
 * Nothing that touches `window.api` may be imported STATICALLY. A static import
 * is hoisted and evaluated before any code in this module, and two renderer
 * modules use the API at their own top level: `./i18n` awaits
 * `window.api.userData.getUserData()` (i18n.ts:24), and `./App` pulls in
 * store.ts, which calls `storage.checkLocalStorage()` at module scope
 * (store.ts:9).
 *
 * Under Electron that was safe - the preload created `window.api` before the
 * bundle ran at all. Under Tauri this file installs the bridge, so an eager
 * import of either module crashed with "Cannot read properties of undefined
 * (reading 'userData')" and left the window blank.
 *
 * Hence: install the bridge, migrate legacy storage, hydrate the stores, and
 * only then let anything else load. Skipping the migration would be worse than
 * a blank window, because checkLocalStorage() "repairs" a store it considers
 * invalid by writing defaults - destroying the SongGuessr save that the
 * migration is about to import.
 */
async function mount() {
  if (isTauri) {
    // Electron created its window with webPreferences.zoomFactor 0.9
    // (src/main/main.ts:173). Tauri has no such option, so without this the
    // whole interface renders 11% larger than the Electron build.
    const { getCurrentWebview } = await import('@tauri-apps/api/webview');
    await getCurrentWebview().setZoom(0.9).catch(() => undefined);

    // Renderer failures used to land only in a devtools console, which means a
    // user's bug report contains nothing. Forward them to the log file, where
    // src/main's Electron logger used to put them.
    const { error: logError } = await import('@tauri-apps/plugin-log');
    const originalConsoleError = console.error.bind(console);
    console.error = (...args: unknown[]) => {
      originalConsoleError(...args);
      capturedConsoleErrors.push(
        args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : String(a))).join(' ')
      );
      void logError(
        args
          .map((a) =>
            a instanceof Error ? `${a.name}: ${a.message}\n${a.stack ?? ''}` : String(a)
          )
          .join(' ')
      ).catch(() => undefined);
    };
    window.addEventListener('unhandledrejection', (event) => {
      const reason = event.reason;
      const detail =
        reason instanceof Error
          ? `${reason.name}: ${reason.message}
${reason.stack ?? ''}`
          : String(reason);
      capturedConsoleErrors.push(`Unhandled rejection: ${detail}`);
      void logError(`Unhandled rejection: ${detail}`).catch(() => undefined);
    });

    // External APIs go through Rust.
    //
    // In Electron this network code ran in the MAIN process, where fetch has no
    // CORS enforcement. In a webview it is an ordinary browser request from
    // http://tauri.localhost, and Deezer, Last.fm and Genius send no
    // Access-Control-Allow-Origin - so every artist bio, lyric lookup and
    // scrobble failed with "TypeError: Failed to fetch".
    //
    // Only remote http(s) URLs are redirected; same-origin requests and the
    // nemora:// scheme keep the native fetch, which serves audio and artwork.
    const { info } = await import('@tauri-apps/plugin-log');
    const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
    const browserFetch = globalThis.fetch.bind(globalThis);
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const isRemote = /^https?:\/\//i.test(url) && !/^https?:\/\/[^/]*\.localhost\//i.test(url);
      return isRemote ? tauriFetch(input, init) : browserFetch(input, init);
    }) as typeof globalThis.fetch;

    const { installApi } = await import('@platform/api');
    installApi();

    // NO automatic migration from Nora here. This gate was correct while the
    // Tauri build still WAS Nora and was migrating its own profile in place.
    // After the rebrand it did something else entirely: a first launch of
    // Nemora on a machine that has Nora silently adopted Nora's renderer state
    // - queue, sort orders, equalizer, duels, SongGuessr - while the library,
    // playlists and statistics stayed empty, because those live in the JSON
    // stores it does not touch. That half-imported profile is exactly the
    // mixed state docs/tauri-port/00-PLAN.md forbids, and the user never asked
    // for it. Adopting Nora's data is now one explicit action: Settings ->
    // Import from Nora, which moves the stores, the artwork and those same
    // three localStorage keys together. The decoding machinery in
    // @platform/migration is still used - by that import.
    const { hydrateRuntime } = await import('@platform/runtime');
    await hydrateRuntime();

    await info(`Nemora started. navigator.onLine=${navigator.onLine}.`);
  }

  // Port self-check: exercise the real window.api surface, write a report and
  // quit. Driven by scripts/port-check.mjs via NORA_SELFCHECK_OUT; a normal
  // launch never takes this branch.
  if (isTauri) {
    const { invoke } = await import('@tauri-apps/api/core');
    const target = await invoke<string | null>('selfcheck_output_path').catch(() => null);
    if (target) {
      const { runSelfCheck } = await import('@platform/selfcheck');
      const report = await runSelfCheck(capturedConsoleErrors);
      const { writeTextFile } = await import('@tauri-apps/plugin-fs');
      await writeTextFile(target, JSON.stringify(report, null, 2));
      const { exit } = await import('@tauri-apps/plugin-process');
      await exit(report.summary.threw + report.summary.timeout > 0 ? 1 : 0);
      return;
    }
  }

  if (isTauri) {
    // The shell controllers were built but never started, so the tray icon
    // simply never existed and the taskbar buttons only appeared once playback
    // toggled - at launch, with a paused track, nothing had told Windows what
    // to draw. src/main/main.ts:252 created the tray during boot and
    // manageTaskbarPlaybackButtonControls seeded the buttons the same way.
    const { TrayController, tauriWindowPort, tauriTrayFactory, tauriExitPort } = await import(
      '@platform/shell'
    );
    const tray = new TrayController(tauriWindowPort, tauriTrayFactory, tauriExitPort);
    await tray.start().catch((error: unknown) => console.error('Tray failed to start', error));

    // Seeds the thumbbar and keeps its native light/dark icons following
    // Windows. This used to be one raw invoke that computed the theme once and
    // was never repeated, so the icons only corrected themselves the next time
    // playback toggled.
    const { startTaskbarButtons, startWindowGeometry, startWindowBackgroundSync } = await import(
      '@platform/api'
    );
    startTaskbarButtons();

    // Paints the window and webview layers in the user's actual theme. The
    // config already paints them dark from the first frame; this is what keeps
    // a light-theme profile from getting a dark edge while resizing.
    startWindowBackgroundSync();

    // Restores the saved window rect and installs the move/resize listeners
    // that persist it. Nothing did this before: `windowDiamensions` was never
    // written by any production path, so a resized window reopened at the
    // default size every launch.
    await startWindowGeometry().catch((error: unknown) =>
      console.error('Window geometry could not be restored', error)
    );

    // Watch the music folders for changes made outside the app. Deliberately
    // not awaited: installing the watches is filesystem work and nothing about
    // showing the player should wait on it.
    void import('@platform/runtime').then(({ getRuntime }) =>
      getRuntime()
        .startLibraryWatcher()
        .catch((error: unknown) => console.error('Library watcher failed to start', error))
    );

    // The update check. The client was written with the port and then never
    // called from anywhere, so the app shipped with an updater feed, a signed
    // artifact and no code that ever asked whether an update existed.
    //
    // Deliberately NOT awaited: it reaches the network, and nothing about
    // starting the player should wait on that. It is also deferred past first
    // paint, because the confirmation is a native modal and one that appears
    // while the window is still assembling reads as a fault rather than an
    // offer.
    //
    // Skipped entirely while being benchmarked. A startup measurement that
    // waits for the CPU to go quiet would otherwise be timing a request to
    // GitHub - the same build measured 3.6 s and 11.8 s on one machine purely
    // on how fast that request came back.
    const { invoke: invokeCommand } = await import('@tauri-apps/api/core');
    const benchmarking = await invokeCommand<boolean>('benchmark_mode').catch(() => false);
    if (!benchmarking) {
      void import('@platform/updater').then(async ({ createTauriUpdater }) => {
        const { isInDevelopment } = window.api.properties;
        const updater = createTauriUpdater({
          isDevelopment: isInDevelopment,
          logger: {
            debug: (message, data) => console.debug(message, data),
            info: (message, data) => console.info(message, data),
            warn: (message, data) => console.warn(message, data),
            error: (message, data) => console.error(message, data)
          }
        });
        await new Promise((resolve) => setTimeout(resolve, 4000));
        const result = await updater.checkForUpdates();
        // A failed check is reported, never folded into "you are up to date":
        // someone who cannot reach the server should know that.
        if (result.status === 'failed') console.error('Update check failed.', result.error);
      });
    }
  }

  await import('./i18n');
  const { default: App } = await import('./App');

  root.render(
    <StrictMode>
      <App />
    </StrictMode>
  );
  revealWindowAfterPaint();
}

mount().catch((error: unknown) => {
  // Never fall through to the app with un-migrated storage: that is how someone
  // silently loses their listening history. Show the failure instead.
  const detail =
    error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ''}` : String(error);
  console.error('Nora failed to start', error);

  if (isTauri) {
    // A startup failure that exists only in a devtools console is a failure
    // nobody can report. The logger is itself an IPC call, so this is
    // best-effort.
    void import('@tauri-apps/plugin-log')
      .then(({ error: logError }) => logError(`Nora failed to start: ${detail}`))
      .catch(() => undefined);
  }

  root.render(
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        padding: '32px',
        fontFamily: 'system-ui, sans-serif',
        textAlign: 'center'
      }}
    >
      <h1 style={{ fontSize: '18px', margin: 0 }}>Nemora could not start</h1>
      <p style={{ margin: 0, opacity: 0.75, maxWidth: '52ch' }}>
        Your existing data was left untouched. Restart Nemora to try again; if this keeps happening,
        report the error below.
      </p>
      <pre
        style={{
          margin: 0,
          padding: '12px',
          maxWidth: '80ch',
          overflow: 'auto',
          textAlign: 'left',
          opacity: 0.9
        }}
      >
        {detail}
      </pre>
    </div>
  );
  // The window is hidden until something asks for it, and a startup failure is
  // exactly the case where the user must see the window rather than nothing.
  revealWindowAfterPaint();
});

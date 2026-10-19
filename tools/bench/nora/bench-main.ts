/**
 * Benchmark mode (tools/bench in the Nemora repository): `--bench=<folder>` keeps every byte of
 * this run inside that folder and lets the harness drive the app.
 *
 * Imported FIRST by main.ts. The stores are opened while their modules load, so the profile path
 * must be moved before any of them is imported.
 */
import { app, session } from 'electron';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';

const flag = process.argv.find((arg) => arg.startsWith('--bench='));
export const BENCH_DIR = flag ? path.resolve(flag.slice('--bench='.length)) : null;

export const benchMark = (name: string, at = Date.now(), data?: unknown) => {
  if (!BENCH_DIR) return;
  appendFileSync(path.join(BENCH_DIR, 'marks.jsonl'), `${JSON.stringify({ at, name, data })}\n`);
};

if (BENCH_DIR) {
  const inside = (name: string) => {
    const dir = path.join(BENCH_DIR, name);
    mkdirSync(dir, { recursive: true });
    return dir;
  };
  benchMark('main-start');
  app.setPath('userData', inside('profile'));
  app.setPath('sessionData', inside('profile'));
  app.setPath('logs', inside('logs'));
  app.setPath('crashDumps', inside('crashDumps'));
  app.setPath('temp', inside('temp'));

  // Offline, as Nemora's bench mode is: a request to the internet is noise in every figure and an
  // asymmetry whenever one side gets an answer the other does not.
  const remote = (url: string) =>
    /^https?:\/\//i.test(url) && !/^https?:\/\/(localhost|127\.0\.0\.1)([:/]|$)/i.test(url);
  const localFetch = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return remote(url)
      ? Promise.reject(new TypeError('offline: benchmark run'))
      : localFetch(input, init);
  }) as typeof fetch;
  void app.whenReady().then(() =>
    session.defaultSession.webRequest.onBeforeRequest(
      { urls: ['http://*/*', 'https://*/*'] },
      (details, callback) => callback({ cancel: remote(details.url) })
    )
  );
  // Every location the app will write to, for the harness to check against the folder.
  writeFileSync(
    path.join(BENCH_DIR, 'bench-env.json'),
    JSON.stringify(
      {
        app: 'nora',
        paths: Object.fromEntries(
          (['userData', 'sessionData', 'logs', 'crashDumps', 'temp'] as const).map((name) => [
            name,
            app.getPath(name)
          ])
        )
      },
      null,
      2
    )
  );
}

/** Whether the harness has created the file `name` in the run folder. */
export const benchSignal = (name: string) =>
  !!BENCH_DIR && /^[\w-]+$/.test(name) && existsSync(path.join(BENCH_DIR, name));

/** The scenario, and the library folder described as this app's add-folder call takes it. */
export const benchConfig = async () => {
  if (!BENCH_DIR) return null;
  const scenario = JSON.parse(readFileSync(path.join(BENCH_DIR, 'scenario.json'), 'utf8'));
  const { generateFolderStructure } = await import('./core/getFolderStructures');
  const structure = scenario.library ? await generateFolderStructure(scenario.library) : undefined;
  return { steps: scenario.steps, structures: structure ? [structure] : [] };
};

import { ipc } from '@platform/ipc';

/**
 * Benchmark mode (tools/bench): the scenario, the marks file and quitting, as Nora 3.1.0 exposes
 * them under the same names. Nothing answers outside a `--bench` run; `config` is then null.
 */
export const bench = {
  config: (): Promise<{ steps: unknown[]; structures: unknown[] } | null> => ipc('bench_config'),
  mark: (name: string, at: number, data?: unknown) =>
    void ipc('bench_mark', { name, at, data }).catch(() => undefined),
  signal: (name: string) => ipc('bench_signal', { name }),
  quit: () => void ipc('bench_quit').catch(() => undefined)
};

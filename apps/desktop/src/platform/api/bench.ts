import { invoke } from '@tauri-apps/api/core';

/**
 * Benchmark mode (tools/bench): the scenario, the marks file and quitting, as Nora 3.1.0 exposes
 * them under the same names. Nothing answers outside a `--bench` run; `config` is then null.
 */
export const bench = {
  config: () => invoke<{ steps: unknown[]; structures: unknown[] } | null>('bench_config'),
  mark: (name: string, at: number, data?: unknown) =>
    void invoke('bench_mark', { name, at, data }).catch(() => undefined),
  signal: (name: string) => invoke<boolean>('bench_signal', { name }),
  quit: () => void invoke('bench_quit').catch(() => undefined)
};

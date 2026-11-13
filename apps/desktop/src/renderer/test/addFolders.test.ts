import { beforeAll, describe, expect, it, vi } from 'vitest';
import { open } from '@tauri-apps/plugin-dialog';
import { apiCalls } from './setup';

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }));

/**
 * Add music folders' "Choose folders" (issue #1): the folder dialog opens, and the folders picked are
 * what the prompt lists — not the folders already added, which a fresh profile does not have.
 */
let runtime: import('@platform/runtime').NemoraRuntime;

beforeAll(async () => {
  // The runtime's shell takes the current window at import, as in the app.
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } }
  };
  runtime = new (await import('@platform/runtime')).NemoraRuntime();
});

describe('getFolderStructures', () => {
  it('opens the folder dialog and lists every folder picked', async () => {
    vi.mocked(open).mockResolvedValueOnce([String.raw`E:\Music`, String.raw`D:\Rips`]);
    const structures = await runtime.getFolderStructures();
    expect(vi.mocked(open)).toHaveBeenCalledWith(expect.objectContaining({ directory: true, multiple: true }));
    expect(structures.map((s) => s.path)).toEqual([String.raw`E:\Music`, String.raw`D:\Rips`]);
    expect(structures.every((s) => s.subFolders.length === 0)).toBe(true);
    expect(apiCalls.some((c) => c.path === 'invoke.library_folder_structures')).toBe(false);
  });

  it('lists nothing when the dialog is cancelled', async () => {
    vi.mocked(open).mockResolvedValueOnce(null);
    expect(await runtime.getFolderStructures()).toEqual([]);
  });

  it('takes a single folder too', async () => {
    vi.mocked(open).mockResolvedValueOnce(String.raw`E:\Music`);
    expect((await runtime.getFolderStructures()).map((s) => s.path)).toEqual([String.raw`E:\Music`]);
  });
});

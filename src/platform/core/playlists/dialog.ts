/**
 * File dialogs for playlist export/import.
 *
 * The Electron code called `dialog.showOpenDialog` / `showSaveDialog` and
 * THREW `PROMPT_CLOSED_BEFORE_INPUT` when the user cancelled. The callers rely
 * on that: cancellation lands in their error handlers and produces the exact
 * same message codes as before. These adapters preserve that contract over
 * `@tauri-apps/plugin-dialog`.
 */

import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import type { OpenDialogOptions, SaveDialogOptions } from '@tauri-apps/plugin-dialog';

export class PromptClosedError extends Error {
  constructor() {
    super('PROMPT_CLOSED_BEFORE_INPUT');
    this.name = 'PromptClosedError';
  }
}

/** Single-file open dialog; resolves with the selected path or throws on cancel. */
export const showOpenDialog = async (options: OpenDialogOptions): Promise<string[]> => {
  const selection = await openDialog({ ...options, multiple: false });
  if (selection === null) throw new PromptClosedError();
  return Array.isArray(selection) ? selection : [selection];
};

/** Save dialog; resolves with the destination path or throws on cancel. */
export const showSaveDialog = async (options: SaveDialogOptions): Promise<string> => {
  const destination = await saveDialog(options);
  if (destination === null) throw new PromptClosedError();
  return destination;
};

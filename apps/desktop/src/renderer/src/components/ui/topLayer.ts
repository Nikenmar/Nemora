/**
 * A modal `<dialog>` (prompts, Duel, SongGuessr) sits in the browser's top layer and makes the rest
 * of the page inert, so the app's floating layers (context menu, tooltips) would open beneath it
 * and ignore the pointer. They render as popovers inside the modal dialog on top instead: a popover
 * joins the top layer above that dialog, and inside its subtree it stays interactive.
 */

/** The modal dialog on top, if one is open: the one holding the focus, else the last one. */
export const topModalDialog = (): HTMLDialogElement | null => {
  const focused = document.activeElement?.closest('dialog');
  if (focused?.matches(':modal')) return focused;
  const open = [...document.querySelectorAll('dialog[open]')].filter((dialog) =>
    dialog.matches(':modal')
  );
  return (open.at(-1) as HTMLDialogElement | undefined) ?? null;
};

/** Shows a `popover="manual"` element, or moves it back above a dialog opened after it. */
export const raiseToTopLayer = (element: HTMLElement | null) => {
  if (!element?.isConnected || !('showPopover' in element)) return;
  if (element.matches(':popover-open')) element.hidePopover();
  element.showPopover();
};

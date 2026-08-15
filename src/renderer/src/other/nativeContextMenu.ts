/**
 * Suppresses WebView2's own page context menu.
 *
 * Electron never had one: right-clicking a BrowserWindow does nothing unless
 * the application builds a menu itself, so the fork's own onContextMenu
 * handlers were the whole story and nobody had to think about the rest of the
 * window. WebView2 is a browser. Everywhere the app does not open a menu of its
 * own, Edge opened its page menu instead - Back, Reload, Save as, Print, Send
 * tab to your devices, Inspect. In a music player none of that is meaningful
 * and half of it is actively wrong.
 *
 * The listener runs in the CAPTURE phase on purpose. preventDefault has to be
 * certain to run, and a component that calls stopPropagation inside its own
 * handler would otherwise let the native menu through anyway. Capturing does
 * not interfere with anything: preventDefault suppresses only the browser's
 * default action, so every onContextMenu handler still fires and the app's own
 * menus behave exactly as before.
 *
 * TEXT FIELDS KEEP THE NATIVE MENU. Cut, copy and paste there are the only
 * clipboard UI the app has, and someone right-clicking the search box or the
 * tag editor is asking for precisely that. Matching Electron here would mean
 * copying a limitation rather than a decision.
 *
 * The type check matters more than it looks: sliders are `input` elements too,
 * and the seekbar, the volume control and every equaliser band are exactly
 * where a stray "Save as" is most likely to be summoned by accident.
 */

/** Input types that accept typed text, plus '' for an `input` with no type. */
const TEXT_ENTRY_TYPES = new Set([
  '',
  'text',
  'search',
  'url',
  'email',
  'password',
  'tel',
  'number'
]);

/** True when the element under the pointer is somewhere the user types. */
const isTextEntry = (element: Element): boolean => {
  if (element instanceof HTMLTextAreaElement) return true;
  if (element instanceof HTMLInputElement) {
    return TEXT_ENTRY_TYPES.has(element.type.toLowerCase()) && !element.disabled;
  }
  return element instanceof HTMLElement && element.isContentEditable;
};

/**
 * Installs the suppression for the lifetime of the document.
 *
 * Called synchronously at startup rather than from a component, so that it also
 * covers the startup-failure screen: an app that could not start should not be
 * offering to print itself.
 */
export const suppressNativeContextMenu = (): void => {
  window.addEventListener(
    'contextmenu',
    (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Element) {
        const editable = target.closest('input, textarea, [contenteditable]');
        if (editable && isTextEntry(editable)) return;
      }
      event.preventDefault();
    },
    { capture: true }
  );
};

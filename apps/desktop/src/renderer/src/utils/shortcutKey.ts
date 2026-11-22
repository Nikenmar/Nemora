/** Keys that shortcuts use besides letters and digits, by their place on a US keyboard. */
const PLACES: Record<string, string> = { BracketLeft: '[', BracketRight: ']', Backslash: '\\', Slash: '/' };

/**
 * The key a shortcut names, whatever the keyboard layout. `key` follows the layout, so Ctrl+A on a
 * Russian layout says `ф` and a shortcut written as `a` never fired; `code` is the physical key,
 * wrong on AZERTY or QWERTZ, where the letter printed on the key is the one meant. A Latin letter
 * or digit is taken as the layout gives it; any other script falls back to the key's place on a
 * US keyboard, as the browser's own Ctrl+A, Ctrl+C and Ctrl+V do.
 */
export const shortcutKey = ({ key, code, shiftKey }: Pick<KeyboardEvent, 'key' | 'code' | 'shiftKey'>): string => {
  if (/^[a-z0-9]$/i.test(key)) return key;
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return shiftKey ? letter[1] : letter[1].toLowerCase();
  const digit = /^Digit(\d)$/.exec(code);
  if (digit) return digit[1];
  return PLACES[code] ?? key;
};

/** A text field has the focus (not a checkbox, radio, slider or button): its own keys come first. */
export const isTypingIn = (target: EventTarget | null): boolean => {
  const element = target instanceof HTMLElement ? target : null;
  return (
    !!element?.closest('input, textarea, select, [contenteditable="true"]') &&
    !(element instanceof HTMLInputElement && ['checkbox', 'radio', 'range', 'button'].includes(element.type))
  );
};

/** Ctrl+A meant for a list (every row selected), not for the text field the focus is in. */
export const isSelectAll = (e: Pick<KeyboardEvent, 'key' | 'code' | 'shiftKey' | 'ctrlKey' | 'target'>): boolean =>
  e.ctrlKey && shortcutKey(e) === 'a' && !isTypingIn(e.target);

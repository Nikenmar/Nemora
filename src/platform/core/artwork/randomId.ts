/** Same 10-character ASCII-letter scheme used by the legacy nanoid helper. */
const PALETTE_ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

export const generatePaletteId = (): string => {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  let id = '';
  for (const byte of bytes) id += PALETTE_ID_ALPHABET[byte % PALETTE_ID_ALPHABET.length];
  return id;
};

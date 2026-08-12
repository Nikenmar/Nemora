/**
 * Random playlist id generator, mirroring the Electron `nanoid` alphabet.
 *
 * Uses WebCrypto instead of nanoid so the renderer bundle gains no dependency.
 * 10 lowercase/uppercase letters, same alphabet and length as the original.
 */

const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

export const generateRandomId = (length = 10): string => {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let id = '';
  for (const byte of bytes) id += ALPHABET[byte % ALPHABET.length];
  return id;
};

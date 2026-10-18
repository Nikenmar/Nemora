/**
 * Encrypted-credential storage for the ported core.
 *
 * Faithful port of `src/main/utils/safeStorage.ts` (AES-256-CBC, key derived
 * with scrypt(secret, salt = "salt", 32 bytes), random 16-byte IV prepended as
 * hex, ciphertext hex) with one deliberate change: a webview has no synchronous
 * crypto. Web Crypto (`crypto.subtle`) provides AES-CBC but no scrypt, so key
 * derivation runs in Rust (`secrets_scrypt_key` command) and every operation
 * is async.
 *
 * Compatibility: the on-the-wire format is identical to the Node build, so
 * credentials encrypted by Nora 3.4.5 decrypt with this module unchanged.
 */

import { invoke } from '@tauri-apps/api/core';

import { getBuildEnvVariable } from '../net/buildEnv';

/** Raised when a stored credential cannot be decrypted. Never swallowed. */
export class CredentialDecryptionError extends Error {
  constructor(cause: unknown) {
    super('Failed to decrypt the stored credential; the value was left untouched.');
    this.name = 'CredentialDecryptionError';
    this.cause = cause;
  }
}

/** Raised when a value cannot be encrypted before being stored. */
export class CredentialEncryptionError extends Error {
  constructor(cause: unknown) {
    super('Failed to encrypt the credential; nothing was stored.');
    this.name = 'CredentialEncryptionError';
    this.cause = cause;
  }
}

const ENCRYPTION_SECRET_VARIABLE = 'MAIN_VITE_ENCRYPTION_SECRET';
const IV_BYTE_LENGTH = 16;

/** Derives the 32-byte AES-256 key, matching Node scryptSync(secret, 'salt', 32). */
export type SecretKeyDeriver = (secret: string) => Promise<Uint8Array>;

let keyDeriverOverride: SecretKeyDeriver | undefined;

/**
 * Test-only override for key derivation. Production code never calls this; the
 * default implementation invokes the Rust `secrets_scrypt_key` command.
 */
export const setSecretKeyDeriverForTests = (deriver: SecretKeyDeriver | undefined): void => {
  keyDeriverOverride = deriver;
};

const deriveEncryptionKey = async (secret: string): Promise<Uint8Array> => {
  if (keyDeriverOverride) return keyDeriverOverride(secret);
  // The Rust `secrets_scrypt_key` command mirrors Node's
  // `scryptSync(secret, 'salt', 32)` (salt `salt`, 32-byte key) — the format
  // contract that keeps 3.4.5 credentials readable.
  const key = await invoke<number[]>('secrets_scrypt_key', { secret });
  return new Uint8Array(key);
};

const getEncryptionSecret = (): string => {
  const secret = getBuildEnvVariable(ENCRYPTION_SECRET_VARIABLE);
  if (!secret) throw new Error('ENCRYPTION_SECRET not found.');
  return secret;
};

const importAesKey = (keyBytes: Uint8Array): Promise<CryptoKey> =>
  crypto.subtle.importKey('raw', keyBytes, { name: 'AES-CBC' }, false, ['encrypt', 'decrypt']);

const hexToBytes = (hex: string): Uint8Array => {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1)
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
};

const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

/**
 * Encrypts `data` and returns `ivHex + ciphertextHex`, byte-compatible with the
 * Electron `safeStorage.encrypt` output.
 */
export async function encrypt(data: string): Promise<string> {
  try {
    const secret = getEncryptionSecret();
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTE_LENGTH));
    const key = await importAesKey(await deriveEncryptionKey(secret));

    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-CBC', iv },
      key,
      new TextEncoder().encode(data)
    );

    return bytesToHex(iv) + bytesToHex(new Uint8Array(ciphertext));
  } catch (error) {
    throw new CredentialEncryptionError(error);
  }
}

/**
 * Decrypts a value produced by either this module or the Electron build.
 * Throws {@link CredentialDecryptionError} on any failure — an undecryptable
 * credential is a problem to surface, never an empty string to persist.
 */
export async function decrypt(encryptedData: string): Promise<string> {
  try {
    const secret = getEncryptionSecret();

    const iv = hexToBytes(encryptedData.slice(0, IV_BYTE_LENGTH * 2));
    const ciphertext = hexToBytes(encryptedData.slice(IV_BYTE_LENGTH * 2));
    const key = await importAesKey(await deriveEncryptionKey(secret));

    const plaintext = await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, key, ciphertext);
    return new TextDecoder().decode(plaintext);
  } catch (error) {
    throw new CredentialDecryptionError(error);
  }
}

/**
 * Whether `data` matches the decrypted form of `encryptedData`. Returns false
 * on any failure, exactly like the Electron `safeStorage.compare`.
 */
export async function compare(data: string, encryptedData: string): Promise<boolean> {
  try {
    const decryptedData = await decrypt(encryptedData);
    return decryptedData === data;
  } catch {
    return false;
  }
}

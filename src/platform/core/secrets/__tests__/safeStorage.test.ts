import { createDecipheriv, scryptSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, jest, test } from '@jest/globals';

// The secret is read through build-time env (import.meta.env), which the jest
// CJS transform cannot load; the fixture secret is supplied here instead.
jest.mock('../../net/buildEnv', () => ({
  getBuildEnvVariable: jest.fn((name: string) =>
    name === 'MAIN_VITE_ENCRYPTION_SECRET' ? 'test-encryption-secret-3.4.5' : undefined
  )
}));

import {
  compare,
  CredentialDecryptionError,
  CredentialEncryptionError,
  decrypt,
  encrypt,
  setSecretKeyDeriverForTests
} from '../safeStorage';

const FIXTURE_DIR = process.env.NORA_SECRETS_FIXTURES ?? 'E:/tmp/secrets-fixtures';

interface NodeFixture {
  name: string;
  plaintext: string;
  encrypted: string;
}

interface NodeFixtureFile {
  secret: string;
  fixtures: NodeFixture[];
}

/**
 * Ciphertexts produced by the Electron build, used as the compatibility
 * reference. They are generated on a machine that has that build and are NOT
 * committed, so this file loads them optionally: on a machine without them the
 * fixture-backed blocks skip, exactly as the sharp comparison test does.
 *
 * Reading them at module scope and letting it throw failed the whole suite on
 * any machine but mine, CI included, for tests that never needed a fixture.
 *
 * To run those blocks: point NORA_SECRETS_FIXTURES at the directory.
 */
const nodeFixtures: NodeFixtureFile | null = (() => {
  try {
    return JSON.parse(
      readFileSync(`${FIXTURE_DIR}/node-v3.4.5-ciphertexts.json`, 'utf8')
    ) as NodeFixtureFile;
  } catch {
    return null;
  }
})();

const describeWithFixtures = nodeFixtures ? describe : describe.skip;
const fixtureSecret = nodeFixtures?.secret ?? 'test-encryption-secret-3.4.5';

/** The Electron key derivation, used as the reference in jest (node:crypto). */
const nodeDeriveKey = (secret: string): Uint8Array => scryptSync(secret, 'salt', 32);

/** The Electron decrypt path, used to verify our encrypt round-trip. */
const nodeDecrypt = (encryptedData: string, secret: string): string => {
  const iv = Buffer.from(encryptedData.slice(0, 32), 'hex');
  const ciphertext = encryptedData.slice(32);
  const decipher = createDecipheriv('aes-256-cbc', nodeDeriveKey(secret), iv);
  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
};

beforeEach(() => {
  setSecretKeyDeriverForTests((secret) => Promise.resolve(nodeDeriveKey(secret)));
});

afterAll(() => {
  setSecretKeyDeriverForTests(undefined);
});

describeWithFixtures('decrypting credentials written by Nora 3.4.5 (Node implementation)', () => {
  for (const fixture of nodeFixtures?.fixtures ?? []) {
    test(`decrypts the ${fixture.name} fixture to its exact plaintext`, async () => {
      await expect(decrypt(fixture.encrypted)).resolves.toBe(fixture.plaintext);
    });
  }
});

describe('round-trip: encrypt with the webview implementation, decrypt with Node', () => {
  const values = [
    'fresh-session-key',
    'музыкальный ключ',
    '東京のセッション',
    '🎧 mixed café №7',
    'y'.repeat(3000),
    ''
  ];

  for (const value of values) {
    test(`round-trips ${value.length > 20 ? `${value.slice(0, 20)}…(${value.length})` : JSON.stringify(value)}`, async () => {
      const ciphertext = await encrypt(value);
      expect(nodeDecrypt(ciphertext, fixtureSecret)).toBe(value);
    });
  }

  test('produces the same iv+hex layout as the Node build', async () => {
    const ciphertext = await encrypt('hello');
    expect(ciphertext).toMatch(/^[0-9a-f]{32}[0-9a-f]+$/);
    // The first 16 bytes are the IV, so two encryptions differ.
    const second = await encrypt('hello');
    expect(second).not.toBe(ciphertext);
  });
});

describe('failure visibility', () => {
  test('throws a named error for undecryptable stored values', async () => {
    await expect(decrypt('not-a-valid-ciphertext')).rejects.toBeInstanceOf(
      CredentialDecryptionError
    );
    await expect(decrypt('abc')).rejects.toBeInstanceOf(CredentialDecryptionError);
  });

  test('a wrong secret surfaces the named error instead of garbage', async () => {
    const ciphertext = await encrypt('secret value');
    setSecretKeyDeriverForTests((secret) => Promise.resolve(nodeDeriveKey(`${secret}-other`)));
    await expect(decrypt(ciphertext)).rejects.toBeInstanceOf(CredentialDecryptionError);
  });

  test('compare returns false on any failure instead of throwing', async () => {
    await expect(compare('anything', 'garbage')).resolves.toBe(false);
  });

  test('encrypt surfaces a named error when the secret is missing', async () => {
    const { getBuildEnvVariable } = jest.requireMock('../../net/buildEnv') as {
      getBuildEnvVariable: jest.Mock;
    };
    getBuildEnvVariable.mockReturnValue(undefined);
    await expect(encrypt('value')).rejects.toBeInstanceOf(CredentialEncryptionError);
    getBuildEnvVariable.mockReturnValue('test-encryption-secret-3.4.5');
  });
});

describe('compare', () => {
  test('matches equal values and rejects different ones', async () => {
    const ciphertext = await encrypt('session-key');
    await expect(compare('session-key', ciphertext)).resolves.toBe(true);
    await expect(compare('other-key', ciphertext)).resolves.toBe(false);
  });
});

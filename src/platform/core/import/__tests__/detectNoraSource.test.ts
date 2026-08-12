import { describe, expect, jest, test } from '@jest/globals';

import { detectNoraSource } from '../detectNoraSource';
import { NoraImportError } from '../noraImportRepository';
import {
  NORA_ROOT,
  buildForkProfile,
  buildUpstreamProfile,
  createMockNoraImportPort
} from './testUtils';

describe('detectNoraSource — identify the app by profile CONTENTS, not the folder name', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('detects the CMR fork from its fork-only stores', async () => {
    const fixture = buildForkProfile();
    const port = createMockNoraImportPort(fixture.files, fixture.dirs);

    const inventory = await detectNoraSource(port);

    expect(inventory.kind).toBe('cmr-fork');
    expect(inventory.presentStores).toHaveLength(11);
    expect(inventory.presentStores).toContain('tierlists');
    expect(inventory.presentStores).toContain('cmrStats');
    expect(inventory.absentStores).toHaveLength(0);
    expect(inventory.hasLevelDb).toBe(true);
    expect(inventory.hasSongCovers).toBe(true);
  });

  test('detects upstream Nora 3.1.0 when the fork-only stores are missing — not an error', async () => {
    const fixture = buildUpstreamProfile();
    const port = createMockNoraImportPort(fixture.files, fixture.dirs);

    const inventory = await detectNoraSource(port);

    expect(inventory.kind).toBe('upstream');
    expect(inventory.presentStores).toHaveLength(9);
    expect(inventory.absentStores).toEqual(expect.arrayContaining(['tierlists', 'cmrStats']));
    expect(inventory.hasLevelDb).toBe(true);
  });

  test('fails when the Nora profile directory does not exist at all', async () => {
    const port = createMockNoraImportPort(new Map(), new Set());

    await expect(detectNoraSource(port)).rejects.toThrow(NoraImportError);
    await expect(detectNoraSource(port)).rejects.toThrow(/not found/);
  });

  test('fails when the profile exists but holds no stores', async () => {
    const files = new Map<string, Uint8Array>();
    const dirs = new Set<string>([NORA_ROOT]);
    const port = createMockNoraImportPort(files, dirs);

    await expect(detectNoraSource(port)).rejects.toThrow(/No Nora stores/);
  });

  test('a profile with only some stores still detects and reports the others as absent', async () => {
    const fixture = buildForkProfile();
    fixture.files.delete(`${NORA_ROOT}\\listening_data.json`);
    const port = createMockNoraImportPort(fixture.files, fixture.dirs);

    const inventory = await detectNoraSource(port);

    expect(inventory.presentStores).not.toContain('listeningData');
    expect(inventory.absentStores).toContain('listeningData');
  });
});

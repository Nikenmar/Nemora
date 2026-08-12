import { compareVersions, getVersionInfoFromString, isUpdateNewer } from '../version';

describe('updater version comparison', () => {
  test('handles the Nemora scheme: patch and minor bumps within -stable', () => {
    expect(isUpdateNewer('1.0.1-stable', '1.0.0-stable')).toBe(true);
    expect(compareVersions('1.0.1-stable', '1.0.0-stable')).toBe('newer');
    expect(isUpdateNewer('1.1.0-stable', '1.0.0-stable')).toBe(true);
    expect(compareVersions('1.1.0-stable', '1.0.0-stable')).toBe('newer');
  });

  test('treats equal versions as up to date', () => {
    expect(isUpdateNewer('1.0.0-stable', '1.0.0-stable')).toBe(false);
    expect(compareVersions('1.0.0-stable', '1.0.0-stable')).toBe('equal');
  });

  test('treats a genuine downgrade as up to date', () => {
    expect(isUpdateNewer('0.9.9-stable', '1.0.0-stable')).toBe(false);
    expect(compareVersions('0.9.9-stable', '1.0.0-stable')).toBe('older');
    expect(isUpdateNewer('1.0.0-stable', '1.0.1-stable')).toBe(false);
  });

  test('compares the numeric core numerically, not lexically', () => {
    expect(isUpdateNewer('1.10.0-stable', '1.9.0-stable')).toBe(true);
    expect(isUpdateNewer('2.0.0-stable', '1.10.0-stable')).toBe(true);
  });

  test('treats -stable as a release marker, not a strict semver gate', () => {
    expect(isUpdateNewer('1.0.0', '1.0.0-stable')).toBe(true);
    expect(isUpdateNewer('1.0.0-stable', '1.0.0')).toBe(false);
    expect(compareVersions('1.0.0-stable', '1.0.0')).toBe('older');
  });

  test('accepts an optional leading v', () => {
    expect(isUpdateNewer('v1.0.1-stable', '1.0.0-stable')).toBe(true);
  });

  test('marks malformed versions as invalid, never as an update or downgrade', () => {
    expect(getVersionInfoFromString('1.0.0-stable')).toMatchObject({
      major: 1,
      minor: 0,
      patch: 0,
      preRelease: 'stable',
      releasePhase: 'stable'
    });
    expect(getVersionInfoFromString('1.0')).toBeUndefined();
    expect(getVersionInfoFromString('1.0.0.1-stable')).toBeUndefined();
    expect(getVersionInfoFromString('not-a-version')).toBeUndefined();
    expect(compareVersions('not-a-version', '1.0.0-stable')).toBe('invalid');
    expect(compareVersions('1.0.1-stable', 'garbage')).toBe('invalid');
    expect(isUpdateNewer('not-a-version', '1.0.0-stable')).toBe(false);
  });
});

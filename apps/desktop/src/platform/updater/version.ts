const semVerRegex =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

export interface VersionInfo {
  major: number;
  minor: number;
  patch: number;
  preRelease?: string;
  releasePhase?: string;
}

export function getVersionInfoFromString(versionString: string): VersionInfo | undefined {
  const versionData = versionString.match(semVerRegex);
  if (!versionData) return undefined;

  const [, major, minor, patch, preRelease] = versionData;
  const releasePhase = preRelease?.replace(/[^a-zA-Z]/gu, '');
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    preRelease,
    releasePhase
  };
}

/**
 * Outcome of comparing an update candidate against the installed version.
 * 'invalid' means either side is not parseable; callers must surface that as
 * a failed check rather than reporting "up to date".
 */
export type VersionComparison = 'newer' | 'older' | 'equal' | 'invalid';

const compareNumericCore = (candidate: VersionInfo, current: VersionInfo): number => {
  if (candidate.major !== current.major) return candidate.major > current.major ? 1 : -1;
  if (candidate.minor !== current.minor) return candidate.minor > current.minor ? 1 : -1;
  if (candidate.patch !== current.patch) return candidate.patch > current.patch ? 1 : -1;
  return 0;
};

const comparePrereleasePart = (candidatePart: string, currentPart: string): number => {
  const candidateIsNumeric = /^(0|[1-9]\d*)$/.test(candidatePart);
  const currentIsNumeric = /^(0|[1-9]\d*)$/.test(currentPart);
  if (candidateIsNumeric && currentIsNumeric) {
    const candidateNumber = Number(candidatePart);
    const currentNumber = Number(currentPart);
    if (candidateNumber !== currentNumber) return candidateNumber > currentNumber ? 1 : -1;
    return 0;
  }
  if (candidateIsNumeric) return -1;
  if (currentIsNumeric) return 1;
  if (candidatePart !== currentPart) return candidatePart > currentPart ? 1 : -1;
  return 0;
};

const comparePrerelease = (candidate?: string, current?: string): number => {
  if (candidate === current) return 0;
  if (candidate === undefined) return 1;
  if (current === undefined) return -1;

  const candidateParts = candidate.split('.');
  const currentParts = current.split('.');
  const sharedLength = Math.min(candidateParts.length, currentParts.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const partComparison = comparePrereleasePart(candidateParts[index], currentParts[index]);
    if (partComparison !== 0) return partComparison;
  }
  return candidateParts.length === currentParts.length
    ? 0
    : candidateParts.length > currentParts.length
      ? 1
      : -1;
};

/**
 * Compares an update candidate against the installed version using semver
 * precedence. Nemora publishes every release as `X.Y.Z-stable`, so both sides
 * carry the same `-stable` marker and the numeric core decides the outcome:
 * `1.0.1-stable` beats `1.0.0-stable`, and `1.1.0-stable` beats both. The
 * marker is not treated as a strict semver prerelease gate, but the release
 * ordering still follows semver for the remaining cases: a version without
 * the marker (e.g. `1.0.0`) is newer than the same core with it, and
 * differently labelled prereleases compare identifier by identifier.
 */
export function compareVersions(
  candidateVersion: string,
  currentVersion: string
): VersionComparison {
  const candidate = getVersionInfoFromString(candidateVersion);
  const current = getVersionInfoFromString(currentVersion);
  if (!candidate || !current) return 'invalid';

  const coreComparison = compareNumericCore(candidate, current);
  if (coreComparison !== 0) return coreComparison > 0 ? 'newer' : 'older';

  const preReleaseComparison = comparePrerelease(candidate.preRelease, current.preRelease);
  if (preReleaseComparison !== 0) return preReleaseComparison > 0 ? 'newer' : 'older';
  return 'equal';
}

export const isUpdateNewer = (candidateVersion: string, currentVersion: string): boolean =>
  compareVersions(candidateVersion, currentVersion) === 'newer';

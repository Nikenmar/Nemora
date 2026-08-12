import { canonicalPathKey } from '../library/path';

export const DEFAULT_WRITE_SUPPRESSION_MS = 2_000;

export class InternalWriteSuppression {
  private readonly expiresAtByPath: Map<string, number>;
  private readonly activeWritesByPath: Map<string, number>;
  private readonly now: () => number;
  private readonly defaultWindowMs: number;

  constructor(now: () => number = Date.now, defaultWindowMs = DEFAULT_WRITE_SUPPRESSION_MS) {
    if (!Number.isFinite(defaultWindowMs) || defaultWindowMs < 0) {
      throw new RangeError('Suppression window must be a non-negative number.');
    }
    this.expiresAtByPath = new Map<string, number>();
    this.activeWritesByPath = new Map<string, number>();
    this.now = now;
    this.defaultWindowMs = defaultWindowMs;
  }

  suppress(path: string, windowMs = this.defaultWindowMs): void {
    if (!Number.isFinite(windowMs) || windowMs < 0) {
      throw new RangeError('Suppression window must be a non-negative number.');
    }
    const key = canonicalPathKey(path);
    const expiresAt = this.now() + windowMs;
    const current = this.expiresAtByPath.get(key) ?? 0;
    this.expiresAtByPath.set(key, Math.max(current, expiresAt));
  }

  isSuppressed(path: string): boolean {
    const key = canonicalPathKey(path);
    if ((this.activeWritesByPath.get(key) ?? 0) > 0) return true;
    const expiresAt = this.expiresAtByPath.get(key);
    if (expiresAt === undefined) return false;
    if (this.now() < expiresAt) return true;
    this.expiresAtByPath.delete(key);
    return false;
  }

  clear(path: string): void {
    const key = canonicalPathKey(path);
    this.expiresAtByPath.delete(key);
    this.activeWritesByPath.delete(key);
  }

  async during<Result>(
    paths: string | readonly string[],
    operation: () => Promise<Result>,
    windowMs = this.defaultWindowMs
  ): Promise<Result> {
    const values = typeof paths === 'string' ? [paths] : [...new Set(paths)];
    const keys = values.map(canonicalPathKey);
    for (const key of keys) {
      this.activeWritesByPath.set(key, (this.activeWritesByPath.get(key) ?? 0) + 1);
    }
    try {
      return await operation();
    } finally {
      // Watch notifications can arrive after the writer has closed the file.
      for (let index = 0; index < values.length; index += 1) {
        const key = keys[index];
        const remaining = (this.activeWritesByPath.get(key) ?? 1) - 1;
        if (remaining > 0) this.activeWritesByPath.set(key, remaining);
        else this.activeWritesByPath.delete(key);
        this.suppress(values[index], windowMs);
      }
    }
  }
}

/** Shared by the watcher manager and every app-owned tag/artwork writer. */
export const internalWriteSuppression = new InternalWriteSuppression();

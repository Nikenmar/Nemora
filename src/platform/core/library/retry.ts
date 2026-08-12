export const LOCKED_FILE_RETRY_COUNT = 5;
export const LOCKED_FILE_RETRY_DELAY_MS = 5_000;

export interface RetryOptions {
  retries?: number;
  delayMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
  shouldRetry?: (error: unknown) => boolean;
}

const LOCK_ERROR_PATTERN =
  /(?:EBUSY|EACCES|EPERM|sharing violation|used by another process|resource busy|file is locked|end-of-stream|unexpected end|premature end|read error)/iu;

export const isLockedFileError = (error: unknown): boolean => {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = String((error as { code: unknown }).code).toUpperCase();
    if (code === 'EBUSY' || code === 'EACCES' || code === 'EPERM') return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return LOCK_ERROR_PATTERN.test(message);
};

const defaultSleep = (delayMs: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, delayMs));

export const retryLockedFile = async <Result>(
  operation: () => Promise<Result>,
  options: RetryOptions = {}
): Promise<Result> => {
  const retries = options.retries ?? LOCKED_FILE_RETRY_COUNT;
  const delayMs = options.delayMs ?? LOCKED_FILE_RETRY_DELAY_MS;
  const sleep = options.sleep ?? defaultSleep;
  const shouldRetry = options.shouldRetry ?? isLockedFileError;

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= retries || !shouldRetry(error)) throw error;
      await sleep(delayMs);
    }
  }
};

export class InFlightPathGuard {
  private readonly paths: Set<string>;

  constructor() {
    this.paths = new Set<string>();
  }

  async run<Result>(key: string, operation: () => Promise<Result>): Promise<Result | undefined> {
    if (this.paths.has(key)) return undefined;
    this.paths.add(key);
    try {
      return await operation();
    } finally {
      this.paths.delete(key);
    }
  }
}

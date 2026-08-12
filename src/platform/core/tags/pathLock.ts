const tails = new Map<string, Promise<void>>();

/** Serializes in-process read/modify/write transactions for the same file. */
export async function withTagPathLock<T>(path: string, operation: () => Promise<T>): Promise<T> {
  const previous = tails.get(path) ?? Promise.resolve();
  let release = (): void => undefined;
  const turn = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => turn);
  tails.set(path, tail);

  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (tails.get(path) === tail) tails.delete(path);
  }
}

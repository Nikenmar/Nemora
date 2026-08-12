export const runWithConcurrency = async <Item, Result>(
  items: readonly Item[],
  concurrency: number,
  operation: (item: Item, index: number) => Promise<Result>
): Promise<Result[]> => {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError('Concurrency must be a positive integer.');
  }

  const results = new Array<Result>(items.length);
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await operation(items[index], index);
    }
  };

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
};

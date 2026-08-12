import { describe, expect, jest, test } from '@jest/globals';

import { LOCKED_FILE_RETRY_DELAY_MS, retryLockedFile } from '../retry';

describe('retryLockedFile', () => {
  test('retries a locked file with the legacy delay', async () => {
    let attempts = 0;
    const sleep = jest.fn(async () => undefined);

    const result = await retryLockedFile(
      async () => {
        attempts += 1;
        if (attempts < 3) throw Object.assign(new Error('busy'), { code: 'EBUSY' });
        return 'parsed';
      },
      { sleep }
    );

    expect(result).toBe('parsed');
    expect(attempts).toBe(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(LOCKED_FILE_RETRY_DELAY_MS);
  });

  test('does not retry a permanent parse error', async () => {
    const sleep = jest.fn(async () => undefined);

    await expect(
      retryLockedFile(async () => Promise.reject(new Error('unsupported codec')), { sleep })
    ).rejects.toThrow('unsupported codec');
    expect(sleep).not.toHaveBeenCalled();
  });
});

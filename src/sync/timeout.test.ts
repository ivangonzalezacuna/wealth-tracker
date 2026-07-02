import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withTimeout } from './timeout';

describe('withTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves normally when the wrapped promise settles before the timeout', async () => {
    const p = new Promise<string>((resolve) => setTimeout(() => resolve('ok'), 100));
    const result = withTimeout(p, 5000);
    await vi.advanceTimersByTimeAsync(100);
    await expect(result).resolves.toBe('ok');
  });

  it('rejects with signin_timeout when the wrapped promise never settles within ms', async () => {
    const p = new Promise<string>(() => {}); // never settles
    const result = withTimeout(p, 5000);
    // Attach rejection handler before advancing timers to avoid unhandled rejection
    const caught = result.catch((e) => e);
    await vi.advanceTimersByTimeAsync(5000);
    const err = await caught;
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('signin_timeout');
  });

  it('rejects with the original error when the wrapped promise rejects before timeout', async () => {
    const p = Promise.reject(new Error('original'));
    const result = withTimeout(p, 5000);
    await expect(result).rejects.toThrow('original');
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock import.meta.env before importing the module
vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');

// Provide a minimal localStorage mock for the module's top-level code
const storage = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
  clear: () => storage.clear(),
  get length() {
    return storage.size;
  },
  key: (_i: number) => null as string | null,
};
vi.stubGlobal('localStorage', localStorageMock);

describe('isSignedIn', () => {
  beforeEach(() => {
    storage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
    storage.clear();
  });

  it('returns true when a valid non-expired token exists in localStorage', async () => {
    const futureExpiry = Date.now() + 3600_000; // 1 hour from now
    storage.set(
      'gtoken',
      JSON.stringify({
        access_token: 'test-token',
        expires_at: futureExpiry,
      }),
    );

    const { isSignedIn } = await import('./google');
    expect(isSignedIn()).toBe(true);
  });

  it('returns false when no token exists in localStorage', async () => {
    const { isSignedIn } = await import('./google');
    expect(isSignedIn()).toBe(false);
  });

  it('returns false when token is expired', async () => {
    const pastExpiry = Date.now() - 1000; // already expired
    storage.set(
      'gtoken',
      JSON.stringify({
        access_token: 'test-token',
        expires_at: pastExpiry,
      }),
    );

    const { isSignedIn } = await import('./google');
    expect(isSignedIn()).toBe(false);
  });

  it('returns false when token expires within 60s margin', async () => {
    const nearExpiry = Date.now() + 30_000; // expires in 30s, within 60s margin
    storage.set(
      'gtoken',
      JSON.stringify({
        access_token: 'test-token',
        expires_at: nearExpiry,
      }),
    );

    const { isSignedIn } = await import('./google');
    expect(isSignedIn()).toBe(false);
  });

  it('does not make any network call when checking isSignedIn', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => Promise.reject('should not be called'));
    const futureExpiry = Date.now() + 3600_000;
    storage.set(
      'gtoken',
      JSON.stringify({
        access_token: 'test-token',
        expires_at: futureExpiry,
      }),
    );

    const { isSignedIn } = await import('./google');
    isSignedIn();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

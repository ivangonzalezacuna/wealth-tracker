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

describe('signIn - error_callback / popup_closed handling', () => {
  let _capturedConfig: any;
  let _fakeClient: any;

  beforeEach(() => {
    storage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));
    vi.resetModules();

    _capturedConfig = null;
    _fakeClient = { callback: () => {}, requestAccessToken: () => {} };

    // Stub window.google so _loadGis resolves immediately (early-return path)
    Object.defineProperty(globalThis, 'window', {
      value: {
        ...globalThis.window,
        google: {
          accounts: {
            oauth2: {
              initTokenClient: (config: any) => {
                _capturedConfig = config;
                _fakeClient.callback = config.callback;
                return _fakeClient;
              },
              revoke: () => {},
            },
          },
        },
      },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    storage.clear();
    vi.unstubAllGlobals();
    vi.stubGlobal('localStorage', localStorageMock);
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');
  });

  it('signIn rejects with popup_closed when error_callback fires with type popup_closed', async () => {
    const { signIn } = await import('./google');
    const p = signIn();

    // Allow microtasks (_loadGis promise chain) to settle
    await vi.advanceTimersByTimeAsync(0);

    // GIS fires error_callback with popup_closed
    _capturedConfig.error_callback({ type: 'popup_closed' });

    await expect(p).rejects.toThrow('popup_closed');
  });

  it('signIn resolves with access token when callback fires with valid response', async () => {
    const { signIn } = await import('./google');
    const p = signIn();

    await vi.advanceTimersByTimeAsync(0);

    // The per-request callback is set on the fakeClient
    _fakeClient.callback({
      access_token: 'abc123',
      expires_in: 3600,
      token_type: 'Bearer',
      scope: 'https://www.googleapis.com/auth/spreadsheets',
    });

    await expect(p).resolves.toBe('abc123');
  });

  it('callback after error_callback does not double-settle the promise', async () => {
    const { signIn } = await import('./google');
    const p = signIn();

    await vi.advanceTimersByTimeAsync(0);

    // error_callback fires first
    _capturedConfig.error_callback({ type: 'popup_closed' });
    await expect(p).rejects.toThrow('popup_closed');

    // Late callback fires — should not throw
    expect(() => {
      _fakeClient.callback({
        access_token: 'late-token',
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'https://www.googleapis.com/auth/spreadsheets',
      });
    }).not.toThrow();
  });

  it('error_callback after callback does not throw', async () => {
    const { signIn } = await import('./google');
    const p = signIn();

    await vi.advanceTimersByTimeAsync(0);

    // callback fires first
    _fakeClient.callback({
      access_token: 'abc123',
      expires_in: 3600,
      token_type: 'Bearer',
      scope: 'https://www.googleapis.com/auth/spreadsheets',
    });
    await expect(p).resolves.toBe('abc123');

    // Late error_callback fires — should not throw
    expect(() => {
      _capturedConfig.error_callback({ type: 'popup_closed' });
    }).not.toThrow();
  });
});

describe('Phase 49 - GRANTED_KEY prompt selection', () => {
  let _capturedConfig: any;
  let _fakeClient: any;

  beforeEach(() => {
    storage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));
    vi.resetModules();

    _capturedConfig = null;
    _fakeClient = { callback: () => {}, requestAccessToken: vi.fn() };

    Object.defineProperty(globalThis, 'window', {
      value: {
        ...globalThis.window,
        google: {
          accounts: {
            oauth2: {
              initTokenClient: (config: any) => {
                _capturedConfig = config;
                _fakeClient.callback = config.callback;
                return _fakeClient;
              },
              revoke: () => {},
            },
          },
        },
        location: { reload: vi.fn() },
      },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    storage.clear();
    vi.unstubAllGlobals();
    vi.stubGlobal('localStorage', localStorageMock);
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');
  });

  it('first interactive sign-in (no GRANTED_KEY) requests with prompt: consent', async () => {
    const { signIn } = await import('./google');
    const p = signIn();
    await vi.advanceTimersByTimeAsync(0);

    expect(_fakeClient.requestAccessToken).toHaveBeenCalledWith({ prompt: 'consent' });

    // Settle promise to avoid unhandled rejection
    _fakeClient.callback({
      access_token: 'tok1',
      expires_in: 3600,
      token_type: 'Bearer',
      scope: 'https://www.googleapis.com/auth/spreadsheets',
    });
    await p;
  });

  it('interactive sign-in with GRANTED_KEY set requests with prompt: empty string', async () => {
    storage.set('ggranted', '1');
    const { signIn } = await import('./google');
    const p = signIn();
    await vi.advanceTimersByTimeAsync(0);

    expect(_fakeClient.requestAccessToken).toHaveBeenCalledWith({ prompt: '' });

    _fakeClient.callback({
      access_token: 'tok2',
      expires_in: 3600,
      token_type: 'Bearer',
      scope: 'https://www.googleapis.com/auth/spreadsheets',
    });
    await p;
  });

  it('successful token response sets GRANTED_KEY to 1', async () => {
    const { signIn } = await import('./google');
    const p = signIn();
    await vi.advanceTimersByTimeAsync(0);

    _fakeClient.callback({
      access_token: 'tok3',
      expires_in: 3600,
      token_type: 'Bearer',
      scope: 'https://www.googleapis.com/auth/spreadsheets',
    });
    await p;

    expect(storage.get('ggranted')).toBe('1');
  });

  it('signOut removes both STORE_KEY and GRANTED_KEY', async () => {
    storage.set('gtoken', JSON.stringify({ access_token: 'x', expires_at: Date.now() + 3600_000 }));
    storage.set('ggranted', '1');

    const { signOut } = await import('./google');
    signOut();

    expect(storage.has('gtoken')).toBe(false);
    expect(storage.has('ggranted')).toBe(false);
  });

  it('failed interactive signIn removes GRANTED_KEY', async () => {
    storage.set('ggranted', '1');
    const { signIn } = await import('./google');
    const p = signIn();
    await vi.advanceTimersByTimeAsync(0);

    // Simulate failure via error_callback
    _capturedConfig.error_callback({ type: 'popup_closed' });

    await expect(p).rejects.toThrow('popup_closed');
    expect(storage.has('ggranted')).toBe(false);
  });

  it('non-interactive getToken always requests with prompt: empty string regardless of GRANTED_KEY', async () => {
    storage.set('ggranted', '1');
    const { getToken } = await import('./google');
    const p = getToken();
    await vi.advanceTimersByTimeAsync(0);

    expect(_fakeClient.requestAccessToken).toHaveBeenCalledWith({ prompt: '' });

    _fakeClient.callback({
      access_token: 'silent-tok',
      expires_in: 3600,
      token_type: 'Bearer',
      scope: 'https://www.googleapis.com/auth/spreadsheets',
    });
    await p;
  });
});

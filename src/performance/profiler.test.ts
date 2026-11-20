// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('web-vitals/attribution', () => ({
  onCLS: vi.fn(),
  onFCP: vi.fn(),
  onINP: vi.fn(),
  onLCP: vi.fn(),
  onTTFB: vi.fn(),
}));
vi.mock('./store', () => ({
  pruneRecords: vi.fn().mockResolvedValue(undefined),
  recordSessionStart: vi.fn().mockResolvedValue(null),
  writeRecords: vi.fn().mockRejectedValue(new Error('quota exceeded')),
}));

import { initProfiler, sanitizeProfileInput } from './profiler';
import { writeRecords } from './store';

describe('performance profiler', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('sanitizes route and attribution without retaining URLs or arbitrary identifiers', () => {
    const result = sanitizeProfileInput({
      route: 'settings/advanced',
      durationMs: 42,
      unit: 'ms',
      attribution: {
        inputDelay: 8,
        target: '#user-content',
        resourceUrl: 'https://example.test/private?token=value',
        requestId: 123,
      },
    });
    expect(result).toEqual({
      route: 'settings/advanced',
      durationMs: 42,
      unit: 'ms',
      attribution: { inputDelay: 8 },
    });
  });

  it('degrades without PerformanceObserver and isolates storage failures', async () => {
    vi.stubGlobal('PerformanceObserver', undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(() => initProfiler()).not.toThrow();
    const profiler = globalThis.__wtProfiler;
    expect(profiler).toBeDefined();
    profiler?.record('app', 'failure-isolation-test');
    await expect(profiler?.flush()).resolves.toBeUndefined();
    expect(profiler?.getStatus().storageError).toContain('quota exceeded');
    expect(warn).toHaveBeenCalled();
  });

  it('separates render completion from delayed frames and retains the original route', async () => {
    vi.mocked(writeRecords).mockResolvedValue(undefined);
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    const now = vi.spyOn(performance, 'now').mockReturnValue(100);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const profiler = globalThis.__wtProfiler!;
    profiler.recordFirstRender(20, { route: 'networth', cacheState: 'cached' });
    now.mockReturnValue(2600);
    window.location.hash = '#analytics';
    callbacks[0](2600);
    await profiler.flush();
    const records = vi.mocked(writeRecords).mock.calls.flatMap(([batch]) => batch);
    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'first-render-complete',
          durationMs: 80,
          route: 'networth',
        }),
        expect.objectContaining({
          name: 'first-frame-delay-visible',
          durationMs: 2500,
          route: 'networth',
        }),
      ]),
    );
    window.location.hash = '';
  });

  it('retains the actual completion timestamp when profiler loading finishes later', async () => {
    vi.mocked(writeRecords).mockClear();
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return 1;
    });
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const now = vi.spyOn(performance, 'now').mockReturnValue(2600);
    const profiler = globalThis.__wtProfiler!;
    profiler.recordFirstRender(20, { route: 'settings' }, 100);
    now.mockReturnValue(2610);
    callbacks[0](2610);
    await profiler.flush();
    const records = vi.mocked(writeRecords).mock.calls.flatMap(([batch]) => batch);
    expect(records).toContainEqual(
      expect.objectContaining({ name: 'first-render-complete', durationMs: 80 }),
    );
    expect(records).toContainEqual(
      expect.objectContaining({ name: 'first-frame-delay-visible', durationMs: 2510 }),
    );
  });

  it('labels frames delayed across a hidden interval separately', async () => {
    vi.mocked(writeRecords).mockClear();
    let callback!: FrameRequestCallback;
    vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => {
      callback = fn;
      return 1;
    });
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const now = vi.spyOn(performance, 'now').mockReturnValue(50);
    const profiler = globalThis.__wtProfiler!;
    profiler.recordFirstRender(0, { route: 'portfolio' });
    visibility.mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    visibility.mockReturnValue('visible');
    now.mockReturnValue(3050);
    callback(3050);
    await profiler.flush();
    await profiler.flush();
    const records = vi.mocked(writeRecords).mock.calls.flatMap(([batch]) => batch);
    expect(records).toContainEqual(
      expect.objectContaining({
        name: 'first-frame-delay-hidden',
        durationMs: 3000,
        route: 'portfolio',
      }),
    );
  });

  it('distinguishes known resize notifications without retaining arbitrary error text', async () => {
    vi.mocked(writeRecords).mockClear();
    window.dispatchEvent(
      new ErrorEvent('error', {
        message: 'ResizeObserver loop completed with undelivered notifications.',
      }),
    );
    window.dispatchEvent(
      new ErrorEvent('error', { message: 'ResizeObserver loop limit exceeded' }),
    );
    window.dispatchEvent(new ErrorEvent('error', { message: 'Sensitive arbitrary error' }));
    await globalThis.__wtProfiler!.flush();
    const records = vi.mocked(writeRecords).mock.calls.flatMap(([batch]) => batch);
    expect(records.filter((r) => r.name === 'resize-observer-loop')).toHaveLength(2);
    expect(records).toContainEqual(
      expect.objectContaining({ category: 'error', name: 'javascript-error' }),
    );
    expect(JSON.stringify(records)).not.toContain('Sensitive arbitrary error');
  });
});

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
});

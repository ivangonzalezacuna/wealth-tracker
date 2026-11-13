import { afterEach, expect, it, vi } from 'vitest';
import { measureRender } from './measure';

afterEach(() => vi.unstubAllGlobals());

it('preserves return values with profiling disabled', () => {
  vi.stubGlobal('__wtProfiler', undefined);
  expect(measureRender('test', 'networth', () => 42)).toBe(42);
});

it('records duration and outcome without swallowing render failures', () => {
  const record = vi.fn();
  vi.stubGlobal('__wtProfiler', { record });
  const error = new Error('test');
  expect(() =>
    measureRender('networth-goals', 'networth', () => {
      throw error;
    }),
  ).toThrow(error);
  expect(record).toHaveBeenCalledWith(
    'render',
    'networth-goals',
    expect.objectContaining({ outcome: 'error', route: 'networth' }),
  );
  record.mockClear();
  expect(measureRender('networth-goals', 'networth', () => 42)).toBe(42);
  expect(record).toHaveBeenCalledWith(
    'render',
    'networth-goals',
    expect.objectContaining({ outcome: 'success' }),
  );
});

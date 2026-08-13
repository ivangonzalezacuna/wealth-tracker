import { describe, it, expect, vi, afterEach } from 'vitest';
import { toBase, APP_CURRENCY } from './fx';

describe('APP_CURRENCY', () => {
  it('is EUR', () => {
    expect(APP_CURRENCY).toBe('EUR');
  });
});

describe('toBase', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns value unchanged when currency matches APP_CURRENCY', () => {
    expect(toBase(100, 'EUR', 0)).toBe(100);
    expect(toBase(-50, 'EUR', 1.1)).toBe(-50);
  });

  it('returns value unchanged when currency is empty (defaults to base)', () => {
    expect(toBase(100, '', 0.9)).toBe(100);
  });

  it('converts non-base currency using fxRate', () => {
    // 100 USD at 0.92 USD/EUR → 92 EUR
    expect(toBase(100, 'USD', 0.92)).toBeCloseTo(92);
  });

  it('converts negative amounts correctly', () => {
    // -200 CHF at 1.05 CHF/EUR → -210 EUR
    expect(toBase(-200, 'CHF', 1.05)).toBeCloseTo(-210);
  });

  it('warns and returns NaN when fxRate is 0 for non-base currency', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = toBase(100, 'USD', 0);
    expect(Number.isNaN(result)).toBe(true);
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toContain('USD');
    expect(warnSpy.mock.calls[0][0]).toContain('fxRate=0');
  });

  it('warns and returns NaN when fxRate is negative', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = toBase(100, 'USD', -1);
    expect(Number.isNaN(result)).toBe(true);
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it('warns and returns NaN when fxRate is Infinity', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = toBase(100, 'USD', Infinity);
    expect(Number.isNaN(result)).toBe(true);
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it('warns and returns NaN when fxRate is NaN', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = toBase(100, 'USD', NaN);
    expect(Number.isNaN(result)).toBe(true);
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it('does not warn for EUR transactions regardless of fxRate', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    toBase(100, 'EUR', 0);
    toBase(100, 'EUR', NaN);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

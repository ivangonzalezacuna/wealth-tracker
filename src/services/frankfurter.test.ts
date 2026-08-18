import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import {
  fetchRate,
  FrankfurterError,
  FrankfurterOfflineError,
  FRANKFURTER_BASE_URL,
} from './frankfurter';

const BASE_URL = FRANKFURTER_BASE_URL;

/** V2 /rate/{base}/{quote} response: a single Rate object. */
function mockFetch(body: unknown, status = 200) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchRate', () => {
  it('builds the correct URL for a historical date', async () => {
    const spy = mockFetch({ date: '2024-01-15', base: 'USD', quote: 'EUR', rate: 0.92 });
    await fetchRate('USD', 'EUR', '2024-01-15');
    expect(spy).toHaveBeenCalledWith(`${BASE_URL}/rate/USD/EUR?date=2024-01-15`);
  });

  it('builds the correct URL for "latest" (no date param)', async () => {
    const spy = mockFetch({ date: '2024-01-15', base: 'USD', quote: 'EUR', rate: 0.92 });
    await fetchRate('USD', 'EUR', 'latest');
    expect(spy).toHaveBeenCalledWith(`${BASE_URL}/rate/USD/EUR`);
  });

  it('returns a correctly shaped FxRateRecord', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-20T10:00:00.000Z'));
    mockFetch({ date: '2024-01-15', base: 'USD', quote: 'EUR', rate: 0.92 });

    const result = await fetchRate('USD', 'EUR', '2024-01-15');
    expect(result).toEqual({
      base: 'USD',
      target: 'EUR',
      date: '2024-01-15',
      rate: 0.92,
      effectiveDate: '2024-01-15',
      fetchedAt: '2024-01-20T10:00:00.000Z',
    });
    vi.useRealTimers();
  });

  it('sets date to effectiveDate for "latest" requests', async () => {
    mockFetch({ date: '2024-01-19', base: 'USD', quote: 'EUR', rate: 0.91 });
    const result = await fetchRate('USD', 'EUR', 'latest');
    // date should mirror the provider's effective date
    expect(result.date).toBe('2024-01-19');
    expect(result.effectiveDate).toBe('2024-01-19');
  });

  it('handles business-day fallback: effectiveDate differs from requested date', async () => {
    // Saturday 2024-01-20 → provider returns Friday 2024-01-19
    mockFetch({ date: '2024-01-19', base: 'USD', quote: 'EUR', rate: 0.91 });
    const result = await fetchRate('USD', 'EUR', '2024-01-20');
    expect(result.date).toBe('2024-01-20'); // requested date preserved
    expect(result.effectiveDate).toBe('2024-01-19'); // provider's actual date
    expect(result.rate).toBe(0.91);
  });

  it('throws FrankfurterOfflineError on network failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(fetchRate('USD', 'EUR', '2024-01-15')).rejects.toThrow(FrankfurterOfflineError);
  });

  it('FrankfurterOfflineError includes the original message', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(fetchRate('USD', 'EUR', '2024-01-15')).rejects.toThrow('Failed to fetch');
  });

  it('throws FrankfurterError on non-OK HTTP response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Not Found', { status: 404 }));
    const err = await fetchRate('USD', 'EUR', '2024-01-15').catch((e) => e);
    expect(err).toBeInstanceOf(FrankfurterError);
    expect(err.statusCode).toBe(404);
  });

  it('throws FrankfurterError on malformed JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('not-json', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    await expect(fetchRate('USD', 'EUR', '2024-01-15')).rejects.toThrow(FrankfurterError);
  });

  it('throws FrankfurterError when response is missing required fields', async () => {
    mockFetch({ base: 'USD', quote: 'EUR' }); // no date or rate
    await expect(fetchRate('USD', 'EUR', '2024-01-15')).rejects.toThrow(FrankfurterError);
  });

  it('throws FrankfurterError when rate value is non-positive', async () => {
    mockFetch({ date: '2024-01-15', base: 'USD', quote: 'EUR', rate: 0 });
    await expect(fetchRate('USD', 'EUR', '2024-01-15')).rejects.toThrow(FrankfurterError);
  });

  it('accepts a custom baseUrl', async () => {
    const spy = mockFetch({ date: '2024-01-15', base: 'USD', quote: 'EUR', rate: 0.92 });
    await fetchRate('USD', 'EUR', '2024-01-15', 'https://custom.host/v2');
    expect(spy).toHaveBeenCalledWith('https://custom.host/v2/rate/USD/EUR?date=2024-01-15');
  });
});

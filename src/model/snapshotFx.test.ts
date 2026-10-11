import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../fx', () => ({
  APP_CURRENCY: 'EUR',
  resolveMonthEndRate: vi.fn(),
}));

vi.mock('../services/fxRateService', () => ({
  recordFxNormalize: vi.fn().mockResolvedValue(undefined),
}));

import { normalizeSnapshotReview } from './snapshotFx';
import { resolveMonthEndRate } from '../fx';
import { recordFxNormalize } from '../services/fxRateService';
import type { Snapshot, FxRateRecord } from '../types';

const mockResolveMonthEndRate = vi.mocked(resolveMonthEndRate);

afterEach(() => {
  vi.clearAllMocks();
  mockResolveMonthEndRate.mockReset();
});

function makeRate(rate: number): FxRateRecord {
  return {
    base: 'USD',
    target: 'EUR',
    date: '2024-01-31',
    rate,
    effectiveDate: '2024-01-31',
    fetchedAt: '2024-02-01T00:00:00.000Z',
  };
}

describe('normalizeSnapshotReview', () => {
  it('converts each field once at its currency rate, caches per currency and preserves hidden canonical keys without mutation', async () => {
    mockResolveMonthEndRate.mockImplementation(async (currency) =>
      makeRate(currency === 'GBP' ? 1.25 : 0.9),
    );
    const snap = Object.freeze({
      date: '2024-02',
      broker: 1000,
      etf_broker: 100,
      gbp_cash: 20,
      etf_ABC: 500,
      retired: 250.123456789,
      etf_hidden: 0,
      metadata: 'preserved',
    });
    const result = await normalizeSnapshotReview(snap, {
      broker: 'USD',
      etf_broker: 'GBP',
      gbp_cash: 'GBP',
      etf_ABC: 'USD',
    });
    expect(result.snapshot).toEqual({
      ...snap,
      broker: 900,
      etf_broker: 125,
      gbp_cash: 25,
      etf_ABC: 450,
    });
    expect(result.snapshot).not.toBe(snap);
    expect(snap.broker).toBe(1000);
    expect(snap.etf_broker).toBe(100);
    expect(mockResolveMonthEndRate.mock.calls).toEqual([
      ['USD', '2024-02'],
      ['GBP', '2024-02'],
    ]);
    expect(result.rates).toEqual({ USD: 0.9, GBP: 1.25 });
    expect(recordFxNormalize).toHaveBeenCalledWith(4, 4, 0);
  });

  it.each([null, -1, 0, NaN, Infinity, -Infinity])(
    'blocks raw foreign balances and records failed telemetry for rate %s',
    async (rate) => {
      mockResolveMonthEndRate.mockResolvedValue(rate === null ? null : makeRate(rate));
      expect(
        await normalizeSnapshotReview({ date: '2024-01', broker: 1000 }, { broker: 'USD' }),
      ).toEqual({ error: expect.stringContaining('FX unavailable') });
      expect(recordFxNormalize).toHaveBeenCalledWith(1, 0, 1);
    },
  );

  it('allows explicit EUR amounts, including zero, without fetching rates', async () => {
    const snap = { date: '2024-01', broker: 900, etf_ABC: 0 };
    expect(await normalizeSnapshotReview(snap, { broker: 'EUR', etf_ABC: 'EUR' })).toEqual({
      snapshot: snap,
      rates: {},
    });
    expect(mockResolveMonthEndRate).not.toHaveBeenCalled();
    expect(recordFxNormalize).not.toHaveBeenCalled();
  });

  it.each(['not-a-number', undefined, NaN, Infinity, -Infinity])(
    'rejects non-finite or non-numeric input %s before requesting FX',
    async (value) => {
      const snap: Snapshot = { date: '2024-01', broker: value };
      expect(await normalizeSnapshotReview(snap, { broker: 'USD' })).toEqual({
        error: 'Every entered balance must be a finite number.',
      });
      expect(mockResolveMonthEndRate).not.toHaveBeenCalled();
      expect(recordFxNormalize).not.toHaveBeenCalled();
    },
  );

  it('blocks a thrown provider error and records resolved and failed attempts', async () => {
    mockResolveMonthEndRate
      .mockResolvedValueOnce(makeRate(0.9))
      .mockRejectedValueOnce(new Error('offline'));
    expect(
      await normalizeSnapshotReview(
        { date: '2024-01', broker: 1000, etf_broker: 100 },
        { broker: 'USD', etf_broker: 'GBP' },
      ),
    ).toEqual({ error: expect.stringContaining('FX rate fetch failed') });
    expect(recordFxNormalize).toHaveBeenCalledWith(2, 1, 1);
  });

  it('rejects conversion overflow rather than returning a saveable snapshot', async () => {
    mockResolveMonthEndRate.mockResolvedValue(makeRate(10));
    expect(
      await normalizeSnapshotReview({ date: '2024-02', broker: 1e308 }, { broker: 'USD' }),
    ).toEqual({ error: 'Converted amount is too large.' });
    expect(recordFxNormalize).toHaveBeenCalledWith(1, 1, 0);
  });
});

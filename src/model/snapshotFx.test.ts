import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../fx', () => ({
  APP_CURRENCY: 'EUR',
  resolveMonthEndRate: vi.fn(),
}));

import { applySnapshotFxNormalization } from './snapshotFx';
import { resolveMonthEndRate } from '../fx';
import type { Snapshot, Account, FxRateRecord } from '../types';

const mockResolveMonthEndRate = vi.mocked(resolveMonthEndRate);

afterEach(() => {
  vi.clearAllMocks();
});

// ── helpers ────────────────────────────────────────────────────────

function makeAccount(id: string, currency = 'EUR'): Account {
  return { id, label: id, currency };
}

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

// ── applySnapshotFxNormalization ───────────────────────────────────

describe('applySnapshotFxNormalization', () => {
  it('returns the snapshot unchanged when all accounts are EUR', async () => {
    const snap: Snapshot = { date: '2024-01', acc1: 1000, acc2: 500 };
    const accounts = [makeAccount('acc1', 'EUR'), makeAccount('acc2', 'EUR')];

    const result = await applySnapshotFxNormalization(snap, accounts);

    expect(result).toBe(snap); // same reference — no copy made
    expect(mockResolveMonthEndRate).not.toHaveBeenCalled();
  });

  it('converts a non-EUR account balance using the month-end rate', async () => {
    mockResolveMonthEndRate.mockResolvedValue(makeRate(0.92));

    const snap: Snapshot = { date: '2024-01', usd_acc: 1000 };
    const accounts = [makeAccount('usd_acc', 'USD')];

    const result = await applySnapshotFxNormalization(snap, accounts);

    expect(result.usd_acc).toBeCloseTo(920); // 1000 * 0.92
    expect(mockResolveMonthEndRate).toHaveBeenCalledWith('USD', '2024-01');
  });

  it('keeps the raw balance when the FX service returns null', async () => {
    mockResolveMonthEndRate.mockResolvedValue(null);

    const snap: Snapshot = { date: '2024-01', usd_acc: 1000 };
    const accounts = [makeAccount('usd_acc', 'USD')];

    const result = await applySnapshotFxNormalization(snap, accounts);

    expect(result.usd_acc).toBe(1000); // unchanged
  });

  it('converts only non-EUR accounts and leaves EUR accounts untouched', async () => {
    mockResolveMonthEndRate.mockResolvedValue(makeRate(0.85));

    const snap: Snapshot = { date: '2024-01', eur_acc: 500, usd_acc: 1000 };
    const accounts = [makeAccount('eur_acc', 'EUR'), makeAccount('usd_acc', 'USD')];

    const result = await applySnapshotFxNormalization(snap, accounts);

    expect(result.eur_acc).toBe(500); // unchanged
    expect(result.usd_acc).toBeCloseTo(850); // 1000 * 0.85
    expect(mockResolveMonthEndRate).toHaveBeenCalledTimes(1);
    expect(mockResolveMonthEndRate).toHaveBeenCalledWith('USD', '2024-01');
  });

  it('skips accounts whose balance is not a finite number', async () => {
    const snap: Snapshot = { date: '2024-01', usd_acc: 'not-a-number' as unknown as number };
    const accounts = [makeAccount('usd_acc', 'USD')];

    await applySnapshotFxNormalization(snap, accounts);

    expect(mockResolveMonthEndRate).not.toHaveBeenCalled();
  });

  it('skips accounts whose balance is NaN or Infinity', async () => {
    const snap: Snapshot = { date: '2024-01', usd_acc: NaN, usd_acc2: Infinity };
    const accounts = [makeAccount('usd_acc', 'USD'), makeAccount('usd_acc2', 'USD')];

    await applySnapshotFxNormalization(snap, accounts);

    expect(mockResolveMonthEndRate).not.toHaveBeenCalled();
  });

  it('handles accounts whose currency defaults to EUR when unset', async () => {
    const snap: Snapshot = { date: '2024-01', acc1: 1000 };
    const accounts = [{ id: 'acc1', label: 'acc1' }]; // no currency field

    const result = await applySnapshotFxNormalization(snap, accounts);

    expect(result.acc1).toBe(1000);
    expect(mockResolveMonthEndRate).not.toHaveBeenCalled();
  });

  it('does not mutate the original snapshot object', async () => {
    mockResolveMonthEndRate.mockResolvedValue(makeRate(0.92));

    const snap: Snapshot = { date: '2024-01', usd_acc: 1000 };
    const original = { ...snap };
    const accounts = [makeAccount('usd_acc', 'USD')];

    await applySnapshotFxNormalization(snap, accounts);

    expect(snap).toEqual(original);
  });

  it('returns an empty accounts array unchanged', async () => {
    const snap: Snapshot = { date: '2024-01' };
    const result = await applySnapshotFxNormalization(snap, []);
    expect(result).toBe(snap);
    expect(mockResolveMonthEndRate).not.toHaveBeenCalled();
  });
});

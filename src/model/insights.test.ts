import { describe, it, expect } from 'vitest';
import { monthlyGrowthSplit, cagr, findYoYSnapshot } from './insights';
import type { Snapshot } from '../types';

describe('monthlyGrowthSplit', () => {
  it('splits delta into contributed and market', () => {
    const result = monthlyGrowthSplit(11000, 10000, 400);
    expect(result).toEqual({ contributed: 400, market: 600 });
  });

  it('handles negative market movement', () => {
    const result = monthlyGrowthSplit(10200, 10000, 400);
    expect(result).toEqual({ contributed: 400, market: -200 });
  });

  it('handles zero contributions', () => {
    const result = monthlyGrowthSplit(10500, 10000, 0);
    expect(result).toEqual({ contributed: 0, market: 500 });
  });

  it('handles overall loss with contributions', () => {
    const result = monthlyGrowthSplit(9800, 10000, 400);
    expect(result).toEqual({ contributed: 400, market: -600 });
  });
});

describe('cagr', () => {
  it('returns the correct CAGR for a known case', () => {
    // 10000 -> 12100 over 24 months = (12100/10000)^(12/24) - 1 = 0.1 = 10%
    const result = cagr(10000, 12100, 24);
    expect(result).toBeCloseTo(0.1, 5);
  });

  it('returns null for months < 12', () => {
    expect(cagr(10000, 11000, 6)).toBeNull();
    expect(cagr(10000, 11000, 11)).toBeNull();
  });

  it('returns null for first <= 0', () => {
    expect(cagr(0, 11000, 24)).toBeNull();
    expect(cagr(-100, 11000, 24)).toBeNull();
  });

  it('handles exactly 12 months', () => {
    // 10000 -> 11000 over 12 months = (11000/10000)^(12/12) - 1 = 0.1
    const result = cagr(10000, 11000, 12);
    expect(result).toBeCloseTo(0.1, 5);
  });

  it('handles negative growth', () => {
    // 10000 -> 9000 over 12 months
    const result = cagr(10000, 9000, 12);
    expect(result).toBeCloseTo(-0.1, 5);
  });
});

describe('findYoYSnapshot', () => {
  it('returns null when fewer than 2 snapshots', () => {
    expect(findYoYSnapshot([])).toBeNull();
    expect(findYoYSnapshot([{ date: '2026-06' }])).toBeNull();
  });

  it('returns null when history span < 12 months', () => {
    const snaps: Snapshot[] = [{ date: '2026-01' }, { date: '2026-06' }];
    expect(findYoYSnapshot(snaps)).toBeNull();
  });

  it('picks the snapshot nearest 12 months prior', () => {
    const snaps: Snapshot[] = [
      { date: '2025-01', savings: 5000 },
      { date: '2025-06', savings: 6000 },
      { date: '2025-07', savings: 6500 },
      { date: '2026-06', savings: 10000 },
    ];
    const result = findYoYSnapshot(snaps);
    expect(result).not.toBeNull();
    // Nearest to 2025-06 (12 months before 2026-06) is the snap at 2025-06
    expect(result!.snap.date).toBe('2025-06');
  });

  it('picks the closest when no exact match exists', () => {
    const snaps: Snapshot[] = [
      { date: '2025-01', savings: 5000 },
      { date: '2025-04', savings: 5500 },
      { date: '2025-08', savings: 6500 },
      { date: '2026-06', savings: 10000 },
    ];
    const result = findYoYSnapshot(snaps);
    expect(result).not.toBeNull();
    // 12 months before 2026-06 = 2025-06, nearest available is 2025-04 (dist=2) or 2025-08 (dist=2)
    // Both equidistant; first found wins = 2025-04
    expect(['2025-04', '2025-08']).toContain(result!.snap.date);
  });

  it('works at year boundary (January latest)', () => {
    const snaps: Snapshot[] = [
      { date: '2024-12', savings: 8000 },
      { date: '2025-01', savings: 8200 },
      { date: '2025-06', savings: 9000 },
      { date: '2026-01', savings: 11000 },
    ];
    const result = findYoYSnapshot(snaps);
    expect(result).not.toBeNull();
    // 12 months before 2026-01 = 2025-01
    expect(result!.snap.date).toBe('2025-01');
  });
});

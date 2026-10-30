import { describe, expect, it, vi, afterEach } from 'vitest';
import type { Account } from '../types';
import {
  isAccountClosedInMonth,
  validateAccountLifecycle,
  validateClosedPeriods,
} from './accounts';

const account: Account = {
  id: 'spain',
  label: 'Spain ETF',
  moneyType: 'investment',
  closedPeriods: [
    { closedFromMonth: '2026-02', reopenedFromMonth: '2046-06' },
    { closedFromMonth: '2050-01' },
  ],
};

afterEach(() => vi.useRealTimers());

describe('account closure intervals', () => {
  it('preserves repeated closed gaps with inclusive close and exclusive reopen', () => {
    expect(isAccountClosedInMonth(account, '2026-01')).toBe(false);
    expect(isAccountClosedInMonth(account, '2026-02-28')).toBe(true);
    expect(isAccountClosedInMonth(account, '2046-05')).toBe(true);
    expect(isAccountClosedInMonth(account, '2046-06')).toBe(false);
    expect(isAccountClosedInMonth(account, '2050-01')).toBe(true);
  });
  it('rejects invalid, unordered, adjacent or overlapping periods', () => {
    for (const periods of [
      [{ closedFromMonth: '2026-13' }],
      [{ closedFromMonth: '2026-01', reopenedFromMonth: '2026-01' }],
      [{ closedFromMonth: '2026-01' }, { closedFromMonth: '2027-01' }],
      [
        { closedFromMonth: '2026-01', reopenedFromMonth: '2026-04' },
        { closedFromMonth: '2026-04' },
      ],
    ])
      expect(validateClosedPeriods(periods)).not.toBeNull();
  });
  it('requires persisted zero at every closure boundary and blocks residual balances', () => {
    const closed: Account = { ...account, closedPeriods: [{ closedFromMonth: '2026-02' }] };
    expect(validateAccountLifecycle([closed], [])).toContain('explicit zero');
    expect(validateAccountLifecycle([closed], [{ date: '2026-02', spain: 0 }])).toBeNull();
    expect(
      validateAccountLifecycle(
        [closed],
        [
          { date: '2026-02', spain: 0 },
          { date: '2026-03', spain: -1 },
        ],
      ),
    ).toContain('nonzero');
    expect(
      validateAccountLifecycle(
        [closed],
        [{ date: '2026-02', spain: 0, 'position:spain:IE00B4L5Y983': 1 }],
      ),
    ).toContain('ETF');
  });
  it('uses aliases/case and preserves actual historical balances', () => {
    const closed = {
      ...account,
      key: 'old_spain',
      closedPeriods: [{ closedFromMonth: '2026-02' }],
    };
    expect(
      validateAccountLifecycle(
        [closed],
        [
          { date: '2026-01', OLD_SPAIN: 10000 },
          { date: '2026-02', OLD_SPAIN: 0 },
        ],
      ),
    ).toBeNull();
  });
  it('does not allow primary or future contributions on a currently closed account', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2027-01-01'));
    expect(
      validateAccountLifecycle(
        [{ ...account, isPrimaryInvestment: true }],
        [
          { date: '2026-02', spain: 0 },
          { date: '2050-01', spain: 0 },
        ],
      ),
    ).toContain('planned contributions');
  });
});

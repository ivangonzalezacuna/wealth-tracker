/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Account } from '../types';
import { accountLifecycleDialog } from './accountLifecycleDialog';

const source: Account = {
  id: 'old',
  label: 'Original name',
  moneyType: 'investment',
  isPrimaryInvestment: true,
  contribAmount: 100,
  extraContrib: 50,
  locked: true,
  annualReturnPct: 7,
};
const field = (selector: string) => document.querySelector<HTMLInputElement>(selector)!;
function confirm() {
  field('#lifecycle-confirm').checked = true;
  document.querySelector<HTMLButtonElement>('.js-submit')!.click();
}
afterEach(() => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('account lifecycle review', () => {
  it('requires explicit primary choice and stages budget stop without mutating input', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-15'));
    const pending = accountLifecycleDialog({
      accounts: [source],
      accountIndex: 0,
      mode: 'close',
      snapshots: [{ date: '2026-09', old: 0 }],
    });
    confirm();
    expect(field('#lifecycle-error').textContent).toContain('replacement primary');
    field('#lifecycle-primary').value = 'stop';
    confirm();
    const result = await pending;
    expect(result?.settingsPatch).toEqual({ monthly_contrib_budget: '0' });
    expect(result?.accounts[0]).toMatchObject({
      id: 'old',
      label: 'Original name',
      locked: true,
      annualReturnPct: 7,
      contribAmount: 0,
      extraContrib: 0,
      isPrimaryInvestment: false,
      closedPeriods: [{ closedFromMonth: '2026-09' }],
    });
    expect(source.contribAmount).toBe(100);
    expect(source.closedPeriods).toBeUndefined();
  });

  it('blocks current-month closure, missing zero and source ETF values', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-15'));
    const pending = accountLifecycleDialog({
      accounts: [{ ...source, isPrimaryInvestment: false }],
      accountIndex: 0,
      mode: 'close',
      snapshots: [{ date: '2026-09', old: 0, 'position:old:IE00B4L5Y983': 10 }],
    });
    field('#lifecycle-month').value = '2026-10';
    confirm();
    expect(field('#lifecycle-error').textContent).toContain('completed');
    field('#lifecycle-month').value = '2026-09';
    confirm();
    expect(field('#lifecycle-error').textContent).toContain('ETF');
    expect(field('#lifecycle-blockers').textContent).toContain('2026-09');
    expect(document.querySelector<HTMLAnchorElement>('.js-snapshots')!.getAttribute('href')).toBe(
      '#log/snapshots',
    );
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(await pending).toBeNull();
  });

  it('reopens the same record without contributions or changing another primary', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-15'));
    const closed = {
      ...source,
      isPrimaryInvestment: false,
      contribAmount: 0,
      extraContrib: 0,
      closedPeriods: [{ closedFromMonth: '2026-01' }],
    };
    const other = {
      id: 'other',
      label: 'Other',
      moneyType: 'investment',
      isPrimaryInvestment: true,
    };
    const pending = accountLifecycleDialog({
      accounts: [closed, other],
      accountIndex: 0,
      mode: 'reopen',
      snapshots: [{ date: '2026-01', old: 0 }],
    });
    expect(document.body.textContent).toContain('bank issued a replacement');
    confirm();
    const result = await pending;
    expect(result?.accounts[0].closedPeriods).toEqual([
      { closedFromMonth: '2026-01', reopenedFromMonth: '2026-10' },
    ]);
    expect(result?.accounts[1]).toBe(other);
    expect(result?.accounts[0].contribAmount).toBe(0);
    expect(closed.closedPeriods[0]).not.toHaveProperty('reopenedFromMonth');
  });

  it('requires reviewed and validated date corrections', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-15'));
    const account = {
      ...source,
      isPrimaryInvestment: false,
      contribAmount: 0,
      extraContrib: 0,
      closedPeriods: [{ closedFromMonth: '2026-01', reopenedFromMonth: '2026-04' }],
    };
    const pending = accountLifecycleDialog({
      accounts: [account],
      accountIndex: 0,
      mode: 'correct',
      snapshots: [
        { date: '2026-01', old: 0 },
        { date: '2026-02', old: 0 },
      ],
    });
    field('[data-close="0"]').value = '2026-02';
    confirm();
    const result = await pending;
    expect(result?.accounts[0].closedPeriods?.[0].closedFromMonth).toBe('2026-02');
    expect(account.closedPeriods[0].closedFromMonth).toBe('2026-01');
  });
});

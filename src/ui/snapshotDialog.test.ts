/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { snapshotDialog } from './snapshotDialog';
import type { Account, Holding, PortfolioData, Snapshot } from '../types';

const accounts: Account[] = [
  { id: 'cash', label: 'Cash account' },
  {
    id: 'broker',
    label: 'Broker',
    currency: 'USD',
    moneyType: 'investment',
    isPrimaryInvestment: true,
  },
];

const configHoldings: Holding[] = [
  {
    isin: 'IE00AAA',
    name: 'World ETF',
    shortName: 'WORLD',
    color: '#111111',
    acc: true,
    active: true,
    targetPct: 100,
    assetClass: 'equity',
    region: 'world',
    foldInto: '',
    order: 1,
  },
  {
    isin: 'IE00BBB',
    name: 'Legacy ETF',
    shortName: 'LEGACY',
    color: '#222222',
    acc: true,
    active: false,
    assetClass: 'bond',
    region: 'eu',
    foldInto: '',
    order: 2,
  },
];

const holdings: PortfolioData['etfs'] = {
  IE00AAA: {
    isin: 'IE00AAA',
    shortName: 'WORLD',
    name: 'World ETF',
    color: '#111111',
    acc: true,
    active: true,
    shares: 10,
    cost: 1000,
    divNet: 0,
    taxPaid: 0,
    buys: 0,
    realizedPnL: 0,
    totalFees: 0,
    exited: false,
  },
  IE00BBB: {
    isin: 'IE00BBB',
    shortName: 'LEGACY',
    name: 'Legacy ETF',
    color: '#222222',
    acc: true,
    active: false,
    shares: 5,
    cost: 500,
    divNet: 0,
    taxPaid: 0,
    buys: 0,
    realizedPnL: 0,
    totalFees: 0,
    exited: false,
  },
};

function getOverlay() {
  return document.querySelector('.snap-dialog-overlay') as HTMLElement | null;
}
function getSubmit() {
  return document.querySelector('.js-snapd-submit') as HTMLElement | null;
}
function getCancel() {
  return document.querySelector('.js-snapd-cancel') as HTMLElement | null;
}
function setField(id: string, value: string) {
  const el = document.querySelector('#' + id) as HTMLInputElement | null;
  if (el) {
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
}
function baseOpts(extra: Partial<Parameters<typeof snapshotDialog>[0]> = {}) {
  return {
    accounts,
    holdings,
    configHoldings,
    ...extra,
  };
}

function nextMonth(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

describe('snapshotDialog', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    getOverlay()?.remove();
    document.body.style.overflow = '';
    document.removeEventListener('keydown', () => {});
  });

  it('appends exactly one .snap-dialog-overlay', () => {
    snapshotDialog(baseOpts());
    expect(document.querySelectorAll('.snap-dialog-overlay').length).toBe(1);
  });

  it('cancelling resolves null and removes overlay', async () => {
    const p = snapshotDialog(baseOpts());
    getCancel()!.click();
    expect(await p).toBeNull();
    expect(getOverlay()).toBeNull();
  });

  it('Escape resolves null and removes overlay', async () => {
    const p = snapshotDialog(baseOpts());
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(await p).toBeNull();
    expect(getOverlay()).toBeNull();
  });

  it('clicking backdrop resolves null', async () => {
    const p = snapshotDialog(baseOpts());
    getOverlay()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(await p).toBeNull();
  });

  it('validates required date field', async () => {
    const p = snapshotDialog(baseOpts());
    setField('snapd-date', '');
    let settled = false;
    void p.then(() => {
      settled = true;
    });
    getSubmit()!.click();
    await Promise.resolve();
    expect(settled).toBe(false);
    expect((document.querySelector('#snapd-date-err') as HTMLElement).textContent).not.toBe('');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await p;
  });

  it('validates future date field', async () => {
    const p = snapshotDialog(baseOpts());
    setField('snapd-date', nextMonth());
    let settled = false;
    void p.then(() => {
      settled = true;
    });
    getSubmit()!.click();
    await Promise.resolve();
    expect(settled).toBe(false);
    expect((document.querySelector('#snapd-date-err') as HTMLElement).textContent).toContain(
      'future',
    );
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await p;
  });

  it('accepts partial ETF allocation as unallocated cash', async () => {
    const p = snapshotDialog(baseOpts());
    (document.querySelector('.snap-etf-toggle') as HTMLButtonElement).click();
    setField('snapd-acc-broker', '1000');
    setField('snapd-etf-broker-IE00AAA', '700');
    getSubmit()!.click();
    const snap = await p;
    expect(snap).not.toBeNull();
    expect(snap!.broker).toBe(1000);
    expect(snap!.etf_IE00AAA).toBe(700);
  });

  it('rejects ETF over-allocation inline', async () => {
    const p = snapshotDialog(baseOpts());
    (document.querySelector('.snap-etf-toggle') as HTMLButtonElement).click();
    setField('snapd-acc-broker', '1000');
    setField('snapd-etf-broker-IE00AAA', '700');
    setField('snapd-etf-broker-IE00BBB', '400');
    let settled = false;
    void p.then(() => {
      settled = true;
    });
    getSubmit()!.click();
    await Promise.resolve();
    expect(settled).toBe(false);
    expect((document.querySelector('#snapd-etf-broker-err') as HTMLElement).textContent).toContain(
      'cannot exceed the account total',
    );
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await p;
  });

  it('submits with valid fields and resolves a Snapshot', async () => {
    const p = snapshotDialog(baseOpts());
    (document.querySelector('.snap-etf-toggle') as HTMLButtonElement).click();
    setField('snapd-date', '2024-06');
    setField('snapd-notes', 'Done');
    setField('snapd-acc-cash', '500');
    setField('snapd-acc-broker', '1000');
    setField('snapd-etf-broker-IE00AAA', '750');
    setField('snapd-etf-broker-IE00BBB', '250');
    getSubmit()!.click();
    const snap = await p;
    expect(snap).not.toBeNull();
    expect(snap!.date).toBe('2024-06');
    expect(snap!.notes).toBe('Done');
    expect(snap!.cash).toBe(500);
    expect(snap!.broker).toBe(1000);
    expect(snap!.etf_IE00AAA).toBe(750);
    expect(snap!.etf_IE00BBB).toBe(250);
  });

  it('title shows edit mode and prefills existing values', () => {
    const existing: Snapshot = {
      date: '2024-04',
      notes: 'Prefilled',
      cash: 200,
      broker: 800,
      etf_IE00AAA: 500,
    };
    snapshotDialog(baseOpts({ existing, mode: 'edit' }));
    expect((document.querySelector('.dialog-title') as HTMLElement).textContent).toContain('Edit');
    expect((document.querySelector('#snapd-date') as HTMLInputElement).value).toBe('2024-04');
    expect((document.querySelector('#snapd-notes') as HTMLInputElement).value).toBe('Prefilled');
    expect((document.querySelector('#snapd-acc-broker') as HTMLInputElement).value).toBe('800');
    expect((document.querySelector('#snapd-etf-broker-IE00AAA') as HTMLInputElement).value).toBe(
      '500',
    );
    expect(
      (document.querySelector('.snap-etf-toggle') as HTMLElement).getAttribute('aria-expanded'),
    ).toBe('true');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });

  it('calling a second time resolves first call null', async () => {
    const p1 = snapshotDialog(baseOpts());
    const p2 = snapshotDialog(baseOpts());
    expect(await p1).toBeNull();
    expect(document.querySelectorAll('.snap-dialog-overlay').length).toBe(1);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(await p2).toBeNull();
  });

  it('traps Tab inside the dialog', () => {
    snapshotDialog(baseOpts());
    const ov = getOverlay()!;
    const focusables = Array.from(
      ov.querySelectorAll('input:not([disabled]), button:not([disabled])'),
    ) as HTMLElement[];
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    last.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.activeElement).toBe(first);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });

  it('keeps compact account spacing classes for regression safety', () => {
    snapshotDialog(baseOpts());
    const accountBlocks = document.querySelectorAll('.snap-dialog-account');
    expect(accountBlocks.length).toBe(2);
    expect(
      document.querySelectorAll('.snap-dialog-account .dialog-error.dialog-error-compact').length,
    ).toBeGreaterThan(0);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });

  it('shows account labels with per-account currency', () => {
    snapshotDialog(baseOpts());
    const cashLabel = document.querySelector('label[for="snapd-acc-cash"]') as HTMLElement | null;
    const brokerLabel = document.querySelector(
      'label[for="snapd-acc-broker"]',
    ) as HTMLElement | null;
    expect(cashLabel?.textContent).toContain('Cash account (EUR)');
    expect(brokerLabel?.textContent).toContain('Broker (USD)');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });
});

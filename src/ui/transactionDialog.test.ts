/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { transactionDialog } from './transactionDialog';
import type { SecuritySuggestions } from '../model/securitySuggestions';

vi.mock('../fx', () => ({
  resolveRate: vi.fn().mockResolvedValue(null),
  resolveMonthEndRate: vi.fn().mockResolvedValue(null),
  APP_CURRENCY: 'EUR',
  toBase: vi.fn((amount: number) => amount),
}));

function getOverlay() {
  return document.querySelector('.tx-dialog-overlay') as HTMLElement | null;
}
function getSubmit() {
  return document.querySelector('.js-txd-submit') as HTMLElement | null;
}
function getCancel() {
  return document.querySelector('.js-txd-cancel') as HTMLElement | null;
}
function setField(id: string, value: string) {
  const el = document.querySelector('#' + id) as HTMLInputElement | null;
  if (el) el.value = value;
}
function fillRequired() {
  setField('txd-date', '2024-06-01');
  setField('txd-name', 'Test Fund');
}

const suggestions: SecuritySuggestions = {
  pairs: [
    { isin: 'IE00AAA', name: 'Alpha Fund' },
    { isin: 'IE00BBB', name: 'Beta Fund' },
  ],
};

describe('transactionDialog', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    getOverlay()?.remove();
    document.body.style.overflow = '';
    document.removeEventListener('keydown', () => {});
  });

  it('appends exactly one .tx-dialog-overlay', () => {
    transactionDialog();
    expect(document.querySelectorAll('.tx-dialog-overlay').length).toBe(1);
  });

  it('uses the shared dialog field spacing instead of the relaxed variant', () => {
    transactionDialog();
    const fields = document.querySelector(
      '.tx-dialog-overlay .dialog-fields',
    ) as HTMLElement | null;
    expect(fields).not.toBeNull();
    expect(fields?.classList.contains('dialog-fields-relaxed')).toBe(false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });

  it('cancelling resolves null and removes overlay', async () => {
    const p = transactionDialog();
    getCancel()!.click();
    expect(await p).toBeNull();
    expect(getOverlay()).toBeNull();
  });

  it('Escape resolves null and removes overlay', async () => {
    const p = transactionDialog();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(await p).toBeNull();
    expect(getOverlay()).toBeNull();
  });

  it('clicking backdrop resolves null', async () => {
    const p = transactionDialog();
    const ov = getOverlay()!;
    ov.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(await p).toBeNull();
  });

  it('validates required date field', async () => {
    const p = transactionDialog();
    fillRequired();
    setField('txd-date', ''); // clear date
    let settled = false;
    void p.then(() => {
      settled = true;
    });
    getSubmit()!.click();
    await Promise.resolve();
    expect(settled).toBe(false); // not yet resolved
    const errEl = document.querySelector('#txd-date-err') as HTMLElement;
    expect(errEl.textContent).not.toBe('');
    // cancel to clean up
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await p;
  });

  it('validates required name field', async () => {
    const p = transactionDialog();
    setField('txd-date', '2024-06-01');
    setField('txd-name', '');
    let settled = false;
    void p.then(() => {
      settled = true;
    });
    getSubmit()!.click();
    await Promise.resolve();
    expect(settled).toBe(false);
    const errEl = document.querySelector('#txd-name-err') as HTMLElement;
    expect(errEl.textContent).not.toBe('');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await p;
  });

  it('blocks submit and shows ISIN format error when ISIN is invalid', async () => {
    const p = transactionDialog();
    fillRequired();
    setField('txd-isin', 'IE00B4L5Y98A');
    let settled = false;
    void p.then(() => {
      settled = true;
    });
    getSubmit()!.click();
    await Promise.resolve();
    expect(settled).toBe(false);
    const errEl = document.querySelector('#txd-isin-err') as HTMLElement;
    expect(errEl.textContent).toContain('Use 12-character ISIN format');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await p;
  });

  it('submits with valid fields and resolves a Transaction', async () => {
    const p = transactionDialog();
    fillRequired();
    setField('txd-amount', '100.50');
    getSubmit()!.click();
    const tx = await p;
    expect(tx).not.toBeNull();
    expect(tx!.date).toBe('2024-06-01');
    expect(tx!.name).toBe('Test Fund');
    expect(tx!.amount).toBeCloseTo(100.5);
    expect(tx!.source).toBe('manual');
  });

  it('canonicalizes TAX transactions so tax falls back to amount when tax is empty', async () => {
    const p = transactionDialog();
    setField('txd-date', '2024-06-01');
    setField('txd-name', 'Tax refund');
    setField('txd-type', 'TAX');
    (document.querySelector('#txd-type') as HTMLSelectElement).dispatchEvent(new Event('change'));
    setField('txd-amount', '3.44');
    setField('txd-tax', '');
    getSubmit()!.click();
    const tx = await p;
    expect(tx).not.toBeNull();
    expect(tx!.type).toBe('TAX');
    expect(tx!.tax).toBeCloseTo(3.44);
    expect(tx!.amount).toBeCloseTo(3.44);
  });

  it('shows the tax field for INTEREST transactions and preserves its value', async () => {
    const p = transactionDialog();
    const typeEl = document.querySelector('#txd-type') as HTMLSelectElement;
    typeEl.value = 'INTEREST';
    typeEl.dispatchEvent(new Event('change'));
    fillRequired();
    setField('txd-amount', '3.75');
    setField('txd-tax', '-0.50');
    const taxField = document.querySelector('#txd-field-tax') as HTMLElement;
    expect(taxField.style.display).not.toBe('none');
    getSubmit()!.click();
    const tx = await p;
    expect(tx).not.toBeNull();
    expect(tx!.type).toBe('INTEREST');
    expect(tx!.amount).toBeCloseTo(3.75);
    expect(tx!.tax).toBeCloseTo(-0.5);
  });

  it('title shows "Edit transaction" when editing an existing tx', () => {
    transactionDialog({
      existing: {
        id: 'x1',
        rowId: 5n,
        date: '2024-01-15',
        source: 'manual',
        category: '',
        type: 'BUY',
        name: 'Old Name',
        isin: 'IE001',
        shares: 2,
        price: 100,
        amount: 200,
        fee: 1,
        tax: 0,
        currency: 'EUR',
        fxRate: 1,
      },
    });
    const title = document.querySelector('.dialog-title') as HTMLElement;
    expect(title.textContent).toContain('Edit');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });

  it('prefills fields from existing transaction', () => {
    transactionDialog({
      existing: {
        id: 'x2',
        rowId: 7n,
        date: '2024-03-10',
        source: 'manual',
        category: '',
        type: 'SELL',
        name: 'Prefilled Fund',
        isin: 'IE999',
        shares: 5,
        price: 200,
        amount: 1000,
        fee: 2.5,
        tax: 1.2,
        currency: 'USD',
        fxRate: 1.1,
        note: 'test note',
      },
    });
    expect((document.querySelector('#txd-date') as HTMLInputElement).value).toBe('2024-03-10');
    expect((document.querySelector('#txd-name') as HTMLInputElement).value).toBe('Prefilled Fund');
    expect((document.querySelector('#txd-isin') as HTMLInputElement).value).toBe('IE999');
    expect((document.querySelector('#txd-amount') as HTMLInputElement).value).toBe('1000');
    expect((document.querySelector('#txd-note') as HTMLInputElement).value).toBe('test note');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });

  it('calling a second time resolves first call null', async () => {
    const p1 = transactionDialog();
    const p2 = transactionDialog();
    expect(await p1).toBeNull();
    expect(document.querySelectorAll('.tx-dialog-overlay').length).toBe(1);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(await p2).toBeNull();
  });

  it('traps Tab inside the dialog', () => {
    transactionDialog();
    const ov = getOverlay()!;
    const focusables = Array.from(
      ov.querySelectorAll('input:not([disabled]), select:not([disabled]), button:not([disabled])'),
    ) as HTMLElement[];
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    last.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.activeElement).toBe(first);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });

  it('title text is HTML-escaped', () => {
    transactionDialog({ existing: undefined });
    const title = document.querySelector('.dialog-title') as HTMLElement;
    expect(title.innerHTML).not.toContain('<script>');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });

  it('populates ISIN and name autocomplete lists from suggestions', () => {
    transactionDialog({ suggestions });
    const isinOpts = Array.from(document.querySelectorAll('#txd-isin-list option')).map(
      (o) => (o as HTMLOptionElement).value,
    );
    const nameOpts = Array.from(document.querySelectorAll('#txd-name-list option')).map(
      (o) => (o as HTMLOptionElement).value,
    );
    expect(isinOpts).toEqual(['IE00AAA', 'IE00BBB']);
    expect(nameOpts).toEqual(['Alpha Fund', 'Beta Fund']);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });

  it('syncs ISIN and name inputs from autocomplete selection', () => {
    transactionDialog({ suggestions });
    const nameInput = document.querySelector('#txd-name') as HTMLInputElement;
    nameInput.value = 'Beta Fund';
    nameInput.dispatchEvent(new Event('change'));
    expect((document.querySelector('#txd-isin') as HTMLInputElement).value).toBe('IE00BBB');
    expect((document.querySelector('#txd-name') as HTMLInputElement).value).toBe('Beta Fund');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });

  it('renders the FX rate hint span in the dialog', () => {
    transactionDialog();
    const hintEl = document.querySelector('#txd-fxrate-hint') as HTMLElement | null;
    expect(hintEl).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });

  it('populates the FX rate field and shows the hint when resolveRate returns a record', async () => {
    const { resolveRate } = await import('../fx');
    const mockRecord = { base: 'USD', target: 'EUR', date: '2024-03-15', rate: 0.9234, effectiveDate: '2024-03-15', fetchedAt: '' };
    vi.mocked(resolveRate).mockResolvedValueOnce(mockRecord);

    transactionDialog();
    const typeEl = document.querySelector('#txd-type') as HTMLSelectElement;
    typeEl.value = 'BUY';
    typeEl.dispatchEvent(new Event('change'));

    setField('txd-currency', 'USD');
    setField('txd-date', '2024-03-15');
    (document.querySelector('#txd-currency') as HTMLInputElement).dispatchEvent(new Event('input'));

    await vi.runAllTimersAsync?.().catch(() => undefined);
    // Flush microtask queue
    await new Promise((r) => setTimeout(r, 0));

    const rateInput = document.querySelector('#txd-fxrate') as HTMLInputElement;
    const hintEl = document.querySelector('#txd-fxrate-hint') as HTMLElement;
    expect(rateInput.value).toBe('0.9234');
    expect(hintEl.style.display).not.toBe('none');
    expect(hintEl.textContent).toContain('0.9234');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });

  it('does not overwrite a manually entered FX rate when resolveRate returns a record', async () => {
    const { resolveRate } = await import('../fx');
    const mockRecord = { base: 'USD', target: 'EUR', date: '2024-03-15', rate: 0.9234, effectiveDate: '2024-03-15', fetchedAt: '' };
    vi.mocked(resolveRate).mockResolvedValueOnce(mockRecord);

    transactionDialog();
    setField('txd-fxrate', '1.05');
    setField('txd-currency', 'USD');
    setField('txd-date', '2024-03-15');
    (document.querySelector('#txd-currency') as HTMLInputElement).dispatchEvent(new Event('input'));

    await new Promise((r) => setTimeout(r, 0));

    const rateInput = document.querySelector('#txd-fxrate') as HTMLInputElement;
    // User's value must be preserved
    expect(rateInput.value).toBe('1.05');
    const hintEl = document.querySelector('#txd-fxrate-hint') as HTMLElement;
    expect(hintEl.textContent).toContain('0.9234');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });

  it('hides the FX hint when resolveRate returns null (offline / EUR)', async () => {
    const { resolveRate } = await import('../fx');
    vi.mocked(resolveRate).mockResolvedValueOnce(null);

    transactionDialog();
    setField('txd-currency', 'GBP');
    setField('txd-date', '2024-03-15');
    (document.querySelector('#txd-currency') as HTMLInputElement).dispatchEvent(new Event('input'));

    await new Promise((r) => setTimeout(r, 0));

    const hintEl = document.querySelector('#txd-fxrate-hint') as HTMLElement;
    expect(hintEl.style.display).toBe('none');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });
});

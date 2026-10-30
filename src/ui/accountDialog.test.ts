/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { accountDialog } from './accountDialog';
import type { Account } from '../types';

function getOverlay() {
  return document.querySelector('.acct-dialog-overlay') as HTMLElement | null;
}

function setField(id: string, value: string) {
  const el = document.getElementById(id) as HTMLInputElement | null;
  if (el) el.value = value;
}

function getSubmit() {
  return document.querySelector('.js-acctd-submit') as HTMLButtonElement | null;
}

const EXISTING_ACCOUNT: Account = {
  id: 'main_account',
  label: 'Main Account',
  moneyType: 'investment',
  institution: 'Broker',
  color: '#123456',
  annualReturnPct: 7,
  group: 'Retirement',
};

describe('accountDialog', () => {
  it('keeps lifecycle actions collapsed and hands off without saving metadata', async () => {
    const onLifecycle = vi.fn();
    const pending = accountDialog({
      existing: { ...EXISTING_ACCOUNT, closedPeriods: [{ closedFromMonth: '2020-01' }] },
      lifecycleEnabled: true,
      onLifecycle,
    });
    expect(document.querySelector<HTMLDetailsElement>('#acctd-lifecycle')!.open).toBe(false);
    expect(document.querySelector('#acctd-lifecycle')!.textContent).toContain('2020-01');
    document.querySelector<HTMLButtonElement>('[data-mode="reopen"]')!.click();
    expect(await pending).toBeNull();
    expect(getOverlay()).toBeNull();
    expect(onLifecycle).toHaveBeenCalledWith('reopen');
  });
  it('requires updating metadata drafts before changing lifecycle', () => {
    const onLifecycle = vi.fn();
    accountDialog({ existing: EXISTING_ACCOUNT, lifecycleEnabled: true, onLifecycle });
    const input = document.getElementById('acctd-label') as HTMLInputElement;
    input.value = 'Changed';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const action = document.querySelector<HTMLButtonElement>('[data-mode="close"]')!;
    expect(action.disabled).toBe(true);
    action.click();
    expect(onLifecycle).not.toHaveBeenCalled();
    expect(document.querySelector('#acctd-lifecycle-note')!.textContent).toContain(
      'Update this draft',
    );
  });
  it('gates lifecycle changes until migration and omits them for new accounts', () => {
    accountDialog({ existing: EXISTING_ACCOUNT, lifecycleEnabled: false, onLifecycle: vi.fn() });
    expect(document.querySelector<HTMLButtonElement>('[data-mode="close"]')!.disabled).toBe(true);
    accountDialog({ onLifecycle: vi.fn() });
    expect(document.querySelector('#acctd-lifecycle')).toBeNull();
  });
  it('preserves lifecycle and legacy identity when editing metadata', async () => {
    const existing = {
      ...EXISTING_ACCOUNT,
      key: 'legacy',
      closedPeriods: [{ closedFromMonth: '2025-01', reopenedFromMonth: '2025-06' }],
    };
    const pending = accountDialog({ existing });
    expect(document.getElementById('acctd-history-warning')?.textContent).toContain(
      'global account metadata',
    );
    setField('acctd-label', 'Updated name');
    getSubmit()!.click();
    const result = await pending;
    expect(result?.key).toBe('legacy');
    expect(result?.closedPeriods).toEqual(existing.closedPeriods);
    expect(result?.closedPeriods).not.toBe(existing.closedPeriods);
  });
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    getOverlay()?.remove();
  });

  const pickFirst = (input: HTMLInputElement, value?: string) => {
    input.closest('.combo')!.querySelector<HTMLButtonElement>('.combo-toggle')!.click();
    const options = [
      ...document.querySelectorAll<HTMLElement>(
        `#${input.getAttribute('aria-controls')} [role="option"]`,
      ),
    ];
    const target = value
      ? options.find((o) => o.querySelector('.combo-value')?.textContent === value)!
      : options[0];
    target.click();
    return options.map((o) => o.querySelector('.combo-value')?.textContent);
  };
  const field = (id: string) => document.getElementById(id) as HTMLInputElement;
  const typeInto = (id: string, value: string) => {
    const el = field(id);
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };

  it('offers stored institutions on their own, without filling other fields', () => {
    accountDialog({ institutionSuggestions: ['Broker', 'Savings Bank'] });
    const inst = field('acctd-institution');
    expect(inst.getAttribute('role')).toBe('combobox');
    expect(pickFirst(inst)).toEqual(['Broker', 'Savings Bank']);
    expect(inst.value).toBe('Broker');
    expect(field('acctd-country').value).toBe('');
    expect(field('acctd-currency').value).toBe('EUR');
  });

  it('lists your countries first, then built-in countries with their currency', () => {
    accountDialog({ countrySuggestions: ['Deutschland'], countryLinks: { Deutschland: 'USD' } });
    const values = pickFirst(field('acctd-country'));
    expect(values[0]).toBe('Deutschland');
    expect(values).toContain('Switzerland');
    // Germany is already covered by the stored German name.
    expect(values).not.toContain('Germany');
    expect(field('acctd-currency').value).toBe('USD');
  });

  it('a country typed in another language sets its currency, and unknown text restores it', () => {
    accountDialog({});
    typeInto('acctd-country', 'Suiza');
    expect(field('acctd-currency').value).toBe('CHF');
    typeInto('acctd-country', 'Polen');
    expect(field('acctd-currency').value).toBe('PLN');
    typeInto('acctd-country', 'Atlantis');
    expect(field('acctd-currency').value).toBe('EUR');
  });

  it("prefers the user's own currency for a country over the built-in default", () => {
    accountDialog({ countrySuggestions: ['Spain'], countryLinks: { Spain: 'USD' } });
    pickFirst(field('acctd-country'), 'Spain');
    expect(field('acctd-currency').value).toBe('USD');
    typeInto('acctd-country', 'united kingdom');
    expect(field('acctd-currency').value).toBe('GBP');
  });

  it('a typed currency is kept, and changing the currency never changes the country', () => {
    accountDialog({});
    typeInto('acctd-currency', 'USD');
    typeInto('acctd-country', 'Japan');
    expect(field('acctd-currency').value).toBe('USD');
    expect(field('acctd-country').value).toBe('Japan');
  });

  it('a currency picked from the list is kept when the country changes', () => {
    accountDialog({ currencySuggestions: ['EUR', 'USD'] });
    pickFirst(field('acctd-currency'), 'USD');
    typeInto('acctd-country', 'Japan');
    expect(field('acctd-currency').value).toBe('USD');
  });

  it('changing an existing account country updates its currency, and reverting restores it', () => {
    accountDialog({ existing: { ...EXISTING_ACCOUNT, country: 'Germany', currency: 'USD' } });
    expect(field('acctd-currency').value).toBe('USD');
    typeInto('acctd-country', 'Switzerland');
    expect(field('acctd-currency').value).toBe('CHF');
    typeInto('acctd-country', 'Germany');
    expect(field('acctd-currency').value).toBe('USD');
  });
  it('rejects duplicate account names after trimming and lowercasing', async () => {
    const p = accountDialog({ existingLabels: ['Main Account'] });
    setField('acctd-label', '  main account  ');

    let settled = false;
    void p.then(() => {
      settled = true;
    });

    getSubmit()!.click();
    await Promise.resolve();

    expect(settled).toBe(false);
    expect((document.getElementById('acctd-label-err') as HTMLElement).textContent).toContain(
      'already defined',
    );

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await p;
  });

  it('accepts the current account name unchanged while editing', async () => {
    const p = accountDialog({
      existing: EXISTING_ACCOUNT,
      existingLabels: ['Other Account'],
    });

    getSubmit()!.click();
    const draft = await p;

    expect(draft?.label).toBe('Main Account');
  });

  it('returns the optional country field when provided', async () => {
    const p = accountDialog();
    setField('acctd-label', 'Country account');
    setField('acctd-country', 'Spain');
    getSubmit()!.click();
    const draft = await p;
    expect(draft?.country).toBe('Spain');
  });

  it('returns the optional group field when provided', async () => {
    const p = accountDialog();
    setField('acctd-label', 'Grouped account');
    setField('acctd-group', 'Retirement');
    getSubmit()!.click();
    const draft = await p;
    expect(draft?.group).toBe('Retirement');
  });

  it('renders color picker in the final dialog row', () => {
    accountDialog();
    const rows = Array.from(
      document.querySelectorAll('.acct-dialog-card .dialog-fields .dialog-row'),
    );
    const lastRow = rows[rows.length - 1] as HTMLElement | undefined;
    expect(lastRow?.querySelector('#acctd-color')).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });
  it('groups forecast and chart fields under Advanced options, closed for plain accounts', () => {
    void accountDialog({
      existing: { id: 'cash', label: 'Cash', moneyType: 'cash', institution: '' } as Account,
    });
    const details = document.querySelector(
      '.acct-dialog-overlay details.dialog-optional',
    ) as HTMLDetailsElement;
    expect(details.querySelector('summary')?.textContent).toBe('Advanced options');
    expect(details.open).toBe(false);
    for (const id of ['acctd-return', 'acctd-contrib', 'acctd-interval', 'acctd-group']) {
      expect(details.querySelector(`#${id}`)).not.toBeNull();
    }
    expect(details.querySelector('#acctd-country')).toBeNull();
    expect(details.querySelector('#acctd-primary')).toBeNull();
    expect(details.querySelector('#acctd-locked')).toBeNull();
    getOverlay()?.remove();
    void accountDialog({ existing: EXISTING_ACCOUNT });
    expect(
      document.querySelector<HTMLDetailsElement>('.acct-dialog-overlay details.dialog-optional')
        ?.open,
    ).toBe(true);
  });

  it('opens Advanced options and focuses an invalid advanced field on submit', async () => {
    void accountDialog();
    setField('acctd-label', 'Valid');
    setField('acctd-return', '-500');
    getSubmit()!.click();
    await Promise.resolve();
    const details = document.querySelector('details.dialog-optional') as HTMLDetailsElement;
    expect(details.open).toBe(true);
    expect(document.activeElement?.id).toBe('acctd-return');
  });
});

/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    getOverlay()?.remove();
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
    for (const id of ['acctd-return', 'acctd-contrib', 'acctd-interval', 'acctd-country']) {
      expect(details.querySelector(`#${id}`)).not.toBeNull();
    }
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

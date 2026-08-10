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
  annualTaxDragPct: 12,
  drawdownStartMonth: '2040-01',
  annualWithdrawal: 12000,
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

  it('renders color picker in the final dialog row', () => {
    accountDialog();
    const rows = Array.from(
      document.querySelectorAll('.acct-dialog-card .dialog-fields .dialog-row'),
    );
    const lastRow = rows[rows.length - 1] as HTMLElement | undefined;
    expect(lastRow?.querySelector('#acctd-color')).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });

  it('returns drawdown and tax drag fields in submitted draft', async () => {
    const p = accountDialog({ existing: EXISTING_ACCOUNT });
    setField('acctd-tax-drag', '15');
    setField('acctd-drawdown-start', '2038-06');
    setField('acctd-withdrawal', '18000');
    getSubmit()!.click();
    const draft = await p;
    expect(draft?.annualTaxDragPct).toBe(15);
    expect(draft?.drawdownStartMonth).toBe('2038-06');
    expect(draft?.annualWithdrawal).toBe(18000);
  });
});

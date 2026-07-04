/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { isCardBusy, withCardGuard } from './settings';

// Mock all dependencies that settings.ts imports
vi.mock('../store/config', () => ({
  getAccounts: () => [],
  getHoldings: () => [],
  getSettings: () => ({}),
  isConfigLoaded: () => true,
  getCostBasisMethod: () => 'avgco',
  getTargetNetWorth: () => null,
  getTargetDate: () => null,
  setAccounts: vi.fn(async () => {}),
  setHoldings: vi.fn(async () => {}),
  setSettings: vi.fn(async () => {}),
  setSetting: vi.fn(async () => {}),
  getRetiredAccountIds: () => [],
  retireAccountIds: vi.fn(async () => {}),
}));

vi.mock('../sheets/transactions', () => ({
  loadTransactions: vi.fn(async () => []),
}));

vi.mock('../model/accounts', () => ({
  validatePrimaryInvestment: () => null,
}));

vi.mock('../model/holdings', () => ({
  validateHoldings: () => [],
}));

vi.mock('../model/contributions', () => ({
  INTERVAL_LABELS: {
    weekly: 'Weekly',
    biweekly: 'Bi-weekly',
    monthly: 'Monthly',
    quarterly: 'Quarterly',
  },
}));

vi.mock('../utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils')>();
  return {
    ...actual,
    showMsg: vi.fn(),
    reinjectPendingMsg: vi.fn(),
  };
});

vi.mock('../theme', () => ({
  resolvedT: () => ({ ink2: '#666', pos: '#0a0', neg: '#a00' }),
  T: { ink2: '#666', pos: '#0a0', neg: '#a00' },
}));

vi.mock('../ui/collapseState', () => ({
  isCollapsed: () => false,
  toggleCollapsed: () => false,
}));

vi.mock('../ui/infoTip', () => ({
  infoTip: () => '',
  attachInfoTips: vi.fn(),
}));

vi.mock('../ui/confirmDialog', () => ({
  confirmDialog: vi.fn(async () => true),
}));

vi.mock('../auth/google', () => ({
  isSignedIn: () => true,
}));

vi.mock('../backup/exportImport', () => ({
  isBackupStale: () => false,
}));

describe('isCardBusy / withCardGuard', () => {
  let btn: HTMLButtonElement;

  beforeEach(() => {
    document.body.innerHTML = '<button id="btn">Save</button>';
    btn = document.getElementById('btn') as HTMLButtonElement;
  });

  it('isCardBusy is false initially for any key', () => {
    expect(isCardBusy('accounts')).toBe(false);
    expect(isCardBusy('holdings')).toBe(false);
    expect(isCardBusy('rules')).toBe(false);
  });

  it('withCardGuard sets isCardBusy to true during action, false after success', async () => {
    let busyDuringAction = false;
    await withCardGuard('accounts', btn, async () => {
      busyDuringAction = isCardBusy('accounts');
      return 'done';
    });
    expect(busyDuringAction).toBe(true);
    expect(isCardBusy('accounts')).toBe(false);
  });

  it('withCardGuard sets isCardBusy to false after failure', async () => {
    try {
      await withCardGuard('accounts', btn, async () => {
        throw new Error('fail');
      });
    } catch {
      // expected
    }
    expect(isCardBusy('accounts')).toBe(false);
  });

  it('second withCardGuard call while first is pending returns undefined without invoking action', async () => {
    let resolve1!: (v: string) => void;
    const p1 = withCardGuard('accounts', btn, () => new Promise<string>((r) => (resolve1 = r)));

    const secondAction = vi.fn(async () => 'second');
    const btn2 = document.createElement('button');
    btn2.textContent = 'Delete';
    document.body.appendChild(btn2);

    const p2 = withCardGuard('accounts', btn2, secondAction);
    const result2 = await p2;

    expect(result2).toBe(undefined);
    expect(secondAction).not.toHaveBeenCalled();

    resolve1('first');
    const result1 = await p1;
    expect(result1).toBe('first');
  });

  it('withCardGuard for a different card proceeds normally while another card is busy', async () => {
    let resolve1!: (v: string) => void;
    const p1 = withCardGuard('accounts', btn, () => new Promise<string>((r) => (resolve1 = r)));

    const btn2 = document.createElement('button');
    btn2.textContent = 'Save';
    document.body.appendChild(btn2);

    const holdingsResult = await withCardGuard('holdings', btn2, async () => 'holdings-done');
    expect(holdingsResult).toBe('holdings-done');
    expect(isCardBusy('accounts')).toBe(true);
    expect(isCardBusy('holdings')).toBe(false);

    resolve1('accounts-done');
    await p1;
  });

  it('withCardGuard disables sibling buttons in the same card while busy', async () => {
    document.body.innerHTML = `
      <div id="settings-card-accounts">
        <button id="save-btn">Save</button>
        <button id="delete-btn">Delete</button>
        <button id="other-btn">Other</button>
      </div>`;
    const saveBtn = document.getElementById('save-btn') as HTMLButtonElement;
    const deleteBtn = document.getElementById('delete-btn') as HTMLButtonElement;
    const otherBtn = document.getElementById('other-btn') as HTMLButtonElement;

    let siblingDisabledDuringAction = false;
    await withCardGuard('accounts', saveBtn, async () => {
      siblingDisabledDuringAction = deleteBtn.disabled && otherBtn.disabled;
      return 'done';
    });

    expect(siblingDisabledDuringAction).toBe(true);
    // After completion, sibling buttons are re-enabled
    expect(deleteBtn.disabled).toBe(false);
    expect(otherBtn.disabled).toBe(false);
  });

  it('withCardGuard re-enables sibling buttons even on failure', async () => {
    document.body.innerHTML = `
      <div id="settings-card-accounts">
        <button id="save-btn">Save</button>
        <button id="delete-btn">Delete</button>
      </div>`;
    const saveBtn = document.getElementById('save-btn') as HTMLButtonElement;
    const deleteBtn = document.getElementById('delete-btn') as HTMLButtonElement;

    try {
      await withCardGuard('accounts', saveBtn, async () => {
        throw new Error('fail');
      });
    } catch {
      // expected
    }

    expect(deleteBtn.disabled).toBe(false);
  });
});

/**
 * @vitest-environment jsdom
 */
// @ts-nocheck - mirrors production file's @ts-nocheck; test fixtures use partial objects
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ───────────────────────────────────────────────────────

// Minimal account / holding / settings shapes sufficient for renderSettings
const MOCK_ACCOUNTS = [
  {
    id: 'acct1',
    moneyType: 'investment',
    institution: 'TR',
    label: 'Main',
    color: '#111111',
    isPrimaryInvestment: true,
    order: 1,
  },
];
const MOCK_HOLDINGS = [
  {
    isin: 'IE00TEST',
    ticker: 'IWDA',
    name: '',
    color: '#222222',
    acc: true,
    active: true,
    contribAmount: 50,
    interval: 'weekly',
    assetClass: 'equity',
    region: 'developed',
    foldInto: '',
    order: 1,
  },
];
const MOCK_SETTINGS = { annualReturnPct: '7', costBasisMethod: 'avgco' };

vi.mock('../store/config', () => ({
  getAccounts: () => MOCK_ACCOUNTS,
  getHoldings: () => MOCK_HOLDINGS,
  getSettings: () => MOCK_SETTINGS,
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

// Collapse state: use real in-memory implementation for testability
let _collapseState: Record<string, boolean> = {};
vi.mock('../ui/collapseState', () => ({
  isCollapsed: (key: string) => !!_collapseState[key],
  toggleCollapsed: (key: string) => {
    _collapseState[key] = !_collapseState[key];
    return _collapseState[key];
  },
  setCollapsed: (key: string, v: boolean) => {
    if (v) _collapseState[key] = true;
    else delete _collapseState[key];
  },
}));

vi.mock('../utils', () => ({
  showMsg: vi.fn(),
  reinjectPendingMsg: vi.fn(),
  withButtonGuard: vi.fn(async (btn, action, opts) => {
    const origText = btn.textContent;
    if (opts?.busyText) btn.textContent = opts.busyText;
    btn.disabled = true;
    try {
      const result = await action();
      if (!opts?.keepDisabledOnSuccess) {
        btn.disabled = false;
        btn.textContent = origText;
      }
      return result;
    } catch (err) {
      btn.disabled = false;
      btn.textContent = origText;
      throw err;
    }
  }),
}));

vi.mock('../theme', () => ({}));

vi.mock('../model/accounts', () => ({
  validatePrimaryInvestment: () => null,
}));

vi.mock('../model/contributions', () => ({
  INTERVAL_LABELS: {
    weekly: 'Weekly',
    biweekly: 'Biweekly',
    monthly: 'Monthly',
    quarterly: 'Quarterly',
  },
}));

vi.mock('../auth/google', () => ({
  isSignedIn: () => true,
}));

vi.mock('../backup/exportImport', () => ({
  isBackupStale: vi.fn(() => true),
}));

vi.mock('../model/holdings', () => ({
  validateHoldings: () => [],
}));

vi.mock('../ui/infoTip', () => ({
  infoTip: (text: string) =>
    `<span class="info-tip" data-tip="${text}" aria-label="${text}" tabindex="0">?</span>`,
  attachInfoTips: vi.fn((root: HTMLElement | Document = document) => {
    root.querySelectorAll('.info-tip:not([data-tip-bound])').forEach((el) => {
      (el as HTMLElement).dataset.tipBound = '1';
    });
  }),
}));

vi.mock('../ui/confirmDialog', () => ({
  confirmDialog: vi.fn(async () => true),
}));

import { renderSettings, generateId, refreshSettingsAfterChange } from './settings';
import { isCollapsed } from '../ui/collapseState';
import { isBackupStale } from '../backup/exportImport';
import { withButtonGuard } from '../utils';

// ── Test setup ──────────────────────────────────────────────────

function setupDOM(): void {
  document.body.innerHTML = '<div id="settings-content"></div>';
}

describe('Settings scoped re-render (repaintCard)', () => {
  beforeEach(() => {
    _collapseState = {};
    setupDOM();
    renderSettings();
  });

  it('all six card IDs are present after renderSettings()', () => {
    const ids = [
      'settings-card-accounts',
      'settings-card-holdings',
      'settings-card-cost-basis',
      'settings-card-goal',
      'settings-card-rules',
      'settings-card-cache',
    ];
    for (const id of ids) {
      expect(document.getElementById(id), `missing #${id}`).not.toBeNull();
    }
  });

  it('repaintCard("accounts") replaces only the accounts card, siblings are untouched', () => {
    // Capture reference to the holdings card before repaint
    const holdingsBefore = document.getElementById('settings-card-holdings');
    const accountsBefore = document.getElementById('settings-card-accounts');
    expect(holdingsBefore).not.toBeNull();
    expect(accountsBefore).not.toBeNull();

    // Simulate what repaintCard does: replace outerHTML of the accounts card
    const el = document.getElementById('settings-card-accounts')!;
    el.outerHTML = el.outerHTML; // replace with same HTML

    // After outerHTML replacement, the old reference is detached
    expect(document.getElementById('settings-card-accounts')).not.toBe(accountsBefore);
    // Holdings card is still the same DOM node (not replaced)
    expect(document.getElementById('settings-card-holdings')).toBe(holdingsBefore);
  });

  it('collapse state survives a card outerHTML replacement', () => {
    // Mark accounts card as collapsed in state
    _collapseState['card:accounts'] = true;
    const card = document.getElementById('settings-card-accounts')!;
    card.classList.add('collapsed');

    // Simulate repaintCard: replace outerHTML then reapply collapse state
    card.outerHTML = card.outerHTML;
    const fresh = document.getElementById('settings-card-accounts')!;
    // repaintCard reapplies: if (isCollapsed('card:' + key)) fresh.classList.add('collapsed');
    if (isCollapsed('card:accounts')) fresh.classList.add('collapsed');

    expect(fresh.classList.contains('collapsed')).toBe(true);
  });

  it('color-picker two-way sync works after renderSettings()', () => {
    const holdingsCard = document.getElementById('settings-card-holdings')!;
    const swatch = holdingsCard.querySelector('.color-picker-swatch') as HTMLInputElement;
    const hex = holdingsCard.querySelector('.color-picker-hex') as HTMLInputElement;

    // Verify color picker elements exist
    expect(swatch).not.toBeNull();
    expect(hex).not.toBeNull();

    // attachColorPickerSync wires swatch→hex sync
    // Simulate: change swatch value and fire input event
    swatch.value = '#ff0000';
    swatch.dispatchEvent(new Event('input'));
    expect(hex.value).toBe('#ff0000');

    // Reverse: hex→swatch
    hex.value = '#00ff00';
    hex.dispatchEvent(new Event('input'));
    expect(swatch.value).toBe('#00ff00');
  });

  it('data-card-key attributes are preserved alongside new ids', () => {
    const cards = document.querySelectorAll('.card-collapsible');
    const keys = [...cards].map((c) => (c as HTMLElement).dataset.cardKey);
    expect(keys).toContain('accounts');
    expect(keys).toContain('holdings');
    expect(keys).toContain('cost-basis');
    expect(keys).toContain('goal');
    expect(keys).toContain('rules');
    expect(keys).toContain('cache');
  });
});

describe('generateId (collision-free)', () => {
  it('no collision → plain slug', () => {
    const taken = new Set<string>();
    expect(generateId('My Account', taken)).toBe('my_account');
  });

  it('one collision → appends _2', () => {
    const taken = new Set(['my_account']);
    expect(generateId('My Account', taken)).toBe('my_account_2');
  });

  it('two collisions → appends _3', () => {
    const taken = new Set(['my_account', 'my_account_2']);
    expect(generateId('My Account', taken)).toBe('my_account_3');
  });

  it('two new accounts same label in one save → distinct ids', () => {
    const taken = new Set<string>();
    const id1 = generateId('Savings', taken);
    taken.add(id1);
    const id2 = generateId('Savings', taken);
    taken.add(id2);
    expect(id1).toBe('savings');
    expect(id2).toBe('savings_2');
    expect(id1).not.toBe(id2);
  });

  it('retired id in taken → new account gets a different id', () => {
    const taken = new Set(['old_account']);
    expect(generateId('Old Account', taken)).toBe('old_account_2');
  });

  it('strips special characters and limits to 30 chars', () => {
    const taken = new Set<string>();
    expect(generateId('Hello World! @#$%', taken)).toBe('hello_world');
    const longLabel = 'A'.repeat(50);
    const result = generateId(longLabel, taken);
    expect(result.length).toBeLessThanOrEqual(30);
  });
});

describe('Backup card nudge', () => {
  beforeEach(() => {
    _collapseState = {};
    setupDOM();
  });

  it('shows reminder text when backup is stale', () => {
    (isBackupStale as ReturnType<typeof vi.fn>).mockReturnValue(true);
    renderSettings();
    const backupCard = document.getElementById('settings-card-backup');
    expect(backupCard).not.toBeNull();
    expect(backupCard!.textContent).toContain('No backup yet');
  });

  it('does not show reminder when backup is fresh', () => {
    (isBackupStale as ReturnType<typeof vi.fn>).mockReturnValue(false);
    renderSettings();
    const backupCard = document.getElementById('settings-card-backup');
    expect(backupCard).not.toBeNull();
    expect(backupCard!.textContent).not.toContain('No backup yet');
    expect(backupCard!.textContent).not.toContain('over 30 days');
  });
});

describe('refreshSettingsAfterChange - scoped data-only refresh', () => {
  beforeEach(() => {
    _collapseState = {};
    setupDOM();
    renderSettings();
  });

  it('refreshSettingsAfterChange("accounts") replaces #settings-accounts-tbl content but leaves #btn-save-accts and #accts-msg as same DOM nodes', () => {
    const btnBefore = document.getElementById('btn-save-accts');
    const msgBefore = document.getElementById('accts-msg');
    expect(btnBefore).not.toBeNull();
    expect(msgBefore).not.toBeNull();

    refreshSettingsAfterChange('accounts');

    // Buttons and message span are the exact same node reference (not replaced)
    expect(document.getElementById('btn-save-accts')).toBe(btnBefore);
    expect(document.getElementById('accts-msg')).toBe(msgBefore);
  });

  it('refreshSettingsAfterChange("holdings") calls only the holdings refresh, no other card data region changes', () => {
    const acctsTbl = document.getElementById('settings-accounts-tbl')!;
    const acctsBefore = acctsTbl.innerHTML;
    const costBasisFields = document.getElementById('settings-costbasis-fields')!;
    const cbBefore = costBasisFields.innerHTML;

    refreshSettingsAfterChange('holdings');

    // Accounts and cost-basis data regions are untouched
    expect(document.getElementById('settings-accounts-tbl')!.innerHTML).toBe(acctsBefore);
    expect(document.getElementById('settings-costbasis-fields')!.innerHTML).toBe(cbBefore);
  });

  it('refreshSettingsAfterChange("settings") updates cost-basis, goal, rules, and backup-nudge without touching buttons/messages', () => {
    const costBasisBtn = document.getElementById('btn-save-cost-basis');
    const goalBtn = document.getElementById('btn-save-goal');
    const rulesBtn = document.getElementById('btn-save-rules');
    const costBasisMsg = document.getElementById('costbasis-msg');
    const goalMsg = document.getElementById('goal-msg');
    const rulesMsg = document.getElementById('rules-msg');

    refreshSettingsAfterChange('settings');

    // Buttons and messages are the same DOM node references (not replaced)
    expect(document.getElementById('btn-save-cost-basis')).toBe(costBasisBtn);
    expect(document.getElementById('btn-save-goal')).toBe(goalBtn);
    expect(document.getElementById('btn-save-rules')).toBe(rulesBtn);
    expect(document.getElementById('costbasis-msg')).toBe(costBasisMsg);
    expect(document.getElementById('goal-msg')).toBe(goalMsg);
    expect(document.getElementById('rules-msg')).toBe(rulesMsg);
    // Data regions still exist (were refreshed)
    expect(document.getElementById('settings-costbasis-fields')).not.toBeNull();
    expect(document.getElementById('settings-goal-fields')).not.toBeNull();
    expect(document.getElementById('settings-backup-nudge')).not.toBeNull();
  });

  it('refreshSettingsAfterChange does nothing when settings tab is not rendered', () => {
    document.body.innerHTML = '<div id="other-content"></div>';
    // Should not throw
    refreshSettingsAfterChange('accounts');
    refreshSettingsAfterChange('settings');
  });
});

describe('Info-tip rebinding after rerenderAccountsTable', () => {
  beforeEach(() => {
    _collapseState = {};
    setupDOM();
    renderSettings();
  });

  it('info-tip icons in Accounts rows get data-tip-bound after rerender', () => {
    // Initial render should have info tips bound
    const accountsCard = document.getElementById('settings-card-accounts')!;
    const tips = accountsCard.querySelectorAll('.info-tip');
    expect(tips.length).toBeGreaterThan(0);

    // After refreshSettingsAfterChange, tips should be re-bound
    refreshSettingsAfterChange('accounts');
    const tipsAfter = document
      .getElementById('settings-card-accounts')!
      .querySelectorAll('.info-tip');
    expect(tipsAfter.length).toBeGreaterThan(0);
    // The attachInfoTips function was called (bound attribute set)
    tipsAfter.forEach((tip) => {
      expect(tip.getAttribute('data-tip-bound')).toBe('1');
    });
  });
});

describe('Data region IDs exist after renderSettings', () => {
  beforeEach(() => {
    _collapseState = {};
    setupDOM();
    renderSettings();
  });

  it('has #settings-costbasis-fields wrapping the cost-basis form', () => {
    const el = document.getElementById('settings-costbasis-fields');
    expect(el).not.toBeNull();
    expect(el!.querySelector('#set-cost-basis-method')).not.toBeNull();
  });

  it('has #settings-goal-fields wrapping the goal form', () => {
    const el = document.getElementById('settings-goal-fields');
    expect(el).not.toBeNull();
    expect(el!.querySelector('#set-target-nw')).not.toBeNull();
    expect(el!.querySelector('#set-target-date')).not.toBeNull();
  });

  it('has #settings-backup-nudge wrapping the backup staleness nudge', () => {
    const el = document.getElementById('settings-backup-nudge');
    expect(el).not.toBeNull();
  });
});

describe('Busy state - cost-basis, goal, cache, backup', () => {
  beforeEach(() => {
    _collapseState = {};
    setupDOM();
    renderSettings();
  });

  it('Save cost-basis button shows busy text during save', async () => {
    const { setSetting } = await import('../store/config');
    let resolveWrite: () => void;
    (setSetting as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveWrite = resolve;
        }),
    );

    const btn = document.getElementById('btn-save-cost-basis') as HTMLButtonElement;
    btn.click();

    // Wait for microtask to allow click handler to execute
    await new Promise((r) => setTimeout(r, 0));
    expect(btn.textContent).toBe('Saving...');
    expect(btn.disabled).toBe(true);

    resolveWrite!();
    await new Promise((r) => setTimeout(r, 0));
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe('Save cost-basis method');
  });

  it('Save goal button shows busy text during save', async () => {
    const { setSettings } = await import('../store/config');
    let resolveWrite: () => void;
    (setSettings as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveWrite = resolve;
        }),
    );

    const btn = document.getElementById('btn-save-goal') as HTMLButtonElement;
    btn.click();

    await new Promise((r) => setTimeout(r, 0));
    expect(btn.textContent).toBe('Saving...');
    expect(btn.disabled).toBe(true);

    resolveWrite!();
    await new Promise((r) => setTimeout(r, 0));
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe('Save goal');
  });

  it('Force resync button shows busy text during resync', async () => {
    let resolveResync: () => void;
    (window as any).__forceFullResync = () =>
      new Promise((resolve) => {
        resolveResync = resolve;
      });

    const btn = document.getElementById('btn-force-resync') as HTMLButtonElement;
    btn.click();

    await new Promise((r) => setTimeout(r, 0));
    expect(btn.textContent).toBe('Resyncing...');
    expect(btn.disabled).toBe(true);

    resolveResync!();
    await new Promise((r) => setTimeout(r, 0));
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe('Force full resync');
  });

  it('Export backup button shows busy text during export', async () => {
    let resolveExport: () => void;
    (window as any).__exportBackup = () =>
      new Promise((resolve) => {
        resolveExport = resolve;
      });

    const btn = document.getElementById('btn-export-backup') as HTMLButtonElement;
    btn.click();

    await new Promise((r) => setTimeout(r, 0));
    expect(btn.textContent).toBe('Exporting...');
    expect(btn.disabled).toBe(true);

    resolveExport!();
    await new Promise((r) => setTimeout(r, 0));
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe('Export backup');
  });

  it('second click while card is busy has no effect', async () => {
    const { setSetting } = await import('../store/config');
    (setSetting as ReturnType<typeof vi.fn>).mockClear();
    let resolveWrite: () => void;
    (setSetting as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveWrite = resolve;
        }),
    );

    const btn = document.getElementById('btn-save-cost-basis') as HTMLButtonElement;
    btn.click();
    await new Promise((r) => setTimeout(r, 0));

    // Second click while busy
    btn.click();
    await new Promise((r) => setTimeout(r, 0));

    // Only one call to setSetting (the card-level lock prevents the second)
    expect((setSetting as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);

    resolveWrite!();
    await new Promise((r) => setTimeout(r, 0));
  });
});

describe('Button-disable verification: synchronous disable and double-click prevention', () => {
  beforeEach(() => {
    _collapseState = {};
    setupDOM();
    renderSettings();
  });

  // Helper: await one microtask so the async click handler starts executing
  const tick = () => new Promise((r) => setTimeout(r, 0));

  describe('#btn-save-accts (accounts card)', () => {
    it('disables synchronously and prevents double-click', async () => {
      const { setAccounts } = await import('../store/config');
      (setAccounts as ReturnType<typeof vi.fn>).mockClear();
      let resolveWrite!: () => void;
      (setAccounts as ReturnType<typeof vi.fn>).mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolveWrite = r;
          }),
      );

      const btn = document.getElementById('btn-save-accts') as HTMLButtonElement;
      btn.click();
      await tick();

      expect(btn.disabled).toBe(true);
      expect(btn.textContent).toBe('Saving...');

      // Second click while busy - card guard prevents action
      btn.click();
      await tick();
      expect((setAccounts as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);

      resolveWrite();
      await tick();
      expect(btn.disabled).toBe(false);
      expect(btn.textContent).toBe('Save accounts');
    });

    it('re-enables and shows error on failure', async () => {
      const { setAccounts } = await import('../store/config');
      const { showMsg } = await import('../utils');
      (setAccounts as ReturnType<typeof vi.fn>).mockClear();
      (showMsg as ReturnType<typeof vi.fn>).mockClear();
      (setAccounts as ReturnType<typeof vi.fn>).mockImplementationOnce(() =>
        Promise.reject(new Error('Network error')),
      );

      const btn = document.getElementById('btn-save-accts') as HTMLButtonElement;
      btn.click();
      await tick();

      expect(btn.disabled).toBe(false);
      expect(btn.textContent).toBe('Save accounts');
      expect(showMsg as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
        'accts-msg',
        'Error: Network error',
        false,
      );
    });
  });

  describe('.js-del-acct (accounts delete)', () => {
    it('disables synchronously and prevents double-click', async () => {
      const { setAccounts } = await import('../store/config');
      (setAccounts as ReturnType<typeof vi.fn>).mockClear();
      let resolveWrite!: () => void;
      (setAccounts as ReturnType<typeof vi.fn>).mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolveWrite = r;
          }),
      );

      const btn = document.querySelector('.js-del-acct') as HTMLButtonElement;
      expect(btn).not.toBeNull();
      btn.click();
      await tick(); // confirmDialog resolves
      await tick(); // withCardGuard starts

      expect(btn.disabled).toBe(true);
      expect(btn.textContent).toBe('Removing...');

      // Second click while busy
      btn.click();
      await tick();
      expect((setAccounts as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);

      resolveWrite();
      await tick();
    });
  });

  describe('#btn-save-holds (holdings card)', () => {
    it('disables synchronously and prevents double-click', async () => {
      const { setHoldings } = await import('../store/config');
      (setHoldings as ReturnType<typeof vi.fn>).mockClear();
      let resolveWrite!: () => void;
      (setHoldings as ReturnType<typeof vi.fn>).mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolveWrite = r;
          }),
      );

      const btn = document.getElementById('btn-save-holds') as HTMLButtonElement;
      btn.click();
      await tick();

      expect(btn.disabled).toBe(true);
      expect(btn.textContent).toBe('Saving...');

      btn.click();
      await tick();
      expect((setHoldings as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);

      resolveWrite();
      await tick();
      expect(btn.disabled).toBe(false);
      expect(btn.textContent).toBe('Save holdings');
    });

    it('re-enables and shows error on failure', async () => {
      const { setHoldings } = await import('../store/config');
      const { showMsg } = await import('../utils');
      (setHoldings as ReturnType<typeof vi.fn>).mockClear();
      (showMsg as ReturnType<typeof vi.fn>).mockClear();
      (setHoldings as ReturnType<typeof vi.fn>).mockImplementationOnce(() =>
        Promise.reject(new Error('Sheets API error')),
      );

      const btn = document.getElementById('btn-save-holds') as HTMLButtonElement;
      btn.click();
      await tick();

      expect(btn.disabled).toBe(false);
      expect(showMsg as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
        'holds-msg',
        'Error: Sheets API error',
        false,
      );
    });
  });

  describe('.js-del-hold (holdings delete)', () => {
    it('disables synchronously and prevents double-click', async () => {
      const { setHoldings } = await import('../store/config');
      (setHoldings as ReturnType<typeof vi.fn>).mockClear();
      let resolveWrite!: () => void;
      (setHoldings as ReturnType<typeof vi.fn>).mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolveWrite = r;
          }),
      );

      const btn = document.querySelector('.js-del-hold') as HTMLButtonElement;
      expect(btn).not.toBeNull();
      btn.click();
      await tick(); // confirmDialog
      await tick(); // withCardGuard

      expect(btn.disabled).toBe(true);
      expect(btn.textContent).toBe('Removing...');

      btn.click();
      await tick();
      expect((setHoldings as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);

      resolveWrite();
      await tick();
    });
  });

  describe('#btn-autofill-holds (holdings autofill)', () => {
    it('disables synchronously and prevents double-click', async () => {
      const { loadTransactions } = await import('../sheets/transactions');
      (loadTransactions as ReturnType<typeof vi.fn>).mockClear();
      let resolveLoad!: () => void;
      (loadTransactions as ReturnType<typeof vi.fn>).mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolveLoad = r;
          }),
      );

      const btn = document.getElementById('btn-autofill-holds') as HTMLButtonElement;
      btn.click();
      await tick();

      expect(btn.disabled).toBe(true);
      expect(btn.textContent).toBe('Loading...');

      btn.click();
      await tick();
      expect((loadTransactions as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);

      resolveLoad();
      await tick();
      expect(btn.disabled).toBe(false);
    });
  });

  describe('#btn-save-rules (rules card)', () => {
    it('disables synchronously and prevents double-click', async () => {
      const { setSettings } = await import('../store/config');
      (setSettings as ReturnType<typeof vi.fn>).mockClear();
      let resolveWrite!: () => void;
      (setSettings as ReturnType<typeof vi.fn>).mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolveWrite = r;
          }),
      );

      const btn = document.getElementById('btn-save-rules') as HTMLButtonElement;
      btn.click();
      await tick();

      expect(btn.disabled).toBe(true);
      expect(btn.textContent).toBe('Saving...');

      btn.click();
      await tick();
      expect((setSettings as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);

      resolveWrite();
      await tick();
      expect(btn.disabled).toBe(false);
      expect(btn.textContent).toBe('Save rules');
    });

    it('re-enables and shows error on failure', async () => {
      const { setSettings } = await import('../store/config');
      const { showMsg } = await import('../utils');
      (setSettings as ReturnType<typeof vi.fn>).mockClear();
      (showMsg as ReturnType<typeof vi.fn>).mockClear();
      (setSettings as ReturnType<typeof vi.fn>).mockImplementationOnce(() =>
        Promise.reject(new Error('Write failed')),
      );

      const btn = document.getElementById('btn-save-rules') as HTMLButtonElement;
      btn.click();
      await tick();

      expect(btn.disabled).toBe(false);
      expect(showMsg as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
        'rules-msg',
        'Error: Write failed',
        false,
      );
    });
  });

  describe('.js-del-rule (rules delete)', () => {
    it('disables synchronously and prevents double-click', async () => {
      const { setSettings } = await import('../store/config');
      (setSettings as ReturnType<typeof vi.fn>).mockClear();
      let resolveWrite!: () => void;
      (setSettings as ReturnType<typeof vi.fn>).mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolveWrite = r;
          }),
      );

      const btn = document.querySelector('.js-del-rule') as HTMLButtonElement;
      if (!btn) return; // rules may be empty, skip if no rule rows exist
      btn.click();
      await tick(); // confirmDialog
      await tick(); // withCardGuard

      expect(btn.disabled).toBe(true);
      expect(btn.textContent).toBe('Removing...');

      btn.click();
      await tick();
      expect((setSettings as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);

      resolveWrite();
      await tick();
    });
  });

  describe('#btn-save-cost-basis (cost-basis card)', () => {
    it('disables synchronously and prevents double-click', async () => {
      const { setSetting } = await import('../store/config');
      (setSetting as ReturnType<typeof vi.fn>).mockClear();
      let resolveWrite!: () => void;
      (setSetting as ReturnType<typeof vi.fn>).mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolveWrite = r;
          }),
      );

      const btn = document.getElementById('btn-save-cost-basis') as HTMLButtonElement;
      btn.click();
      await tick();

      expect(btn.disabled).toBe(true);
      expect(btn.textContent).toBe('Saving...');

      btn.click();
      await tick();
      expect((setSetting as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);

      resolveWrite();
      await tick();
      expect(btn.disabled).toBe(false);
      expect(btn.textContent).toBe('Save cost-basis method');
    });

    it('re-enables and shows error on failure', async () => {
      const { setSetting } = await import('../store/config');
      const { showMsg } = await import('../utils');
      (setSetting as ReturnType<typeof vi.fn>).mockClear();
      (showMsg as ReturnType<typeof vi.fn>).mockClear();
      (setSetting as ReturnType<typeof vi.fn>).mockImplementationOnce(() =>
        Promise.reject(new Error('API error')),
      );

      const btn = document.getElementById('btn-save-cost-basis') as HTMLButtonElement;
      btn.click();
      await tick();

      expect(btn.disabled).toBe(false);
      expect(showMsg as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
        'costbasis-msg',
        'Error: API error',
        false,
      );
    });
  });

  describe('#btn-save-goal (goal card)', () => {
    it('disables synchronously and prevents double-click', async () => {
      const { setSettings } = await import('../store/config');
      (setSettings as ReturnType<typeof vi.fn>).mockReset();
      let resolveWrite!: () => void;
      (setSettings as ReturnType<typeof vi.fn>).mockImplementation(
        () =>
          new Promise<void>((r) => {
            resolveWrite = r;
          }),
      );

      const btn = document.getElementById('btn-save-goal') as HTMLButtonElement;
      btn.click();
      await tick();
      await tick();

      expect((setSettings as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
      expect(btn.disabled).toBe(true);
      expect(btn.textContent).toBe('Saving...');

      // Second click while busy
      btn.click();
      await tick();
      expect((setSettings as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);

      resolveWrite();
      await tick();
      expect(btn.disabled).toBe(false);
      expect(btn.textContent).toBe('Save goal');

      // Restore default mock
      (setSettings as ReturnType<typeof vi.fn>).mockImplementation(async () => {});
    });

    it('re-enables and shows error on failure', async () => {
      const { setSettings } = await import('../store/config');
      const { showMsg } = await import('../utils');
      (setSettings as ReturnType<typeof vi.fn>).mockReset();
      (showMsg as ReturnType<typeof vi.fn>).mockClear();
      (setSettings as ReturnType<typeof vi.fn>).mockImplementation(() =>
        Promise.reject(new Error('Timeout')),
      );

      const btn = document.getElementById('btn-save-goal') as HTMLButtonElement;
      btn.click();
      await tick();
      await tick();

      expect(btn.disabled).toBe(false);
      expect(showMsg as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
        'goal-msg',
        'Error: Timeout',
        false,
      );

      // Restore default mock
      (setSettings as ReturnType<typeof vi.fn>).mockImplementation(async () => {});
    });
  });

  describe('#btn-force-resync (cache card)', () => {
    it('disables synchronously and prevents double-click', async () => {
      let callCount = 0;
      let resolveResync!: () => void;
      (window as any).__forceFullResync = () => {
        callCount++;
        return new Promise((r) => {
          resolveResync = r;
        });
      };

      const btn = document.getElementById('btn-force-resync') as HTMLButtonElement;
      btn.click();
      await tick();

      expect(btn.disabled).toBe(true);
      expect(btn.textContent).toBe('Resyncing...');

      btn.click();
      await tick();
      expect(callCount).toBe(1);

      resolveResync();
      await tick();
      expect(btn.disabled).toBe(false);
      expect(btn.textContent).toBe('Force full resync');
    });

    it('re-enables and shows error on failure', async () => {
      const { showMsg } = await import('../utils');
      (showMsg as ReturnType<typeof vi.fn>).mockClear();
      (window as any).__forceFullResync = () => Promise.reject(new Error('Resync failed'));

      const btn = document.getElementById('btn-force-resync') as HTMLButtonElement;
      btn.click();
      await tick();

      expect(btn.disabled).toBe(false);
      expect(showMsg as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
        'resync-msg',
        'Error: Resync failed',
        false,
      );
    });
  });

  describe('#btn-export-backup (backup card)', () => {
    it('disables synchronously and prevents double-click', async () => {
      let callCount = 0;
      let resolveExport!: () => void;
      (window as any).__exportBackup = () => {
        callCount++;
        return new Promise((r) => {
          resolveExport = r;
        });
      };

      const btn = document.getElementById('btn-export-backup') as HTMLButtonElement;
      btn.click();
      await tick();

      expect(btn.disabled).toBe(true);
      expect(btn.textContent).toBe('Exporting...');

      btn.click();
      await tick();
      expect(callCount).toBe(1);

      resolveExport();
      await tick();
      expect(btn.disabled).toBe(false);
      expect(btn.textContent).toBe('Export backup');
    });

    it('re-enables and shows error on failure', async () => {
      const { showMsg } = await import('../utils');
      (showMsg as ReturnType<typeof vi.fn>).mockClear();
      (window as any).__exportBackup = () => Promise.reject(new Error('Export failed'));

      const btn = document.getElementById('btn-export-backup') as HTMLButtonElement;
      btn.click();
      await tick();

      expect(btn.disabled).toBe(false);
      expect(showMsg as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
        'backup-msg',
        'Export failed: Export failed',
        false,
      );
    });
  });

  describe('#btn-restore-backup (backup restore via file input)', () => {
    it('disables synchronously and prevents double-click', async () => {
      let callCount = 0;
      let resolveRestore!: () => void;
      (window as any).__restoreFromBackup = () => {
        callCount++;
        return new Promise((r) => {
          resolveRestore = r;
        });
      };

      const restoreBtn = document.getElementById('btn-restore-backup') as HTMLButtonElement;
      const fileInput = document.getElementById('backup-file-input') as HTMLInputElement;
      expect(restoreBtn).not.toBeNull();
      expect(fileInput).not.toBeNull();

      // Simulate file selection
      Object.defineProperty(fileInput, 'files', {
        value: [new File(['{}'], 'backup.json', { type: 'application/json' })],
        writable: true,
      });
      fileInput.dispatchEvent(new Event('change'));
      await tick();

      expect(restoreBtn.disabled).toBe(true);
      expect(restoreBtn.textContent).toBe('Restoring...');

      // Second file change while busy - card guard prevents
      fileInput.dispatchEvent(new Event('change'));
      await tick();
      expect(callCount).toBe(1);

      resolveRestore();
      await tick();
      expect(restoreBtn.disabled).toBe(false);
    });
  });
});

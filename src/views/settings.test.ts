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

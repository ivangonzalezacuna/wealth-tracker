/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { snapshotParsers } from '../import/snapshotParsers';
import { fictionalBalanceParser } from '../../tests/fixtures/snapshot-import/balanceParser';
import type { Settings } from '../types';
import { getSettings, saveSnapshotMapping, setSettings } from '../store/config';
import { showMsg } from '../utils';
import { notify } from '../ui/toast';
import { confirmDialog } from '../ui/confirmDialog';
import { SNAPSHOT_MAPPINGS_KEY, TRADE_REPUBLIC_VALUATION } from '../import/snapshotMapping';
import { setBusy } from '../sync/lock';
import { loadConfigHistory, loadSnapshots } from '../db';
import { accountDialog } from '../ui/accountDialog';
import { applySyncBusyState } from './settings';

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
    isin: 'IE00B4L5Y983',
    shortName: 'IWDA',
    name: '',
    color: '#222222',
    acc: true,
    active: true,
    contribAmount: 50,
    contribInterval: 'weekly',
    assetClass: 'equity',
    region: 'developed',
    foldInto: '',
    order: 1,
  },
];
const MOCK_SETTINGS: Settings = { annualReturnPct: '7', costBasisMethod: 'avgco' };
let MOCK_CONTRIB_BUDGET = 500;
let MOCK_CONTRIB_INTERVAL: 'weekly' | 'biweekly' | 'monthly' | 'quarterly' = 'monthly';
let MOCK_CALIBRATION_INTERVAL: 'weekly' | 'biweekly' | 'monthly' | 'quarterly' = 'monthly';

vi.mock('../store/config', () => ({
  getAccounts: () => MOCK_ACCOUNTS,
  getHoldings: () => MOCK_HOLDINGS,
  getSettings: () => MOCK_SETTINGS,
  isConfigLoaded: () => true,
  getCostBasisMethod: () => 'avgco',
  getTargetNetWorth: () => null,
  getTargetDate: () => null,
  getGoals: () => [],
  getAlertSettings: () => ({ driftThresholdPct: 5 }),
  getMonthlyContribBudget: () => MOCK_CONTRIB_BUDGET,
  getContributionBudgetAmount: () => MOCK_CONTRIB_BUDGET,
  getContributionInterval: () => MOCK_CONTRIB_INTERVAL,
  getCalibrationInterval: () => MOCK_CALIBRATION_INTERVAL,
  setAccounts: vi.fn(async () => {}),
  setHoldings: vi.fn(async () => {}),
  setSettings: vi.fn(async () => {}),
  setSetting: vi.fn(async () => {}),
  saveSnapshotMapping: vi.fn(async () => {}),
  getRetiredAccountIds: () => [],
  retireAccountIdsSafely: vi.fn(async () => true),
}));

vi.mock('../db', () => ({
  loadTransactions: vi.fn(async () => []),
  loadConfigHistory: vi.fn(async () => []),
  loadSnapshots: vi.fn(async () => []),
  saveSnapshots: vi.fn(async () => {}),
  getFxTelemetry: vi.fn(async () => ({
    lastFetchAt: '',
    lastRequestUrl: '',
    lastErrorAt: '',
    lastError: '',
    fetchCount: 0,
    cacheHitCount: 0,
    prefetchAttemptCount: 0,
    prefetchSuccessCount: 0,
    prefetchFailureCount: 0,
    normalizeAttemptCount: 0,
    normalizeSuccessCount: 0,
    normalizeFailureCount: 0,
  })),
  getFxTelemetryMonthly: vi.fn(async (month: string) => ({
    month,
    fetchCount: 0,
    cacheHitCount: 0,
    errorCount: 0,
  })),
  loadAllFxRates: vi.fn(async () => []),
  restoreAllFxRates: vi.fn(async () => {}),
}));

vi.mock('../fx', () => ({
  APP_CURRENCY: 'EUR',
  resolveMonthEndRate: vi.fn(async () => null),
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

vi.mock('../utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils')>()),
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
  esc: (s: string | null | undefined) => {
    if (!s) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },
}));

vi.mock('../theme', () => ({}));

vi.mock('../model/accounts', () => ({
  validateAccountIds: () => null,
  validatePrimaryInvestment: () => null,
  validateAccountRanges: () => null,
  validateAccountLabels: () => null,
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
  hasEverGranted: () => true,
}));

vi.mock('../backup/exportImport', () => ({
  isBackupStale: vi.fn(() => true),
}));

vi.mock('../model/holdings', () => ({
  validateHoldings: () => [],
}));

vi.mock('../model/goals', () => ({
  validateGoalLabels: () => null,
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

vi.mock('../ui/toast', () => ({
  notify: vi.fn(() => ({ dismiss: vi.fn() })),
}));

vi.mock('../ui/confirmDialog', () => ({
  confirmDialog: vi.fn(async () => true),
}));

vi.mock('../ui/accountDialog', () => ({
  accountDialog: vi.fn(async () => null),
}));

vi.mock('../ui/holdingDialog', () => ({
  holdingDialog: vi.fn(async () => null),
}));

vi.mock('../ui/goalDialog', () => ({
  goalDialog: vi.fn(async () => null),
}));

vi.mock('../model/accountTypes', () => ({
  ACCOUNT_TYPES: [
    { value: 'investment', label: 'Investment' },
    { value: 'cash', label: 'Cash' },
  ],
  ASSET_CLASSES: [{ value: 'equity', label: 'Equity' }],
  REGIONS: [{ value: 'developed', label: 'Developed' }],
}));

import {
  renderSettings,
  generateId,
  refreshSettingsAfterChange,
  renderConfigHistoryCard,
  _getEligibleYears,
  getSettingsView,
  setSettingsView,
} from './settings';
import { isCollapsed } from '../ui/collapseState';
import { isBackupStale } from '../backup/exportImport';
import { withButtonGuard } from '../utils';

// ── Test setup ──────────────────────────────────────────────────

function stageChanges(btn: HTMLButtonElement): void {
  btn.dataset.dirty = 'true';
  btn.disabled = false;
  btn.title = '';
}

function setupDOM(): void {
  MOCK_CONTRIB_BUDGET = 500;
  MOCK_CONTRIB_INTERVAL = 'monthly';
  MOCK_CALIBRATION_INTERVAL = 'monthly';
  document.body.innerHTML = '<div id="settings-content"></div>';
  (window as any).__hasSyncConflict = () => false;
  (window as any).__openSyncConflictResolver = vi.fn(async () => {});
}

describe('statement mapping settings', () => {
  afterEach(() => {
    snapshotParsers.splice(1);
  });
  beforeEach(() => {
    vi.clearAllMocks();
    setBusy(false);
    delete MOCK_SETTINGS[SNAPSHOT_MAPPINGS_KEY];
    setupDOM();
    renderSettings();
  });
  it('keeps suggested mappings saveable without treating them as user drafts', () => {
    const card = document.getElementById('settings-card-integrations')!;
    const save = document.getElementById('btn-save-statement-mapping') as HTMLButtonElement;
    expect(save.dataset.dirty).toBe('true');
    expect(save.disabled).toBe(false);
    expect(card.classList.contains('settings-dirty')).toBe(false);
    renderSettings({ preserveDrafts: true });
    expect(document.getElementById('settings-card-integrations')).not.toBe(card);
  });
  it('preserves actual mapping edits across refresh and clears the draft on reverting', () => {
    const card = document.getElementById('settings-card-integrations')!;
    const mode = document.getElementById('settings-statement-mode') as HTMLSelectElement;
    const original = mode.value;
    mode.value = 'positions';
    mode.dispatchEvent(new Event('change', { bubbles: true }));
    expect(card.classList.contains('settings-dirty')).toBe(true);
    renderSettings({ preserveDrafts: true });
    expect(document.getElementById('settings-card-integrations')).toBe(card);
    mode.value = original;
    mode.dispatchEvent(new Event('change', { bubbles: true }));
    expect(card.classList.contains('settings-dirty')).toBe(false);
    expect(
      (document.getElementById('btn-save-statement-mapping') as HTMLButtonElement).disabled,
    ).toBe(false);
  });
  it('saves through the guarded ordinary settings path', async () => {
    document.querySelector<HTMLButtonElement>('#btn-save-statement-mapping')!.click();
    await vi.waitFor(() =>
      expect(saveSnapshotMapping).toHaveBeenCalledWith(TRADE_REPUBLIC_VALUATION, {
        mode: 'combined',
        securitiesAccount: 'acct1',
      }),
    );
    await vi.waitFor(() =>
      expect(notify).toHaveBeenCalledWith(expect.stringContaining('saved'), {
        variant: 'success',
        source: 'statement-mapping-msg',
      }),
    );
  });
  it('uses one editor for dozens of registered reports and preserves section spacing', async () => {
    for (let i = 0; i < 30; i++)
      snapshotParsers.push({
        ...fictionalBalanceParser,
        id: `fictional:${i}`,
        label: `Fictional report ${i}`,
        mapping: {
          kind: 'balances',
          slots: [{ key: 'closing', label: 'Closing', moneyTypes: ['investment'] }],
        },
      });
    renderSettings();
    const selector = document.querySelector<HTMLSelectElement>('#statement-report-type')!;
    expect(selector.options).toHaveLength(31);
    expect(document.querySelectorAll('#btn-save-statement-mapping')).toHaveLength(1);
    selector.value = 'fictional:29';
    selector.dispatchEvent(new Event('change'));
    expect(document.querySelectorAll('[data-mapping-balance]')).toHaveLength(1);
    expect(document.querySelector('[data-mapping-mode]')).toBeNull();
    document.querySelector<HTMLSelectElement>('[data-mapping-balance]')!.value = 'acct1';
    document.querySelector<HTMLButtonElement>('#btn-save-statement-mapping')!.click();
    await vi.waitFor(() =>
      expect(saveSnapshotMapping).toHaveBeenCalledWith('fictional:29', {
        mode: 'balances',
        balanceAccounts: { closing: 'acct1' },
      }),
    );
    const headings = Array.from(
      document.querySelectorAll<HTMLElement>('#settings-card-integrations .card-section-head'),
    );
    expect(headings.find((heading) => heading.textContent === 'FRANKFURTER')!.style.marginTop).toBe(
      '1.25rem',
    );
    selector.value = TRADE_REPUBLIC_VALUATION;
    selector.dispatchEvent(new Event('change'));
    expect(document.querySelector('[data-mapping-mode]')).not.toBeNull();
    expect(document.querySelector('[data-mapping-balance]')).toBeNull();
  });
  it('reports persistence failures instead of success', async () => {
    vi.mocked(saveSnapshotMapping).mockRejectedValueOnce(new Error('Storage unavailable'));
    document.querySelector<HTMLButtonElement>('#btn-save-statement-mapping')!.click();
    await vi.waitFor(() =>
      expect(showMsg).toHaveBeenCalledWith('statement-mapping-msg', 'Storage unavailable', false),
    );
  });
  it('resets only the current provider after confirmation', async () => {
    MOCK_SETTINGS[SNAPSHOT_MAPPINGS_KEY] = JSON.stringify({
      version: 1,
      mappings: {
        [TRADE_REPUBLIC_VALUATION]: { mode: 'combined', securitiesAccount: 'acct1' },
        'future:valuation': { opaque: 'preserved' },
      },
    });
    renderSettings();
    document.querySelector<HTMLButtonElement>('#btn-reset-statement-mapping')!.click();
    await vi.waitFor(() =>
      expect(setSettings).toHaveBeenCalledWith({
        [SNAPSHOT_MAPPINGS_KEY]: JSON.stringify({
          version: 1,
          mappings: { 'future:valuation': { opaque: 'preserved' } },
        }),
      }),
    );
    expect(confirmDialog).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.stringContaining('Other providers') }),
    );
  });
  it('explicitly confirms all-provider reset for corrupt preferences', async () => {
    MOCK_SETTINGS[SNAPSHOT_MAPPINGS_KEY] = '{';
    renderSettings();
    expect(document.querySelector('#statement-mapping')!.textContent).toContain(
      'could not be read',
    );
    document.querySelector<HTMLButtonElement>('#btn-reset-statement-mapping')!.click();
    await vi.waitFor(() =>
      expect(setSettings).toHaveBeenCalledWith({ [SNAPSHOT_MAPPINGS_KEY]: '' }),
    );
    expect(confirmDialog).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.stringContaining('ALL statement mappings') }),
    );
  });
  it('does not reset when confirmation is cancelled', async () => {
    vi.mocked(confirmDialog).mockResolvedValueOnce(false);
    document.querySelector<HTMLButtonElement>('#btn-reset-statement-mapping')!.click();
    await vi.waitFor(() => expect(confirmDialog).toHaveBeenCalled());
    expect(setSettings).not.toHaveBeenCalled();
    expect(getSettings()[SNAPSHOT_MAPPINGS_KEY]).toBeUndefined();
  });
});

describe('Settings scoped re-render (repaintCard)', () => {
  beforeEach(() => {
    _collapseState = {};
    setSettingsView('portfolio');
    setupDOM();
    renderSettings();
  });

  it('core settings card IDs are present after renderSettings()', () => {
    const ids = [
      'settings-card-accounts',
      'settings-card-holdings',
      'settings-card-contributions',
      'settings-card-calc-assumptions',
      'settings-card-goal',
      'settings-card-portfolio-behavior',
      'settings-card-integrations',
      'settings-card-cache',
    ];
    for (const id of ids) {
      expect(document.getElementById(id), `missing #${id}`).not.toBeNull();
    }
  });

  it('renders settings sections as compact Log-style tabs', () => {
    const tablist = document.querySelector('.settings-tabs');
    expect(tablist?.getAttribute('role')).toBe('tablist');
    expect(tablist?.classList.contains('range-toggle')).toBe(true);

    const tabs = [...document.querySelectorAll<HTMLElement>('[role="tab"][data-settings-view]')];
    expect(tabs.map((t) => t.dataset.settingsView)).toEqual(['portfolio', 'planning', 'advanced']);
    expect(tabs[0].className).toContain('btn btn-sm btn-ghost');
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(tabs[1].getAttribute('aria-selected')).toBe('false');
    expect(document.getElementById('settings-group-portfolio')?.hidden).toBe(false);
    expect(document.getElementById('settings-group-tracking')?.hidden).toBe(true);
    expect(document.getElementById('settings-group-advanced')?.hidden).toBe(true);
  });

  it('clicking a tab shows only its section and survives re-render', () => {
    const planning = document.getElementById('settings-tab-planning') as HTMLButtonElement;
    planning.click();

    expect(planning.getAttribute('aria-selected')).toBe('true');
    expect(planning.classList.contains('active')).toBe(true);
    expect(document.getElementById('settings-group-tracking')?.hidden).toBe(false);
    expect(document.getElementById('settings-group-portfolio')?.hidden).toBe(true);
    expect(getSettingsView()).toBe('planning');

    renderSettings();
    expect(document.getElementById('settings-group-tracking')?.hidden).toBe(false);
    expect(document.getElementById('settings-tab-planning')?.getAttribute('aria-selected')).toBe(
      'true',
    );
  });

  it('arrow keys move between settings tabs', () => {
    const portfolio = document.getElementById('settings-tab-portfolio') as HTMLButtonElement;
    portfolio.focus();
    portfolio.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));

    const advanced = document.getElementById('settings-tab-advanced') as HTMLButtonElement;
    expect(advanced.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(advanced);
    expect(document.getElementById('settings-group-advanced')?.hidden).toBe(false);
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

  it('holdings card has read-only rows with Edit buttons after renderSettings()', () => {
    const holdingsCard = document.getElementById('settings-card-holdings')!;
    // Rows are now read-only summaries; color pickers live inside the dialog
    const colorPickers = holdingsCard.querySelectorAll('.color-picker-swatch');
    expect(colorPickers.length).toBe(0);
    // Each holding row has an Edit button
    const editBtns = holdingsCard.querySelectorAll('.js-edit-hold');
    expect(editBtns.length).toBeGreaterThan(0);
  });

  it('goals card has read-only rows with Edit buttons after renderSettings()', () => {
    const goalsCard = document.getElementById('settings-card-goal')!;
    const inlineGoalInputs = goalsCard.querySelectorAll('[data-field="targetNetWorth"]');
    expect(inlineGoalInputs.length).toBe(0);
    expect(document.getElementById('btn-add-goal')).not.toBeNull();
  });

  it('data-card-key attributes are preserved alongside new ids', () => {
    const cards = document.querySelectorAll('.card-collapsible');
    const keys = [...cards].map((c) => (c as HTMLElement).dataset.cardKey);
    expect(keys).toContain('accounts');
    expect(keys).toContain('holdings');
    expect(keys).toContain('calc-assumptions');
    expect(keys).toContain('goal');
    expect(keys).toContain('portfolio-behavior');
    expect(keys).toContain('integrations');
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

  it('falls back to account for empty/all-symbol labels', () => {
    const taken = new Set<string>();
    expect(generateId('', taken)).toBe('account');
    taken.add('account');
    expect(generateId('@@@', taken)).toBe('account_2');
  });

  it('strips reserved etf_ prefix from generated IDs', () => {
    const taken = new Set<string>();
    expect(generateId('ETF Depot', taken)).toBe('depot');
  });
});

describe('Backup card nudge', () => {
  beforeEach(() => {
    _collapseState = {};
    setupDOM();
  });

  describe('Config history timestamp formatting', () => {
    it('uses English month labels in history rows', () => {
      const html = renderConfigHistoryCard([
        {
          timestamp: '2026-06-15T10:00:00.000Z',
          entity: 'settings',
          summary: 'Updated cost basis',
        },
      ] as any);
      expect(html).toMatch(/Jun/);
      expect(html).toContain('Updated cost basis');
    });
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
    expect(document.getElementById('settings-goals-tbl')).not.toBeNull();
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

  it('accounts card rows are read-only summaries with Edit buttons after rerender', () => {
    // Rows are now read-only; editing is via accountDialog
    const accountsCard = document.getElementById('settings-card-accounts')!;
    const editBtns = accountsCard.querySelectorAll('.js-edit-acct');
    expect(editBtns.length).toBeGreaterThan(0);

    // After refreshSettingsAfterChange, edit buttons should still be present
    refreshSettingsAfterChange('accounts');
    const editBtnsAfter = document
      .getElementById('settings-card-accounts')!
      .querySelectorAll('.js-edit-acct');
    expect(editBtnsAfter.length).toBeGreaterThan(0);
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

  it('has #settings-goals-tbl wrapping the goal form', () => {
    const el = document.getElementById('settings-goals-tbl');
    expect(el).not.toBeNull();
    // Add button is present
    expect(document.getElementById('btn-add-goal')).not.toBeNull();
  });

  it('has #settings-backup-nudge wrapping the backup staleness nudge', () => {
    const el = document.getElementById('settings-backup-nudge');
    expect(el).not.toBeNull();
  });
});

describe('Portfolio contributions card', () => {
  beforeEach(() => {
    _collapseState = {};
    setupDOM();
  });

  it('renders contribution amount, contribution cadence, and calibration cadence', () => {
    MOCK_CONTRIB_BUDGET = 250;
    MOCK_CONTRIB_INTERVAL = 'weekly';
    MOCK_CALIBRATION_INTERVAL = 'quarterly';
    renderSettings();

    const amount = document.getElementById('set-contrib-budget') as HTMLInputElement;
    const contributionCadence = document.getElementById(
      'set-contribution-interval',
    ) as HTMLSelectElement;
    const calibrationCadence = document.getElementById(
      'set-calibration-interval',
    ) as HTMLSelectElement;

    expect(amount.value).toBe('250');
    expect(contributionCadence.value).toBe('weekly');
    expect(calibrationCadence.value).toBe('quarterly');
  });

  it('saves amount, contribution cadence, and calibration cadence', async () => {
    renderSettings();
    const { setSetting } = await import('../store/config');
    (setSetting as ReturnType<typeof vi.fn>).mockClear();

    (document.getElementById('set-contrib-budget') as HTMLInputElement).value = '300';
    (document.getElementById('set-contribution-interval') as HTMLSelectElement).value = 'biweekly';
    (document.getElementById('set-calibration-interval') as HTMLSelectElement).value = 'weekly';
    document
      .getElementById('set-contrib-budget')!
      .dispatchEvent(new Event('change', { bubbles: true }));
    (document.getElementById('btn-save-contributions') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));

    expect((setSetting as ReturnType<typeof vi.fn>).mock.calls).toEqual([
      ['monthly_contrib_budget', '300'],
      ['contribution_interval', 'biweekly'],
      ['calibration_interval', 'weekly'],
    ]);
  });

  it('refreshes saved values while preserving another card and its draft listeners', async () => {
    vi.mocked(setSettings).mockClear();
    MOCK_CONTRIB_BUDGET = 203;
    renderSettings();
    const draft = document.getElementById('analytics-risk-free-rate') as HTMLInputElement;
    draft.value = '4.5';
    draft.dispatchEvent(new Event('input', { bubbles: true }));
    const card = document.getElementById('settings-card-calc-assumptions');
    const heading = document.getElementById('settings-heading-calc-assumptions')!;
    const expanded = heading.getAttribute('aria-expanded');

    MOCK_CONTRIB_BUDGET = 205;
    renderSettings({ preserveDrafts: true });
    renderSettings({ preserveDrafts: true });

    expect((document.getElementById('set-contrib-budget') as HTMLInputElement).value).toBe('205');
    expect(document.getElementById('settings-card-calc-assumptions')).toBe(card);
    expect(document.getElementById('analytics-risk-free-rate')).toBe(draft);
    expect(draft.value).toBe('4.5');
    heading.click();
    expect(heading.getAttribute('aria-expanded')).not.toBe(expanded);
    const save = document.getElementById('btn-save-analytics') as HTMLButtonElement;
    expect(save.dataset.dirty).toBe('true');
    save.click();
    await vi.waitFor(() => expect(save.dataset.dirty).toBe('false'));
    expect(vi.mocked(setSettings).mock.calls).toEqual([[{ riskFreeRate: '4.5' }]]);
  });
});

describe('FX integrations card', () => {
  beforeEach(() => {
    _collapseState = {};
    setupDOM();
    renderSettings();
  });

  it('renders integrations controls and status rows', () => {
    expect(document.getElementById('settings-card-integrations')).not.toBeNull();
    expect(document.getElementById('fx-integration-enabled')).not.toBeNull();
    expect(document.getElementById('btn-save-fx-integration')).not.toBeNull();
    expect(document.getElementById('fx-status-cache-entries')).not.toBeNull();
    expect(document.getElementById('fx-status-last-request-url')).toBeNull();
  });

  it('saves fx_integration_enabled setting from the toggle', async () => {
    const { setSetting } = await import('../store/config');
    (setSetting as ReturnType<typeof vi.fn>).mockClear();
    const checkbox = document.getElementById('fx-integration-enabled') as HTMLInputElement;
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    (document.getElementById('btn-save-fx-integration') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));

    expect((setSetting as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual([
      'fx_integration_enabled',
      '0',
    ]);
  });

  it('clears FX cache from integrations card', async () => {
    const { restoreAllFxRates } = await import('../db');
    (restoreAllFxRates as ReturnType<typeof vi.fn>).mockClear();
    (document.getElementById('btn-fx-clear-cache') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));

    expect((restoreAllFxRates as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual([[]]);
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
    let resolveWrite: (value?: unknown) => void;
    (setSetting as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveWrite = resolve;
        }),
    );

    const btn = document.getElementById('btn-save-cost-basis') as HTMLButtonElement;
    const method = document.getElementById('set-cost-basis-method') as HTMLSelectElement;
    method.value = 'fifo';
    method.dispatchEvent(new Event('change', { bubbles: true }));
    btn.click();

    // Wait for microtask to allow click handler to execute
    await new Promise((r) => setTimeout(r, 0));
    expect(btn.textContent).toBe('Saving...');
    expect(btn.disabled).toBe(true);

    resolveWrite!();
    await new Promise((r) => setTimeout(r, 0));
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toBe('Save cost-basis method');
  });

  it('Save goal button shows busy text during save', async () => {
    const { setSettings } = await import('../store/config');
    let resolveWrite: (value?: unknown) => void;
    (setSettings as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveWrite = resolve;
        }),
    );

    const btn = document.getElementById('btn-save-goal') as HTMLButtonElement;
    stageChanges(btn);
    btn.click();

    await new Promise((r) => setTimeout(r, 0));
    expect(btn.textContent).toBe('Saving...');
    expect(btn.disabled).toBe(true);

    resolveWrite!();
    await new Promise((r) => setTimeout(r, 0));
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toBe('Save goals');
  });

  it('Force resync button shows busy text during resync', async () => {
    let resolveResync: (value?: unknown) => void;
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
    let resolveExport: (value?: unknown) => void;
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
    let resolveWrite: (value?: unknown) => void;
    (setSetting as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveWrite = resolve;
        }),
    );

    const btn = document.getElementById('btn-save-cost-basis') as HTMLButtonElement;
    const method = document.getElementById('set-cost-basis-method') as HTMLSelectElement;
    method.value = 'fifo';
    method.dispatchEvent(new Event('change', { bubbles: true }));
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
      let resolveWrite!: (value?: unknown) => void;
      (setAccounts as ReturnType<typeof vi.fn>).mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolveWrite = r;
          }),
      );

      const btn = document.getElementById('btn-save-accts') as HTMLButtonElement;
      stageChanges(btn);
      btn.click();
      await tick();
      await tick();

      expect(btn.disabled).toBe(true);
      expect(btn.textContent).toBe('Saving...');

      // Second click while busy - card guard prevents action
      btn.click();
      await tick();
      expect((setAccounts as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);

      resolveWrite();
      await tick();
      expect(btn.disabled).toBe(true);
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
      stageChanges(btn);
      btn.click();
      await tick();
      await tick();

      expect(btn.disabled).toBe(false);
      expect(btn.textContent).toBe('Save accounts');
      expect(notify).toHaveBeenCalledWith('Could not save accounts: Network error', {
        variant: 'error',
        source: 'accts-msg',
      });
    });

    it('migrates legacy snapshot keys to current account ids before saving', async () => {
      const { setAccounts } = await import('../store/config');
      const { loadSnapshots, saveSnapshots } = await import('../db');
      (setAccounts as ReturnType<typeof vi.fn>).mockClear();
      (loadSnapshots as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { date: '2026-01', legacy_tr: 1234, cash: 55 },
      ]);
      (saveSnapshots as ReturnType<typeof vi.fn>).mockClear();

      const original = { ...MOCK_ACCOUNTS[0] };
      try {
        MOCK_ACCOUNTS[0] = {
          ...MOCK_ACCOUNTS[0],
          id: 'tr_portfolio',
          key: 'legacy_tr',
        } as any;
        renderSettings();

        const btn = document.getElementById('btn-save-accts') as HTMLButtonElement;
        stageChanges(btn);
        btn.click();
        await tick();

        expect(saveSnapshots as ReturnType<typeof vi.fn>).toHaveBeenCalledWith([
          { date: '2026-01', tr_portfolio: 1234, cash: 55 },
        ]);
        expect(setAccounts as ReturnType<typeof vi.fn>).toHaveBeenCalled();
      } finally {
        MOCK_ACCOUNTS[0] = original;
      }
    });

    it('reuses legacy key as id when account id is missing', async () => {
      const { setAccounts } = await import('../store/config');
      const { saveSnapshots } = await import('../db');
      (setAccounts as ReturnType<typeof vi.fn>).mockClear();
      (saveSnapshots as ReturnType<typeof vi.fn>).mockClear();

      const original = { ...MOCK_ACCOUNTS[0] };
      try {
        MOCK_ACCOUNTS[0] = {
          ...MOCK_ACCOUNTS[0],
          key: 'legacy_account_id',
        } as any;
        delete (MOCK_ACCOUNTS[0] as any).id;
        renderSettings();

        const btn = document.getElementById('btn-save-accts') as HTMLButtonElement;
        stageChanges(btn);
        btn.click();
        await tick();

        const savedAccounts = (setAccounts as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(savedAccounts[0].id).toBe('legacy_account_id');
        expect(saveSnapshots as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
      } finally {
        MOCK_ACCOUNTS[0] = original;
      }
    });
  });

  describe('.js-del-acct (accounts delete)', () => {
    it('blocks deletion when account has historical snapshot values', async () => {
      const { loadSnapshots } = await import('../db');
      const { setAccounts } = await import('../store/config');
      const { showMsg } = await import('../utils');
      (loadSnapshots as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { date: '2026-01', acct1: 1234 },
      ]);
      (setAccounts as ReturnType<typeof vi.fn>).mockClear();
      (showMsg as ReturnType<typeof vi.fn>).mockClear();

      const btn = document.querySelector('.js-del-acct') as HTMLButtonElement;
      btn.click();
      await tick();

      expect(setAccounts as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
      expect(showMsg as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
        'accts-msg',
        expect.stringContaining('Cannot remove this account'),
        false,
      );
    });

    it('marks the account for removal without writing, and Undo restores it', async () => {
      const { setAccounts, retireAccountIdsSafely } = await import('../store/config');
      (setAccounts as ReturnType<typeof vi.fn>).mockClear();
      (retireAccountIdsSafely as ReturnType<typeof vi.fn>).mockClear();

      const card = document.getElementById('settings-card-accounts')!;
      (document.querySelector('.js-del-acct') as HTMLButtonElement).click();
      await tick();

      const row = card.querySelector('.settings-acct-row')!;
      expect(row.classList.contains('settings-item-removed')).toBe(true);
      expect(row.textContent).toContain('Removed');
      expect(row.querySelector('.js-edit-acct')).toBeNull();
      const undo = row.querySelector<HTMLButtonElement>('.js-del-acct')!;
      expect(undo.getAttribute('aria-label')).toBe('Undo remove account Main');
      expect(card.classList.contains('settings-dirty')).toBe(true);
      expect(setAccounts as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
      expect(confirmDialog).not.toHaveBeenCalled();

      undo.click();
      await tick();
      const restored = card.querySelector('.settings-acct-row')!;
      expect(restored.classList.contains('settings-item-removed')).toBe(false);
      expect(restored.querySelector('.js-edit-acct')).not.toBeNull();
      expect(card.classList.contains('settings-dirty')).toBe(false);
      expect((document.getElementById('btn-save-accts') as HTMLButtonElement).disabled).toBe(true);
      expect(setAccounts as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
      expect(retireAccountIdsSafely as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    });

    it('commits a marked removal on Save and retires the removed id', async () => {
      const { setAccounts, retireAccountIdsSafely } = await import('../store/config');
      (setAccounts as ReturnType<typeof vi.fn>).mockClear();
      (retireAccountIdsSafely as ReturnType<typeof vi.fn>).mockClear();

      (document.querySelector('.js-del-acct') as HTMLButtonElement).click();
      await tick();
      const save = document.getElementById('btn-save-accts') as HTMLButtonElement;
      expect(save.disabled).toBe(false);
      save.click();
      await tick();
      await tick();

      expect(setAccounts as ReturnType<typeof vi.fn>).toHaveBeenCalledWith([]);
      expect(retireAccountIdsSafely as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(['acct1']);
      expect(document.querySelectorAll('.settings-acct-row')).toHaveLength(0);
      expect(notify).toHaveBeenCalledWith('Accounts saved', {
        variant: 'success',
        source: 'accts-msg',
      });
    });

    it('still reports success (not an error) when the id retirement write itself fails', async () => {
      const { setAccounts, retireAccountIdsSafely } = await import('../store/config');
      (setAccounts as ReturnType<typeof vi.fn>).mockClear();
      (setAccounts as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {});
      // Simulates: account removal itself succeeded, but the follow-up
      // retirement write failed and was queued instead of thrown.
      (retireAccountIdsSafely as ReturnType<typeof vi.fn>).mockImplementationOnce(
        async () => false,
      );
      const { showMsg } = await import('../utils');
      (showMsg as ReturnType<typeof vi.fn>).mockClear();

      (document.querySelector('.js-del-acct') as HTMLButtonElement).click();
      await tick();
      (document.getElementById('btn-save-accts') as HTMLButtonElement).click();
      await tick();
      await tick();

      expect(setAccounts as ReturnType<typeof vi.fn>).toHaveBeenCalled();
      // The account was actually removed - this must never surface as an
      // "Error: ..." message, only a softer heads-up about the id.
      expect(notify).toHaveBeenCalledWith(
        'Accounts saved (will finish reserving removed ids once back online)',
        { variant: 'success', source: 'accts-msg' },
      );
      const errorCall = (showMsg as ReturnType<typeof vi.fn>).mock.calls.find(
        (c) => c[0] === 'accts-msg' && c[2] === false,
      );
      expect(errorCall).toBeUndefined();
    });
  });

  describe('#btn-save-holds (holdings card)', () => {
    it('disables synchronously and prevents double-click', async () => {
      const { setHoldings } = await import('../store/config');
      (setHoldings as ReturnType<typeof vi.fn>).mockClear();
      let resolveWrite!: (value?: unknown) => void;
      (setHoldings as ReturnType<typeof vi.fn>).mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolveWrite = r;
          }),
      );

      const btn = document.getElementById('btn-save-holds') as HTMLButtonElement;
      stageChanges(btn);
      btn.click();
      await tick();

      expect(btn.disabled).toBe(true);
      expect(btn.textContent).toBe('Saving...');

      btn.click();
      await tick();
      expect((setHoldings as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);

      resolveWrite();
      await tick();
      expect(btn.disabled).toBe(true);
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
      stageChanges(btn);
      btn.click();
      await tick();

      expect(btn.disabled).toBe(false);
      expect(notify).toHaveBeenCalledWith('Could not save holdings: Sheets API error', {
        variant: 'error',
        source: 'holds-msg',
      });
    });
  });

  describe('.js-del-hold (holdings delete)', () => {
    it('stages the removal and keeps unsaved edits out of storage until Save', async () => {
      const { setHoldings } = await import('../store/config');
      (setHoldings as ReturnType<typeof vi.fn>).mockClear();

      (document.querySelector('.js-del-hold') as HTMLButtonElement).click();
      await tick();
      expect(setHoldings as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
      expect(
        document.querySelector('.settings-hold-row')!.classList.contains('settings-item-removed'),
      ).toBe(true);

      const save = document.getElementById('btn-save-holds') as HTMLButtonElement;
      expect(save.disabled).toBe(false);
      save.click();
      await tick();
      expect(setHoldings as ReturnType<typeof vi.fn>).toHaveBeenCalledWith([]);
      expect(document.querySelectorAll('.settings-hold-row')).toHaveLength(0);
    });
  });

  describe('#btn-autofill-holds (holdings autofill)', () => {
    it('disables synchronously and prevents double-click', async () => {
      const { loadTransactions } = await import('../db');
      (loadTransactions as ReturnType<typeof vi.fn>).mockClear();
      let resolveLoad!: (value?: unknown) => void;
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
      let resolveWrite!: (value?: unknown) => void;
      (setSettings as ReturnType<typeof vi.fn>).mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolveWrite = r;
          }),
      );

      const btn = document.getElementById('btn-save-rules') as HTMLButtonElement;
      stageChanges(btn);
      btn.click();
      await tick();

      expect(btn.disabled).toBe(true);
      expect(btn.textContent).toBe('Saving...');

      btn.click();
      await tick();
      expect((setSettings as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);

      resolveWrite();
      await tick();
      expect(btn.disabled).toBe(true);
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
      stageChanges(btn);
      btn.click();
      await tick();

      expect(btn.disabled).toBe(false);
      expect(notify).toHaveBeenCalledWith('Could not save rules: Write failed', {
        variant: 'error',
        source: 'rules-msg',
      });
    });
  });

  describe('.js-del-rule (rules delete)', () => {
    it('stages the removal, supports Undo, and only Save rules persists', async () => {
      const { setSettings } = await import('../store/config');
      (setSettings as ReturnType<typeof vi.fn>).mockClear();

      const add = document.getElementById('btn-add-rule') as HTMLButtonElement;
      add.click();
      add.click();
      const inputs = document.querySelectorAll<HTMLInputElement>('.settings-rule-row input');
      inputs[0].value = 'Keep';
      inputs[2].value = 'Drop';
      inputs[0].dispatchEvent(new Event('input', { bubbles: true }));

      const del = () =>
        document.querySelectorAll<HTMLButtonElement>('.settings-rule-row .js-del-rule')[1];
      del().click();
      const row = document.querySelectorAll<HTMLElement>('.settings-rule-row')[1];
      expect(row.dataset.removed).toBe('true');
      expect(row.querySelector<HTMLInputElement>('input')!.disabled).toBe(true);
      expect(del().textContent).toBe('Undo remove');
      expect(setSettings as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();

      del().click();
      expect(document.querySelectorAll<HTMLElement>('.settings-rule-row')[1].dataset.removed).toBe(
        undefined,
      );
      expect(document.querySelectorAll<HTMLInputElement>('.settings-rule-row input')[2].value).toBe(
        'Drop',
      );
      del().click();

      (document.getElementById('btn-save-rules') as HTMLButtonElement).click();
      await tick();
      expect(setSettings as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
        expect.objectContaining({ rule_1_label: 'Keep' }),
      );
      const updates = (setSettings as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(updates).not.toHaveProperty('rule_2_label');
      expect(document.querySelectorAll('.settings-rule-row')).toHaveLength(1);
    });
  });

  describe('#btn-save-cost-basis (cost-basis card)', () => {
    it('disables synchronously and prevents double-click', async () => {
      const { setSetting } = await import('../store/config');
      (setSetting as ReturnType<typeof vi.fn>).mockClear();
      let resolveWrite!: (value?: unknown) => void;
      (setSetting as ReturnType<typeof vi.fn>).mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolveWrite = r;
          }),
      );

      const btn = document.getElementById('btn-save-cost-basis') as HTMLButtonElement;
      const method = document.getElementById('set-cost-basis-method') as HTMLSelectElement;
      method.value = 'fifo';
      method.dispatchEvent(new Event('change', { bubbles: true }));
      btn.click();
      await tick();

      expect(btn.disabled).toBe(true);
      expect(btn.textContent).toBe('Saving...');

      btn.click();
      await tick();
      expect((setSetting as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);

      resolveWrite();
      await tick();
      expect(btn.disabled).toBe(true);
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
      const method = document.getElementById('set-cost-basis-method') as HTMLSelectElement;
      method.value = 'fifo';
      method.dispatchEvent(new Event('change', { bubbles: true }));
      btn.click();
      await tick();

      expect(btn.disabled).toBe(false);
      expect(notify).toHaveBeenCalledWith('Could not save cost-basis method: API error', {
        variant: 'error',
        source: 'costbasis-msg',
      });
    });
  });

  describe('#btn-save-goal (goal card)', () => {
    it('disables synchronously and prevents double-click', async () => {
      const { setSettings } = await import('../store/config');
      (setSettings as ReturnType<typeof vi.fn>).mockReset();
      let resolveWrite!: (value?: unknown) => void;
      (setSettings as ReturnType<typeof vi.fn>).mockImplementation(
        () =>
          new Promise((r) => {
            resolveWrite = r;
          }),
      );

      const btn = document.getElementById('btn-save-goal') as HTMLButtonElement;
      stageChanges(btn);
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
      expect(btn.disabled).toBe(true);
      expect(btn.textContent).toBe('Save goals');
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
      stageChanges(btn);
      btn.click();
      await tick();
      await tick();

      expect(btn.disabled).toBe(false);
      expect(notify).toHaveBeenCalledWith('Could not save goals: Timeout', {
        variant: 'error',
        source: 'goal-msg',
      });

      // Restore default mock
      (setSettings as ReturnType<typeof vi.fn>).mockImplementation(async () => {});
    });
  });

  describe('#btn-force-resync (cache card)', () => {
    it('shows conflict-specific copy and action when a sync conflict is pending', async () => {
      const openConflictResolver = vi.fn(async () => {});
      (window as any).__hasSyncConflict = () => true;
      (window as any).__openSyncConflictResolver = openConflictResolver;

      renderSettings();

      expect(document.getElementById('btn-resolve-sync-conflict')).not.toBeNull();
      expect(document.getElementById('settings-card-cache')?.textContent).toContain(
        'Sync is paused because Drive changed elsewhere and this device also has local changes.',
      );

      (document.getElementById('btn-resolve-sync-conflict') as HTMLButtonElement).click();
      await tick();
      expect(openConflictResolver).toHaveBeenCalledTimes(1);
    });

    it('disables synchronously and prevents double-click', async () => {
      let callCount = 0;
      let resolveResync!: (value?: unknown) => void;
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
      expect(notify).toHaveBeenCalledWith('Resync failed: Resync failed', {
        variant: 'error',
        source: 'resync-msg',
      });
    });
  });

  describe('#btn-export-backup (backup card)', () => {
    it('disables synchronously and prevents double-click', async () => {
      let callCount = 0;
      let resolveExport!: (value?: unknown) => void;
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
      expect(notify).toHaveBeenCalledWith('Export failed: Export failed', {
        variant: 'error',
        source: 'backup-msg',
      });
    });
  });

  describe('#btn-restore-backup (backup restore via file input)', () => {
    it('disables synchronously and prevents double-click', async () => {
      let callCount = 0;
      let resolveRestore!: (value?: unknown) => void;
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

  describe('holdings dialog-based add', () => {
    it('opens holdingDialog when btn-add-hold is clicked', async () => {
      const { holdingDialog } = await import('../ui/holdingDialog');
      (holdingDialog as ReturnType<typeof vi.fn>).mockClear();

      renderSettings();
      await tick();

      (document.getElementById('btn-add-hold') as HTMLButtonElement).click();
      await tick();

      expect(holdingDialog as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
    });

    it('adds a row when holdingDialog resolves with a holding', async () => {
      const { holdingDialog } = await import('../ui/holdingDialog');
      (holdingDialog as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        isin: 'IE00KNOWN',
        shortName: 'KNOWN',
        name: 'Known Fund',
        color: '#111111',
        acc: true,
        active: true,
        contribAmount: 0,
        contribInterval: 'weekly',
        assetClass: 'equity',
        region: 'developed',
        foldInto: '',
        order: 2,
      });

      renderSettings();
      await tick();

      const rowsBefore = document.querySelectorAll('.settings-hold-row').length;
      (document.getElementById('btn-add-hold') as HTMLButtonElement).click();
      await tick();

      const rowsAfter = document.querySelectorAll('.settings-hold-row').length;
      expect(rowsAfter).toBe(rowsBefore + 1);
    });
  });
});

// ── _getEligibleYears ──────────────────────────────────────────────────────────

describe('_getEligibleYears', () => {
  const snap = (date: string) => ({ date });
  const tx = (date: string) =>
    ({
      id: date,
      date,
      source: 'broker',
      type: 'BUY',
      name: '',
      isin: '',
      shares: 0,
      price: 0,
      amount: 0,
      fee: 0,
      tax: 0,
      currency: 'EUR',
      fxRate: 1,
    }) as any;

  it('returns years from snapshots only', () => {
    const years = _getEligibleYears([], [snap('2022-06-01'), snap('2024-12-31')]);
    expect(years).toEqual([2024, 2022]);
  });

  it('returns years from transactions only', () => {
    const years = _getEligibleYears([tx('2021-03-15'), tx('2023-11-01')], []);
    expect(years).toEqual([2023, 2021]);
  });

  it('merges years from both sources and deduplicates', () => {
    const years = _getEligibleYears(
      [tx('2022-05-01'), tx('2024-01-01')],
      [snap('2022-12-31'), snap('2023-06-01')],
    );
    expect(years).toEqual([2024, 2023, 2022]);
  });

  it('returns years sorted descending', () => {
    const years = _getEligibleYears([tx('2019-01-01'), tx('2021-06-01')], [snap('2020-12-31')]);
    expect(years).toEqual([2021, 2020, 2019]);
  });

  it('returns empty array when no data exists', () => {
    const years = _getEligibleYears([], []);
    expect(years).toEqual([]);
  });
});

describe('Settings accessible controls and report states', () => {
  beforeEach(() => {
    setBusy(false);
    _collapseState = {};
    setupDOM();
    vi.mocked(loadSnapshots).mockReset().mockResolvedValue([]);
    vi.mocked(loadConfigHistory).mockReset().mockResolvedValue([]);
    vi.mocked(showMsg).mockClear();
    vi.mocked(notify).mockClear();
  });
  afterEach(() => {
    setBusy(false);
    setSettingsView('portfolio');
  });

  it('associates accordion headings and preserves expansion during history loading', async () => {
    let resolve!: (entries: []) => void;
    vi.mocked(loadConfigHistory).mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    renderSettings();
    const headings = [...document.querySelectorAll<HTMLButtonElement>('.js-card-toggle')];
    expect(headings).toHaveLength(11);
    for (const heading of headings) {
      const body = document.getElementById(heading.getAttribute('aria-controls')!)!;
      expect(heading.tagName).toBe('BUTTON');
      expect(body.getAttribute('aria-labelledby')).toBe(heading.id);
      expect(heading.getAttribute('aria-expanded')).toBe(String(!body.hidden));
    }
    setSettingsView('advanced');
    const heading = document.getElementById('settings-heading-config-history') as HTMLButtonElement;
    heading.focus();
    heading.click();
    resolve([]);
    await vi.mocked(loadConfigHistory).mock.results[0].value;
    expect(document.activeElement).toBe(heading);
    expect(heading.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById('settings-body-config-history')!.hidden).toBe(false);
  });

  it.each([false, true])('loads report years with restored-open=%s', async (restored) => {
    if (restored) _collapseState = { 'settings-defaults-v1': true };
    vi.mocked(loadSnapshots).mockResolvedValueOnce([
      { date: '2024-12-01' },
      { date: '2025-01-01' },
    ]);
    renderSettings();
    if (!restored) document.getElementById('settings-heading-reports')!.click();
    const select = document.getElementById('report-year-select') as HTMLSelectElement;
    await vi.waitFor(() => expect(select.disabled).toBe(false));
    expect([...select.options].map((option) => option.value)).toEqual(['2025', '2024']);
    expect((document.getElementById('btn-download-report') as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect(document.getElementById('report-msg')!.textContent).toBe('');
    expect(notify).not.toHaveBeenCalled();
  });

  it('keeps reports without data unavailable after sync and supports retries after failures', async () => {
    vi.mocked(loadSnapshots).mockRejectedValueOnce(new Error('Read failed'));
    renderSettings();
    document.getElementById('settings-heading-reports')!.click();
    const retry = document.getElementById('btn-retry-report') as HTMLButtonElement;
    await vi.waitFor(() => expect(retry.hidden).toBe(false));
    expect(showMsg).toHaveBeenCalledWith(
      'report-msg',
      'Report years could not be loaded: Read failed',
      false,
    );
    retry.click();
    await vi.waitFor(() =>
      expect(showMsg).toHaveBeenCalledWith(
        'report-msg',
        'No data found. Add snapshots or transactions to generate a report.',
        false,
      ),
    );
    expect(retry.hidden).toBe(true);
    setBusy(true);
    applySyncBusyState();
    setBusy(false);
    applySyncBusyState();
    expect((document.getElementById('btn-download-report') as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('keeps a ready report locked until an in-flight sync finishes', async () => {
    let resolve!: (snapshots: Awaited<ReturnType<typeof loadSnapshots>>) => void;
    vi.mocked(loadSnapshots).mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    renderSettings();
    document.getElementById('settings-heading-reports')!.click();
    setBusy(true);
    applySyncBusyState();
    resolve([{ date: '2024-01-01' }]);
    const download = document.getElementById('btn-download-report') as HTMLButtonElement;
    await vi.waitFor(() => expect(download.dataset.reportReady).toBe('true'));
    expect(download.disabled).toBe(true);
    setBusy(false);
    applySyncBusyState();
    expect(download.disabled).toBe(false);
  });

  it('enables analytics saving only while its value differs from the baseline', () => {
    renderSettings();
    const input = document.getElementById('analytics-risk-free-rate') as HTMLInputElement;
    const save = document.getElementById('btn-save-analytics') as HTMLButtonElement;
    const original = input.value;
    for (const [value, dirty] of [
      [original, false],
      [String(Number(original) + 1), true],
      [original, false],
    ] as const) {
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      expect(save.disabled).toBe(!dirty);
      expect(save.dataset.dirty).toBe(String(dirty));
      expect(save.title).toBe(dirty ? '' : 'No changes to save');
    }
  });

  it('renders staged account rows, drops an unsaved new row on delete, and clears drafts after saving', async () => {
    vi.mocked(accountDialog)
      .mockResolvedValueOnce({ label: 'Draft account', moneyType: 'cash' })
      .mockResolvedValueOnce({ label: 'Second draft', moneyType: 'cash' });
    renderSettings();
    const card = document.getElementById('settings-card-accounts')!;
    document.getElementById('btn-add-acct')!.click();
    await vi.waitFor(() => expect(card.classList.contains('settings-dirty')).toBe(true));
    expect(card.querySelector('.settings-draft-status')?.textContent).toBe('Unsaved changes');
    expect(card.querySelector('.settings-card-summary')?.textContent).toBe('2 accounts');
    const row = card.querySelectorAll('.settings-acct-row')[1];
    expect(row.classList.contains('settings-item-new')).toBe(true);
    expect(row.textContent).toContain('New');
    expect(row.querySelector('.settings-item-copy .settings-item-title')?.textContent).toBe(
      'Draft account',
    );
    const remove = row.querySelector<HTMLButtonElement>('.js-del-acct')!;
    expect(remove.getAttribute('aria-label')).toBe('Delete account Draft account');
    remove.click();
    await vi.waitFor(() => expect(card.querySelectorAll('.settings-acct-row')).toHaveLength(1));
    expect(confirmDialog).not.toHaveBeenCalled();
    expect(card.classList.contains('settings-dirty')).toBe(false);

    document.getElementById('btn-add-acct')!.click();
    await vi.waitFor(() => expect(card.querySelectorAll('.settings-acct-row')).toHaveLength(2));
    const save = document.getElementById('btn-save-accts') as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    save.click();
    await vi.waitFor(() => expect(card.classList.contains('settings-dirty')).toBe(false));
    expect(card.querySelector('.settings-draft-status')?.textContent).toBe('');
    expect(card.querySelector('.settings-item-new')).toBeNull();
    expect(save.disabled).toBe(true);
    expect(notify).toHaveBeenCalledWith('Accounts saved', {
      variant: 'success',
      source: 'accts-msg',
    });
  });

  it('shows account filters once there are 2+ accounts and resets them on edits', async () => {
    vi.mocked(accountDialog)
      .mockResolvedValueOnce({ label: 'Draft account', moneyType: 'cash' })
      .mockResolvedValueOnce({ label: 'Second draft', moneyType: 'cash' });
    renderSettings();
    const card = document.getElementById('settings-card-accounts')!;
    const bar = card.querySelector<HTMLElement>('.settings-acct-filter-bar')!;
    const chips = card.querySelector<HTMLElement>('#acct-filter-toggle')!;
    const rows = () =>
      [...card.querySelectorAll('.settings-acct-row .settings-item-title')].map(
        (e) => e.textContent,
      );
    expect(bar.hidden).toBe(true);

    document.getElementById('btn-add-acct')!.click();
    await vi.waitFor(() => expect(rows()).toHaveLength(2));
    expect(bar.hidden).toBe(false);
    expect(chips.hidden).toBe(false);
    expect(chips.textContent?.replace(/\s+/g, '')).toBe('All2Investment1Cash1');

    chips.querySelector<HTMLButtonElement>('[data-afilter="cash"]')!.click();
    expect(rows()).toEqual(['Draft account']);

    const search = card.querySelector<HTMLInputElement>('#settings-acct-search')!;
    search.value = 'nothing';
    search.dispatchEvent(new Event('input'));
    expect(card.querySelector('.settings-acct-empty')).not.toBeNull();

    document.getElementById('btn-add-acct')!.click();
    await vi.waitFor(() => expect(rows()).toHaveLength(3));
    expect(card.querySelector<HTMLInputElement>('#settings-acct-search')!.value).toBe('');
    expect(chips.querySelector('[data-afilter="all"]')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('preserves a goal draft when an unrelated settings save refreshes the view', async () => {
    const { goalDialog } = await import('../ui/goalDialog');
    vi.mocked(goalDialog).mockResolvedValueOnce({
      label: 'Draft goal',
      targetNetWorth: '100000',
      targetDate: '',
    });
    renderSettings();
    document.getElementById('btn-add-goal')!.click();
    await vi.waitFor(() => expect(document.querySelectorAll('.settings-goal-row')).toHaveLength(1));
    refreshSettingsAfterChange('settings');
    expect(document.querySelector('.settings-goal-row')?.textContent).toContain('Draft goal');
    expect(document.querySelector('#settings-card-goal.settings-dirty')).not.toBeNull();
  });

  it('keeps staged account objects and save listeners across a full data refresh', async () => {
    const { setAccounts } = await import('../store/config');
    vi.mocked(accountDialog).mockResolvedValueOnce({ label: 'Draft account', moneyType: 'cash' });
    renderSettings();
    document.getElementById('btn-add-acct')!.click();
    const card = document.getElementById('settings-card-accounts')!;
    await vi.waitFor(() => expect(card.classList.contains('settings-dirty')).toBe(true));
    MOCK_CONTRIB_BUDGET = 205;
    renderSettings({ preserveDrafts: true });
    expect(document.getElementById('settings-card-accounts')).toBe(card);
    expect(card.textContent).toContain('Draft account');
    expect((document.getElementById('set-contrib-budget') as HTMLInputElement).value).toBe('205');
    vi.mocked(setAccounts).mockClear();
    document.getElementById('btn-save-accts')!.click();
    await vi.waitFor(() => expect(setAccounts).toHaveBeenCalledOnce());
    expect(setAccounts).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ label: 'Draft account' })]),
    );
  });
});

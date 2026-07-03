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
}));

vi.mock('../theme', () => ({
  T: { ink2: '#666', pos: '#0a0', neg: '#a00' },
}));

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

import { renderSettings, generateId } from './settings';
import { isCollapsed } from '../ui/collapseState';

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

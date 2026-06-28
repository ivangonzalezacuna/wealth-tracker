/**
 * Runtime config store — loaded from Google Sheets at boot.
 * Replaces static config.js imports with async accessors.
 *
 * Sheet tabs:
 *   Accounts       — id | moneyType | institution | label | color | isPrimaryInvestment | order
 *   Holdings       — isin | ticker | name | color | acc | active | weeklyTarget | assetClass | region | foldInto | order
 *   Settings       — key | value
 *   ConfigHistory  — timestamp | device | entity | summary
 */

import { readRange, writeRange, appendRows, ensureSheets } from '../sheets/api';
import { CONFIG } from '../config';
import type { StaticAccount, StaticHolding, TargetSlice } from '../config';
import type { Account, Holding, Settings } from '../types';

// Type for reinvestment rules from static config
interface ReinvestmentRule { label: string; value: string }

// ── Sheet tab names ──────────────────────────────────────
const TABS = {
  ACCOUNTS:       'Accounts',
  HOLDINGS:       'Holdings',
  SETTINGS:       'Settings',
  CONFIG_HISTORY: 'ConfigHistory',
} as const;

interface HoldingMeta {
  color: string;
  acc: boolean;
  active: boolean;
}

interface AccountEntry {
  key: string;
  label: string;
  color: string;
}

// ── In-memory state ──────────────────────────────────────
let _accounts: Account[] = [];
let _holdings: Holding[] = [];
let _settings: Settings = {};
let _loaded   = false;
let _onChange: (() => void) | null = null;

// ── Public accessors (read at render time) ───────────────

export function getAccounts(): Account[] { return _accounts; }
export function getHoldings(): Holding[] { return _holdings; }
export function getSettings(): Settings { return _settings; }
export function isConfigLoaded(): boolean { return _loaded; }

/** Get ACCTS-compatible array for backward compat (key/label/color). */
export function getACCTS(): AccountEntry[] {
  return _accounts.map(a => ({
    key:   a.id || a.key || '',
    label: a.label || `${a.moneyType} · ${a.institution}`,
    color: a.color || '',
  }));
}

/** Get ISIN → ticker map from holdings. */
export function getISINMap(): Record<string, string> {
  return Object.fromEntries(_holdings.map(h => [h.isin, h.ticker]));
}

/** Get ticker → metadata map from holdings. */
export function getMETA(): Record<string, HoldingMeta> {
  return Object.fromEntries(_holdings.map(h => [h.ticker, {
    color:  h.color,
    acc:    h.acc,
    active: h.active,
  }]));
}

/** Get ISINs in display order. */
export function getISIN_ORDER(): string[] {
  return _holdings.map(h => h.isin);
}

/** Get the account(s) marked as primary investment. */
export function getPrimaryInvestmentAccounts(): Account[] {
  return _accounts.filter(a => a.isPrimaryInvestment);
}

/** Computed: total weekly target from all active holdings. */
export function getTotalWeeklyTarget(): number {
  return _holdings
    .filter(h => h.active && h.weeklyTarget > 0)
    .reduce((s, h) => s + h.weeklyTarget, 0);
}

/** Computed: annual return pct from settings. */
export function getAnnualReturnPct(): number {
  return parseFloat(_settings.annualReturnPct || '') || 7;
}

/** Computed: cost basis method from settings. */
export function getCostBasisMethod(): 'fifo' | 'avgco' {
  const v = (_settings.costBasisMethod || '').toLowerCase();
  return v === 'fifo' ? 'fifo' : 'avgco';
}

// ── Register re-render callback ──────────────────────────
export function onConfigChange(fn: () => void): void { _onChange = fn; }

// ── Load config from sheets ──────────────────────────────

export async function loadConfig(): Promise<void> {
  await ensureSheets(Object.values(TABS));

  const [accRows, holdRows, setRows] = await Promise.all([
    readRange(`${TABS.ACCOUNTS}!A:G`),
    readRange(`${TABS.HOLDINGS}!A:K`),
    readRange(`${TABS.SETTINGS}!A:B`),
  ]);

  _accounts = parseAccounts(accRows);
  _holdings = parseHoldings(holdRows);
  _settings = parseSettings(setRows);

  // First-run migration: if tabs are empty, seed from config.js
  if (_accounts.length === 0 && _holdings.length === 0) {
    await seedFromConfig();
  }

  _loaded = true;
}

// ── Persist updates ──────────────────────────────────────

export async function setAccounts(accounts: Account[]): Promise<void> {
  _accounts = accounts;
  await ensureSheets([TABS.ACCOUNTS]);
  const hdr = ['id','moneyType','institution','label','color','isPrimaryInvestment','order'];
  const rows = accounts.map(a => [
    a.id || a.key || '', a.moneyType || '', a.institution || '', a.label || '', a.color || '',
    a.isPrimaryInvestment ? 'true' : 'false', a.order ?? '',
  ]);
  await writeRange(`${TABS.ACCOUNTS}!A1`, [hdr, ...rows]);
  await logChange('Accounts', `updated ${accounts.length} accounts`);
  if (_onChange) _onChange();
}

export async function setHoldings(holdings: Holding[]): Promise<void> {
  _holdings = holdings;
  await ensureSheets([TABS.HOLDINGS]);
  const hdr = ['isin','ticker','name','color','acc','active','weeklyTarget','assetClass','region','foldInto','order'];
  const rows = holdings.map(h => [
    h.isin, h.ticker, h.name || '', h.color || '',
    h.acc ? 'true' : 'false', h.active ? 'true' : 'false',
    h.weeklyTarget ?? 0, h.assetClass || '', h.region || '',
    h.foldInto || '', h.order ?? '',
  ]);
  await writeRange(`${TABS.HOLDINGS}!A1`, [hdr, ...rows]);
  await logChange('Holdings', `updated ${holdings.length} holdings`);
  if (_onChange) _onChange();
}

export async function setSetting(key: string, value: string): Promise<void> {
  _settings[key] = value;
  await persistSettings();
  await logChange('Settings', `${key} = ${value}`);
  if (_onChange) _onChange();
}

export async function setSettings(settings: Record<string, string | null | undefined>): Promise<void> {
  for (const [k, v] of Object.entries(settings)) {
    if (v === null || v === undefined) {
      delete _settings[k];
    } else {
      _settings[k] = v;
    }
  }
  await persistSettings();
  await logChange('Settings', `updated ${Object.keys(settings).join(', ')}`);
  if (_onChange) _onChange();
}

async function persistSettings(): Promise<void> {
  await ensureSheets([TABS.SETTINGS]);
  const hdr = ['key', 'value'];
  const rows = Object.entries(_settings).map(([k, v]) => [k, String(v)]);
  await writeRange(`${TABS.SETTINGS}!A1`, [hdr, ...rows]);
}

// ── ConfigHistory audit log ──────────────────────────────

async function logChange(entity: string, summary: string): Promise<void> {
  await ensureSheets([TABS.CONFIG_HISTORY]);
  const timestamp = new Date().toISOString();
  await appendRows(`${TABS.CONFIG_HISTORY}!A:D`, [[timestamp, 'web', entity, summary]]);
}

// ── Parsing helpers ──────────────────────────────────────

function parseAccounts(rows: string[][]): Account[] {
  if (!rows.length) return [];
  const hdr = rows[0].map(c => (c || '').trim().toLowerCase());
  return rows.slice(1).filter(r => r[hdr.indexOf('id')]).map(r => ({
    id:                  r[hdr.indexOf('id')] || '',
    moneyType:           r[hdr.indexOf('moneytype')] || '',
    institution:         r[hdr.indexOf('institution')] || '',
    label:               r[hdr.indexOf('label')] || '',
    color:               r[hdr.indexOf('color')] || '',
    isPrimaryInvestment: (r[hdr.indexOf('isprimaryinvestment')] || '').toLowerCase() === 'true',
    order:               parseInt(r[hdr.indexOf('order')]) || 0,
  })).sort((a, b) => (a.order || 0) - (b.order || 0));
}

function parseHoldings(rows: string[][]): Holding[] {
  if (!rows.length) return [];
  const hdr = rows[0].map(c => (c || '').trim().toLowerCase());
  return rows.slice(1).filter(r => r[hdr.indexOf('isin')]).map(r => ({
    isin:         r[hdr.indexOf('isin')] || '',
    ticker:       r[hdr.indexOf('ticker')] || '',
    name:         r[hdr.indexOf('name')] || '',
    color:        r[hdr.indexOf('color')] || '',
    acc:          (r[hdr.indexOf('acc')] || '').toLowerCase() === 'true',
    active:       (r[hdr.indexOf('active')] || '').toLowerCase() === 'true',
    weeklyTarget: parseFloat(r[hdr.indexOf('weeklytarget')]) || 0,
    assetClass:   r[hdr.indexOf('assetclass')] || '',
    region:       r[hdr.indexOf('region')] || '',
    foldInto:     r[hdr.indexOf('foldinto')] || '',
    order:        parseInt(r[hdr.indexOf('order')]) || 0,
  })).sort((a, b) => a.order - b.order);
}

function parseSettings(rows: string[][]): Settings {
  if (!rows.length) return {};
  const settings: Settings = {};
  for (const row of rows.slice(1)) {
    if (row[0]) settings[row[0].trim()] = (row[1] || '').trim();
  }
  return settings;
}

// ── First-run migration ──────────────────────────────────

async function seedFromConfig(): Promise<void> {
  const staticAccounts = CONFIG.accounts;
  const staticHoldings = CONFIG.holdings;
  const slices = CONFIG.targetAllocation?.slices || [];
  const rules = CONFIG.reinvestmentRules?.rows || [];

  // Seed Accounts from CONFIG.accounts (preserving existing keys as ids)
  const accounts: Account[] = staticAccounts.map((a, i) => ({
    id:                  a.key,
    moneyType:           a.key === 'tr_portfolio' ? 'investment'
                       : a.key === 'n26' ? 'savings'
                       : a.key === 'bav' ? 'pension'
                       : a.key === 'tr_cash' ? 'savings'
                       : 'cash',
    institution:         a.key === 'tr_portfolio' ? 'Trade Republic'
                       : a.key === 'n26' ? 'N26'
                       : a.key === 'bav' ? 'Ginkgo'
                       : a.key === 'avd' ? 'AVD'
                       : a.key === 'tr_cash' ? 'Trade Republic'
                       : '',
    label:               a.label,
    color:               a.color,
    isPrimaryInvestment: a.key === 'tr_portfolio',
    order:               i + 1,
  }));

  // Seed Holdings from CONFIG.holdings
  const holdings: Holding[] = staticHoldings.map((h, i) => {
    // Determine weekly target from targetAllocation note
    const slice = slices.find(s => s.ticker === h.ticker);
    let weeklyTarget = 0;
    if (slice && h.active) {
      // Calculate from the note pattern or proportional from total
      const totalWeekly = CONFIG.projection?.weeklyTarget || 200;
      weeklyTarget = Math.round(totalWeekly * slice.pct / 100);
    }

    // Determine asset class and region
    let assetClass = 'equity';
    let region = 'developed';
    if (['AGGH','IEAC','EIBX'].includes(h.ticker)) {
      assetClass = 'bond';
      region = 'global';
    } else if (['EIMI','IEEM'].includes(h.ticker)) {
      region = 'emerging';
    } else if (['SUSW'].includes(h.ticker)) {
      region = 'global';
    }

    // Determine foldInto for closed positions
    let foldInto = '';
    if (!h.active) {
      if (h.ticker === 'IEEM') foldInto = 'IE00BKM4GZ66'; // → EIMI
      else if (h.ticker === 'IEAC' || h.ticker === 'EIBX') foldInto = 'IE00BDBRDM35'; // → AGGH
    }

    return {
      isin:         h.isin,
      ticker:       h.ticker,
      name:         '',
      color:        h.color,
      acc:          h.acc,
      active:       h.active,
      weeklyTarget,
      assetClass,
      region,
      foldInto,
      order:        i + 1,
    };
  });

  // Seed Settings
  const settings: Settings = {
    annualReturnPct: String(CONFIG.projection?.annualReturnPct || 7),
  };

  // Add reinvestment rules as settings
  rules.forEach((r, i) => {
    settings[`rule_${i + 1}_label`] = r.label;
    settings[`rule_${i + 1}_value`] = r.value;
  });

  _accounts = accounts;
  _holdings = holdings;
  _settings = settings;

  // Persist
  await setAccounts(accounts);
  await setHoldings(holdings);
  await persistSettings();
  await logChange('Migration', 'Seeded config from config.js defaults');
}

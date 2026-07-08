/** Runtime config store - loads Accounts, Holdings, and Settings from local SQLite DB. */

import {
  loadAccounts as dbLoadAccounts,
  saveAccounts as dbSaveAccounts,
  loadHoldings as dbLoadHoldings,
  saveHoldings as dbSaveHoldings,
  loadSettings as dbLoadSettings,
  setSetting as dbSetSetting,
  replaceAllSettings as dbReplaceAllSettings,
  logConfigChange,
} from '../db';
import { scheduleUpload } from '../sync/engine';
import { CONFIG } from '../config';
import type { Account, Holding, Settings, ContribInterval } from '../types';
import { totalAnnualContrib, INTERVAL_PER_YEAR } from '../model/contributions';
import type { CachedConfig } from '../cache/db';

// Valid contribution intervals, derived from the canonical INTERVAL_PER_YEAR map
const VALID_INTERVALS = new Set(Object.keys(INTERVAL_PER_YEAR));

// Type for reinvestment rules from static config
interface ReinvestmentRule {
  label: string;
  value: string;
}

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
let _loaded = false;
export type ConfigChangeKind = 'accounts' | 'holdings' | 'settings';
let _onChange: ((changed: ConfigChangeKind) => void) | null = null;

// ── Public accessors (read at render time) ───────────────

export function getAccounts(): Account[] {
  return _accounts;
}
export function getHoldings(): Holding[] {
  return _holdings;
}
export function getSettings(): Settings {
  return _settings;
}
export function isConfigLoaded(): boolean {
  return _loaded;
}

/** Map accounts to the {key,label,color} shape used by chart legends. */
export function getACCTS(): AccountEntry[] {
  return _accounts.map((a) => ({
    key: a.id || a.key || '',
    label: a.label || `${a.moneyType} · ${a.institution}`,
    color: a.color || '',
  }));
}

/** Get ISIN → shortName map from holdings. */
export function getISINMap(): Record<string, string> {
  return Object.fromEntries(_holdings.map((h) => [h.isin, h.shortName]));
}

/** Get ISIN → metadata map from holdings. */
export function getMETA(): Record<string, HoldingMeta> {
  return Object.fromEntries(
    _holdings.map((h) => [
      h.isin,
      {
        color: h.color,
        acc: h.acc,
        active: h.active,
      },
    ]),
  );
}

/** Get ISINs in display order. */
export function getISIN_ORDER(): string[] {
  return _holdings.map((h) => h.isin);
}

/** Computed: total annualized contribution from all active holdings. */
export function getTotalAnnualContrib(): number {
  return totalAnnualContrib(_holdings);
}

/** Goal: target net worth (number or null if unset). */
export function getTargetNetWorth(): number | null {
  const raw = (_settings.targetNetWorth || '').replace(/\./g, '').replace(',', '.');
  const n = parseFloat(raw);
  return isNaN(n) || n <= 0 ? null : n;
}

/** Goal: target date as YYYY-MM string (or null if unset). */
export function getTargetDate(): string | null {
  const v = (_settings.targetDate || '').trim();
  return /^\d{4}-\d{2}$/.test(v) ? v : null;
}

/** Computed: cost basis method from settings. */
export function getCostBasisMethod(): 'fifo' | 'avgco' {
  const v = (_settings.costBasisMethod || '').toLowerCase();
  return v === 'fifo' ? 'fifo' : 'avgco';
}

// ── Register re-render callback ──────────────────────────
export function onConfigChange(fn: (changed: ConfigChangeKind) => void): void {
  _onChange = fn;
}

// ── Cache hydration (offline/read-only boot) ─────────────
/** Populate the store from a cached IndexedDB snapshot (offline/read-only boot). */
export function hydrateConfigFromCache(cfg: CachedConfig): void {
  _accounts = cfg.accounts || [];
  _holdings = cfg.holdings || [];
  _settings = cfg.settings || {};
  _loaded = true;
}

// ── Load config from SQLite ──────────────────────────────

export async function loadConfig(): Promise<void> {
  _accounts = await dbLoadAccounts();
  _holdings = await dbLoadHoldings();
  _settings = await dbLoadSettings();

  // First-run seed: seed each table independently when empty.
  const needSeedAccounts = _accounts.length === 0 && CONFIG.accounts.length > 0;
  const needSeedHoldings = _holdings.length === 0 && CONFIG.holdings.length > 0;
  if (needSeedAccounts || needSeedHoldings) {
    await seedFromConfig(needSeedAccounts, needSeedHoldings);
  }

  // Seed per-account annualReturnPct from the global setting if not already set.
  const legacyRate = parseFloat(_settings.annualReturnPct || '');
  if (!isNaN(legacyRate) && legacyRate > 0) {
    const primary = _accounts.filter((a) => a.isPrimaryInvestment && !a.annualReturnPct);
    if (primary.length > 0) {
      primary.forEach((a) => (a.annualReturnPct = legacyRate));
      await setAccounts(_accounts);
    }
  }

  _loaded = true;

  // Flush any pending retired account IDs
  void flushPendingRetiredIds();
}

// ── Persist updates ──────────────────────────────────────

export async function setAccounts(accounts: Account[]): Promise<void> {
  const previous = _accounts;
  _accounts = accounts;
  try {
    await dbSaveAccounts(accounts);
    await logConfigChange('Accounts', `updated ${accounts.length} accounts`);
    scheduleUpload();
    if (_onChange) _onChange('accounts');
  } catch (err) {
    _accounts = previous;
    throw err;
  }
}

export async function setHoldings(holdings: Holding[]): Promise<void> {
  const previous = _holdings;
  _holdings = holdings;
  try {
    await dbSaveHoldings(holdings);
    await logConfigChange('Holdings', `updated ${holdings.length} holdings`);
    scheduleUpload();
    if (_onChange) _onChange('holdings');
  } catch (err) {
    _holdings = previous;
    throw err;
  }
}

export async function setSetting(key: string, value: string): Promise<void> {
  const previous = { ..._settings };
  _settings[key] = value;
  try {
    await dbSetSetting(key, value);
    await logConfigChange('Settings', `${key} = ${value}`);
    scheduleUpload();
    if (_onChange) _onChange('settings');
  } catch (err) {
    _settings = previous;
    throw err;
  }
}

export async function setSettings(
  settings: Record<string, string | null | undefined>,
): Promise<void> {
  const previous = { ..._settings };
  for (const [k, v] of Object.entries(settings)) {
    if (v === null || v === undefined) {
      delete _settings[k];
    } else {
      _settings[k] = v;
    }
  }
  try {
    await persistSettings();
    await logConfigChange('Settings', `updated ${Object.keys(settings).join(', ')}`);
    scheduleUpload();
    if (_onChange) _onChange('settings');
  } catch (err) {
    _settings = previous;
    throw err;
  }
}

/** Full replace of the Settings table - used only by backup restore. */
export async function replaceSettings(settings: Settings): Promise<void> {
  const previous = _settings;
  _settings = { ...settings };
  try {
    await persistSettings();
    await logConfigChange('Settings', 'restored from backup');
    scheduleUpload();
    if (_onChange) _onChange('settings');
  } catch (err) {
    _settings = previous;
    throw err;
  }
}

async function persistSettings(): Promise<void> {
  await dbReplaceAllSettings(_settings);
}

// ── Retired account IDs ──────────────────────────────────

const RETIRED_IDS_KEY = 'retired_account_ids';

// localStorage-only queue for ids whose retireAccountIds() DB write
// failed after the account was already removed locally (setAccounts
// succeeded). Kept outside the DB-backed Settings store on purpose:
// the whole point is to survive a moment where that store's write path
// is failing. Merged into getRetiredAccountIds() so a pending id is
// treated as taken immediately, even before it reaches the DB.
const PENDING_RETIRED_IDS_KEY = 'wt_pending_retired_ids';

function getPendingRetiredIds(): string[] {
  try {
    return JSON.parse(localStorage.getItem(PENDING_RETIRED_IDS_KEY) || '[]');
  } catch {
    return [];
  }
}

function setPendingRetiredIds(ids: string[]): void {
  try {
    localStorage.setItem(PENDING_RETIRED_IDS_KEY, JSON.stringify(ids));
  } catch {
    /* quota - best effort only, flushPendingRetiredIds retries next time */
  }
}

export function getRetiredAccountIds(): string[] {
  let persisted: string[] = [];
  try {
    persisted = JSON.parse(_settings[RETIRED_IDS_KEY] || '[]');
  } catch {
    persisted = [];
  }
  return [...new Set([...persisted, ...getPendingRetiredIds()])];
}

/** Called once per deleted account from Settings, so no future account can
 *  reuse (and inherit the Snapshots column of) a retired id. Throws on
 *  failure - callers that must never lose the id on a failed write should
 *  use retireAccountIdsSafely instead. */
export async function retireAccountIds(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const existing = new Set(getRetiredAccountIds());
  for (const id of ids) if (id) existing.add(id);
  await setSetting(RETIRED_IDS_KEY, JSON.stringify([...existing]));
}

/** Retire ids without ever losing them to a failed write. If the DB
 *  write fails (e.g. error mid-write), the
 *  ids are queued in localStorage instead of being dropped - they still
 *  count as "taken" via getRetiredAccountIds() immediately, and the queue
 *  is flushed opportunistically by flushPendingRetiredIds(). Returns false
 *  (never throws) when the id had to be queued instead of persisted. */
export async function retireAccountIdsSafely(ids: string[]): Promise<boolean> {
  if (!ids.length) return true;
  try {
    await retireAccountIds(ids);
    return true;
  } catch {
    const queued = new Set([...getPendingRetiredIds(), ...ids]);
    setPendingRetiredIds([...queued]);
    return false;
  }
}

/** Best-effort retry of any ids queued by retireAccountIdsSafely. Never
 *  throws. Safe to call opportunistically (on load, after any successful
 *  settings write) - a no-op when the queue is empty. */
export async function flushPendingRetiredIds(): Promise<void> {
  const pending = getPendingRetiredIds();
  if (!pending.length) return;
  try {
    await retireAccountIds(pending);
    setPendingRetiredIds([]);
  } catch {
    // Still failing - leave queued, getRetiredAccountIds() still protects
    // against reuse in the meantime.
  }
}

// ── Parsing helpers (retained for backup import compatibility) ────

/** Normalize a value that may arrive as boolean or string to a boolean. */
const toBool = (v: unknown) =>
  v === true ||
  String(v ?? '')
    .trim()
    .toLowerCase() === 'true';

/** Normalize a value that may arrive as number or string to a number. */
const toNum = (v: unknown) => (typeof v === 'number' ? v : parseFloat(String(v ?? '')) || 0);

export function parseAccounts(rows: (string | number | boolean)[][]): Account[] {
  if (!rows.length) return [];
  const hdr = rows[0].map((c) => (c || '').toString().trim().toLowerCase());
  return rows
    .slice(1)
    .filter((r) => r[hdr.indexOf('id')])
    .map((r) => ({
      id: String(r[hdr.indexOf('id')] ?? ''),
      moneyType: String(r[hdr.indexOf('moneytype')] ?? ''),
      institution: String(r[hdr.indexOf('institution')] ?? ''),
      label: String(r[hdr.indexOf('label')] ?? ''),
      color: String(r[hdr.indexOf('color')] ?? ''),
      isPrimaryInvestment: toBool(r[hdr.indexOf('isprimaryinvestment')]),
      order: toNum(r[hdr.indexOf('order')]),
      annualReturnPct: toNum(r[hdr.indexOf('annualreturnpct')]),
      contribAmount: toNum(r[hdr.indexOf('contribamount')]),
      contribInterval: (VALID_INTERVALS.has(
        String(r[hdr.indexOf('contribinterval')] ?? '')
          .trim()
          .toLowerCase(),
      )
        ? String(r[hdr.indexOf('contribinterval')]).trim().toLowerCase()
        : 'monthly') as ContribInterval,
    }))
    .sort((a, b) => (a.order || 0) - (b.order || 0));
}

// ── First-run seed ───────────────────────────────────────

async function seedFromConfig(seedAccounts: boolean, seedHoldings: boolean): Promise<void> {
  const staticAccounts = CONFIG.accounts;
  const staticHoldings = CONFIG.holdings;
  const slices = CONFIG.targetAllocation?.slices || [];
  const rules = CONFIG.reinvestmentRules?.rows || [];

  // Seed Accounts from CONFIG.accounts when requested and source is non-empty
  if (seedAccounts && staticAccounts.length > 0) {
    const accounts: Account[] = staticAccounts.map((a, i) => ({
      id: a.key,
      moneyType: 'cash',
      institution: '',
      label: a.label,
      color: a.color,
      isPrimaryInvestment: false,
      order: i + 1,
    }));
    _accounts = accounts;
    await setAccounts(accounts);
  }

  // Seed Holdings from CONFIG.holdings when requested and source is non-empty
  if (seedHoldings && staticHoldings.length > 0) {
    const holdings: Holding[] = staticHoldings.map((h, i) => {
      const slice = slices.find((s) => s.isin === h.isin || s.shortName === h.shortName);
      let contribAmount = h.contribAmount || 0;
      if (!contribAmount && slice && h.active) {
        const totalWeekly = CONFIG.projection?.weeklyTarget || 200;
        contribAmount = Math.round((totalWeekly * slice.pct) / 100);
      }
      const contribInterval: ContribInterval = h.interval || 'weekly';
      const assetClass = h.assetClass || 'equity';
      const region = h.region || 'developed';
      const foldInto = h.foldInto || '';

      return {
        isin: h.isin,
        name: '',
        shortName: h.shortName,
        color: h.color,
        acc: h.acc,
        active: h.active,
        contribAmount,
        contribInterval,
        assetClass,
        region,
        foldInto,
        order: i + 1,
      };
    });
    _holdings = holdings;
    await setHoldings(holdings);
  }

  // Seed Settings (only on first-run when both were empty)
  if (seedAccounts && seedHoldings) {
    const settings: Settings = {
      annualReturnPct: String(CONFIG.projection?.annualReturnPct || 7),
    };
    rules.forEach((r, i) => {
      settings[`rule_${i + 1}_label`] = r.label;
      settings[`rule_${i + 1}_value`] = r.value;
    });
    _settings = settings;
    await persistSettings();
  }

  await logConfigChange(
    'Migration',
    `Seeded config from config.js defaults (accounts=${seedAccounts}, holdings=${seedHoldings})`,
  );
}

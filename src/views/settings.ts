// @ts-nocheck — DOM-heavy view; full strict typing deferred to framework migration
import {
  getAccounts,
  getHoldings,
  getSettings,
  setAccounts,
  setHoldings,
  setSettings,
  setSetting,
  isConfigLoaded,
  getCostBasisMethod,
  getTargetNetWorth,
  getTargetDate,
} from '../store/config';
import { loadTransactions } from '../sheets/transactions';
import { validatePrimaryInvestment } from '../model/accounts';
import { validateHoldings } from '../model/holdings';
import { INTERVAL_LABELS } from '../model/contributions';
import { showMsg } from '../utils';
import type { Account, Holding, Settings, ContribInterval } from '../types';
import { resolvedT } from '../theme';
import { isCollapsed, toggleCollapsed } from '../ui/collapseState';
import { infoTip, attachInfoTips } from '../ui/infoTip';
import { confirmDialog } from '../ui/confirmDialog';

/** Card key -> render fn, used by repaintCard() to scope a re-render to one card. */
type CardKey = 'accounts' | 'holdings' | 'cost-basis' | 'goal' | 'rules' | 'cache';

/** Re-render exactly one Settings card in place; re-attach only its own
 *  listeners; reapply its persisted collapse state. Touches no sibling card. */
function repaintCard(key: CardKey): void {
  const id = `settings-card-${key}`;
  const existing = document.getElementById(id);
  if (!existing) return; // settings not currently rendered - nothing to do

  const accounts = getAccounts();
  const holdings = getHoldings();
  const settings = getSettings();

  let html: string;
  switch (key) {
    case 'accounts':
      html = renderAccountsCard(accounts);
      break;
    case 'holdings':
      html = renderHoldingsCard(holdings);
      break;
    case 'cost-basis':
      html = renderCostBasisCard(settings);
      break;
    case 'goal':
      html = renderGoalCard(settings);
      break;
    case 'rules':
      html = renderRulesCard(settings);
      break;
    case 'cache':
      html = renderCacheCard();
      break;
  }

  existing.outerHTML = html;
  const fresh = document.getElementById(id);
  if (!fresh) return;

  switch (key) {
    case 'accounts':
      attachAccountListeners(fresh);
      break;
    case 'holdings':
      attachHoldingListeners(fresh);
      attachColorPickerSync(fresh);
      break;
    case 'cost-basis':
      attachCostBasisListeners(fresh);
      break;
    case 'goal':
      attachGoalListeners(fresh);
      break;
    case 'rules':
      attachRulesListeners(fresh);
      break;
    case 'cache':
      attachCacheListeners(fresh);
      break;
  }
  attachCardCollapseListeners(fresh);
  if (isCollapsed('card:' + key)) fresh.classList.add('collapsed');
  attachInfoTips(fresh);
}

/**
 * Render the Settings section — user-friendly forms for Accounts, Holdings, Settings.
 * Only shown after config is loaded (sign-in required).
 */
export function renderSettings(): void {
  const el = document.getElementById('settings-content');
  if (!el) return;

  if (!isConfigLoaded()) {
    el.innerHTML = '<p class="note">Sign in and load data to manage settings.</p>';
    return;
  }

  const accounts = getAccounts();
  const holdings = getHoldings();
  const settings = getSettings();

  el.innerHTML = `
    ${renderAccountsCard(accounts)}
    ${renderHoldingsCard(holdings)}
    ${renderCostBasisCard(settings)}
    ${renderGoalCard(settings)}
    ${renderRulesCard(settings)}
    ${renderCacheCard()}
  `;

  attachAccountListeners(el);
  attachHoldingListeners(el);
  attachCostBasisListeners(el);
  attachGoalListeners(el);
  attachRulesListeners(el);
  attachCacheListeners(el);
  attachColorPickerSync(el);
  attachCardCollapseListeners(el);

  // Reapply persisted collapse state after re-render
  el.querySelectorAll('.card-collapsible').forEach((card) => {
    const key = (card as HTMLElement).dataset.cardKey;
    if (key && isCollapsed('card:' + key)) card.classList.add('collapsed');
  });

  attachInfoTips(el);
}

// ── Accounts ──────────────────────────────────────────────

const ACCOUNT_TYPES = [
  { value: 'investment', label: 'Investment' },
  { value: 'savings', label: 'Savings' },
  { value: 'pension', label: 'Pension' },
  { value: 'cash', label: 'Cash' },
];

function renderAccountsCard(accounts: Account[]): string {
  const rows = accounts.map((a, i) => renderAccountRow(a, i)).join('');

  return `
    <div class="card card-collapsible" id="settings-card-accounts" data-card-key="accounts">
      <div class="card-header js-card-toggle">
        <div class="card-title">Accounts</div>
        <span class="card-chevron"></span>
      </div>
      <div class="card-body">
        <p class="note" style="margin-bottom:.75rem">Accounts tracked in each monthly net-worth snapshot. Add one row per bank account or portfolio.</p>
        <div id="settings-accounts-tbl" class="settings-items">
          ${rows}
        </div>
        <div style="display:flex;gap:10px;margin-top:.75rem;flex-wrap:wrap">
          <button class="btn btn-outline btn-sm" id="btn-add-acct">+ Add account</button>
          <button class="btn btn-primary btn-sm" id="btn-save-accts">Save accounts</button>
          <span id="accts-msg" style="font-size:12px;line-height:28px"></span>
        </div>
      </div>
    </div>`;
}

function renderAccountRow(a: Account, i: number): string {
  const typeOptions = ACCOUNT_TYPES.map(
    (t) =>
      `<option value="${t.value}" ${a.moneyType === t.value ? 'selected' : ''}>${t.label}</option>`,
  ).join('');

  return `
    <div class="settings-item settings-acct-row item-collapsible" data-idx="${i}">
      <div class="settings-item-header js-item-toggle">
        <span class="leg-sq" style="background:${esc(a.color) || 'var(--ink-4)'};flex-shrink:0"></span>
        <span class="settings-item-title">${esc(a.label) || 'New account'}</span>
        <span style="font-size:11px;color:var(--ink-3);white-space:nowrap" class="settings-item-meta">${esc(ACCOUNT_TYPES.find((t) => t.value === a.moneyType)?.label || a.moneyType)}${a.isPrimaryInvestment ? ' \u00B7 Primary' : ''}</span>
        <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
          <span class="item-chevron"></span>
          <button class="btn btn-sm btn-danger js-del-acct" data-idx="${i}">\u2715</button>
        </div>
      </div>
      <div class="settings-item-fields">
        <div class="settings-field">
          <label class="settings-field-label">Name</label>
          <input class="form-input form-input-sm" data-field="label" value="${esc(a.label)}" placeholder="e.g. Main ETF portfolio">
        </div>
        <div class="settings-field">
          <label class="settings-field-label">Type</label>
          <select class="form-input form-input-sm" data-field="moneyType">${typeOptions}</select>
        </div>
        <div class="settings-field">
          <label class="settings-field-label">Institution</label>
          <input class="form-input form-input-sm" data-field="institution" value="${esc(a.institution)}" placeholder="e.g. Trade Republic">
        </div>
        <div class="settings-field">
          <label class="settings-field-label">Color</label>
          <div class="color-picker-wrap">
            <input type="color" class="color-picker-swatch" data-field="color" value="${esc(a.color)}">
            <input class="form-input form-input-sm color-picker-hex" data-field="color-hex" value="${esc(a.color)}" placeholder="#888888" maxlength="7">
          </div>
        </div>
        <div class="settings-field">
          <label class="settings-field-label">Annual return assumption (%)${infoTip("Used for this account's slice of the 5-year forecast on the Net Worth tab. Cash/savings are typically 0% unless they earn interest.")}</label>
          <input class="form-input form-input-sm" data-field="annualReturnPct" type="number" min="0" max="30" step="0.1" value="${esc(String(a.annualReturnPct ?? 0))}">
        </div>
        <div class="js-contrib-note" style="${a.isPrimaryInvestment ? '' : 'display:none'}">
          <p class="note" style="grid-column:1/-1">Contribution amount for the primary investment account comes from the ETF contribution plan in the Holdings card below, not from this account row.</p>
        </div>
        <div class="js-contrib-fields" style="${a.isPrimaryInvestment ? 'display:none' : 'display:contents'}">
        <div class="settings-field">
          <label class="settings-field-label">Recurring contribution (\u20AC per execution)</label>
          <input class="form-input form-input-sm" data-field="contribAmount" type="number" min="0" step="1" value="${esc(String(a.contribAmount ?? 0))}">
        </div>
        <div class="settings-field">
          <label class="settings-field-label">Contribution interval</label>
          <select class="form-input form-input-sm" data-field="contribInterval">
            ${Object.entries(INTERVAL_LABELS)
              .map(
                ([k, label]) =>
                  `<option value="${k}" ${a.contribInterval === k ? 'selected' : ''}>${label}</option>`,
              )
              .join('')}
          </select>
        </div>
        </div>
        <div class="settings-field settings-field-inline">
          <label class="settings-field-label" style="cursor:pointer"><input type="checkbox" data-field="isPrimaryInvestment" ${a.isPrimaryInvestment ? 'checked' : ''}> Primary investment${infoTip('Used to split net-worth growth into contributions vs market returns. Only investment-type accounts (broker, depot) should be marked.')}</label>
        </div>
      </div>
      <input type="hidden" data-field="id" value="${esc(a.id)}">
    </div>`;
}

/** Bind change listeners on isPrimaryInvestment checkboxes to dynamically show/hide contribution fields. */
function attachPrimaryToggleListeners(scope: Element): void {
  scope.querySelectorAll('[data-field="isPrimaryInvestment"]').forEach((cb) => {
    cb.addEventListener('change', () => {
      const row = cb.closest('.settings-acct-row');
      if (!row) return;
      const note = row.querySelector('.js-contrib-note') as HTMLElement | null;
      const fields = row.querySelector('.js-contrib-fields') as HTMLElement | null;
      if (note) note.style.display = cb.checked ? '' : 'none';
      if (fields) fields.style.display = cb.checked ? 'none' : 'contents';
    });
  });
}

function attachAccountListeners(root: HTMLElement): void {
  attachPrimaryToggleListeners(root);
  root.querySelector('#btn-add-acct')?.addEventListener('click', () => {
    const accounts = collectAccounts(root);
    accounts.push({
      id: '',
      moneyType: 'cash',
      institution: '',
      label: '',
      color: '#888888',
      isPrimaryInvestment: false,
      order: accounts.length + 1,
    });
    rerenderAccountsTable(root, accounts);
  });

  root.querySelector('#btn-save-accts')?.addEventListener('click', async () => {
    const accounts = collectAccounts(root);
    if (accounts.some((a) => !a.label)) {
      showMsg('accts-msg', 'Each account needs a name.', false);
      return;
    }
    const primErr = validatePrimaryInvestment(accounts);
    if (primErr) {
      showMsg('accts-msg', primErr, false);
      return;
    }
    // Auto-generate IDs for accounts that don't have one
    for (const a of accounts) {
      if (!a.id) {
        a.id = generateId(a.label);
      }
    }
    try {
      await setAccounts(accounts);
      showMsg('accts-msg', 'Saved', true);
    } catch (err) {
      showMsg('accts-msg', 'Error: ' + err.message, false);
    }
  });

  root.querySelectorAll('.js-del-acct').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const accounts = collectAccounts(root);
      const idx = parseInt(btn.dataset.idx);
      const a = accounts[idx];
      const ok = await confirmDialog({
        title: `Remove ${esc(a?.label || 'this account')}?`,
        body: 'This removes it from your configuration. Historical data already saved to Google Sheets is not affected.',
        confirmLabel: 'Remove',
        danger: true,
      });
      if (!ok) return;
      accounts.splice(idx, 1);
      rerenderAccountsTable(root, accounts);
    });
  });
}

function collectAccounts(root: HTMLElement): Account[] {
  const rows = root.querySelectorAll('.settings-acct-row');
  return [...rows].map((row, i) => {
    const isPrimary = row.querySelector('[data-field="isPrimaryInvestment"]').checked;
    const contribEl = row.querySelector('[data-field="contribAmount"]');
    const intervalEl = row.querySelector('[data-field="contribInterval"]');
    return {
      id: row.querySelector('[data-field="id"]').value.trim(),
      moneyType: row.querySelector('[data-field="moneyType"]').value.trim(),
      institution: row.querySelector('[data-field="institution"]').value.trim(),
      label: row.querySelector('[data-field="label"]').value.trim(),
      color: row.querySelector('[data-field="color"]').value.trim(),
      isPrimaryInvestment: isPrimary,
      order: i + 1,
      annualReturnPct: parseFloat(row.querySelector('[data-field="annualReturnPct"]').value) || 0,
      // Primary investment contribution comes from Holdings, so zero out its per-account fields.
      contribAmount: isPrimary ? 0 : parseFloat(contribEl?.value) || 0,
      contribInterval: isPrimary
        ? 'monthly'
        : contribEl
          ? intervalEl?.value || 'monthly'
          : 'monthly',
    };
  });
}

function rerenderAccountsTable(root: HTMLElement, accounts: Account[]): void {
  const tbl = root.querySelector('#settings-accounts-tbl');
  if (!tbl) return;
  const rows = accounts.map((a, i) => renderAccountRow(a, i)).join('');
  tbl.innerHTML = rows;
  attachColorPickerSync(tbl);
  attachPrimaryToggleListeners(tbl);
  attachItemCollapseListeners(tbl);
  tbl.querySelectorAll('.js-del-acct').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const accs = collectAccounts(root);
      const idx = parseInt(btn.dataset.idx);
      const a = accs[idx];
      const ok = await confirmDialog({
        title: `Remove ${esc(a?.label || 'this account')}?`,
        body: 'This removes it from your configuration. Historical data already saved to Google Sheets is not affected.',
        confirmLabel: 'Remove',
        danger: true,
      });
      if (!ok) return;
      accs.splice(idx, 1);
      rerenderAccountsTable(root, accs);
    });
  });
}

// ── Holdings ──────────────────────────────────────────────

let _holdingsSettingsFilter = 'all'; // 'all' | 'active' | 'closed'
let _allHoldings: Holding[] | null = null; // cached full holdings list for filtered views

const ASSET_CLASSES = [
  { value: 'equity', label: 'Equity' },
  { value: 'bond', label: 'Bond' },
  { value: 'reit', label: 'REIT' },
  { value: 'commodity', label: 'Commodity' },
  { value: 'other', label: 'Other' },
];

const REGIONS = [
  { value: 'developed', label: 'Developed' },
  { value: 'emerging', label: 'Emerging' },
  { value: 'global', label: 'Global' },
  { value: 'europe', label: 'Europe' },
  { value: 'us', label: 'US' },
  { value: 'other', label: 'Other' },
];

function renderHoldingsCard(holdings: Holding[]): string {
  // Cache the full list for merge-back when filter is active
  _allHoldings = holdings.slice();

  const activeCount = holdings.filter((h) => h.active).length;
  const closedCount = holdings.filter((h) => !h.active).length;

  // Apply filter
  let filtered;
  if (_holdingsSettingsFilter === 'active') {
    filtered = holdings.filter((h) => h.active);
  } else if (_holdingsSettingsFilter === 'closed') {
    filtered = holdings.filter((h) => !h.active);
  } else {
    filtered = holdings;
  }

  const rows = filtered
    .map((h, i) => {
      // Store original index so delete/edit operations target the right holding
      const origIdx = holdings.indexOf(h);
      return renderHoldingRow(h, origIdx);
    })
    .join('');

  return `
    <div class="card card-collapsible" id="settings-card-holdings" data-card-key="holdings">
      <div class="card-header js-card-toggle">
        <div class="card-title">Holdings (ETFs)</div>
        <span class="card-chevron"></span>
      </div>
      <div class="card-body">
        <p class="note" style="margin-bottom:.75rem">ETF positions in your portfolio. Active holdings receive contributions on their configured schedule (weekly, biweekly, monthly, or quarterly). Closed positions can be folded into a successor fund.</p>
        <div class="filter-bar" style="margin-bottom:8px">
          <div class="range-toggle" id="hold-filter-toggle">
            <button class="btn btn-sm btn-ghost ${_holdingsSettingsFilter === 'all' ? 'active' : ''}" data-hfilter="all">All (${holdings.length})</button>
            <button class="btn btn-sm btn-ghost ${_holdingsSettingsFilter === 'active' ? 'active' : ''}" data-hfilter="active">Active (${activeCount})</button>
            <button class="btn btn-sm btn-ghost ${_holdingsSettingsFilter === 'closed' ? 'active' : ''}" data-hfilter="closed">Closed (${closedCount})</button>
          </div>
        </div>
        <div id="settings-holdings-tbl" class="settings-items">
          ${rows}
        </div>
        <div style="display:flex;gap:10px;margin-top:.75rem;flex-wrap:wrap">
          <button class="btn btn-outline btn-sm" id="btn-add-hold">+ Add holding</button>
          <button class="btn btn-outline btn-sm" id="btn-autofill-holds">Auto-fill from transactions</button>
          <button class="btn btn-primary btn-sm" id="btn-save-holds">Save holdings</button>
          <span id="holds-msg" style="font-size:12px;line-height:28px"></span>
        </div>
      </div>
    </div>`;
}

function renderHoldingRow(h: Holding, i: number): string {
  const classOptions = ASSET_CLASSES.map(
    (c) =>
      `<option value="${c.value}" ${h.assetClass === c.value ? 'selected' : ''}>${c.label}</option>`,
  ).join('');
  const regionOptions = REGIONS.map(
    (r) =>
      `<option value="${r.value}" ${h.region === r.value ? 'selected' : ''}>${r.label}</option>`,
  ).join('');
  const intervalOptions = Object.entries(INTERVAL_LABELS)
    .map(
      ([val, label]) =>
        `<option value="${val}" ${h.interval === val ? 'selected' : ''}>${label}</option>`,
    )
    .join('');

  const statusBadge = h.active
    ? '<span class="badge b-active">Active</span>'
    : '<span class="badge b-closed">Closed</span>';

  return `
    <div class="settings-item settings-hold-row item-collapsible" data-idx="${i}">
      <div class="settings-item-header js-item-toggle">
        <span class="leg-sq" style="background:${esc(h.color) || 'var(--ink-4)'};flex-shrink:0"></span>
        <span class="settings-item-title">${esc(h.ticker) || esc(h.isin) || 'New holding'}</span>
        <span style="font-size:11px;color:var(--ink-3);white-space:nowrap" class="settings-item-meta">${h.acc ? 'Acc' : 'Dist'}</span>
        ${statusBadge}
        <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
          <span class="item-chevron"></span>
          <button class="btn btn-sm btn-danger js-del-hold" data-idx="${i}">\u2715</button>
        </div>
      </div>
      <div class="settings-item-fields">
        <div class="settings-field">
          <label class="settings-field-label">ISIN${infoTip('International Securities Identification Number — 12-character unique ID for a financial instrument.')}</label>
          <input class="form-input form-input-sm" data-field="isin" value="${esc(h.isin)}" placeholder="e.g. IE00B4L5Y983">
        </div>
        <div class="settings-field">
          <label class="settings-field-label">Ticker</label>
          <input class="form-input form-input-sm" data-field="ticker" value="${esc(h.ticker)}" placeholder="e.g. IWDA">
        </div>
        <div class="settings-field">
          <label class="settings-field-label">Asset class</label>
          <select class="form-input form-input-sm" data-field="assetClass">${classOptions}</select>
        </div>
        <div class="settings-field">
          <label class="settings-field-label">Region</label>
          <select class="form-input form-input-sm" data-field="region">${regionOptions}</select>
        </div>
        <div class="settings-field">
          <label class="settings-field-label">Contribution (€)</label>
          <input class="form-input form-input-sm" data-field="contribAmount" value="${h.contribAmount || ''}" type="number" min="0" placeholder="0">
        </div>
        <div class="settings-field">
          <label class="settings-field-label">Interval</label>
          <select class="form-input form-input-sm" data-field="interval">${intervalOptions}</select>
        </div>
        <div class="settings-field">
          <label class="settings-field-label">Successor ISIN${infoTip('When an ETF merges into another, enter the new ISIN here. Transactions are consolidated under the successor.')}</label>
          <input class="form-input form-input-sm" data-field="foldInto" value="${esc(h.foldInto)}" placeholder="ISIN of successor">
        </div>
        <div class="settings-field">
          <label class="settings-field-label">Color</label>
          <div class="color-picker-wrap">
            <input type="color" class="color-picker-swatch" data-field="color" value="${esc(h.color)}">
            <input class="form-input form-input-sm color-picker-hex" data-field="color-hex" value="${esc(h.color)}" placeholder="#888888" maxlength="7">
          </div>
        </div>
        <div class="settings-field settings-field-inline">
          <label class="settings-field-label" style="cursor:pointer"><input type="checkbox" data-field="acc" ${h.acc ? 'checked' : ''}> Accumulating${infoTip('Acc (accumulating) ETFs reinvest dividends internally. Dist (distributing) ETFs pay dividends to your account.')}</label>
        </div>
        <div class="settings-field settings-field-inline">
          <label class="settings-field-label" style="cursor:pointer"><input type="checkbox" data-field="active" ${h.active ? 'checked' : ''}> Active</label>
        </div>
      </div>
    </div>`;
}

/**
 * Scoped repaint: rewrite only the holdings table rows and filter-button
 * active state. Does NOT touch sibling cards, so collapse state is preserved.
 */
function applyHoldingsFilter(root: HTMLElement): void {
  const all = _allHoldings ?? getHoldings();
  let filtered: Holding[];
  if (_holdingsSettingsFilter === 'active') filtered = all.filter((h) => h.active);
  else if (_holdingsSettingsFilter === 'closed') filtered = all.filter((h) => !h.active);
  else filtered = all;

  const tbl = root.querySelector('#settings-holdings-tbl');
  if (tbl) {
    tbl.innerHTML = filtered
      .map((h) => {
        const origIdx = all.indexOf(h);
        return renderHoldingRow(h, origIdx);
      })
      .join('');
    attachColorPickerSync(tbl as HTMLElement);
    attachItemCollapseListeners(tbl as HTMLElement);
    (tbl as HTMLElement).querySelectorAll('.js-del-hold').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const holds = collectHoldings(root);
        const idx = parseInt((btn as HTMLElement).dataset.idx!);
        const h = holds[idx];
        const ok = await confirmDialog({
          title: `Remove ${esc(h?.ticker || h?.isin || 'this holding')}?`,
          body: 'This removes it from your configuration. Historical data already saved to Google Sheets is not affected.',
          confirmLabel: 'Remove',
          danger: true,
        });
        if (!ok) return;
        holds.splice(idx, 1);
        rerenderHoldingsTable(root, holds);
      });
    });
  }

  // Update filter-button active state and counts
  const activeCount = all.filter((h) => h.active).length;
  const closedCount = all.filter((h) => !h.active).length;
  root.querySelectorAll('#hold-filter-toggle [data-hfilter]').forEach((b) => {
    b.classList.toggle('active', (b as HTMLElement).dataset.hfilter === _holdingsSettingsFilter);
    if ((b as HTMLElement).dataset.hfilter === 'all') b.textContent = `All (${all.length})`;
    if ((b as HTMLElement).dataset.hfilter === 'active') b.textContent = `Active (${activeCount})`;
    if ((b as HTMLElement).dataset.hfilter === 'closed') b.textContent = `Closed (${closedCount})`;
  });
}

function attachHoldingListeners(root: HTMLElement): void {
  // Filter toggle — scoped repaint, does NOT rebuild sibling cards
  const filterToggle = root.querySelector('#hold-filter-toggle');
  if (filterToggle) {
    filterToggle.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('[data-hfilter]') as HTMLElement | null;
      if (!btn) return;
      _holdingsSettingsFilter = btn.dataset.hfilter || 'all';
      applyHoldingsFilter(root);
    });
  }

  root.querySelector('#btn-add-hold')?.addEventListener('click', () => {
    const holds = collectHoldings(root);
    holds.push({
      isin: '',
      ticker: '',
      name: '',
      color: '#888888',
      acc: true,
      active: true,
      contribAmount: 0,
      interval: 'weekly' as ContribInterval,
      assetClass: 'equity',
      region: 'developed',
      foldInto: '',
      order: holds.length + 1,
    });
    rerenderHoldingsTable(root, holds);
  });

  root.querySelector('#btn-autofill-holds')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    btn.disabled = true;
    const origText = btn.textContent || '';
    btn.innerHTML = '<span class="spinner"></span> Loading\u2026';
    try {
      const txs = await loadTransactions();
      const buys = txs.filter((t) => t.type === 'BUY' && (t.isin || t.symbol));
      if (buys.length === 0) {
        showMsg('holds-msg', 'No BUY transactions found. Import a CSV first.', false);
        return;
      }
      // Determine cutoff: ISINs with buys in the last 3 months are "active"
      const latestDate = buys.reduce((max, t) => (t.date > max ? t.date : max), '');
      const cutoff = subtractMonths(latestDate, 3);
      // Extract unique ISIN→name mapping and track latest tx date per ISIN
      const isinMap = {};
      const isinLatest = {};
      for (const tx of buys) {
        const sym = tx.isin || tx.symbol;
        if (!isinMap[sym]) {
          isinMap[sym] = tx.name || '';
        }
        if (!isinLatest[sym] || tx.date > isinLatest[sym]) {
          isinLatest[sym] = tx.date;
        }
      }
      // Merge with existing holdings (skip already-configured ISINs)
      const holds = collectHoldings(root);
      const existing = new Set(holds.map((h) => h.isin));
      let added = 0;
      for (const [isin, name] of Object.entries(isinMap)) {
        if (existing.has(isin)) continue;
        const parsed = parseHoldingName(name, isin);
        const isActive = (isinLatest[isin] || '') >= cutoff;
        holds.push({
          isin,
          ticker: parsed.ticker,
          name: '',
          color: randomColor(),
          acc: parsed.acc,
          active: isActive,
          contribAmount: 0,
          interval: 'weekly' as ContribInterval,
          assetClass: parsed.assetClass,
          region: parsed.region,
          foldInto: '',
          order: holds.length + 1,
        });
        added++;
      }
      rerenderHoldingsTable(root, holds);
      showMsg(
        'holds-msg',
        added > 0
          ? `Added ${added} holding(s) from transactions. Review and save.`
          : 'All transaction ISINs already configured.',
        true,
      );
    } catch (err) {
      showMsg('holds-msg', 'Error: ' + err.message, false);
    } finally {
      btn.disabled = false;
      btn.textContent = origText;
    }
  });

  root.querySelector('#btn-save-holds')?.addEventListener('click', async () => {
    const holds = collectHoldings(root);
    if (holds.some((h) => !h.isin || !h.ticker)) {
      showMsg('holds-msg', 'Each holding needs an ISIN and ticker.', false);
      return;
    }
    const valErrors = validateHoldings(holds);
    if (valErrors.length > 0) {
      showMsg('holds-msg', valErrors[0].message, false);
      return;
    }
    try {
      await setHoldings(holds);
      showMsg('holds-msg', 'Saved', true);
    } catch (err) {
      showMsg('holds-msg', 'Error: ' + err.message, false);
    }
  });

  root.querySelectorAll('.js-del-hold').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const holds = collectHoldings(root);
      const idx = parseInt(btn.dataset.idx);
      const h = holds[idx];
      const ok = await confirmDialog({
        title: `Remove ${esc(h?.ticker || h?.isin || 'this holding')}?`,
        body: 'This removes it from your configuration. Historical data already saved to Google Sheets is not affected.',
        confirmLabel: 'Remove',
        danger: true,
      });
      if (!ok) return;
      holds.splice(idx, 1);
      rerenderHoldingsTable(root, holds);
    });
  });
}

function collectHoldings(root: HTMLElement): Holding[] {
  const rows = root.querySelectorAll('.settings-hold-row');
  const fromDOM = [...rows].map((row) => ({
    idx: parseInt(row.dataset.idx),
    isin: row.querySelector('[data-field="isin"]').value.trim(),
    ticker: row.querySelector('[data-field="ticker"]').value.trim(),
    name: '',
    color: row.querySelector('[data-field="color"]').value.trim(),
    acc: row.querySelector('[data-field="acc"]').checked,
    active: row.querySelector('[data-field="active"]').checked,
    contribAmount: parseFloat(row.querySelector('[data-field="contribAmount"]').value) || 0,
    interval: (row.querySelector('[data-field="interval"]').value.trim() ||
      'weekly') as ContribInterval,
    assetClass: row.querySelector('[data-field="assetClass"]').value.trim(),
    region: row.querySelector('[data-field="region"]').value.trim(),
    foldInto: row.querySelector('[data-field="foldInto"]').value.trim(),
  }));

  // When no filter is active or no cached list, return DOM rows directly
  if (_holdingsSettingsFilter === 'all' || !_allHoldings) {
    return fromDOM.map((h, i) => {
      const { idx, ...rest } = h;
      return { ...rest, order: i + 1 };
    });
  }

  // Merge DOM edits back into the full cached list
  const merged = _allHoldings.slice();
  for (const h of fromDOM) {
    const { idx, ...rest } = h;
    if (idx >= 0 && idx < merged.length) {
      merged[idx] = { ...rest, order: idx + 1 };
    }
  }
  // Re-number order
  merged.forEach((h, i) => {
    h.order = i + 1;
  });
  return merged;
}

function rerenderHoldingsTable(root: HTMLElement, holdings: Holding[]): void {
  // Update cache and reset filter to show all when modifying
  _allHoldings = holdings.slice();
  _holdingsSettingsFilter = 'all';
  const tbl = root.querySelector('#settings-holdings-tbl');
  if (!tbl) return;
  const rows = holdings.map((h, i) => renderHoldingRow(h, i)).join('');
  tbl.innerHTML = rows;
  // Update filter counts
  const toggle = root.querySelector('#hold-filter-toggle');
  if (toggle) {
    const activeCount = holdings.filter((h) => h.active).length;
    const closedCount = holdings.filter((h) => !h.active).length;
    const btns = toggle.querySelectorAll('[data-hfilter]');
    btns.forEach((b) => {
      b.classList.toggle('active', b.dataset.hfilter === 'all');
      if (b.dataset.hfilter === 'all') b.textContent = `All (${holdings.length})`;
      if (b.dataset.hfilter === 'active') b.textContent = `Active (${activeCount})`;
      if (b.dataset.hfilter === 'closed') b.textContent = `Closed (${closedCount})`;
    });
  }
  attachColorPickerSync(tbl);
  attachItemCollapseListeners(tbl);
  tbl.querySelectorAll('.js-del-hold').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const h = collectHoldings(root);
      const idx = parseInt(btn.dataset.idx);
      const hold = h[idx];
      const ok = await confirmDialog({
        title: `Remove ${esc(hold?.ticker || hold?.isin || 'this holding')}?`,
        body: 'This removes it from your configuration. Historical data already saved to Google Sheets is not affected.',
        confirmLabel: 'Remove',
        danger: true,
      });
      if (!ok) return;
      h.splice(idx, 1);
      rerenderHoldingsTable(root, h);
    });
  });
}

// ── Cost-basis method ───────────────────────────────────

function renderCostBasisCard(settings: Settings): string {
  const current = getCostBasisMethod();

  return `
    <div class="card card-collapsible" id="settings-card-cost-basis" data-card-key="cost-basis">
      <div class="card-header js-card-toggle">
        <div class="card-title">Cost-basis method</div>
        <span class="card-chevron"></span>
      </div>
      <div class="card-body">
        <p class="note" style="margin-bottom:.75rem">Choose how realized gains are calculated when you sell shares.</p>
        <div class="form-grid" style="max-width:500px">
          <div class="form-group">
            <label class="form-label">Method</label>
            <select class="form-input" id="set-cost-basis-method">
              <option value="avgco" ${current === 'avgco' ? 'selected' : ''}>Average cost</option>
              <option value="fifo" ${current === 'fifo' ? 'selected' : ''}>FIFO (first in, first out)</option>
            </select>
            <span class="note">FIFO matches the German Abgeltungsteuer ordering rule. Average cost is simpler but may diverge on partial sells.</span>
          </div>
        </div>
        <div style="display:flex;gap:10px;margin-top:.75rem">
          <button class="btn btn-primary btn-sm" id="btn-save-cost-basis">Save cost-basis method</button>
          <span id="costbasis-msg" style="font-size:12px;line-height:28px"></span>
        </div>
      </div>
    </div>`;
}

function attachCostBasisListeners(root: HTMLElement): void {
  root.querySelector('#btn-save-cost-basis')?.addEventListener('click', async () => {
    const method = root.querySelector('#set-cost-basis-method')?.value || 'avgco';
    try {
      await setSetting('costBasisMethod', method);
      showMsg('costbasis-msg', 'Saved', true);
    } catch (err) {
      showMsg('costbasis-msg', 'Error: ' + err.message, false);
    }
  });
}

// ── Goal / target net worth ──────────────────────────────

function renderGoalCard(settings: Settings): string {
  const targetNW = settings.targetNetWorth || '';
  const targetDate = settings.targetDate || '';

  return `
    <div class="card card-collapsible" id="settings-card-goal" data-card-key="goal">
      <div class="card-header js-card-toggle">
        <div class="card-title">Goal</div>
        <span class="card-chevron"></span>
      </div>
      <div class="card-body">
        <p class="note" style="margin-bottom:.75rem">Set a net-worth target to track progress on the Net Worth tab. Optionally set a target date to see if you're on track.</p>
        <div class="form-grid" style="max-width:500px">
          <div class="form-group">
            <label class="form-label">Target net worth (\u20AC)</label>
            <input class="form-input" id="set-target-nw" type="text" inputmode="decimal" value="${esc(targetNW)}" placeholder="e.g. 100000 or 100.000">
            <span class="note">Supports German format (100.000,00) or plain numbers.</span>
          </div>
          <div class="form-group">
            <label class="form-label">Target date (optional)</label>
            <input class="form-input" id="set-target-date" type="month" value="${esc(targetDate)}">
            <span class="note">Leave empty for ETA-only mode (no deadline).</span>
          </div>
        </div>
        <div style="display:flex;gap:10px;margin-top:.75rem">
          <button class="btn btn-primary btn-sm" id="btn-save-goal">Save goal</button>
          <span id="goal-msg" style="font-size:12px;line-height:28px"></span>
        </div>
      </div>
    </div>`;
}

function attachGoalListeners(root: HTMLElement): void {
  root.querySelector('#btn-save-goal')?.addEventListener('click', async () => {
    const nwVal = root.querySelector('#set-target-nw')?.value || '';
    const dateVal = root.querySelector('#set-target-date')?.value || '';
    try {
      await setSettings({ targetNetWorth: nwVal, targetDate: dateVal });
      showMsg('goal-msg', 'Saved', true);
    } catch (err) {
      showMsg('goal-msg', 'Error: ' + err.message, false);
    }
  });
}

// ── Reinvestment rules ───────────────────────────────────

function renderRulesCard(settings: Settings): string {
  // Extract rules from settings: rule_1_label, rule_1_value, rule_2_label, ...
  const rules = [];
  for (let i = 1; i <= 20; i++) {
    const label = settings[`rule_${i}_label`];
    const value = settings[`rule_${i}_value`];
    if (label !== undefined || value !== undefined) {
      rules.push({ label: label || '', value: value || '' });
    }
  }

  const rows = rules
    .map(
      (r, i) => `
    <div class="settings-item settings-rule-row" data-idx="${i}">
      <div class="settings-item-fields" style="grid-template-columns:1fr">
        <div class="settings-field">
          <label class="settings-field-label">Description</label>
          <input class="form-input form-input-sm" data-field="label" value="${esc(r.label)}" placeholder="e.g. Dividends reinvested">
        </div>
        <div class="settings-field">
          <label class="settings-field-label">Action</label>
          <input class="form-input form-input-sm" data-field="value" value="${esc(r.value)}" placeholder="e.g. into IWDA weekly">
        </div>
      </div>
      <div style="text-align:right;margin-top:4px"><button class="btn btn-sm btn-danger js-del-rule" data-idx="${i}">✕ Remove</button></div>
    </div>
  `,
    )
    .join('');

  return `
    <div class="card card-collapsible" id="settings-card-rules" data-card-key="rules">
      <div class="card-header js-card-toggle">
        <div class="card-title">Reinvestment rules</div>
        <span class="card-chevron"></span>
      </div>
      <div class="card-body">
        <p class="note" style="margin-bottom:.75rem">Notes about how dividends and proceeds from sold positions are reinvested. These are displayed on the Overview tab as reminders.</p>
        <div id="settings-rules-tbl" class="settings-items">
          ${rows}
        </div>
        <div style="display:flex;gap:10px;margin-top:.75rem;flex-wrap:wrap">
          <button class="btn btn-outline btn-sm" id="btn-add-rule">+ Add rule</button>
          <button class="btn btn-primary btn-sm" id="btn-save-rules">Save rules</button>
          <span id="rules-msg" style="font-size:12px;line-height:28px"></span>
        </div>
      </div>
    </div>`;
}

function attachRulesListeners(root: HTMLElement): void {
  root.querySelector('#btn-add-rule')?.addEventListener('click', () => {
    const rules = collectRules(root);
    rules.push({ label: '', value: '' });
    rerenderRulesTable(root, rules);
  });

  root.querySelector('#btn-save-rules')?.addEventListener('click', async () => {
    const rules = collectRules(root);
    const currentSettings = getSettings();
    const updates = {};
    // Mark existing rule keys for deletion
    for (const key of Object.keys(currentSettings)) {
      if (/^rule_\d+_(label|value)$/.test(key)) {
        updates[key] = null;
      }
    }
    // Write new rules (overrides null for reused slots)
    rules.forEach((r, i) => {
      if (r.label || r.value) {
        updates[`rule_${i + 1}_label`] = r.label;
        updates[`rule_${i + 1}_value`] = r.value;
      }
    });
    try {
      await setSettings(updates);
      showMsg('rules-msg', 'Saved', true);
    } catch (err) {
      showMsg('rules-msg', 'Error: ' + err.message, false);
    }
  });

  root.querySelectorAll('.js-del-rule').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const rules = collectRules(root);
      const idx = parseInt(btn.dataset.idx);
      const ok = await confirmDialog({
        title: 'Remove this rule?',
        confirmLabel: 'Remove',
        danger: true,
      });
      if (!ok) return;
      rules.splice(idx, 1);
      rerenderRulesTable(root, rules);
    });
  });
}

function collectRules(root: HTMLElement): { label: string; value: string }[] {
  const rows = root.querySelectorAll('.settings-rule-row');
  return [...rows].map((row) => ({
    label: row.querySelector('[data-field="label"]').value.trim(),
    value: row.querySelector('[data-field="value"]').value.trim(),
  }));
}

function rerenderRulesTable(root: HTMLElement, rules: { label: string; value: string }[]): void {
  const tbl = root.querySelector('#settings-rules-tbl');
  if (!tbl) return;
  const rows = rules
    .map(
      (r, i) => `
    <div class="settings-item settings-rule-row" data-idx="${i}">
      <div class="settings-item-fields" style="grid-template-columns:1fr">
        <div class="settings-field">
          <label class="settings-field-label">Description</label>
          <input class="form-input form-input-sm" data-field="label" value="${esc(r.label)}" placeholder="e.g. Dividends reinvested">
        </div>
        <div class="settings-field">
          <label class="settings-field-label">Action</label>
          <input class="form-input form-input-sm" data-field="value" value="${esc(r.value)}" placeholder="e.g. into IWDA weekly">
        </div>
      </div>
      <div style="text-align:right;margin-top:4px"><button class="btn btn-sm btn-danger js-del-rule" data-idx="${i}">✕ Remove</button></div>
    </div>
  `,
    )
    .join('');
  tbl.innerHTML = rows;
  tbl.querySelectorAll('.js-del-rule').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const r = collectRules(root);
      const idx = parseInt(btn.dataset.idx);
      const ok = await confirmDialog({
        title: 'Remove this rule?',
        confirmLabel: 'Remove',
        danger: true,
      });
      if (!ok) return;
      r.splice(idx, 1);
      rerenderRulesTable(root, r);
    });
  });
}

// ── Helpers ───────────────────────────────────────────────

/** Attach two-way sync between color swatch and hex text inputs. */
function attachColorPickerSync(root: HTMLElement): void {
  root.querySelectorAll('.color-picker-wrap').forEach((wrap) => {
    const swatch = wrap.querySelector('.color-picker-swatch');
    const hex = wrap.querySelector('.color-picker-hex');
    if (!swatch || !hex) return;
    swatch.addEventListener('input', () => {
      hex.value = swatch.value;
    });
    hex.addEventListener('input', () => {
      const v = hex.value.trim();
      if (/^#[0-9a-fA-F]{6}$/.test(v)) swatch.value = v;
    });
  });
}

/** Attach click listeners to card headers for collapsing/expanding. */
function attachCardCollapseListeners(root: HTMLElement): void {
  root.querySelectorAll('.js-card-toggle').forEach((header) => {
    header.addEventListener('click', () => {
      const card = header.closest('.card-collapsible') as HTMLElement | null;
      if (!card) return;
      const key = card.dataset.cardKey;
      if (key) {
        const collapsed = toggleCollapsed('card:' + key);
        card.classList.toggle('collapsed', collapsed);
      } else {
        card.classList.toggle('collapsed');
      }
    });
  });
  attachItemCollapseListeners(root);
}

/** Attach click listeners to individual item headers for collapsing/expanding. */
function attachItemCollapseListeners(root: HTMLElement): void {
  root.querySelectorAll('.js-item-toggle').forEach((header) => {
    header.addEventListener('click', (e) => {
      // Don't toggle when clicking the delete button
      if (e.target.closest('.btn-danger')) return;
      const item = header.closest('.item-collapsible') as HTMLElement | null;
      if (!item) return;
      item.classList.toggle('item-collapsed');
      // Persist via stable key if available
      const stableKey = _itemStableKey(item);
      if (stableKey) {
        toggleCollapsed(stableKey);
      }
    });
  });
  // Reapply persisted item collapse state
  root.querySelectorAll('.item-collapsible').forEach((item) => {
    const stableKey = _itemStableKey(item as HTMLElement);
    if (stableKey && isCollapsed(stableKey)) {
      item.classList.add('item-collapsed');
    }
  });
}

/** Derive a stable persistence key for a settings item row. */
function _itemStableKey(item: HTMLElement): string | null {
  // Account rows: use the hidden id field
  if (item.classList.contains('settings-acct-row')) {
    const id = item.querySelector('[data-field="id"]')?.value;
    return id ? 'item:acct:' + id : null;
  }
  // Holding rows: use the ISIN field
  if (item.classList.contains('settings-hold-row')) {
    const isin = item.querySelector('[data-field="isin"]')?.value;
    return isin ? 'item:hold:' + isin : null;
  }
  return null;
}

function esc(s: string | undefined | null): string {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Generate a stable snake_case ID from a label. */
function generateId(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 30);
}

/** Generate a random muted hex color for a new holding. */
function randomColor(): string {
  const h = Math.random() * 360;
  const s = 0.45,
    l = 0.55;
  // HSL to hex conversion
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r, g, b;
  if (h < 60) {
    r = c;
    g = x;
    b = 0;
  } else if (h < 120) {
    r = x;
    g = c;
    b = 0;
  } else if (h < 180) {
    r = 0;
    g = c;
    b = x;
  } else if (h < 240) {
    r = 0;
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    g = 0;
    b = c;
  } else {
    r = c;
    g = 0;
    b = x;
  }
  const toHex = (v) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Parse an ETF/fund name (from any imported broker's transaction data) to
 * infer holding metadata. Operates on the canonical Transaction.name field -
 * not broker-specific. Typical names:
 *   "iShares Core MSCI World UCITS ETF USD (Acc)"
 *   "iShares Core MSCI EM IMI UCITS ETF USD (Acc)"
 *   "iShares € Aggregate Bond UCITS ETF EUR (Dist)"
 *   "Vanguard FTSE All-World UCITS ETF (USD) Accumulating"
 *   "Xtrackers MSCI Emerging Markets UCITS ETF 1C"
 */
function parseHoldingName(
  name: string,
  isin: string,
): { ticker: string; acc: boolean; assetClass: string; region: string } {
  const upper = (name || '').toUpperCase();

  // ── Acc vs Dist ──
  // Check for explicit (Acc)/(Dist) or Accumulating/Distributing keywords
  let acc = true; // default to accumulating
  if (/\(DIST\)|DISTRIBUTING/i.test(name)) {
    acc = false;
  } else if (/\(ACC\)|ACCUMULATING/i.test(name)) {
    acc = true;
  }

  // ── Asset class ──
  let assetClass = 'equity';
  if (/BOND|AGGREGATE|FIXED.?INCOME|TREASURY|GOVT/i.test(name)) {
    assetClass = 'bond';
  } else if (/REIT|REAL.?ESTATE|PROPERTY/i.test(name)) {
    assetClass = 'reit';
  } else if (/GOLD|COMMODITY|COMMODITIES/i.test(name)) {
    assetClass = 'commodity';
  }

  // ── Region ──
  let region = 'developed';
  if (/EMERGING|EM IMI/i.test(name) || /\bEM\b/.test(upper)) {
    region = 'emerging';
  } else if (/ALL.?WORLD|ACWI/i.test(name)) {
    region = 'global';
  } else if (/EUROPE|EURO\b|STOXX|€/i.test(name)) {
    region = 'europe';
  } else if (/S&P.?500|NASDAQ|US\b|USA\b|AMERICA/i.test(name)) {
    region = 'us';
  } else if (/GLOBAL|AGGREGATE|WORLD/i.test(name)) {
    region = 'global';
  }

  // ── Ticker ──
  // Try to extract a recognizable ticker: the short word before "UCITS"
  // or the word(s) right after the provider name that look like an index abbreviation
  let ticker = isin.slice(-4); // fallback
  // Strategy: find the word just before "UCITS" or "ETF" that looks like a ticker
  // Common pattern: "iShares Core MSCI World UCITS ETF" → we want something meaningful
  // Better: strip the provider prefix, strip "(Acc)"/"(Dist)", strip "UCITS ETF ..."
  const cleaned = name
    .replace(/\(Acc\)|\(Dist\)|Accumulating|Distributing/gi, '')
    .replace(/UCITS\s+ETF.*/i, '')
    .replace(
      /^(iShares|Vanguard|Xtrackers|Amundi|SPDR|Invesco|Lyxor|WisdomTree|UBS|HSBC|BNP)\s*(Core\s*)?/i,
      '',
    )
    .trim();
  if (cleaned) {
    // Build a compact ticker-like abbreviation from remaining words
    const words = cleaned.split(/\s+/).filter((w) => w.length > 0);
    if (words.length <= 3) {
      ticker = words.join(' ');
    } else {
      // Take initials of long names
      ticker = words
        .map((w) => w[0])
        .join('')
        .toUpperCase();
    }
  }

  return { ticker, acc, assetClass, region };
}

/** Subtract N months from a YYYY-MM-DD date string, returning YYYY-MM-DD. */
function subtractMonths(dateStr: string, months: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

// ── Cache / Force resync ──────────────────────────────────

function renderCacheCard(): string {
  return `
    <div class="card card-collapsible" id="settings-card-cache" data-card-key="cache">
      <div class="card-header js-card-toggle">
        <div class="card-title">Cache &amp; sync</div>
        <span class="card-chevron"></span>
      </div>
      <div class="card-body">
        <p class="note" style="margin-bottom:.75rem">Data is cached locally in IndexedDB for offline access and fast boot. If you edited historical rows directly in Google Sheets, use Force full resync to rebuild the cache from scratch.</p>
        <div style="display:flex;gap:10px;margin-top:.5rem;align-items:center;flex-wrap:wrap">
          <button class="btn btn-outline btn-sm" id="btn-force-resync">Force full resync</button>
          <span id="resync-msg" style="font-size:12px;line-height:28px"></span>
        </div>
      </div>
    </div>`;
}

function attachCacheListeners(root: HTMLElement): void {
  root.querySelector('#btn-force-resync')?.addEventListener('click', async () => {
    const msgEl = root.querySelector('#resync-msg') as HTMLElement | null;
    const C = resolvedT();
    if (msgEl) {
      msgEl.textContent = 'Resyncing…';
      msgEl.style.color = C.ink2;
    }
    try {
      await (window as any).__forceFullResync();
      if (msgEl) {
        msgEl.textContent = 'Done ✓';
        msgEl.style.color = C.pos;
      }
    } catch (err: any) {
      if (msgEl) {
        msgEl.textContent = 'Error: ' + (err?.message || 'unknown');
        msgEl.style.color = C.neg;
      }
    }
  });
}

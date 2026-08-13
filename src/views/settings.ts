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
  getGoals,
  getAlertSettings,
  getRetiredAccountIds,
  retireAccountIdsSafely,
  getContributionBudgetAmount,
  getContributionInterval,
  getCalibrationInterval,
} from '../store/config';
import type { ConfigChangeKind } from '../store/config';
import { loadTransactions, loadConfigHistory, loadSnapshots, saveSnapshots } from '../db';
import type { ConfigHistoryEntry } from '../db';
import {
  validatePrimaryInvestment,
  validateAccountRanges,
  validateAccountIds,
  validateAccountLabels,
} from '../model/accounts';
import { validateGoalLabels } from '../model/goals';
import { validateHoldings } from '../model/holdings';
import { INTERVAL_LABELS } from '../model/contributions';
import { showMsg, reinjectPendingMsg, withButtonGuard, esc, fmtEur } from '../utils';
import type {
  Account,
  Holding,
  Settings,
  ContribInterval,
  NamedGoal,
  Transaction,
  Snapshot,
} from '../types';
import { formatEnglishDateTime, formatEnglishMonth } from '../dateFormat';
import { normalizeInstitution } from '../model/securitySuggestions';
import { isCollapsed, setCollapsed, toggleCollapsed } from '../ui/collapseState';
import { infoTip, attachInfoTips } from '../ui/infoTip';
import { confirmDialog } from '../ui/confirmDialog';
import { accountDialog } from '../ui/accountDialog';
import { holdingDialog } from '../ui/holdingDialog';
import { goalDialog } from '../ui/goalDialog';
import { ACCOUNT_TYPES } from '../model/accountTypes';
import { isSignedIn } from '../auth/google';
import { isBackupStale } from '../backup/exportImport';
import { isBusy, setBusy } from '../sync/lock';
import {
  buildHoldingSecuritySuggestions,
  loadAppSecuritySuggestions,
} from '../securitySuggestions';

/** Build <option> HTML for an interval <select>, marking `selected` the matching value. */
function intervalOptionsHtml(selected: ContribInterval): string {
  return Object.entries(INTERVAL_LABELS)
    .map(
      ([val, label]) =>
        `<option value="${val}" ${selected === val ? 'selected' : ''}>${label}</option>`,
    )
    .join('');
}

const EDIT_ICON = `<svg class="btn-icon-svg" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M11.65 1.85a1.8 1.8 0 0 1 2.5 0l.02.02a1.78 1.78 0 0 1 0 2.5L6.18 12.35 3 13l.65-3.18L11.65 1.85Zm1.45 1.02a.38.38 0 0 0-.52 0l-.9.9 1.54 1.54.9-.9a.38.38 0 0 0 0-.52l-1.02-1.02ZM12.2 6.3l-1.54-1.54-5.7 5.7-.3 1.46 1.46-.3 6.08-5.82Z"/></svg>`;
const DELETE_ICON = `<svg class="btn-icon-svg" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M6.5 1h3a1 1 0 0 1 1 1v1H13v1H3V3h2.5V2a1 1 0 0 1 1-1Zm1 2h1V2h-1v1ZM4.5 5h7l-.5 8.1a1 1 0 0 1-1 .9H6a1 1 0 0 1-1-.9L4.5 5Zm2 1v6h1V6h-1Zm2 0v6h1V6h-1Z"/></svg>`;

/** Card key — identifies which settings card an action belongs to. */
type CardKey =
  | 'accounts'
  | 'holdings'
  | 'contributions'
  | 'calc-assumptions'
  | 'goal'
  | 'portfolio-behavior'
  | 'cache'
  | 'backup'
  | 'config-history';

/** One busy flag per card. Every Save/Delete/action handler in a card must
 *  go through withCardGuard (never withButtonGuard directly), so two actions
 *  in the same card can never race each other's persistence. Deliberately
 *  per-card, not global; an in-flight Holdings save must not block an
 *  unrelated Accounts delete. */
const _cardBusy = new Set<CardKey>();

export function isCardBusy(key: CardKey): boolean {
  return _cardBusy.has(key);
}

/** Wraps withButtonGuard with the card-level lock. This is the single
 *  required entry point for every write handler added or touched in 57b
 *  and 57c; no handler should call withButtonGuard directly. */
export async function withCardGuard<T>(
  cardKey: CardKey,
  btn: HTMLButtonElement,
  action: () => Promise<T>,
  opts: { busyText?: string; keepDisabledOnSuccess?: boolean } = {},
): Promise<T | undefined> {
  // isBusy() is the single lock also held by main.ts during background
  // sync/import/backup writes (see sync/lock.ts). Checking it here stops
  // a Settings save from starting while an auto-resync is loadConfig()-ing
  // the same in-memory store; setting it for the duration of this card's
  // write stops the reverse race.
  if (isCardBusy(cardKey) || isBusy()) return undefined;
  _cardBusy.add(cardKey);
  setBusy(true);
  applySyncBusyState(); // grey out every OTHER card's buttons too, not just this one's

  // Disable all buttons in this card so none are clickable while busy
  const cardEl = document.getElementById(`settings-card-${cardKey}`);
  const siblingBtns: HTMLButtonElement[] = [];
  if (cardEl) {
    for (const b of Array.from(cardEl.querySelectorAll('button'))) {
      if (b !== btn && !b.disabled) {
        b.disabled = true;
        siblingBtns.push(b);
      }
    }
  }

  try {
    return await withButtonGuard(btn, action, opts);
  } finally {
    _cardBusy.delete(cardKey);
    setBusy(false);
    applySyncBusyState(); // re-enable the other cards' buttons
    // Re-enable sibling buttons that we disabled
    for (const b of siblingBtns) b.disabled = false;
  }
}

/** Card-content refresh functions never touch buttons - these ids never
 *  go through withCardGuard/Sheets writes, so they stay clickable even
 *  while a sync/write is in progress elsewhere in the app. */
const SYNC_LOCK_EXEMPT_IDS = new Set([
  'btn-add-acct',
  'btn-add-hold',
  'btn-add-rule',
  'btn-add-goal',
]);
const SYNC_BUSY_TITLE = 'Sync in progress, try again in a moment';
const SETTINGS_DEFAULT_COLLAPSE_MARKER = 'settings-defaults-v1';
const SETTINGS_DEFAULT_COLLAPSED_CARDS: ReadonlySet<CardKey> = new Set([
  'portfolio-behavior',
  'cache',
  'backup',
  'config-history',
]);

function applySettingsDefaultCollapseState(): void {
  if (isCollapsed(SETTINGS_DEFAULT_COLLAPSE_MARKER)) return;
  for (const key of SETTINGS_DEFAULT_COLLAPSED_CARDS) {
    setCollapsed('card:' + key, true);
  }
  setCollapsed(SETTINGS_DEFAULT_COLLAPSE_MARKER, true);
}

/**
 * Disable every write-triggering Settings button while a sync/write is in
 * flight anywhere in the app. Idempotent; no-ops if Settings isn't mounted.
 */
export function applySyncBusyState(): void {
  const root = document.getElementById('settings-content');
  if (!root) return;
  const busy = isBusy();
  root.querySelectorAll<HTMLButtonElement>('.card button').forEach((btn) => {
    if (SYNC_LOCK_EXEMPT_IDS.has(btn.id) || btn.dataset.hfilter !== undefined) return;
    if (busy) {
      btn.disabled = true;
      btn.title = SYNC_BUSY_TITLE;
    } else if (btn.title === SYNC_BUSY_TITLE) {
      btn.disabled = false;
      btn.title = '';
    }
  });
}

/**
 * Render the Settings section — user-friendly forms for Accounts, Holdings, Settings.
 * Only shown after config is loaded (sign-in required).
 */
export function renderSettings(): void {
  const el = document.getElementById('settings-content');
  if (!el) return;

  if (!isConfigLoaded() || !isSignedIn()) {
    el.innerHTML = '<p class="note">Sign in and load data to manage settings.</p>';
    return;
  }

  const accounts = getAccounts();
  const holdings = getHoldings();
  const settings = getSettings();
  applySettingsDefaultCollapseState();

  el.innerHTML = `
    <nav class="subnav range-toggle settings-group-nav" aria-label="Settings sections">
      <button type="button" class="btn btn-sm btn-ghost settings-group-nav-link active" data-settings-group-target="settings-group-portfolio" aria-pressed="true">Portfolio structure</button>
      <button type="button" class="btn btn-sm btn-ghost settings-group-nav-link" data-settings-group-target="settings-group-tracking" aria-pressed="false">Tracking &amp; planning</button>
      <button type="button" class="btn btn-sm btn-ghost settings-group-nav-link" data-settings-group-target="settings-group-advanced" aria-pressed="false">Advanced</button>
    </nav>
    <div class="settings-group" id="settings-group-portfolio">
      <div class="settings-group-header">
        <span class="settings-group-title">Portfolio structure</span>
        <span class="settings-group-note">Start here — add an account first, then add your holdings.</span>
      </div>
      ${renderAccountsCard(accounts)}
      ${renderHoldingsCard(holdings)}
    </div>
    <div class="settings-group" id="settings-group-tracking">
      <div class="settings-group-header">
        <span class="settings-group-title">Tracking &amp; planning</span>
      </div>
      ${renderContributionsCard(settings)}
      ${renderCalcAssumptionsCard(settings)}
      ${renderGoalCard(settings)}
    </div>
    <div class="settings-group" id="settings-group-advanced">
      <div class="settings-group-header">
        <span class="settings-group-title">Advanced</span>
      </div>
      ${renderPortfolioBehaviorCard(settings)}
      ${renderCacheCard()}
      ${renderBackupCard()}
      ${renderConfigHistoryCard([])}
    </div>
  `;

  attachAccountListeners(el);
  attachHoldingListeners(el);
  attachContributionsListeners(el);
  attachCalcAssumptionsListeners(el);
  attachGoalListeners(el);
  attachPortfolioBehaviorListeners(el);
  attachCacheListeners(el);
  attachBackupListeners(el);
  attachColorPickerSync(el);
  attachCardCollapseListeners(el);
  attachSettingsGroupNavListeners(el);

  // Load and render config history asynchronously after initial paint
  void loadConfigHistory(50).then((entries) => {
    const card = document.getElementById('settings-card-config-history');
    if (card) card.outerHTML = renderConfigHistoryCard(entries);
    const fresh = document.getElementById('settings-card-config-history');
    if (fresh) {
      attachCardCollapseListeners(fresh);
      if (isCollapsed('card:config-history')) fresh.classList.add('collapsed');
    }
  });

  // Reapply persisted collapse state after re-render
  el.querySelectorAll('.card-collapsible').forEach((card) => {
    const key = (card as HTMLElement).dataset.cardKey;
    if (key && isCollapsed('card:' + key)) card.classList.add('collapsed');
  });

  attachInfoTips(el);
  reinjectPendingMsg();
  applySyncBusyState();
}

function setActiveSettingsGroupNav(root: HTMLElement, targetId: string): void {
  root.querySelectorAll<HTMLElement>('[data-settings-group-target]').forEach((item) => {
    const isActive = item.dataset.settingsGroupTarget === targetId;
    item.classList.toggle('active', isActive);
    item.setAttribute('aria-pressed', String(isActive));
  });
}

function attachSettingsGroupNavListeners(root: HTMLElement): void {
  const nav = root.querySelector('.settings-group-nav');
  if (!nav) return;
  nav.addEventListener('click', (event) => {
    const btn = (event.target as HTMLElement).closest<HTMLButtonElement>(
      '[data-settings-group-target]',
    );
    const targetId = btn?.dataset.settingsGroupTarget;
    if (!targetId) return;
    const section = document.getElementById(targetId);
    if (!section) return;
    setActiveSettingsGroupNav(root, targetId);
    if (typeof section.scrollIntoView === 'function') {
      section.scrollIntoView({ block: 'start' });
    }
  });
}

// ── Data-only refresh functions ───────────────────────────
/** Each rewrites exactly the data region inside an already-mounted card and
 *  nothing else - never the buttons, never the message span. */

function refreshAccountsData(): void {
  const root = document.getElementById('settings-card-accounts');
  if (root) rerenderAccountsTable(root, getAccounts());
}

function refreshHoldingsData(): void {
  const root = document.getElementById('settings-card-holdings');
  if (root) rerenderHoldingsTable(root, getHoldings());
}

function refreshRulesData(): void {
  const root = document.getElementById('settings-card-portfolio-behavior');
  if (root) rerenderRulesTable(root, rulesFromSettings(getSettings()));
}

function refreshCostBasisData(): void {
  const el = document.getElementById('settings-costbasis-fields');
  if (el) el.innerHTML = costBasisFieldsHtml(getCostBasisMethod());
}

function refreshGoalData(): void {
  const card = document.getElementById('settings-card-goal');
  if (card) rerenderGoalsTable(card, getGoals());
}

function refreshBackupData(): void {
  const el = document.getElementById('settings-backup-nudge');
  if (el) el.innerHTML = backupNudgeHtml(getSettings());
}

/** Dispatch a config-change notification to the narrowest correct refresh.
 *  'settings' backs cost-basis, goal, rules, and backup's nudge (all
 *  confirmed via source to read getSettings()); accounts/holdings are
 *  excluded, confirmed not to. */
export function refreshSettingsAfterChange(changed: ConfigChangeKind): void {
  if (!document.getElementById('settings-content')) return;
  applySyncBusyState();
  if (changed === 'accounts') {
    refreshAccountsData();
    return;
  }
  if (changed === 'holdings') {
    refreshHoldingsData();
    return;
  }
  refreshRulesData();
  refreshCostBasisData();
  refreshGoalData();
  refreshBackupData();
}

// ── Accounts ──────────────────────────────────────────────

/** In-memory list of accounts — kept in sync by add/edit/delete dialog operations. */
let _accounts: Account[] | null = null;

function accountInstitutionList(accounts: Account[]): string[] {
  return [
    ...new Set(accounts.map((a) => normalizeInstitution(a.institution || '')).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b));
}

interface EditableListController<T> {
  items(): T[];
  previewAdd(next: T, message: string): T[];
  previewUpdate(index: number, next: T, message: string): T[];
}

function createEditableListController<T>(opts: {
  getItems: () => T[];
  apply: (items: T[]) => void;
  msgId: string;
}): EditableListController<T> {
  return {
    items: () => opts.getItems(),
    previewAdd(next, message) {
      const updated = [...opts.getItems(), next];
      opts.apply(updated);
      showMsg(opts.msgId, message, true);
      return updated;
    },
    previewUpdate(index, next, message) {
      const updated = opts.getItems().map((item, itemIndex) => (itemIndex === index ? next : item));
      opts.apply(updated);
      showMsg(opts.msgId, message, true);
      return updated;
    },
  };
}

async function persistListRemoval<T>(opts: {
  controller: EditableListController<T>;
  index: number;
  root: HTMLElement;
  btn: HTMLButtonElement;
  cardKey: CardKey;
  persist: (items: T[]) => Promise<unknown>;
  rerender: (root: HTMLElement, items: T[]) => void;
  confirmTitle: string;
  confirmBody: string;
  msgId: string;
  successMessage: string;
  busyText: string;
  keepDisabledOnSuccess?: boolean;
  confirmLabel?: string;
  afterPersist?: (items: T[]) => Promise<string | void>;
}): Promise<void> {
  const ok = await confirmDialog({
    title: opts.confirmTitle,
    body: opts.confirmBody,
    confirmLabel: opts.confirmLabel || 'Remove',
    danger: true,
  });
  if (!ok) return;
  const updated = opts.controller.items().filter((_, itemIndex) => itemIndex !== opts.index);
  try {
    let successMessage = opts.successMessage;
    await withCardGuard(
      opts.cardKey,
      opts.btn,
      async () => {
        await opts.persist(updated);
        const result = await opts.afterPersist?.(updated);
        if (result) successMessage = result;
      },
      {
        busyText: opts.busyText,
        keepDisabledOnSuccess: opts.keepDisabledOnSuccess,
      },
    );
    opts.rerender(opts.root, updated);
    showMsg(opts.msgId, successMessage, true);
  } catch (err) {
    showMsg(opts.msgId, 'Error: ' + (err as Error).message, false);
  }
}

function renderAccountsCard(accounts: Account[]): string {
  _accounts = accounts.slice();
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
        <div class="form-actions">
          <button class="btn btn-outline btn-sm" id="btn-add-acct">+ Add account</button>
          <button class="btn btn-primary btn-sm" id="btn-save-accts">Save accounts</button>
          <span id="accts-msg" class="form-msg"></span>
        </div>
      </div>
    </div>`;
}

function renderAccountRow(a: Account, i: number): string {
  const typeLabel = esc(
    ACCOUNT_TYPES.find((t) => t.value === a.moneyType)?.label || a.moneyType || '',
  );
  const color = a.color || 'var(--ink-4)';
  const meta = [
    typeLabel,
    a.institution ? esc(a.institution) : '',
    a.isPrimaryInvestment ? 'Primary' : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return `
    <div class="settings-item settings-acct-row" data-idx="${i}">
      <div class="settings-item-header">
        <span class="leg-sq" style="background:${esc(color)};flex-shrink:0"></span>
        <span class="settings-item-title">${esc(a.label) || 'New account'}</span>
        <span class="settings-item-meta">${meta}</span>
        <div class="settings-row-actions">
          <button class="btn btn-sm btn-outline btn-icon js-edit-acct" data-idx="${i}" aria-label="Edit account" title="Edit account">${EDIT_ICON}</button>
          <button class="btn btn-sm btn-danger btn-icon js-del-acct" data-idx="${i}" aria-label="Delete account" title="Delete account">${DELETE_ICON}</button>
        </div>
      </div>
    </div>`;
}

/** Shared account-delete implementation. setAccounts runs before
 *  retireAccountIdsSafely so getAccounts() is correct the instant this
 *  resolves, closing the window where retirement's own setSetting ->
 *  _onChange could trigger a re-render from stale data.
 *  retireAccountIdsSafely never throws: if the Sheets write for the
 *  retirement itself fails after setAccounts already succeeded, the id is
 *  queued locally (getRetiredAccountIds() still protects against reuse
 *  immediately) and retried automatically on next load, instead of
 *  surfacing a misleading "Error" for a delete that actually went through. */
async function deleteAccount(
  root: HTMLElement,
  idx: number,
  btn: HTMLButtonElement,
): Promise<void> {
  if (isCardBusy('accounts') || isBusy()) return;
  const accounts = _accounts ?? [];
  const a = accounts[idx];
  const accountKeys = [a?.id, a?.key].filter((k): k is string => !!k && k.trim().length > 0);
  if (accountKeys.length > 0) {
    const snaps = await loadSnapshots();
    const hasHistory = snaps.some((s) =>
      accountKeys.some((key) => typeof s[key] === 'number' && Number(s[key]) !== 0),
    );
    if (hasHistory) {
      showMsg(
        'accts-msg',
        'Cannot remove this account because it has historical snapshot values. Removing it would rewrite historical totals. Keep it and rename it (for example, "Closed - …").',
        false,
      );
      return;
    }
  }
  const controller = createEditableListController<Account>({
    getItems: () => _accounts ?? [],
    apply: (updated) => rerenderAccountsTable(root, updated),
    msgId: 'accts-msg',
  });
  await persistListRemoval({
    controller,
    index: idx,
    root,
    btn,
    cardKey: 'accounts',
    persist: async (updated) => setAccounts(updated),
    rerender: rerenderAccountsTable,
    confirmTitle: `Remove ${esc(a?.label || 'this account')}?`,
    confirmBody:
      'This removes it from your configuration. The account has no stored snapshot balances, so historical totals stay unchanged. Its old data column stays reserved so a future account never accidentally reuses it.',
    msgId: 'accts-msg',
    successMessage: 'Removed',
    busyText: 'Removing...',
    keepDisabledOnSuccess: true,
    afterPersist: async () => {
      if (!a?.id) return;
      const retiredOk = await retireAccountIdsSafely([a.id]);
      return retiredOk ? 'Removed' : 'Removed (will finish reserving its id once back online)';
    },
  });
}

async function migrateLegacySnapshotKeys(accounts: Account[]): Promise<void> {
  const keyMap = new Map<string, string>();
  for (const account of accounts) {
    const from = String(account.key || '')
      .trim()
      .toLowerCase();
    const to = String(account.id || '')
      .trim()
      .toLowerCase();
    if (!from || !to || from === to) continue;
    keyMap.set(from, to);
  }
  if (keyMap.size === 0) return;

  const snapshots = await loadSnapshots();
  let changed = false;
  const migrated = snapshots.map((snap) => {
    const next: Record<string, unknown> = { ...snap };
    for (const [legacyKey, currentKey] of keyMap.entries()) {
      const match = Object.keys(next).find((k) => k.toLowerCase() === legacyKey);
      if (!match || match === currentKey) continue;
      const legacyValue = next[match];
      const currentValue = next[currentKey];
      if (typeof legacyValue === 'number' && typeof currentValue !== 'number') {
        next[currentKey] = legacyValue;
        changed = true;
      }
      delete next[match];
      changed = true;
    }
    return next as Snapshot;
  });
  if (changed) await saveSnapshots(migrated);
}

function attachAccountListeners(root: HTMLElement): void {
  const controller = createEditableListController<Account>({
    getItems: () => _accounts ?? [],
    apply: (updated) => rerenderAccountsTable(root, updated),
    msgId: 'accts-msg',
  });
  root.querySelector('#btn-add-acct')?.addEventListener('click', async () => {
    const draft = await accountDialog({
      existingLabels: controller.items().map((a) => a.label),
      institutionSuggestions: accountInstitutionList(controller.items()),
    });
    if (!draft) return;
    draft.order = controller.items().length + 1;
    controller.previewAdd(draft, 'Account added — click Save to persist.');
  });

  root.addEventListener('click', async (e) => {
    const editBtn = (e.target as Element).closest('.js-edit-acct') as HTMLElement | null;
    if (!editBtn) return;
    const idx = parseInt(editBtn.dataset.idx ?? '');
    if (isNaN(idx)) return;
    const accounts = controller.items();
    const existing = accounts[idx];
    if (!existing) return;
    const draft = await accountDialog({
      existing,
      existingLabels: accounts.filter((_, i) => i !== idx).map((a) => a.label),
      institutionSuggestions: accountInstitutionList(accounts),
    });
    if (!draft) return;
    draft.order = existing.order;
    controller.previewUpdate(idx, draft, 'Account updated — click Save to persist.');
  });

  root.querySelector('#btn-save-accts')?.addEventListener('click', async () => {
    const btn = root.querySelector('#btn-save-accts') as HTMLButtonElement;
    const accounts = _accounts ?? [];
    if (accounts.some((a) => !a.label)) {
      showMsg('accts-msg', 'Each account needs a name.', false);
      return;
    }
    const labelErr = validateAccountLabels(accounts);
    if (labelErr) {
      showMsg('accts-msg', labelErr, false);
      return;
    }
    // Auto-generate IDs for accounts that don't have one
    const taken = new Set([
      ...accounts.map((a) => (a.id || a.key || '').trim()).filter((id) => !!id),
      ...getRetiredAccountIds(),
    ]);
    for (const a of accounts) {
      if (!a.id) {
        const legacyKey = String(a.key || '').trim();
        a.id = legacyKey || generateId(a.label, taken);
        taken.add(a.id);
      }
    }
    const idErr = validateAccountIds(accounts);
    if (idErr) {
      showMsg('accts-msg', idErr, false);
      return;
    }
    const primErr = validatePrimaryInvestment(accounts);
    if (primErr) {
      showMsg('accts-msg', primErr, false);
      return;
    }
    const rangeErr = validateAccountRanges(accounts);
    if (rangeErr) {
      showMsg('accts-msg', rangeErr, false);
      return;
    }
    try {
      await withCardGuard(
        'accounts',
        btn,
        async () => {
          await migrateLegacySnapshotKeys(accounts);
          await setAccounts(accounts);
        },
        { busyText: 'Saving...' },
      );
      showMsg('accts-msg', 'Saved', true);
    } catch (err) {
      showMsg('accts-msg', 'Error: ' + (err as Error).message, false);
    }
  });

  root.addEventListener('click', (e) => {
    const delBtn = (e.target as Element).closest('.js-del-acct') as HTMLButtonElement | null;
    if (!delBtn) return;
    const idx = parseInt(delBtn.dataset.idx ?? '');
    if (!isNaN(idx)) deleteAccount(root, idx, delBtn);
  });
}

function collectAccounts(_root: HTMLElement): Account[] {
  return _accounts ?? [];
}

function rerenderAccountsTable(root: HTMLElement, accounts: Account[]): void {
  _accounts = accounts.slice();
  const tbl = root.querySelector('#settings-accounts-tbl') as HTMLElement | null;
  if (!tbl) return;
  const rows = accounts.map((a, i) => renderAccountRow(a, i)).join('');
  tbl.innerHTML = rows;
}

// ── Holdings ──────────────────────────────────────────────

/** In-memory list of holdings — kept in sync by add/edit/delete dialog operations. */
let _holdings: Holding[] | null = null;
let _holdingsSettingsFilter = 'all'; // 'all' | 'active' | 'closed'
let _allHoldings: Holding[] | null = null; // cached full holdings list for filtered views
let _suggestionTransactions: Transaction[] = [];

function renderHoldingsCard(holdings: Holding[]): string {
  // Cache the full list for merge-back when filter is active
  _holdings = holdings.slice();
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
    .map((h) => {
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
        <p class="note" style="margin-bottom:.75rem">ETF positions in your portfolio. Set a target allocation percentage on each active holding to use the drift and rebalance features. Closed positions can be folded into a successor fund.</p>
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
        <div class="form-actions">
          <button class="btn btn-outline btn-sm" id="btn-add-hold">+ Add holding</button>
          <button class="btn btn-outline btn-sm" id="btn-autofill-holds">Auto-fill from transactions</button>
          <button class="btn btn-primary btn-sm" id="btn-save-holds">Save holdings</button>
          <span id="holds-msg" class="form-msg"></span>
        </div>
      </div>
    </div>`;
}

function renderHoldingRow(h: Holding, i: number): string {
  const statusBadge = h.active
    ? '<span class="badge b-active">Active</span>'
    : '<span class="badge b-closed">Closed</span>';
  const color = h.color || 'var(--ink-4)';

  return `
    <div class="settings-item settings-hold-row" data-idx="${i}">
      <div class="settings-item-header">
        <span class="leg-sq" style="background:${esc(color)};flex-shrink:0"></span>
        <span class="settings-item-title">${esc(h.shortName) || esc(h.isin) || 'New holding'}</span>
        ${statusBadge}
        <div class="settings-row-actions">
          <button class="btn btn-sm btn-outline btn-icon js-edit-hold" data-idx="${i}" aria-label="Edit holding" title="Edit holding">${EDIT_ICON}</button>
          <button class="btn btn-sm btn-danger btn-icon js-del-hold" data-idx="${i}" aria-label="Delete holding" title="Delete holding">${DELETE_ICON}</button>
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

/** Shared holding-delete implementation. */
async function deleteHolding(
  root: HTMLElement,
  idx: number,
  btn: HTMLButtonElement,
): Promise<void> {
  if (isCardBusy('holdings') || isBusy()) return;
  const holds = _holdings ?? [];
  const hold = holds[idx];
  const controller = createEditableListController<Holding>({
    getItems: () => _holdings ?? _allHoldings ?? [],
    apply: (updated) => rerenderHoldingsTable(root, updated),
    msgId: 'holds-msg',
  });
  await persistListRemoval({
    controller,
    index: idx,
    root,
    btn,
    cardKey: 'holdings',
    persist: async (updated) => setHoldings(updated),
    rerender: rerenderHoldingsTable,
    confirmTitle: `Remove ${esc(hold?.shortName || hold?.isin || 'this holding')}?`,
    confirmBody: 'This removes it from your configuration. Historical data is not affected.',
    msgId: 'holds-msg',
    successMessage: 'Removed',
    busyText: 'Removing...',
    keepDisabledOnSuccess: true,
  });
}

function attachHoldingListeners(root: HTMLElement): void {
  const controller = createEditableListController<Holding>({
    getItems: () => _holdings ?? _allHoldings ?? [],
    apply: (updated) => rerenderHoldingsTable(root, updated),
    msgId: 'holds-msg',
  });
  void loadAppSecuritySuggestions()
    .then((txs) => {
      _suggestionTransactions = txs.transactions;
    })
    .catch(() => undefined);

  // Filter toggle - scoped repaint, does NOT rebuild sibling cards
  const filterToggle = root.querySelector('#hold-filter-toggle');
  if (filterToggle) {
    filterToggle.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('[data-hfilter]') as HTMLElement | null;
      if (!btn) return;
      _holdingsSettingsFilter = btn.dataset.hfilter || 'all';
      applyHoldingsFilter(root);
    });
  }

  root.querySelector('#btn-add-hold')?.addEventListener('click', async () => {
    const order = controller.items().length + 1;
    const draft = await holdingDialog({
      suggestions: buildHoldingSecuritySuggestions(
        _suggestionTransactions,
        controller.items().map((h) => h.isin),
      ),
      order,
      existingIsins: controller.items().map((h) => h.isin),
    });
    if (!draft) return;
    controller.previewAdd(draft, 'Holding added — click Save to persist.');
  });

  root.addEventListener('click', async (e) => {
    const editBtn = (e.target as Element).closest('.js-edit-hold') as HTMLElement | null;
    if (!editBtn) return;
    const idx = parseInt(editBtn.dataset.idx ?? '');
    if (isNaN(idx)) return;
    const holds = controller.items();
    const existing = holds[idx];
    if (!existing) return;
    const draft = await holdingDialog({
      existing,
      suggestions: buildHoldingSecuritySuggestions(
        _suggestionTransactions,
        holds.filter((h) => h.isin !== existing.isin).map((h) => h.isin),
      ),
      existingIsins: holds.filter((h) => h.isin !== existing.isin).map((h) => h.isin),
    });
    if (!draft) return;
    controller.previewUpdate(
      idx,
      { ...draft, order: existing.order },
      'Holding updated — click Save to persist.',
    );
  });

  root.querySelector('#btn-autofill-holds')?.addEventListener('click', async () => {
    const btn = root.querySelector('#btn-autofill-holds') as HTMLButtonElement;
    try {
      await withCardGuard(
        'holdings',
        btn,
        async () => {
          const txData = await loadAppSecuritySuggestions();
          const txs = txData.transactions;
          _suggestionTransactions = txs;
          const buys = txs.filter((t) => t.type === 'BUY' && t.isin);
          if (buys.length === 0) {
            showMsg('holds-msg', 'No BUY transactions found. Import a CSV first.', false);
            return;
          }
          // Determine cutoff: ISINs with buys in the last 3 months are "active"
          const latestDate = buys.reduce((max, t) => (t.date > max ? t.date : max), '');
          const cutoff = subtractMonths(latestDate, 3);
          // Extract unique ISIN->name mapping and track latest tx date per ISIN
          const isinMap: Record<string, string> = {};
          const isinLatest: Record<string, string> = {};
          for (const tx of buys) {
            const sym = tx.isin;
            if (!isinMap[sym]) {
              isinMap[sym] = tx.name || '';
            }
            if (!isinLatest[sym] || tx.date > isinLatest[sym]) {
              isinLatest[sym] = tx.date;
            }
          }
          // Merge with existing holdings (skip already-configured ISINs)
          const holds = controller.items().slice();
          const existing = new Set(holds.map((h) => h.isin));
          let added = 0;
          for (const [isin, name] of Object.entries(isinMap)) {
            if (existing.has(isin)) continue;
            const parsed = parseHoldingName(name, isin);
            const isActive = (isinLatest[isin] || '') >= cutoff;
            holds.push({
              isin,
              shortName: parsed.shortName,
              name,
              color: randomColor(),
              acc: parsed.acc,
              active: isActive,
              assetClass: parsed.assetClass,
              region: parsed.region,
              foldInto: '',
              order: holds.length + 1,
            });
            added++;
          }
          // Deduplicate shortNames: if two auto-generated names collide,
          // append a distinguishing suffix from the ISIN (last 4 chars)
          const shortNameCounts = new Map<string, number>();
          for (const h of holds) {
            shortNameCounts.set(h.shortName, (shortNameCounts.get(h.shortName) || 0) + 1);
          }
          for (const h of holds) {
            if ((shortNameCounts.get(h.shortName) || 0) > 1) {
              const suffix = h.isin.slice(-4);
              const maxBase = 10 - 1 - suffix.length; // 1 for the separator
              h.shortName = h.shortName.slice(0, maxBase) + '·' + suffix;
            }
          }
          rerenderHoldingsTable(root, holds);
          showMsg(
            'holds-msg',
            added > 0
              ? `Added ${added} holding(s) from transactions. Review and save.`
              : 'All transaction ISINs already configured.',
            true,
          );
        },
        { busyText: 'Loading...' },
      );
    } catch (err) {
      showMsg('holds-msg', 'Error: ' + (err as Error).message, false);
    }
  });

  root.querySelector('#btn-save-holds')?.addEventListener('click', async () => {
    const btn = root.querySelector('#btn-save-holds') as HTMLButtonElement;
    const holds = _holdings ?? [];
    if (holds.some((h) => !h.isin || !h.shortName)) {
      showMsg('holds-msg', 'Each holding needs an ISIN and short name.', false);
      return;
    }
    const valErrors = validateHoldings(holds);
    if (valErrors.length > 0) {
      showMsg('holds-msg', valErrors[0].message, false);
      return;
    }
    try {
      await withCardGuard('holdings', btn, () => setHoldings(holds), { busyText: 'Saving...' });
      showMsg('holds-msg', 'Saved', true);
    } catch (err) {
      showMsg('holds-msg', 'Error: ' + (err as Error).message, false);
    }
  });

  root.addEventListener('click', (e) => {
    const delBtn = (e.target as Element).closest('.js-del-hold') as HTMLButtonElement | null;
    if (!delBtn) return;
    const idx = parseInt(delBtn.dataset.idx ?? '');
    if (!isNaN(idx)) deleteHolding(root, idx, delBtn);
  });
}

function rerenderHoldingsTable(root: HTMLElement, holdings: Holding[]): void {
  // Update cache and reset filter to show all when modifying
  _holdings = holdings.slice();
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
      const el = b as HTMLElement;
      el.classList.toggle('active', el.dataset.hfilter === 'all');
      if (el.dataset.hfilter === 'all') el.textContent = `All (${holdings.length})`;
      if (el.dataset.hfilter === 'active') el.textContent = `Active (${activeCount})`;
      if (el.dataset.hfilter === 'closed') el.textContent = `Closed (${closedCount})`;
    });
  }
}

// ── Cost-basis method ───────────────────────────────────

function costBasisFieldsHtml(current: string): string {
  return `
    <div class="form-grid" style="max-width:500px">
      <div class="form-group">
        <label class="form-label">Method</label>
        <select class="form-input" id="set-cost-basis-method">
          <option value="avgco" ${current === 'avgco' ? 'selected' : ''}>Average cost</option>
          <option value="fifo" ${current === 'fifo' ? 'selected' : ''}>FIFO (first in, first out)</option>
          <option value="lifo" ${current === 'lifo' ? 'selected' : ''}>LIFO (last in, first out)</option>
          <option value="hifo" ${current === 'hifo' ? 'selected' : ''}>HIFO (highest cost first)</option>
        </select>
        <span class="note"><b>Average cost</b> spreads cost evenly across all shares; simple but less precise on partial sells. <b>FIFO</b> uses the oldest lots first; the default under German Abgeltungsteuer. <b>LIFO</b> uses the most recent lots first, often reducing short-term gains. <b>HIFO</b> uses the highest-cost lots first to minimize realized gains where jurisdiction allows.</span>
      </div>
    </div>`;
}

// ── Portfolio contributions ──────────────────────────────────────

function renderContributionsCard(_settings: Settings): string {
  const intervalOptions = Object.entries(INTERVAL_LABELS)
    .map(
      ([val, label]) =>
        `<option value="${esc(val)}" ${getCalibrationInterval() === val ? 'selected' : ''}>${esc(label)}</option>`,
    )
    .join('');
  const contributionIntervalOptions = Object.entries(INTERVAL_LABELS)
    .map(
      ([val, label]) =>
        `<option value="${esc(val)}" ${getContributionInterval() === val ? 'selected' : ''}>${esc(label)}</option>`,
    )
    .join('');

  return `
    <div class="card card-collapsible" id="settings-card-contributions" data-card-key="contributions">
      <div class="card-header js-card-toggle">
        <div class="card-title">Portfolio contributions</div>
        <span class="card-chevron"></span>
      </div>
      <div class="card-body">
        <p class="note" style="margin-bottom:.75rem">Configure your recurring contribution amount and cadence, plus the cadence used to express the rebalance plan in the Portfolio tab.</p>
        <div class="form-group">
          <label class="form-label" for="set-contrib-budget">
            Contribution amount (€)${infoTip('Recurring amount you invest each contribution cycle across all ETFs. Used to size suggested contribution amounts in the drift rebalance plan and forecasts.')}
          </label>
          <input type="number" id="set-contrib-budget" class="form-input"
            value="${esc(String(getContributionBudgetAmount() || ''))}" min="0" step="1" placeholder="e.g. 500">
        </div>
        <div class="form-group" style="margin-top:.75rem">
          <label class="form-label" for="set-contribution-interval">
            Contribution cadence${infoTip('How often your contribution amount is made. The app converts this to a normalized monthly budget for calculations.')}
          </label>
          <select id="set-contribution-interval" class="form-input">${contributionIntervalOptions}</select>
        </div>
        <div class="form-group" style="margin-top:.75rem">
          <label class="form-label" for="set-calibration-interval">
            Calibration interval${infoTip('The contribution cadence used to express suggested amounts in the drift rebalance plan (e.g. Monthly shows how much to invest per month per ETF).')}
          </label>
          <select id="set-calibration-interval" class="form-input">${intervalOptions}</select>
        </div>
        <div class="form-actions">
          <button class="btn btn-primary btn-sm" id="btn-save-contributions">Save</button>
          <span id="contributions-msg" class="form-msg"></span>
        </div>
      </div>
    </div>`;
}

function attachContributionsListeners(root: HTMLElement): void {
  root.querySelector('#btn-save-contributions')?.addEventListener('click', async () => {
    const btn = root.querySelector('#btn-save-contributions') as HTMLButtonElement;
    const budget =
      (root.querySelector('#set-contrib-budget') as HTMLInputElement | null)?.value || '';
    const contributionInterval =
      (root.querySelector('#set-contribution-interval') as HTMLSelectElement | null)?.value ||
      'monthly';
    const interval =
      (root.querySelector('#set-calibration-interval') as HTMLSelectElement | null)?.value ||
      'monthly';
    try {
      await withCardGuard(
        'contributions',
        btn,
        async () => {
          await setSetting('monthly_contrib_budget', budget);
          await setSetting('contribution_interval', contributionInterval);
          await setSetting('calibration_interval', interval);
        },
        { busyText: 'Saving...' },
      );
      showMsg('contributions-msg', 'Saved', true);
    } catch (err) {
      showMsg('contributions-msg', 'Error: ' + (err as Error).message, false);
    }
  });
}

function renderCalcAssumptionsCard(settings: Settings): string {
  const current = getCostBasisMethod();
  const riskFreeRate = parseFloat(settings.riskFreeRate || '2');

  return `
    <div class="card card-collapsible" id="settings-card-calc-assumptions" data-card-key="calc-assumptions">
      <div class="card-header js-card-toggle">
        <div class="card-title">Calculation assumptions</div>
        <span class="card-chevron"></span>
      </div>
      <div class="card-body">
        <div class="card-section-head">COST-BASIS METHOD</div>
        <p class="note" style="margin-bottom:.75rem">Choose how realized gains are calculated when you sell shares.</p>
        <div id="settings-costbasis-fields">${costBasisFieldsHtml(current)}</div>
        <div class="form-actions">
          <button class="btn btn-primary btn-sm" id="btn-save-cost-basis">Save cost-basis method</button>
          <span id="costbasis-msg" class="form-msg"></span>
        </div>
        <div class="card-section-head" style="margin-top:1.25rem">ANALYTICS</div>
        <p class="note" style="margin-bottom:.75rem">Configure parameters used in performance and risk calculations.</p>
        <div class="settings-field">
          <label class="settings-field-label" for="analytics-risk-free-rate">
            Risk-free rate (%)
            ${infoTip('Annual risk-free rate used in Sharpe and Sortino ratio calculations on the Analytics tab. Typically the yield on short-term government bonds (e.g. 3-month T-bills).')}
          </label>
          <input
            type="number"
            id="analytics-risk-free-rate"
            class="form-input form-input-sm"
            value="${riskFreeRate}"
            min="0"
            max="20"
            step="0.01"
            style="width:100px"
            placeholder="2"
          />
        </div>
        <div class="form-actions">
          <button class="btn btn-primary btn-sm" id="btn-save-analytics">Save analytics</button>
          <span id="analytics-msg" class="form-msg"></span>
        </div>
      </div>
    </div>`;
}

function attachCalcAssumptionsListeners(root: HTMLElement): void {
  root.querySelector('#btn-save-cost-basis')?.addEventListener('click', async () => {
    const btn = root.querySelector('#btn-save-cost-basis') as HTMLButtonElement;
    const method =
      (root.querySelector('#set-cost-basis-method') as HTMLSelectElement | null)?.value || 'avgco';
    try {
      await withCardGuard('calc-assumptions', btn, () => setSetting('costBasisMethod', method), {
        busyText: 'Saving...',
      });
      showMsg('costbasis-msg', 'Saved', true);
    } catch (err) {
      showMsg('costbasis-msg', 'Error: ' + (err as Error).message, false);
    }
  });

  root.querySelector('#btn-save-analytics')?.addEventListener('click', async () => {
    const btn = root.querySelector('#btn-save-analytics') as HTMLButtonElement;
    const rfrInput = root.querySelector('#analytics-risk-free-rate') as HTMLInputElement;
    const rfrValue = parseFloat(rfrInput.value);

    if (isNaN(rfrValue) || rfrValue < 0 || rfrValue > 20) {
      showMsg('analytics-msg', 'Risk-free rate must be between 0 and 20', false);
      return;
    }

    try {
      await withCardGuard(
        'calc-assumptions',
        btn,
        () => setSettings({ riskFreeRate: String(rfrValue) }),
        { busyText: 'Saving...' },
      );
      showMsg('analytics-msg', 'Saved', true);
    } catch (err) {
      showMsg('analytics-msg', 'Error: ' + (err as Error).message, false);
    }
  });
}

// ── Goal / target net worth ──────────────────────────────

/** In-memory list of goals — kept in sync by add/edit/delete dialog operations. */
let _goals: NamedGoal[] | null = null;

function _fmtGoalNW(raw: string): string {
  const n = parseFloat(raw.replace(/\./g, '').replace(',', '.'));
  return isFinite(n) ? fmtEur(n) : `\u20AC${raw}`;
}

function renderGoalRow(goal: NamedGoal, idx: number): string {
  const fmtNW = goal.targetNetWorth ? _fmtGoalNW(goal.targetNetWorth) : '';
  const title = goal.label || fmtNW || `Goal ${idx + 1}`;
  const metaParts: string[] = [];
  if (fmtNW) metaParts.push(esc(fmtNW));
  if (goal.targetDate) metaParts.push(esc(formatEnglishMonth(goal.targetDate)));
  const metaStr = metaParts.join(' \u00B7 ');
  return `
    <div class="settings-item settings-goal-row" data-idx="${idx}">
      <div class="settings-item-header">
        <span class="settings-item-title">${esc(title)}</span>
        ${metaStr ? `<span class="settings-item-meta">${metaStr}</span>` : ''}
        <div class="settings-row-actions">
          <button class="btn btn-sm btn-outline btn-icon js-edit-goal" data-idx="${idx}" aria-label="Edit goal" title="Edit goal">${EDIT_ICON}</button>
          <button class="btn btn-sm btn-danger btn-icon js-del-goal" data-idx="${idx}" aria-label="Delete goal" title="Delete goal">${DELETE_ICON}</button>
        </div>
      </div>
    </div>`;
}

function renderGoalCard(_settings: Settings): string {
  const goals = getGoals();
  _goals = goals.slice();
  const rows = goals.map((g, i) => renderGoalRow(g, i)).join('');
  return `
    <div class="card card-collapsible" id="settings-card-goal" data-card-key="goal">
      <div class="card-header js-card-toggle">
        <div class="card-title">Goals</div>
        <span class="card-chevron"></span>
      </div>
      <div class="card-body">
        <p class="note" style="margin-bottom:.75rem">Add one or more net-worth targets to track on the Net Worth tab. Each goal shows progress, remaining amount, and ETA.</p>
        <div id="settings-goals-tbl" class="settings-items">
          ${rows}
        </div>
        <div class="form-actions">
          <button class="btn btn-outline btn-sm" id="btn-add-goal">+ Add goal</button>
          <button class="btn btn-primary btn-sm" id="btn-save-goal">Save goals</button>
          <span id="goal-msg" class="form-msg"></span>
        </div>
      </div>
    </div>`;
}

function rerenderGoalsTable(root: HTMLElement, goals: NamedGoal[]): void {
  _goals = goals.slice();
  const tbl = root.querySelector('#settings-goals-tbl') as HTMLElement | null;
  if (!tbl) return;
  tbl.innerHTML = goals.map((g, i) => renderGoalRow(g, i)).join('');
}

async function deleteGoal(root: HTMLElement, idx: number, btn: HTMLButtonElement): Promise<void> {
  if (isCardBusy('goal') || isBusy()) return;
  const goals = _goals ?? [];
  const goal = goals[idx];
  const title =
    goal?.label || (goal?.targetNetWorth ? `\u20AC${goal.targetNetWorth}` : `Goal ${idx + 1}`);
  const controller = createEditableListController<NamedGoal>({
    getItems: () => _goals ?? [],
    apply: (updated) => rerenderGoalsTable(root, updated),
    msgId: 'goal-msg',
  });
  await persistListRemoval({
    controller,
    index: idx,
    root,
    btn,
    cardKey: 'goal',
    persist: async (updated) => setSettings({ goals: JSON.stringify(updated) }),
    rerender: rerenderGoalsTable,
    confirmTitle: `Remove ${esc(title)}?`,
    confirmBody: 'This removes the goal from your configuration.',
    msgId: 'goal-msg',
    successMessage: 'Removed',
    busyText: 'Removing...',
    keepDisabledOnSuccess: true,
  });
}

function attachGoalListeners(root: HTMLElement): void {
  const controller = createEditableListController<NamedGoal>({
    getItems: () => _goals ?? [],
    apply: (updated) => rerenderGoalsTable(root, updated),
    msgId: 'goal-msg',
  });
  root.querySelector('#btn-add-goal')?.addEventListener('click', async () => {
    const draft = await goalDialog({
      existingLabels: controller.items().map((goal) => goal.label),
    });
    if (!draft) return;
    controller.previewAdd(draft, 'Goal added — click Save to persist.');
  });

  root.addEventListener('click', async (e) => {
    const editBtn = (e.target as Element).closest('.js-edit-goal') as HTMLButtonElement | null;
    if (editBtn) {
      const idx = parseInt(editBtn.dataset.idx ?? '');
      if (!isNaN(idx)) {
        const goals = controller.items();
        const existing = goals[idx];
        if (!existing) return;
        const draft = await goalDialog({
          existing,
          existingLabels: goals.filter((_, i) => i !== idx).map((goal) => goal.label),
        });
        if (!draft) return;
        controller.previewUpdate(idx, draft, 'Goal updated — click Save to persist.');
      }
      return;
    }

    const delBtn = (e.target as Element).closest('.js-del-goal') as HTMLButtonElement | null;
    if (!delBtn) return;
    const idx = parseInt(delBtn.dataset.idx ?? '');
    if (!isNaN(idx)) deleteGoal(root, idx, delBtn);
  });

  root.querySelector('#btn-save-goal')?.addEventListener('click', async () => {
    const btn = root.querySelector('#btn-save-goal') as HTMLButtonElement;
    const goals = (_goals ?? []).filter((g) => g.targetNetWorth);
    const labelErr = validateGoalLabels(goals);
    if (labelErr) {
      showMsg('goal-msg', labelErr, false);
      return;
    }
    try {
      await withCardGuard('goal', btn, () => setSettings({ goals: JSON.stringify(goals) }), {
        busyText: 'Saving...',
      });
      rerenderGoalsTable(root, goals);
      showMsg('goal-msg', 'Saved', true);
    } catch (err) {
      showMsg('goal-msg', 'Error: ' + (err as Error).message, false);
    }
  });
}

// ── Portfolio behavior ────────────────────────────────────

/** Extract rules from settings: rule_1_label, rule_1_value, rule_2_label, ... */
function rulesFromSettings(settings: Settings): { label: string; value: string }[] {
  const rules: { label: string; value: string }[] = [];
  for (let i = 1; i <= 20; i++) {
    const label = settings[`rule_${i}_label`];
    const value = settings[`rule_${i}_value`];
    if (label !== undefined || value !== undefined) {
      rules.push({ label: label || '', value: value || '' });
    }
  }
  return rules;
}

function renderPortfolioBehaviorCard(settings: Settings): string {
  const alertSettings = getAlertSettings();
  const threshold = alertSettings.driftThresholdPct || 5;
  const rules = rulesFromSettings(settings);

  const rows = rules
    .map(
      (r, i) => `
    <div class="settings-item settings-rule-row" data-idx="${i}">
      <div class="settings-item-fields" style="flex-direction:column">
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
    <div class="card card-collapsible" id="settings-card-portfolio-behavior" data-card-key="portfolio-behavior">
      <div class="card-header js-card-toggle">
        <div class="card-title">Portfolio behavior</div>
        <span class="card-chevron"></span>
      </div>
      <div class="card-body">
        <div class="card-section-head">ALERTS</div>
        <p class="note" style="margin-bottom:.75rem">Configure alert conditions for drift and other notifications.</p>
        <div class="settings-field">
          <label class="settings-field-label" for="alert-drift-threshold">
            Drift alert threshold (percentage points)
            ${infoTip('A badge appears on the Portfolio tab when max drift exceeds this threshold. Status colors in the drift table also use this threshold (2x for high drift).')}
          </label>
          <input
            type="number"
            id="alert-drift-threshold"
            class="form-input form-input-sm"
            value="${threshold}"
            min="1"
            max="20"
            step="0.01"
            style="width:100px"
            placeholder="5"
          />
        </div>
        <div class="form-actions">
          <button class="btn btn-primary btn-sm" id="btn-save-alerts">Save alerts</button>
          <span id="alerts-msg" class="form-msg"></span>
        </div>
        <div class="card-section-head" style="margin-top:1.25rem">REINVESTMENT RULES</div>
        <p class="note" style="margin-bottom:.75rem">Notes about how dividends and proceeds from sold positions are reinvested. These are displayed on the Overview tab as reminders.</p>
        <div id="settings-rules-tbl" class="settings-items">
          ${rows}
        </div>
        <div class="form-actions">
          <button class="btn btn-outline btn-sm" id="btn-add-rule">+ Add rule</button>
          <button class="btn btn-primary btn-sm" id="btn-save-rules">Save rules</button>
          <span id="rules-msg" class="form-msg"></span>
        </div>
      </div>
    </div>`;
}

/** Rebuild the full rule_N_label/rule_N_value key set from a rules array;
 *  shared by Save and Delete so both persist identical key numbering. */
async function persistRules(rules: { label: string; value: string }[]): Promise<void> {
  const currentSettings = getSettings();
  const updates: Record<string, string | null> = {};
  for (const key of Object.keys(currentSettings)) {
    if (/^rule_\d+_(label|value)$/.test(key)) updates[key] = null;
  }
  rules.forEach((r, i) => {
    if (r.label || r.value) {
      updates[`rule_${i + 1}_label`] = r.label;
      updates[`rule_${i + 1}_value`] = r.value;
    }
  });
  await setSettings(updates);
}

/** Shared rule-delete implementation. */
async function deleteRule(root: HTMLElement, idx: number, btn: HTMLButtonElement): Promise<void> {
  if (isCardBusy('portfolio-behavior') || isBusy()) return;
  const rules = collectRules(root);
  const ok = await confirmDialog({
    title: 'Remove this rule?',
    confirmLabel: 'Remove',
    danger: true,
  });
  if (!ok) return;
  rules.splice(idx, 1);
  try {
    await withCardGuard('portfolio-behavior', btn, () => persistRules(rules), {
      busyText: 'Removing...',
      keepDisabledOnSuccess: true,
    });
    rerenderRulesTable(root, rules);
    showMsg('rules-msg', 'Removed', true);
  } catch (err) {
    showMsg('rules-msg', 'Error: ' + (err as Error).message, false);
  }
}

function attachPortfolioBehaviorListeners(root: HTMLElement): void {
  root.querySelector('#btn-save-alerts')?.addEventListener('click', async () => {
    const btn = root.querySelector('#btn-save-alerts') as HTMLButtonElement;
    const input = root.querySelector('#alert-drift-threshold') as HTMLInputElement;
    const value = parseFloat(input.value);

    if (isNaN(value) || value < 1 || value > 20) {
      showMsg('alerts-msg', 'Threshold must be between 1 and 20', false);
      return;
    }

    const alertSettings = { driftThresholdPct: value };
    try {
      await withCardGuard(
        'portfolio-behavior',
        btn,
        () =>
          setSettings({
            alerts: JSON.stringify(alertSettings),
          }),
        {
          busyText: 'Saving...',
        },
      );
      showMsg('alerts-msg', 'Saved', true);
      // Trigger drift badge update in main.ts
      if (typeof (window as any).updateDriftBadge === 'function') {
        (window as any).updateDriftBadge();
      }
    } catch (err) {
      showMsg('alerts-msg', 'Error: ' + (err as Error).message, false);
    }
  });

  root.querySelector('#btn-add-rule')?.addEventListener('click', () => {
    const rules = collectRules(root);
    rules.push({ label: '', value: '' });
    rerenderRulesTable(root, rules);
  });

  root.querySelector('#btn-save-rules')?.addEventListener('click', async () => {
    const btn = root.querySelector('#btn-save-rules') as HTMLButtonElement;
    const rules = collectRules(root);
    try {
      await withCardGuard('portfolio-behavior', btn, () => persistRules(rules), {
        busyText: 'Saving...',
      });
      showMsg('rules-msg', 'Saved', true);
    } catch (err) {
      showMsg('rules-msg', 'Error: ' + (err as Error).message, false);
    }
  });

  root.querySelectorAll('.js-del-rule').forEach((btn) => {
    btn.addEventListener('click', () =>
      deleteRule(root, parseInt((btn as HTMLElement).dataset.idx!), btn as HTMLButtonElement),
    );
  });
}

function collectRules(root: HTMLElement): { label: string; value: string }[] {
  const rows = root.querySelectorAll('.settings-rule-row');
  return [...rows].map((row) => ({
    label: (row.querySelector('[data-field="label"]') as HTMLInputElement).value.trim(),
    value: (row.querySelector('[data-field="value"]') as HTMLInputElement).value.trim(),
  }));
}

function rerenderRulesTable(root: HTMLElement, rules: { label: string; value: string }[]): void {
  const tbl = root.querySelector('#settings-rules-tbl');
  if (!tbl) return;
  const rows = rules
    .map(
      (r, i) => `
    <div class="settings-item settings-rule-row" data-idx="${i}">
      <div class="settings-item-fields" style="flex-direction:column">
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
    btn.addEventListener('click', () =>
      deleteRule(root, parseInt((btn as HTMLElement).dataset.idx!), btn as HTMLButtonElement),
    );
  });
}

// ── Helpers ───────────────────────────────────────────────

/** Attach two-way sync between color swatch and hex text inputs. */
function attachColorPickerSync(root: HTMLElement): void {
  root.querySelectorAll('.color-picker-wrap').forEach((wrap) => {
    const swatch = wrap.querySelector('.color-picker-swatch') as HTMLInputElement | null;
    const hex = wrap.querySelector('.color-picker-hex') as HTMLInputElement | null;
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
      if ((e.target as HTMLElement | null)?.closest('.btn-danger')) return;
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
    const id = (item.querySelector('[data-field="id"]') as HTMLInputElement | null)?.value;
    return id ? 'item:acct:' + id : null;
  }
  // Holding rows: use the ISIN field
  if (item.classList.contains('settings-hold-row')) {
    const isin = (item.querySelector('[data-field="isin"]') as HTMLInputElement | null)?.value;
    return isin ? 'item:hold:' + isin : null;
  }
  // Goal rows: use label, falling back to targetNetWorth
  if (item.classList.contains('settings-goal-row')) {
    const label = (
      item.querySelector('[data-field="label"]') as HTMLInputElement | null
    )?.value?.trim();
    const nw = (
      item.querySelector('[data-field="targetNetWorth"]') as HTMLInputElement | null
    )?.value?.trim();
    const key = label || nw;
    return key ? 'item:goal:' + key : null;
  }
  return null;
}

/** Generate a stable snake_case slug from a label. */
function slugify(label: string): string {
  const result = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 30);
  return result || 'account';
}

/** Generate a collision-free ID from a label, avoiding any id in `taken`. */
export function generateId(label: string, taken: Set<string>): string {
  const rawBase = slugify(label);
  const base = rawBase.startsWith('etf_') ? rawBase.slice(4) || 'account' : rawBase;
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
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
  const toHex = (v: number) =>
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
): { shortName: string; acc: boolean; assetClass: string; region: string } {
  const upper = (name || '').toUpperCase();

  // Acc vs Dist
  // Check for explicit (Acc)/(Dist) or Accumulating/Distributing keywords
  let acc = true; // default to accumulating
  if (/\(DIST\)|DISTRIBUTING/i.test(name)) {
    acc = false;
  } else if (/\(ACC\)|ACCUMULATING/i.test(name)) {
    acc = true;
  }

  // Asset class
  let assetClass = 'equity';
  if (/BOND|AGGREGATE|FIXED.?INCOME|TREASURY|GOVT/i.test(name)) {
    assetClass = 'bond';
  } else if (/REIT|REAL.?ESTATE|PROPERTY/i.test(name)) {
    assetClass = 'reit';
  } else if (/GOLD|COMMODITY|COMMODITIES/i.test(name)) {
    assetClass = 'commodity';
  }

  // Region
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

  // Short name generation
  // Produce compact, recognizable labels similar to what brokers display.
  // Strategy: match specific fund characteristics from the cleaned name,
  // building a short label from [Index/Asset] + [Variant] components.
  let shortName = isin; // fallback to full ISIN

  // ── Step 1: Try well-known specific patterns (most specific first) ──
  // These cover the top ~150 ETFs by AUM in Europe (iShares, Vanguard,
  // Xtrackers, Amundi, SPDR). Labels mimic broker short-name conventions.
  const INDEX_SHORTCUTS: [RegExp, string][] = [
    // ── MSCI Equity - specific variants first ──
    [/MSCI\s+EM\s+IMI/i, 'EM IMI'],
    [/MSCI\s+World\s+SRI/i, 'World SRI'],
    [/MSCI\s+World\s+ESG/i, 'World ESG'],
    [/MSCI\s+World\s+Small/i, 'World SC'],
    [/MSCI\s+World\s+Mom/i, 'World Mom'],
    [/MSCI\s+World\s+Val/i, 'World Val'],
    [/MSCI\s+World\s+Min.*Vol/i, 'World MV'],
    [/MSCI\s+World\s+Qual/i, 'World Qual'],
    [/MSCI\s+ACWI\s+SRI/i, 'ACWI SRI'],
    [/MSCI\s+ACWI/i, 'ACWI'],
    [/MSCI\s+EM\s+SRI/i, 'EM SRI'],
    [/MSCI\s+EM(\s|$)/i, 'EM'],
    [/MSCI\s+World/i, 'World'],
    [/MSCI\s+Europe\s+SRI/i, 'Eur SRI'],
    [/MSCI\s+Europe/i, 'Europe'],
    [/MSCI\s+USA\s+SRI/i, 'USA SRI'],
    [/MSCI\s+USA/i, 'USA'],
    [/MSCI\s+Japan/i, 'Japan'],
    [/MSCI\s+Pacific/i, 'Pacific'],

    // ── FTSE ──
    [/FTSE\s+All.?World\s+High\s*Div/i, 'FTSE AW HD'],
    [/FTSE\s+All.?World/i, 'FTSE AW'],
    [/FTSE\s+Dev.*World/i, 'FTSE Dev'],
    [/FTSE\s+Dev.*Europe/i, 'FTSE Eur'],
    [/FTSE\s+Dev.*Asia/i, 'FTSE Asia'],
    [/FTSE\s+EM/i, 'FTSE EM'],
    [/FTSE\s+100/i, 'FTSE 100'],
    [/FTSE\s+250/i, 'FTSE 250'],

    // ── S&P / US ──
    [/S&P\s*500\s+Info/i, 'SP500 IT'],
    [/S&P\s*500\s+Health/i, 'SP500 HC'],
    [/S&P\s*500\s+Financ/i, 'SP500 Fin'],
    [/S&P\s*500\s+Energy/i, 'SP500 Ene'],
    [/S&P\s*500\s+ESG/i, 'SP500 ESG'],
    [/S&P\s*500/i, 'S&P 500'],
    [/NASDAQ.?100/i, 'Nasdaq100'],
    [/Dow\s*Jones.*Ind/i, 'DJIA'],
    [/Russell\s*2000/i, 'Russ 2000'],

    // ── European equity ──
    [/EURO\s*STOXX\s*50/i, 'EuroSt 50'],
    [/STOXX\s*Europe\s*600/i, 'Stx Eur600'],
    [/DAX/i, 'DAX'],
    [/CAC\s*40/i, 'CAC 40'],

    // ── Asia / Other equity ──
    [/Nikkei\s*225/i, 'Nikkei'],
    [/TOPIX/i, 'TOPIX'],
    [/Hang\s*Seng/i, 'Hang Seng'],
    [/CSI\s*300/i, 'CSI 300'],
    [/MSCI\s+China/i, 'China'],
    [/MSCI\s+India/i, 'India'],

    // ── Bonds - Government ──
    [/Euro\s+Gov.*?(\d+[-–]\d+\s*(?:yr?|Year))/i, 'EGov $1'],
    [/Euro\s+Gov(ernment|t)?\s+Bond/i, 'EUR Govt'],
    [/US\s+Treas.*?(\d+[-–]\d+\s*(?:yr?|Year))/i, 'USTrs $1'],
    [/US\s+Treas/i, 'US Treas'],
    [/Glob.*Gov/i, 'Glb Govt'],

    // ── Bonds - Corporate ──
    [/Euro\s+(Corp|Corporate)\s+Bond/i, 'EUR Corp'],
    [/USD\s+(Corp|Corporate)\s+Bond/i, 'USD Corp'],
    [/Glob.*(Corp|Credit)/i, 'Glb Corp'],

    // ── Bonds - Aggregate / Multi ──
    [/Glob.*Agg.*EUR/i, 'GlbAgg EUR'],
    [/Glob.*Agg/i, 'Glb Agg'],
    [/Euro.*Agg/i, 'EUR Agg'],
    [/US.*Agg/i, 'US Agg'],

    // ── Bonds - High Yield ──
    [/EUR?.*High\s*Yield/i, 'EUR HY'],
    [/US.*High\s*Yield/i, 'US HY'],
    [/Glob.*High\s*Yield/i, 'Glb HY'],

    // ── Bonds - Inflation-linked ──
    [/Inflation.?Link.*EUR/i, 'EUR IL'],
    [/Inflation.?Link.*US/i, 'US TIPS'],
    [/TIPS/i, 'US TIPS'],

    // ── Real estate ──
    [/Glob.*REIT/i, 'Glb REIT'],
    [/Develop.*Prop|Dev.*Real/i, 'Dev REIT'],
    [/US\s+REIT|US.*Prop/i, 'US REIT'],
    [/Europ.*REIT|Europ.*Prop/i, 'Eur REIT'],

    // ── Commodities ──
    [/Gold/i, 'Gold'],
    [/Silver/i, 'Silver'],
    [/Diversif.*Commod|Broad.*Commod/i, 'Commod'],
    [/Physic.*Gold/i, 'Phys Gold'],

    // ── Thematic / Sector ──
    [/Clean\s*Energy/i, 'Clean Ene'],
    [/Digital.*Security|Cyber/i, 'Cyber'],
    [/Automat.*Robot/i, 'Robot'],
    [/Healthcare/i, 'Healthcr'],
    [/Ageing\s*Pop/i, 'Ageing'],
    [/Water/i, 'Water'],
    [/Glob.*Infra/i, 'Infra'],
  ];
  for (const [re, label] of INDEX_SHORTCUTS) {
    if (re.test(name)) {
      // Handle capture groups (e.g. "7-10yr" in bond maturity patterns)
      const m = name.match(re);
      if (m && m[1] && label.includes('$1')) {
        // Normalize maturity: "7-10yr" / "1-3 Year" → "7-10Y"
        const normed = m[1].trim().replace(/\s*(Year|yr?)/i, 'Y');
        shortName = label.replace('$1', normed).slice(0, 10);
      } else {
        shortName = label;
      }
      return { shortName, acc, assetClass, region };
    }
  }

  // Strip the provider prefix, strip "(Acc)"/"(Dist)", strip "UCITS ETF ..."
  const cleaned = name
    .replace(/\(Acc\)|\(Dist\)|Accumulating|Distributing/gi, '')
    .replace(/UCITS\s+ETF.*/i, '')
    .replace(
      /^(iShares|Vanguard|Xtrackers|Amundi|SPDR|Invesco|Lyxor|WisdomTree|UBS|HSBC|BNP)\s*(Core\s*)?/i,
      '',
    )
    .trim();
  if (cleaned) {
    // Build a compact abbreviation from remaining words
    const words = cleaned.split(/\s+/).filter((w) => w.length > 0);
    if (words.length <= 2) {
      shortName = words.join(' ').slice(0, 10);
    } else if (words.length === 3) {
      // Abbreviate third word if needed to fit in 10 chars
      const joined = words.join(' ');
      shortName = joined.length <= 10 ? joined : (words[0] + ' ' + words[1]).slice(0, 10);
    } else {
      // Take initials of long names
      shortName = words
        .map((w) => w[0])
        .join('')
        .toUpperCase()
        .slice(0, 10);
    }
  }

  return { shortName, acc, assetClass, region };
}

/** Subtract N months from a YYYY-MM-DD date string, returning YYYY-MM-DD.
 *  Builds the result from local getFullYear/getMonth/getDate (never
 *  toISOString(), which converts to UTC and can roll the date back a day
 *  in any UTC+ timezone, including Europe/Berlin). */
function subtractMonths(dateStr: string, months: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setMonth(d.getMonth() - months);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ── Cache / Force resync ──────────────────────────────────

function renderCacheCard(): string {
  const hasConflict = window.__hasSyncConflict?.() ?? false;
  return `
    <div class="card card-collapsible" id="settings-card-cache" data-card-key="cache">
      <div class="card-header js-card-toggle">
        <div class="card-title">Cache &amp; sync</div>
        <span class="card-chevron"></span>
      </div>
      <div class="card-body">
        <p class="note" style="margin-bottom:.75rem">Data is stored locally in SQLite and synced to Google Drive. If sync pauses because both copies changed, resolve the conflict here and export a backup first if you want the safest path.</p>
        ${
          hasConflict
            ? '<p class="note" style="margin-bottom:.75rem;color:var(--warn-fg)">Sync is paused because Drive changed elsewhere and this device also has local changes.</p>'
            : ''
        }
        <div style="display:flex;gap:10px;margin-top:.5rem;align-items:center;flex-wrap:wrap">
          ${
            hasConflict
              ? '<button class="btn btn-primary btn-sm" id="btn-resolve-sync-conflict">Resolve sync conflict</button>'
              : ''
          }
          <button class="btn btn-outline btn-sm" id="btn-force-resync">Force full resync</button>
          <span id="resync-msg" class="form-msg"></span>
        </div>
        <p class="note" style="margin-top:.75rem">Force full resync clears cached views and re-checks Drive. It is not the primary tool for resolving a sync conflict.</p>
      </div>
    </div>`;
}

function attachCacheListeners(root: HTMLElement): void {
  root.querySelector('#btn-resolve-sync-conflict')?.addEventListener('click', async () => {
    const btn = root.querySelector('#btn-resolve-sync-conflict') as HTMLButtonElement;
    try {
      await withCardGuard(
        'cache',
        btn,
        () => window.__openSyncConflictResolver?.() ?? Promise.resolve(),
        {
          busyText: 'Opening...',
        },
      );
    } catch (err: any) {
      showMsg('resync-msg', 'Error: ' + (err?.message || 'unknown'), false);
    }
  });
  root.querySelector('#btn-force-resync')?.addEventListener('click', async () => {
    if (!navigator.onLine) {
      showMsg('resync-msg', 'Unavailable offline. Connect to the internet first.', false);
      return;
    }
    const btn = root.querySelector('#btn-force-resync') as HTMLButtonElement;
    try {
      await withCardGuard('cache', btn, () => window.__forceFullResync!(), {
        busyText: 'Resyncing...',
      });
      showMsg('resync-msg', 'Done', true);
    } catch (err: any) {
      showMsg('resync-msg', 'Error: ' + (err?.message || 'unknown'), false);
    }
  });
}

// ── Backup & restore ──────────────────────────────────────

function backupNudgeHtml(settings: Settings): string {
  const lastBackupAt = settings['last_backup_at'];
  const stale = isBackupStale(lastBackupAt ?? undefined);
  if (!stale) return '';
  const nudgeText = !lastBackupAt
    ? 'No backup yet. Takes just a few seconds, worth doing now.'
    : "It's been over 30 days since your last backup. A quick export keeps your data safe.";
  return `<p class="note" style="margin-bottom:.75rem;color:var(--ink-2)">${nudgeText}</p>`;
}

function renderBackupCard(): string {
  return `
    <div class="card card-collapsible" id="settings-card-backup" data-card-key="backup">
      <div class="card-header js-card-toggle">
        <div class="card-title">Backup &amp; restore</div>
        <span class="card-chevron"></span>
      </div>
      <div class="card-body">
        <p class="note" style="margin-bottom:.85rem">Export everything as one file you can keep somewhere safe. If anything happens to your Sheet, restore from that file.</p>
        <div id="settings-backup-nudge">${backupNudgeHtml(getSettings())}</div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
          <button class="btn btn-outline btn-sm" id="btn-export-backup">Export backup</button>
          <button class="btn btn-ghost btn-sm" id="btn-restore-backup">Restore from file\u2026</button>
          <input type="file" id="backup-file-input" accept="application/json" style="display:none">
        </div>
        <div id="backup-msg" style="font-size:12px;margin-top:.6rem;min-height:18px"></div>
      </div>
    </div>`;
}

function attachBackupListeners(root: HTMLElement): void {
  root.querySelector('#btn-export-backup')?.addEventListener('click', async () => {
    const btn = root.querySelector('#btn-export-backup') as HTMLButtonElement;
    try {
      await withCardGuard('backup', btn, () => window.__exportBackup!(), {
        busyText: 'Exporting...',
      });
      refreshBackupData();
      showMsg('backup-msg', 'Backup downloaded.', true);
    } catch (err: any) {
      showMsg('backup-msg', 'Export failed: ' + err.message, false);
    }
  });
  const fileInput = root.querySelector('#backup-file-input') as HTMLInputElement | null;
  root.querySelector('#btn-restore-backup')?.addEventListener('click', () => fileInput?.click());
  fileInput?.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    const btn = root.querySelector('#btn-restore-backup') as HTMLButtonElement;
    try {
      const result = await withCardGuard('backup', btn, () => window.__restoreFromBackup!(file), {
        busyText: 'Restoring...',
      });
      if (result === 'cancelled') {
        showMsg('backup-msg', 'Restore cancelled.', false);
      } else {
        showMsg('backup-msg', 'Restore complete.', true);
      }
    } catch (err: any) {
      showMsg('backup-msg', 'Restore failed: ' + err.message, false);
    }
  });
}

// ── Config history (audit log) ──────────────────────────────────────────────

function fmtHistoryTimestamp(iso: string): string {
  if (!iso) return '';
  try {
    return formatEnglishDateTime(new Date(iso));
  } catch {
    return iso;
  }
}

export function renderConfigHistoryCard(entries: ConfigHistoryEntry[]): string {
  let body: string;
  if (entries.length === 0) {
    body = '<p class="note" style="margin-top:.5rem">No changes recorded yet.</p>';
  } else {
    const hdrStyle =
      'text-align:left;font-size:11px;color:var(--ink-3);border-bottom:1px solid var(--line)';
    const rows = entries
      .map(
        (e) => `
      <tr>
        <td style="white-space:nowrap;padding-right:1rem;color:var(--ink-3);font-size:11px">${esc(fmtHistoryTimestamp(e.timestamp))}</td>
        <td style="padding-right:.75rem;font-size:12px;color:var(--ink-2)">${esc(e.entity)}</td>
        <td style="font-size:12px">${esc(e.summary)}</td>
      </tr>`,
      )
      .join('');
    body = `
      <div style="overflow-x:auto;margin-top:.5rem">
        <table style="border-collapse:collapse;width:100%;min-width:400px">
          <thead><tr style="${hdrStyle}">
            <th style="padding-bottom:.4rem;padding-right:1rem">When</th>
            <th style="padding-bottom:.4rem;padding-right:.75rem">What</th>
            <th style="padding-bottom:.4rem">Summary</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <p class="note" style="margin-top:.6rem">Showing the last ${entries.length} change${entries.length === 1 ? '' : 's'}.</p>`;
  }

  return `
    <div class="card card-collapsible collapsed" id="settings-card-config-history" data-card-key="config-history">
      <div class="card-header js-card-toggle">
        <div class="card-title">Config history</div>
        <span class="card-chevron"></span>
      </div>
      <div class="card-body">
        <p class="note" style="margin-bottom:.5rem">Read-only log of recent configuration changes (accounts, holdings, settings).</p>
        ${body}
      </div>
    </div>`;
}

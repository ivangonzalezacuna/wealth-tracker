import {
  getAccounts,
  getHoldings,
  getSettings,
  setAccounts,
  setHoldings,
  setSettings,
  setSetting,
  saveSnapshotMapping,
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
import {
  getSnapshotMapping,
  updateSnapshotMapping,
  SNAPSHOT_MAPPINGS_KEY,
} from '../import/snapshotMapping';
import { getSnapshotParser, snapshotParsers } from '../import/snapshotParsers';
import {
  snapshotMappingFields,
  wireSnapshotMappingFields,
  readSnapshotMappingFields,
} from '../ui/snapshotMappingFields';
import type { ConfigChangeKind } from '../store/config';
import {
  loadTransactions,
  loadConfigHistory,
  loadSnapshots,
  saveSnapshots,
  getFxTelemetry,
  getFxTelemetryMonthly,
  loadAllFxRates,
  restoreAllFxRates,
} from '../db';
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
import { showMsg, reinjectPendingMsg, withButtonGuard, esc, fmtEur, fmtPctNeg } from '../utils';
import { buildAnnualReport, renderAnnualReportHtml } from '../model/annualReport';
import type {
  Account,
  FxTelemetry,
  FxTelemetryMonthly,
  Holding,
  Settings,
  ContribInterval,
  NamedGoal,
  Transaction,
  Snapshot,
} from '../types';
import { formatEnglishDate, formatEnglishDateTime, formatEnglishMonth } from '../dateFormat';
import { accountSuggestions } from '../model/accountSuggestions';
import { isCollapsed, setCollapsed, toggleCollapsed } from '../ui/collapseState';
import { infoTip, attachInfoTips } from '../ui/infoTip';
import { bindSearchClear, chipButtonsHtml, searchHtml } from '../ui/filterBar';
import { confirmDialog } from '../ui/confirmDialog';
import { notify, type ToastVariant } from '../ui/toast';
import { accountDialog } from '../ui/accountDialog';
import { holdingDialog } from '../ui/holdingDialog';
import { goalDialog } from '../ui/goalDialog';
import { ACCOUNT_TYPES } from '../model/accountTypes';
import { isSignedIn, hasEverGranted } from '../auth/google';
import { isBackupStale } from '../backup/exportImport';
import { applyAttention, refreshAttention } from '../ui/attention';
import { isBusy, setBusy } from '../sync/lock';
import { isSyncing } from '../sync/engine';
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

import { EDIT_ICON, DELETE_ICON, UNDO_ICON } from './icons';
import { navHash, SETTINGS_VIEWS, type SettingsView } from '../nav';

/** Card key: identifies which settings card an action belongs to. */
type CardKey =
  | 'accounts'
  | 'holdings'
  | 'contributions'
  | 'calc-assumptions'
  | 'goal'
  | 'portfolio-behavior'
  | 'integrations'
  | 'cache'
  | 'backup'
  | 'reports'
  | 'config-history';

function settingsCardHeader(key: CardKey, title: string, summary = ''): string {
  const collapsed = key === 'config-history' || isCollapsed('card:' + key);
  return `<h3 class="settings-card-heading">
    <button type="button" class="card-header js-card-toggle" id="settings-heading-${key}"
      aria-expanded="${!collapsed}" aria-controls="settings-body-${key}">
      <span class="settings-card-label"><span class="card-title">${title}</span>
      <span class="settings-card-summary">${esc(summary)}</span></span>
      <span class="card-chevron" aria-hidden="true"></span>
    </button>
  </h3>`;
}

function setListDraftState(msgId: string, dirty: boolean): void {
  const card = document.getElementById(msgId)?.closest<HTMLElement>('.card');
  if (!card) return;
  card.classList.toggle('settings-dirty', dirty);
  const status = card.querySelector<HTMLElement>('.settings-draft-status');
  if (status) status.textContent = dirty ? 'Unsaved changes' : '';
  const save = card.querySelector<HTMLButtonElement>('button[data-save-for="' + msgId + '"]');
  if (save) setSaveDirty(save, dirty);
}

const NO_CHANGES_TITLE = 'No changes to save';

// Reapply data-dirty after card guards and sync locks release their buttons.
function setSaveDirty(btn: HTMLButtonElement, dirty: boolean, draftDirty = dirty): void {
  btn.dataset.dirty = String(dirty);
  btn.dataset.draftDirty = String(draftDirty);
  applySaveDirtyState(btn);
  const card = btn.closest<HTMLElement>('.card');
  card?.classList.toggle('settings-dirty', !!card.querySelector('button[data-draft-dirty="true"]'));
}

function applySaveDirtyState(btn: HTMLButtonElement): void {
  if (btn.dataset.dirty === undefined) return;
  const clean = btn.dataset.dirty !== 'true';
  if (btn.title === SYNC_BUSY_TITLE) return;
  if (clean) {
    btn.disabled = true;
    btn.title = NO_CHANGES_TITLE;
  } else {
    if (btn.title === NO_CHANGES_TITLE) btn.title = '';
    if (!isBusy() && !isCardBusy(btnCardKey(btn))) btn.disabled = false;
  }
}

function btnCardKey(btn: HTMLElement): CardKey {
  return (btn.closest<HTMLElement>('[data-card-key]')?.dataset.cardKey ?? '') as CardKey;
}

interface FormDirtyTracker {
  refresh(): void;
  commit(): void;
}

/** Trackers whose section can be re-rendered from the store outside its own listeners. */
const _formDirty = new Map<string, FormDirtyTracker>();

function trackFormDirty(
  root: HTMLElement,
  button: string,
  selector: string | HTMLElement | null,
  read?: () => string,
  forceDirty: () => boolean = () => false,
): FormDirtyTracker {
  const scope = typeof selector === 'string' ? root.querySelector<HTMLElement>(selector) : selector;
  const snapshot = read ?? (() => fieldValues(scope));
  let baseline = snapshot();
  const refresh = () => {
    const btn = root.querySelector<HTMLButtonElement>(`#btn-save-${button}`);
    const changed = snapshot() !== baseline;
    if (btn) setSaveDirty(btn, forceDirty() || changed, changed);
  };
  scope?.addEventListener('input', refresh);
  scope?.addEventListener('change', refresh);
  refresh();
  return {
    refresh,
    commit() {
      baseline = snapshot();
      refresh();
    },
  };
}

function fieldValues(scope: ParentNode | null): string {
  if (!scope) return '';
  return JSON.stringify(
    Array.from(
      scope.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
        'input, select, textarea',
      ),
    ).map((el) =>
      el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')
        ? el.checked
        : el.value,
    ),
  );
}

function clearInlineMsg(id: string): void {
  const inline = document.getElementById(id);
  if (!inline) return;
  inline.textContent = '';
  inline.classList.remove('msg-ok', 'msg-err');
}

function toastResult(source: string, text: string, variant: ToastVariant): void {
  clearInlineMsg(source);
  notify(text, { variant, source });
}

function errorText(err: unknown): string {
  return (err as Error)?.message || 'unknown error';
}

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
  opts: { busyText?: string; keepDisabledOnSuccess?: boolean; allowDuringConflict?: boolean } = {},
): Promise<T | undefined> {
  if (!opts.allowDuringConflict && window.__allowSyncWrite?.() === false) {
    throw new Error('Resolve sync recovery first, then retry saving. Nothing was saved.');
  }
  // isBusy() is the single lock also held by main.ts during background
  // sync/import/backup writes (see sync/lock.ts). Checking it here stops
  // a Settings save from starting while an auto-resync is loadConfig()-ing
  // the same in-memory store; setting it for the duration of this card's
  // write stops the reverse race.
  if (isCardBusy(cardKey) || isBusy() || isSyncing()) return undefined;
  _cardBusy.add(cardKey);
  setBusy(true);
  applySyncBusyState(); // grey out every OTHER card's buttons too, not just this one's

  // Disable all buttons in this card so none are clickable while busy
  const cardEl = document.getElementById(`settings-card-${cardKey}`);
  const siblingBtns: HTMLButtonElement[] = [];
  if (cardEl) {
    for (const b of Array.from(cardEl.querySelectorAll('button'))) {
      if (b !== btn && !b.disabled && !b.classList.contains('js-card-toggle')) {
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
    cardEl?.querySelectorAll<HTMLButtonElement>('button[data-dirty]').forEach(applySaveDirtyState);
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
  'btn-retry-report',
]);
const SYNC_BUSY_TITLE = 'Sync in progress, try again in a moment';
const SETTINGS_DEFAULT_COLLAPSE_MARKER = 'settings-defaults-v1';
const SETTINGS_DEFAULT_COLLAPSED_CARDS: ReadonlySet<CardKey> = new Set([
  'portfolio-behavior',
  'integrations',
  'cache',
  'backup',
  'reports',
  'config-history',
]);

const SETTINGS_TABS: ReadonlyArray<{ view: SettingsView; label: string; panel: string }> = [
  { view: 'portfolio', label: 'Portfolio', panel: 'settings-group-portfolio' },
  { view: 'planning', label: 'Planning', panel: 'settings-group-tracking' },
  { view: 'advanced', label: 'Advanced', panel: 'settings-group-advanced' },
];
let _settingsView: SettingsView = 'portfolio';

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
  const busy = isBusy() || isSyncing();
  root.querySelectorAll<HTMLButtonElement>('.card button').forEach((btn) => {
    if (
      SYNC_LOCK_EXEMPT_IDS.has(btn.id) ||
      btn.dataset.hfilter !== undefined ||
      btn.classList.contains('js-card-toggle')
    )
      return;
    if (busy) {
      btn.disabled = true;
      btn.title = SYNC_BUSY_TITLE;
    } else if (btn.title === SYNC_BUSY_TITLE) {
      btn.disabled = btn.id === 'btn-download-report' && btn.dataset.reportReady !== 'true';
      btn.title = '';
      applySaveDirtyState(btn);
    }
  });
}

/**
 * Render the Settings section with user-friendly forms for Accounts, Holdings, and Settings.
 * Only shown after config is loaded (sign-in required).
 */
export function renderSettings(opts: { preserveDrafts?: boolean } = {}): void {
  const el = document.getElementById('settings-content');
  if (!el) return;
  if (!isConfigLoaded() || !(isSignedIn() || hasEverGranted())) {
    el.innerHTML = '<p class="note">Sign in and load data to manage settings.</p>';
    return;
  }

  const accounts = getAccounts();
  const holdings = getHoldings();
  const settings = getSettings();
  const drafts = new Map(
    opts.preserveDrafts
      ? Array.from(el.querySelectorAll<HTMLElement>('.settings-dirty[data-card-key]')).map(
          (card) => [card.dataset.cardKey!, card] as const,
        )
      : [],
  );
  const cardHtml = (key: CardKey, render: () => string): string =>
    drafts.has(key) ? `<div data-preserved-card="${key}"></div>` : render();
  applySettingsDefaultCollapseState();

  el.innerHTML = `
    <div class="subnav range-toggle settings-tabs" role="tablist" aria-label="Settings sections">
      ${SETTINGS_TABS.map(
        (t) =>
          `<button type="button" class="btn btn-sm btn-ghost" id="settings-tab-${t.view}" role="tab" data-settings-view="${t.view}" aria-controls="${t.panel}">${t.label}</button>`,
      ).join('')}
    </div>
    <div class="settings-group" id="settings-group-portfolio" role="tabpanel" aria-labelledby="settings-tab-portfolio">
      ${cardHtml('accounts', () => renderAccountsCard(accounts))}
      ${cardHtml('holdings', () => renderHoldingsCard(holdings))}
    </div>
    <div class="settings-group" id="settings-group-tracking" role="tabpanel" aria-labelledby="settings-tab-planning">
      ${cardHtml('contributions', () => renderContributionsCard(settings))}
      ${cardHtml('calc-assumptions', () => renderCalcAssumptionsCard(settings))}
      ${cardHtml('goal', () => renderGoalCard(settings))}
    </div>
    <div class="settings-group" id="settings-group-advanced" role="tabpanel" aria-labelledby="settings-tab-advanced">
      ${cardHtml('portfolio-behavior', () => renderPortfolioBehaviorCard(settings))}
      ${cardHtml('integrations', () => renderFxIntegrationsCard(settings))}
      ${cardHtml('cache', renderCacheCard)}
      ${cardHtml('backup', renderBackupCard)}
      ${cardHtml('reports', renderReportCard)}
      ${cardHtml('config-history', () => renderConfigHistoryCard([]))}
    </div>
  `;

  if (!drafts.has('accounts')) attachAccountListeners(el);
  if (!drafts.has('holdings')) attachHoldingListeners(el);
  if (!drafts.has('contributions')) attachContributionsListeners(el);
  if (!drafts.has('calc-assumptions')) attachCalcAssumptionsListeners(el);
  if (!drafts.has('goal')) attachGoalListeners(el);
  if (!drafts.has('portfolio-behavior')) attachPortfolioBehaviorListeners(el);
  if (!drafts.has('integrations')) attachFxIntegrationListeners(el);
  if (!drafts.has('cache')) attachCacheListeners(el);
  if (!drafts.has('backup')) attachBackupListeners(el);
  attachColorPickerSync(el);
  attachCardCollapseListeners(el);
  if (!drafts.has('reports')) attachReportListeners(el);
  attachSettingsGroupNavListeners(el);
  el.querySelectorAll('.form-msg, #backup-msg').forEach((message) => {
    message.setAttribute('role', 'status');
    message.setAttribute('aria-live', 'polite');
  });

  // Load and render config history asynchronously after initial paint
  const historyCard = el.querySelector('#settings-card-config-history');
  void loadConfigHistory(50)
    .then((entries) => {
      if (!historyCard?.isConnected) return;
      const template = document.createElement('template');
      template.innerHTML = renderConfigHistoryCard(entries);
      const body = historyCard.querySelector('.card-body');
      const nextBody = template.content.querySelector('.card-body');
      if (body && nextBody) body.innerHTML = nextBody.innerHTML;
    })
    .catch((error: unknown) => {
      if (!historyCard?.isConnected) return;
      const body = historyCard.querySelector('.card-body');
      if (body) {
        body.textContent =
          'Configuration history could not be loaded: ' +
          (error instanceof Error ? error.message : String(error));
        body.setAttribute('role', 'status');
      }
    });

  // Reapply persisted collapse state after re-render
  el.querySelectorAll('.card-collapsible').forEach((card) => {
    const key = (card as HTMLElement).dataset.cardKey;
    if (key && isCollapsed('card:' + key)) card.classList.add('collapsed');
  });

  attachInfoTips(el);
  // Restore the original nodes and listeners, not copies of unsaved form state.
  for (const [key, card] of drafts) {
    el.querySelector(`[data-preserved-card="${key}"]`)?.replaceWith(card);
  }
  refreshSyncRecoveryControls();
  applyAttention();
  reinjectPendingMsg();
  applySyncBusyState();
}

function attachSettingsGroupNavListeners(root: HTMLElement): void {
  const tablist = root.querySelector<HTMLElement>('.settings-tabs');
  if (!tablist) return;
  applySettingsView(_settingsView);
  tablist.addEventListener('click', (event) => {
    const btn = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-settings-view]');
    if (btn) selectSettingsView(btn.dataset.settingsView as SettingsView);
  });
  tablist.addEventListener('keydown', (event) => {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const cur = SETTINGS_VIEWS.indexOf(_settingsView);
    const n = SETTINGS_VIEWS.length;
    const next =
      event.key === 'ArrowRight'
        ? (cur + 1) % n
        : event.key === 'ArrowLeft'
          ? (cur - 1 + n) % n
          : event.key === 'Home'
            ? 0
            : n - 1;
    selectSettingsView(SETTINGS_VIEWS[next]);
    document.getElementById(`settings-tab-${SETTINGS_VIEWS[next]}`)?.focus();
  });
}

function selectSettingsView(view: SettingsView): void {
  setSettingsView(view);
  if (document.getElementById('settings')?.classList.contains('active')) {
    history.replaceState(null, '', navHash('settings', _settingsView));
  }
}

/** Show one Settings section (tab) and hide the others. Safe before mount. */
export function setSettingsView(view: SettingsView | null | undefined): void {
  _settingsView = view && SETTINGS_VIEWS.includes(view) ? view : 'portfolio';
  applySettingsView(_settingsView);
}

export function getSettingsView(): SettingsView {
  return _settingsView;
}

function applySettingsView(view: SettingsView): void {
  for (const t of SETTINGS_TABS) {
    const active = t.view === view;
    const tab = document.getElementById(`settings-tab-${t.view}`);
    if (tab) {
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.setAttribute('tabindex', active ? '0' : '-1');
    }
    const panel = document.getElementById(t.panel);
    if (panel) panel.hidden = !active;
  }
}

// ── Data-only refresh functions ───────────────────────────
/** Each rewrites exactly the data region inside an already-mounted card and
 *  nothing else - never the buttons, never the message span. */

function refreshAccountsData(): void {
  const root = document.getElementById('settings-card-accounts');
  if (root && !root.classList.contains('settings-dirty'))
    rerenderAccountsTable(root, getAccounts());
}

function refreshHoldingsData(): void {
  const root = document.getElementById('settings-card-holdings');
  if (root && !root.classList.contains('settings-dirty'))
    rerenderHoldingsTable(root, getHoldings());
}

function refreshRulesData(): void {
  const root = document.getElementById('settings-card-portfolio-behavior');
  if (root?.classList.contains('settings-dirty')) return;
  if (root) rerenderRulesTable(root, rulesFromSettings(getSettings()));
  _formDirty.get('rules')?.commit();
}

function refreshCostBasisData(): void {
  const el = document.getElementById('settings-costbasis-fields');
  if (el?.closest('.settings-dirty')) return;
  if (el) el.innerHTML = costBasisFieldsHtml(getCostBasisMethod());
  _formDirty.get('cost-basis')?.commit();
}

function refreshGoalData(): void {
  const card = document.getElementById('settings-card-goal');
  if (card && !card.classList.contains('settings-dirty')) rerenderGoalsTable(card, getGoals());
}

function refreshBackupData(): void {
  const el = document.getElementById('settings-backup-nudge');
  if (el) el.innerHTML = backupNudgeHtml(getSettings());
  refreshAttention();
}

function refreshFxIntegrationsData(): void {
  const root = document.getElementById('settings-content');
  if (!root) return;
  void refreshFxIntegrationStatus(root);
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
  refreshFxIntegrationsData();
}

// ── Accounts ──────────────────────────────────────────────

/** In-memory list of accounts kept in sync by add/edit/delete dialog operations. */
let _accounts: Account[] | null = null;

/** Dialog suggestions from the accounts that stay (rows marked for removal don't count). */
function accountDialogSuggestions(accounts: Account[]) {
  return accountSuggestions(keptItems(accounts));
}

// Unsaved list changes are tracked per item object, so they survive filtered
// re-renders and nothing is persisted until the card's Save button is used.
const _newDrafts = new WeakSet<object>();
const _editedDrafts = new WeakSet<object>();
const _removedDrafts = new WeakSet<object>();

function isRemovedDraft(item: object): boolean {
  return _removedDrafts.has(item);
}

function hasDraftMark(item: object): boolean {
  return _newDrafts.has(item) || _editedDrafts.has(item) || _removedDrafts.has(item);
}

/** Items that a Save should persist (everything not marked for removal). */
function keptItems<T extends object>(items: T[]): T[] {
  return items.filter((item) => !_removedDrafts.has(item));
}

function clearDraftMarks(items: object[]): void {
  for (const item of items) {
    _newDrafts.delete(item);
    _editedDrafts.delete(item);
    _removedDrafts.delete(item);
  }
}

function draftRowClass(item: object): string {
  if (_removedDrafts.has(item)) return ' settings-item-removed';
  if (_newDrafts.has(item)) return ' settings-item-new';
  if (_editedDrafts.has(item)) return ' settings-item-edited';
  return '';
}

function draftBadge(item: object): string {
  if (_removedDrafts.has(item)) return '<span class="badge b-draft-removed">Removed</span>';
  if (_newDrafts.has(item)) return '<span class="badge b-draft-new">New</span>';
  if (_editedDrafts.has(item)) return '<span class="badge b-draft-edited">Edited</span>';
  return '';
}

/** Edit + Remove buttons, or a single Undo button once the row is marked for removal. */
function rowActionsHtml(item: object, i: number, kind: string, noun: string, name: string): string {
  if (_removedDrafts.has(item)) {
    return `<div class="settings-row-actions">
      <button class="btn btn-sm btn-outline btn-icon js-del-${kind}" data-idx="${i}" aria-label="Undo remove ${noun} ${name}" title="Undo remove">${UNDO_ICON}</button>
    </div>`;
  }
  return `<div class="settings-row-actions">
      <button class="btn btn-sm btn-outline btn-icon js-edit-${kind}" data-idx="${i}" aria-label="Edit ${noun} ${name}" title="Edit ${noun}">${EDIT_ICON}</button>
      <button class="btn btn-sm btn-danger btn-icon js-del-${kind}" data-idx="${i}" aria-label="Delete ${noun} ${name}" title="Delete ${noun}">${DELETE_ICON}</button>
    </div>`;
}

interface EditableListController<T> {
  items(): T[];
  previewAdd(next: T): T[];
  previewUpdate(index: number, next: T): T[];
  toggleRemoval(index: number): T[];
}

function createEditableListController<T extends object>(opts: {
  getItems: () => T[];
  apply: (items: T[]) => void;
  msgId: string;
}): EditableListController<T> {
  const commit = (updated: T[]) => {
    opts.apply(updated);
    setListDraftState(opts.msgId, updated.some(hasDraftMark));
    return updated;
  };
  return {
    items: () => opts.getItems(),
    previewAdd(next) {
      _newDrafts.add(next);
      return commit([...opts.getItems(), next]);
    },
    previewUpdate(index, next) {
      const prev = opts.getItems()[index];
      if (prev && _newDrafts.has(prev)) _newDrafts.add(next);
      else _editedDrafts.add(next);
      return commit(opts.getItems().map((item, itemIndex) => (itemIndex === index ? next : item)));
    },
    toggleRemoval(index) {
      const items = opts.getItems();
      const item = items[index];
      if (!item) return items;
      // An unsaved new item has nothing to restore, so it is simply dropped.
      if (_newDrafts.has(item) && !_removedDrafts.has(item)) {
        clearDraftMarks([item]);
        return commit(items.filter((_, itemIndex) => itemIndex !== index));
      }
      if (_removedDrafts.has(item)) _removedDrafts.delete(item);
      else _removedDrafts.add(item);
      return commit(items.slice());
    },
  };
}

let _accountsSettingsFilter = 'all'; // 'all' or an account type value ('other' for untyped)
let _accountsSettingsSearch = '';

function accountTypeKey(a: Account): string {
  return a.moneyType || 'other';
}

function accountTypeChipLabel(type: string): string {
  if (type === 'other') return 'Other';
  const label = ACCOUNT_TYPES.find((t) => t.value === type)?.label || type;
  // "AVD (Altersvorsorgedepot)" -> "AVD": chips stay short.
  return label.replace(/\s*\(.*\)$/, '');
}

/** Account types in use, in the canonical ACCOUNT_TYPES order (unknown types last). */
function accountTypesInUse(all: Account[]): string[] {
  const used = new Set(all.map(accountTypeKey));
  const known = ACCOUNT_TYPES.map((t) => t.value).filter((v) => used.has(v));
  return known.concat([...used].filter((v) => !known.includes(v)).sort());
}

function filterSettingsAccounts(all: Account[]): Account[] {
  const q = _accountsSettingsSearch.trim().toLowerCase();
  return all.filter((a) => {
    if (_accountsSettingsFilter !== 'all' && accountTypeKey(a) !== _accountsSettingsFilter)
      return false;
    if (!q) return true;
    return [
      a.label,
      a.institution,
      a.group,
      a.country,
      a.currency,
      accountTypeChipLabel(accountTypeKey(a)),
    ].some((v) => (v || '').toLowerCase().includes(q));
  });
}

function settingsAccountChips(all: Account[]): string {
  return chipButtonsHtml({
    attr: 'afilter',
    value: _accountsSettingsFilter,
    chips: [
      { value: 'all', label: 'All', count: all.length },
      ...accountTypesInUse(all).map((type) => ({
        value: type,
        label: accountTypeChipLabel(type),
        count: all.filter((a) => accountTypeKey(a) === type).length,
      })),
    ],
  });
}

function settingsAccountRows(all: Account[]): string {
  const filtered = filterSettingsAccounts(all);
  if (!filtered.length && all.length)
    return `<p class="note settings-acct-empty">No accounts match the current filter.</p>`;
  // Keep the original index so edit/remove operations target the right account.
  return filtered.map((a) => renderAccountRow(a, all.indexOf(a))).join('');
}

/** The filter bar appears once there is something to filter; type chips only with 2+ types. */
function syncAccountFilterBar(root: ParentNode, all: Account[]): void {
  const bar = root.querySelector<HTMLElement>('.settings-acct-filter-bar');
  if (bar) bar.hidden = all.length < 2;
  const chips = root.querySelector<HTMLElement>('#acct-filter-toggle');
  if (chips) {
    chips.innerHTML = settingsAccountChips(all);
    chips.hidden = accountTypesInUse(all).length < 2;
  }
}

function applyAccountsFilter(root: HTMLElement): void {
  const all = _accounts ?? [];
  const tbl = root.querySelector('#settings-accounts-tbl');
  if (tbl) tbl.innerHTML = settingsAccountRows(all);
  syncAccountFilterBar(root, all);
}

function renderAccountsCard(accounts: Account[]): string {
  _accounts = accounts.slice();
  if (
    _accountsSettingsFilter !== 'all' &&
    !accountTypesInUse(accounts).includes(_accountsSettingsFilter)
  )
    _accountsSettingsFilter = 'all';
  const rows = settingsAccountRows(accounts);
  const types = accountTypesInUse(accounts);

  return `
    <div class="card card-collapsible" id="settings-card-accounts" data-card-key="accounts">
      ${settingsCardHeader('accounts', 'Accounts', `${accounts.length} account${accounts.length === 1 ? '' : 's'}`)}
      <div class="card-body">
        <p class="note" style="margin-bottom:.5rem">One row per bank account or portfolio, tracked in each monthly snapshot.</p>
        <div class="filter-bar filter-bar-stacked settings-acct-filter-bar"${accounts.length < 2 ? ' hidden' : ''}>
          ${searchHtml({
            id: 'settings-acct-search',
            value: _accountsSettingsSearch,
            placeholder: 'Search name, institution or group',
            ariaLabel: 'Search accounts by name, institution, group or country',
          })}
          <div class="range-toggle filter-chips" id="acct-filter-toggle" role="group" aria-label="Show account types"${types.length < 2 ? ' hidden' : ''}>${settingsAccountChips(accounts)}</div>
        </div>
        <div id="settings-accounts-tbl" class="settings-items settings-list">
          ${rows}
        </div>
        <div class="form-actions">
          <button class="btn btn-outline btn-sm" id="btn-add-acct">+ Add account</button>
          <button class="btn btn-primary btn-sm" id="btn-save-accts" data-save-for="accts-msg" data-dirty="false" title="No changes to save" disabled>Save accounts</button>
          <span class="settings-draft-status" role="status"></span>
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
  const sub = [
    a.institution ? esc(a.institution) : '',
    typeLabel,
    a.group ? esc(a.group) : '',
    a.country ? esc(a.country) : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const facts = [
    a.annualReturnPct ? `${fmtPctNeg(a.annualReturnPct, 2)}/yr` : '',
    a.currency && a.currency.toUpperCase() !== 'EUR' ? esc(a.currency.toUpperCase()) : '',
    a.locked ? `Locked${a.lockedUntil ? ' to ' + esc(a.lockedUntil) : ''}` : '',
  ].filter(Boolean);
  const badge =
    (a.isPrimaryInvestment ? '<span class="badge b-active">Primary</span>' : '') + draftBadge(a);
  const name = esc(a.label) || 'New account';

  return `
    <div class="settings-item settings-acct-row${draftRowClass(a)}" data-idx="${i}">
      <div class="settings-item-header">
        <span class="leg-sq" style="background:${esc(color)};flex-shrink:0"></span>
        <span class="settings-item-copy">
          <span class="settings-item-title" title="${name}">${name}</span>
          ${sub ? `<span class="settings-item-meta" title="${sub}">${sub}</span>` : ''}
        </span>
        ${settingsItemFacts(facts, badge)}
        ${rowActionsHtml(a, i, 'acct', 'account', name)}
      </div>
    </div>`;
}

function settingsItemFacts(facts: string[], badge = ''): string {
  if (!facts.length && !badge) return '';
  return `<span class="settings-item-facts">${facts
    .map((f) => `<span class="settings-item-fact">${f}</span>`)
    .join('')}${badge}</span>`;
}

/** Mark an account for removal (or undo the mark). Nothing is persisted
 *  here; Save accounts commits the removal and retires its id. Accounts
 *  with stored snapshot balances cannot be marked at all. */
async function toggleAccountRemoval(
  controller: EditableListController<Account>,
  idx: number,
): Promise<void> {
  if (isCardBusy('accounts')) return;
  const a = controller.items()[idx];
  if (!a) return;
  if (isRemovedDraft(a)) {
    controller.toggleRemoval(idx);
    return;
  }
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
  controller.toggleRemoval(idx);
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
  root.querySelector('#acct-filter-toggle')?.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-afilter]');
    if (!btn) return;
    _accountsSettingsFilter = btn.dataset.afilter || 'all';
    applyAccountsFilter(root);
  });
  root.querySelector<HTMLInputElement>('#settings-acct-search')?.addEventListener('input', (e) => {
    _accountsSettingsSearch = (e.currentTarget as HTMLInputElement).value;
    applyAccountsFilter(root);
  });
  bindSearchClear(root.querySelector<HTMLElement>('.settings-acct-filter-bar'));
  root.querySelector('#btn-add-acct')?.addEventListener('click', async () => {
    const draft = await accountDialog({
      existingLabels: controller.items().map((a) => a.label),
      ...accountDialogSuggestions(controller.items()),
    });
    if (!draft) return;
    draft.order = controller.items().length + 1;
    controller.previewAdd(draft);
  });

  root.querySelector('#settings-accounts-tbl')?.addEventListener('click', async (e) => {
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
      ...accountDialogSuggestions(accounts),
    });
    if (!draft) return;
    draft.order = existing.order;
    controller.previewUpdate(idx, draft);
  });

  root.querySelector('#btn-save-accts')?.addEventListener('click', async () => {
    const btn = root.querySelector('#btn-save-accts') as HTMLButtonElement;
    const all = _accounts ?? [];
    const accounts = keptItems(all);
    const removedIds = all
      .filter(isRemovedDraft)
      .map((a) => a.id)
      .filter((id): id is string => !!id);
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
      ...all.map((a) => (a.id || a.key || '').trim()).filter((id) => !!id),
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
      let message = 'Accounts saved';
      // setAccounts runs before retireAccountIdsSafely so getAccounts() is
      // correct before retirement's own settings write can trigger a refresh.
      // Retirement never throws: a failed write is queued and retried on load.
      const saved = await withCardGuard(
        'accounts',
        btn,
        async () => {
          await migrateLegacySnapshotKeys(accounts);
          await setAccounts(accounts);
          if (removedIds.length > 0 && !(await retireAccountIdsSafely(removedIds))) {
            message = 'Accounts saved (will finish reserving removed ids once back online)';
          }
          return true;
        },
        { busyText: 'Saving...' },
      );
      if (!saved) return;
      clearDraftMarks(all);
      rerenderAccountsTable(root, accounts);
      setListDraftState('accts-msg', false);
      toastResult('accts-msg', message, 'success');
    } catch (err) {
      toastResult('accts-msg', 'Could not save accounts: ' + errorText(err), 'error');
    }
  });

  root.querySelector('#settings-accounts-tbl')?.addEventListener('click', (e) => {
    const delBtn = (e.target as Element).closest('.js-del-acct') as HTMLButtonElement | null;
    if (!delBtn) return;
    const idx = parseInt(delBtn.dataset.idx ?? '');
    if (!isNaN(idx)) void toggleAccountRemoval(controller, idx);
  });
}

function collectAccounts(_root: HTMLElement): Account[] {
  return _accounts ?? [];
}

function rerenderAccountsTable(root: HTMLElement, accounts: Account[]): void {
  _accounts = accounts.slice();
  const summary = root.querySelector('#settings-heading-accounts .settings-card-summary');
  if (summary)
    summary.textContent = `${accounts.length} account${accounts.length === 1 ? '' : 's'}`;
  // Edits reset the filter so a new or changed account is always visible.
  _accountsSettingsFilter = 'all';
  _accountsSettingsSearch = '';
  const search = root.querySelector<HTMLInputElement>('#settings-acct-search');
  if (search) search.value = '';
  const tbl = root.querySelector('#settings-accounts-tbl') as HTMLElement | null;
  if (!tbl) return;
  tbl.innerHTML = settingsAccountRows(accounts);
  syncAccountFilterBar(root, accounts);
}

// ── Holdings ──────────────────────────────────────────────

/** In-memory list of holdings kept in sync by add/edit/delete dialog operations. */
let _holdings: Holding[] | null = null;
let _holdingsSettingsFilter = 'all'; // 'all' | 'active' | 'closed'
let _holdingsSettingsSearch = '';
let _allHoldings: Holding[] | null = null; // cached full holdings list for filtered views
let _suggestionTransactions: Transaction[] = [];

function filterSettingsHoldings(all: Holding[]): Holding[] {
  const q = _holdingsSettingsSearch.trim().toLowerCase();
  return all.filter((h) => {
    if (_holdingsSettingsFilter === 'active' && !h.active) return false;
    if (_holdingsSettingsFilter === 'closed' && h.active) return false;
    if (!q) return true;
    return [h.shortName, h.name, h.isin].some((v) => (v || '').toLowerCase().includes(q));
  });
}

function settingsHoldingChips(all: Holding[]): string {
  const activeCount = all.filter((h) => h.active).length;
  return chipButtonsHtml({
    attr: 'hfilter',
    value: _holdingsSettingsFilter,
    chips: [
      { value: 'all', label: 'All', count: all.length },
      { value: 'active', label: 'Active', count: activeCount },
      { value: 'closed', label: 'Closed', count: all.length - activeCount },
    ],
  });
}

function settingsHoldingRows(all: Holding[]): string {
  const filtered = filterSettingsHoldings(all);
  if (!filtered.length && all.length)
    return `<p class="note settings-hold-empty">No holdings match the current filter.</p>`;
  // Keep the original index so delete/edit operations target the right holding.
  return filtered.map((h) => renderHoldingRow(h, all.indexOf(h))).join('');
}

function renderHoldingsCard(holdings: Holding[]): string {
  // Cache the full list for merge-back when filter is active
  _holdings = holdings.slice();
  _allHoldings = holdings.slice();
  const activeCount = holdings.filter((h) => h.active).length;
  const rows = settingsHoldingRows(holdings);

  return `
    <div class="card card-collapsible" id="settings-card-holdings" data-card-key="holdings">
      ${settingsCardHeader('holdings', 'Holdings (ETFs)', `${holdings.length} holdings · ${activeCount} active for allocation`)}
      <div class="card-body">
        <p class="note" style="margin-bottom:.5rem">Set a target % on active holdings for drift and rebalancing. Closed positions can fold into a successor fund.</p>
        <div class="filter-bar filter-bar-stacked settings-hold-filter-bar">
          ${searchHtml({
            id: 'settings-hold-search',
            value: _holdingsSettingsSearch,
            placeholder: 'Search ISIN or name',
            ariaLabel: 'Search holdings by ISIN or name',
          })}
          <div class="range-toggle filter-chips" id="hold-filter-toggle" role="group" aria-label="Show holdings">${settingsHoldingChips(holdings)}</div>
        </div>
        <div id="settings-holdings-tbl" class="settings-items settings-list">
          ${rows}
        </div>
        <div class="form-actions">
          <button class="btn btn-outline btn-sm" id="btn-add-hold">+ Add holding</button>
          <button class="btn btn-outline btn-sm" id="btn-autofill-holds">Auto-fill from transactions</button>
          <button class="btn btn-primary btn-sm" id="btn-save-holds" data-save-for="holds-msg" data-dirty="false" title="No changes to save" disabled>Save holdings</button>
          <span class="settings-draft-status" role="status"></span>
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
  const name = esc(h.shortName) || esc(h.isin) || 'New holding';
  const sub = [h.isin ? esc(h.isin) : '', h.name && h.name !== h.shortName ? esc(h.name) : '']
    .filter(Boolean)
    .join(' · ');
  const facts = [
    h.targetPct != null && isFinite(h.targetPct) ? `${fmtPctNeg(h.targetPct, 2)} target` : '',
    h.ter != null && isFinite(h.ter) ? `TER ${fmtPctNeg(h.ter, 2)}` : '',
    h.acc === false ? 'Dist' : 'Acc',
  ].filter(Boolean);

  return `
    <div class="settings-item settings-hold-row${draftRowClass(h)}" data-idx="${i}">
      <div class="settings-item-header">
        <span class="leg-sq" style="background:${esc(color)};flex-shrink:0"></span>
        <span class="settings-item-copy">
          <span class="settings-item-title" title="${name}">${name}</span>
          ${sub ? `<span class="settings-item-meta" title="${sub}">${sub}</span>` : ''}
        </span>
        ${settingsItemFacts(facts, statusBadge + draftBadge(h))}
        ${rowActionsHtml(h, i, 'hold', 'holding', name)}
      </div>
    </div>`;
}

/**
 * Scoped repaint: rewrite only the holdings table rows and filter-button
 * active state. Does NOT touch sibling cards, so collapse state is preserved.
 */
function applyHoldingsFilter(root: HTMLElement): void {
  const all = _allHoldings ?? getHoldings();
  const tbl = root.querySelector('#settings-holdings-tbl');
  if (tbl) tbl.innerHTML = settingsHoldingRows(all);
  const chips = root.querySelector('#hold-filter-toggle');
  if (chips) chips.innerHTML = settingsHoldingChips(all);
}

/** Mark a holding for removal (or undo the mark); Save holdings commits it. */
function toggleHoldingRemoval(controller: EditableListController<Holding>, idx: number): void {
  if (isCardBusy('holdings')) return;
  controller.toggleRemoval(idx);
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
  root.querySelector<HTMLInputElement>('#settings-hold-search')?.addEventListener('input', (e) => {
    _holdingsSettingsSearch = (e.currentTarget as HTMLInputElement).value;
    applyHoldingsFilter(root);
  });
  bindSearchClear(root.querySelector<HTMLElement>('.settings-hold-filter-bar'));

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
    controller.previewAdd(draft);
  });

  root.querySelector('#settings-holdings-tbl')?.addEventListener('click', async (e) => {
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
    controller.previewUpdate(idx, { ...draft, order: existing.order });
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
            const newHolding: Holding = {
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
            };
            _newDrafts.add(newHolding);
            holds.push(newHolding);
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
          if (added > 0) setListDraftState('holds-msg', true);
          toastResult(
            'holds-msg',
            added > 0
              ? `Added ${added} holding(s) from transactions. Review and save.`
              : 'All transaction ISINs already configured.',
            'info',
          );
        },
        { busyText: 'Loading...' },
      );
    } catch (err) {
      toastResult('holds-msg', 'Could not load transactions: ' + errorText(err), 'error');
    }
  });

  root.querySelector('#btn-save-holds')?.addEventListener('click', async () => {
    const btn = root.querySelector('#btn-save-holds') as HTMLButtonElement;
    const all = _holdings ?? [];
    const holds = keptItems(all);
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
      const saved = await withCardGuard(
        'holdings',
        btn,
        () => setHoldings(holds).then(() => true),
        { busyText: 'Saving...' },
      );
      if (!saved) return;
      clearDraftMarks(all);
      rerenderHoldingsTable(root, holds);
      setListDraftState('holds-msg', false);
      toastResult('holds-msg', 'Holdings saved', 'success');
    } catch (err) {
      toastResult('holds-msg', 'Could not save holdings: ' + errorText(err), 'error');
    }
  });

  root.querySelector('#settings-holdings-tbl')?.addEventListener('click', (e) => {
    const delBtn = (e.target as Element).closest('.js-del-hold') as HTMLButtonElement | null;
    if (!delBtn) return;
    const idx = parseInt(delBtn.dataset.idx ?? '');
    if (!isNaN(idx)) toggleHoldingRemoval(controller, idx);
  });
}

function rerenderHoldingsTable(root: HTMLElement, holdings: Holding[]): void {
  // Update cache and reset filter to show all when modifying
  _holdings = holdings.slice();
  _allHoldings = holdings.slice();
  _holdingsSettingsFilter = 'all';
  _holdingsSettingsSearch = '';
  const search = root.querySelector<HTMLInputElement>('#settings-hold-search');
  if (search) search.value = '';
  const summary = root.querySelector('#settings-heading-holdings .settings-card-summary');
  if (summary)
    summary.textContent = `${holdings.length} holdings · ${holdings.filter((h) => h.active).length} active for allocation`;
  const tbl = root.querySelector('#settings-holdings-tbl');
  if (!tbl) return;
  const rows = holdings.map((h, i) => renderHoldingRow(h, i)).join('');
  tbl.innerHTML = rows;
  const toggle = root.querySelector('#hold-filter-toggle');
  if (toggle) toggle.innerHTML = settingsHoldingChips(holdings);
}

// ── Cost-basis method ───────────────────────────────────

function costBasisFieldsHtml(current: string): string {
  return `
    <div class="settings-method-fields">
      <div class="form-group">
        <label class="form-label" for="set-cost-basis-method">Method</label>
        <select class="form-input" id="set-cost-basis-method">
          <option value="avgco" ${current === 'avgco' ? 'selected' : ''}>Average cost</option>
          <option value="fifo" ${current === 'fifo' ? 'selected' : ''}>FIFO (first in, first out)</option>
          <option value="lifo" ${current === 'lifo' ? 'selected' : ''}>LIFO (last in, first out)</option>
          <option value="hifo" ${current === 'hifo' ? 'selected' : ''}>HIFO (highest cost first)</option>
        </select>
        <p class="note settings-method-help"><b>Average cost</b> spreads cost evenly across all shares; simple but less precise on partial sells. <b>FIFO</b> uses the oldest lots first; the default under German Abgeltungsteuer. <b>LIFO</b> uses the most recent lots first, often reducing short-term gains. <b>HIFO</b> uses the highest-cost lots first to minimize realized gains where jurisdiction allows.</p>
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
      ${settingsCardHeader('contributions', 'Portfolio contributions', 'Amount, cadence, and calibration')}
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
          <button class="btn btn-primary btn-sm" id="btn-save-contributions">Save contributions</button>
          <span id="contributions-msg" class="form-msg"></span>
        </div>
      </div>
    </div>`;
}

function attachContributionsListeners(root: HTMLElement): void {
  const contributionsDirty = trackFormDirty(
    root,
    'contributions',
    '#settings-card-contributions .card-body',
  );
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
      contributionsDirty.commit();
      toastResult('contributions-msg', 'Contributions saved', 'success');
    } catch (err) {
      toastResult('contributions-msg', 'Could not save contributions: ' + errorText(err), 'error');
    }
  });
}

function renderCalcAssumptionsCard(settings: Settings): string {
  const current = getCostBasisMethod();
  const riskFreeRate = parseFloat(settings.riskFreeRate || '2');

  return `
    <div class="card card-collapsible" id="settings-card-calc-assumptions" data-card-key="calc-assumptions">
      ${settingsCardHeader('calc-assumptions', 'Calculation assumptions', 'Cost basis and risk parameters')}
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
  const costBasisDirty = trackFormDirty(root, 'cost-basis', '#settings-costbasis-fields');
  _formDirty.set('cost-basis', costBasisDirty);
  const analyticsDirty = trackFormDirty(
    root,
    'analytics',
    '#settings-card-calc-assumptions .settings-field',
  );
  root.querySelector('#btn-save-cost-basis')?.addEventListener('click', async () => {
    const btn = root.querySelector('#btn-save-cost-basis') as HTMLButtonElement;
    const method =
      (root.querySelector('#set-cost-basis-method') as HTMLSelectElement | null)?.value || 'avgco';
    try {
      await withCardGuard('calc-assumptions', btn, () => setSetting('costBasisMethod', method), {
        busyText: 'Saving...',
      });
      costBasisDirty.commit();
      toastResult('costbasis-msg', 'Cost-basis method saved', 'success');
    } catch (err) {
      toastResult('costbasis-msg', 'Could not save cost-basis method: ' + errorText(err), 'error');
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
      analyticsDirty.commit();
      toastResult('analytics-msg', 'Analytics saved', 'success');
    } catch (err) {
      toastResult('analytics-msg', 'Could not save analytics: ' + errorText(err), 'error');
    }
  });
}

// ── Goal / target net worth ──────────────────────────────

/** In-memory list of goals kept in sync by add/edit/delete dialog operations. */
let _goals: NamedGoal[] | null = null;

function _fmtGoalNW(raw: string): string {
  const n = parseFloat(raw.replace(/\./g, '').replace(',', '.'));
  return isFinite(n) ? fmtEur(n) : `\u20AC${raw}`;
}

function renderGoalRow(goal: NamedGoal, idx: number): string {
  const fmtNW = goal.targetNetWorth ? _fmtGoalNW(goal.targetNetWorth) : '';
  const title = goal.label || fmtNW || `Goal ${idx + 1}`;
  const metaParts: string[] = [];
  if (goal.targetDate) metaParts.push(esc(formatEnglishMonth(goal.targetDate)));
  const msCount = goal.milestones?.length ?? 0;
  if (msCount > 0) metaParts.push(`${msCount} milestone${msCount === 1 ? '' : 's'}`);
  const metaStr = metaParts.join(' \u00B7 ');
  return `
    <div class="settings-item settings-goal-row${draftRowClass(goal)}" data-idx="${idx}">
      <div class="settings-item-header">
        <span class="settings-item-copy">
          <span class="settings-item-title">${esc(title)}</span>
          ${metaStr ? `<span class="settings-item-meta">${metaStr}</span>` : ''}
        </span>
        ${settingsItemFacts(fmtNW && title !== fmtNW ? [esc(fmtNW)] : [], draftBadge(goal))}
        ${rowActionsHtml(goal, idx, 'goal', 'goal', esc(title))}
      </div>
    </div>`;
}

function renderGoalCard(_settings: Settings): string {
  const goals = getGoals();
  _goals = goals.slice();
  const rows = goals.map((g, i) => renderGoalRow(g, i)).join('');
  return `
    <div class="card card-collapsible" id="settings-card-goal" data-card-key="goal">
      ${settingsCardHeader('goal', 'Goals', `${goals.length} goal${goals.length === 1 ? '' : 's'}`)}
      <div class="card-body">
        <p class="note" style="margin-bottom:.5rem">Net-worth targets shown on the Net Worth tab with progress and ETA.</p>
        <div id="settings-goals-tbl" class="settings-items settings-list">
          ${rows}
        </div>
        <div class="form-actions">
          <button class="btn btn-outline btn-sm" id="btn-add-goal">+ Add goal</button>
          <button class="btn btn-primary btn-sm" id="btn-save-goal" data-save-for="goal-msg" data-dirty="false" title="No changes to save" disabled>Save goals</button>
          <span class="settings-draft-status" role="status"></span>
          <span id="goal-msg" class="form-msg"></span>
        </div>
      </div>
    </div>`;
}

function rerenderGoalsTable(root: HTMLElement, goals: NamedGoal[]): void {
  _goals = goals.slice();
  const summary = root.querySelector('#settings-heading-goal .settings-card-summary');
  if (summary) summary.textContent = `${goals.length} goal${goals.length === 1 ? '' : 's'}`;
  const tbl = root.querySelector('#settings-goals-tbl') as HTMLElement | null;
  if (!tbl) return;
  tbl.innerHTML = goals.map((g, i) => renderGoalRow(g, i)).join('');
}

/** Mark a goal for removal (or undo the mark); Save goals commits it. */
function toggleGoalRemoval(controller: EditableListController<NamedGoal>, idx: number): void {
  if (isCardBusy('goal')) return;
  controller.toggleRemoval(idx);
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
    controller.previewAdd(draft);
  });

  root.querySelector('#settings-goals-tbl')?.addEventListener('click', async (e) => {
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
        controller.previewUpdate(idx, draft);
      }
      return;
    }

    const delBtn = (e.target as Element).closest('.js-del-goal') as HTMLButtonElement | null;
    if (!delBtn) return;
    const idx = parseInt(delBtn.dataset.idx ?? '');
    if (!isNaN(idx)) toggleGoalRemoval(controller, idx);
  });

  root.querySelector('#btn-save-goal')?.addEventListener('click', async () => {
    const btn = root.querySelector('#btn-save-goal') as HTMLButtonElement;
    const all = _goals ?? [];
    const goals = keptItems(all).filter((g) => g.targetNetWorth);
    const labelErr = validateGoalLabels(goals);
    if (labelErr) {
      showMsg('goal-msg', labelErr, false);
      return;
    }
    try {
      const saved = await withCardGuard(
        'goal',
        btn,
        () => setSettings({ goals: JSON.stringify(goals) }).then(() => true),
        { busyText: 'Saving...' },
      );
      if (!saved) return;
      clearDraftMarks(all);
      rerenderGoalsTable(root, goals);
      setListDraftState('goal-msg', false);
      toastResult('goal-msg', 'Goals saved', 'success');
    } catch (err) {
      toastResult('goal-msg', 'Could not save goals: ' + errorText(err), 'error');
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

  const rows = rules.map((r, i) => renderRuleRow(r, i)).join('');
  return `
    <div class="card card-collapsible" id="settings-card-portfolio-behavior" data-card-key="portfolio-behavior">
      ${settingsCardHeader('portfolio-behavior', 'Portfolio behavior', 'Drift alerts and reinvestment rules')}
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

type RuleDraft = { label: string; value: string; removed?: boolean };

function renderRuleRow(r: RuleDraft, i: number): string {
  const removed = !!r.removed;
  const disabled = removed ? ' disabled' : '';
  const action = removed
    ? `<button class="btn btn-sm btn-outline js-del-rule" data-idx="${i}" aria-label="Undo remove rule ${i + 1}">Undo remove</button>`
    : `<button class="btn btn-sm btn-danger js-del-rule" data-idx="${i}">✕ Remove</button>`;
  return `
    <div class="settings-item settings-rule-row${removed ? ' settings-item-removed' : ''}" data-idx="${i}"${removed ? ' data-removed="true"' : ''}>
      <div class="settings-item-fields" style="flex-direction:column">
        <div class="settings-field">
          <label class="settings-field-label">Description</label>
          <input class="form-input form-input-sm" data-field="label" value="${esc(r.label)}" placeholder="e.g. Dividends reinvested"${disabled}>
        </div>
        <div class="settings-field">
          <label class="settings-field-label">Action</label>
          <input class="form-input form-input-sm" data-field="value" value="${esc(r.value)}" placeholder="e.g. into IWDA weekly"${disabled}>
        </div>
      </div>
      <div style="text-align:right;margin-top:4px">${removed ? '<span class="badge b-draft-removed">Removed</span> ' : ''}${action}</div>
    </div>
  `;
}

/** Mark a rule for removal (or undo the mark); Save rules commits it. */
function toggleRuleRemoval(root: HTMLElement, idx: number): void {
  if (isCardBusy('portfolio-behavior')) return;
  const rules = collectRules(root, true);
  const rule = rules[idx];
  if (!rule) return;
  rule.removed = !rule.removed;
  rerenderRulesTable(root, rules);
  root
    .querySelector<HTMLButtonElement>(`.settings-rule-row[data-idx="${idx}"] .js-del-rule`)
    ?.focus();
}

function attachPortfolioBehaviorListeners(root: HTMLElement): void {
  const alertsDirty = trackFormDirty(
    root,
    'alerts',
    '#settings-card-portfolio-behavior > .card-body > .settings-field',
  );
  const rulesDirty = trackFormDirty(root, 'rules', '#settings-rules-tbl', () =>
    JSON.stringify(collectRules(root)),
  );
  _formDirty.set('rules', rulesDirty);
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
      alertsDirty.commit();
      toastResult('alerts-msg', 'Alerts saved', 'success');
      refreshAttention();
    } catch (err) {
      toastResult('alerts-msg', 'Could not save alerts: ' + errorText(err), 'error');
    }
  });

  root.querySelector('#btn-add-rule')?.addEventListener('click', () => {
    const rules = collectRules(root, true);
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
      rerenderRulesTable(root, rules);
      rulesDirty.commit();
      toastResult('rules-msg', 'Rules saved', 'success');
    } catch (err) {
      toastResult('rules-msg', 'Could not save rules: ' + errorText(err), 'error');
    }
  });

  root.querySelector('#settings-rules-tbl')?.addEventListener('click', (e) => {
    const btn = (e.target as Element).closest<HTMLElement>('.js-del-rule');
    if (!btn) return;
    const idx = parseInt(btn.dataset.idx ?? '');
    if (!isNaN(idx)) toggleRuleRemoval(root, idx);
  });
}

/** Rule rows as shown; rows marked for removal are skipped unless `includeRemoved`. */
function collectRules(root: HTMLElement, includeRemoved = false): RuleDraft[] {
  const rows = root.querySelectorAll<HTMLElement>('.settings-rule-row');
  return [...rows]
    .map((row) => {
      const rule: RuleDraft = {
        label: (row.querySelector('[data-field="label"]') as HTMLInputElement).value.trim(),
        value: (row.querySelector('[data-field="value"]') as HTMLInputElement).value.trim(),
      };
      if (row.dataset.removed === 'true') rule.removed = true;
      return rule;
    })
    .filter((rule) => includeRemoved || !rule.removed);
}

function rerenderRulesTable(root: HTMLElement, rules: RuleDraft[]): void {
  const tbl = root.querySelector('#settings-rules-tbl');
  if (!tbl) return;
  tbl.innerHTML = rules.map((r, i) => renderRuleRow(r, i)).join('');
  _formDirty.get('rules')?.refresh();
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
  root.querySelectorAll<HTMLButtonElement>('.js-card-toggle').forEach((header) => {
    const card = header.closest<HTMLElement>('.card-collapsible');
    const body = card?.querySelector<HTMLElement>('.card-body');
    if (card && body) {
      body.id = header.getAttribute('aria-controls') || '';
      const key = card.dataset.cardKey;
      card.classList.toggle(
        'collapsed',
        key === 'config-history' || (!!key && isCollapsed('card:' + key)),
      );
      body.hidden = card.classList.contains('collapsed');
      header.setAttribute('aria-expanded', String(!body.hidden));
      body.setAttribute('aria-labelledby', header.id);
    }
    header.addEventListener('click', () => {
      const card = header.closest('.card-collapsible') as HTMLElement | null;
      if (!card) return;
      const key = card.dataset.cardKey;
      if (key && key !== 'config-history') {
        const collapsed = toggleCollapsed('card:' + key);
        card.classList.toggle('collapsed', collapsed);
      } else {
        card.classList.toggle('collapsed');
      }
      const body = card.querySelector<HTMLElement>('.card-body');
      if (body) body.hidden = card.classList.contains('collapsed');
      header.setAttribute('aria-expanded', String(!card.classList.contains('collapsed')));
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

// ── Integrations ──────────────────────────────────────────

function renderFxIntegrationsCard(settings: Settings): string {
  const enabled = settings.fx_integration_enabled !== '0';
  return `
    <div class="card card-collapsible" id="settings-card-integrations" data-card-key="integrations">
      ${settingsCardHeader('integrations', 'Integrations', 'Statement imports and exchange rates')}
      <div class="card-body">
        ${renderStatementMapping(settings)}
        <div class="card-section-head" style="margin-top:1.25rem">FRANKFURTER</div>
        <p class="note" style="margin-bottom:.75rem">Provides on-demand FX rates for mixed-currency accounts. The app stays fully usable offline and only fetches when you trigger a relevant action.</p>
        <div class="settings-field">
          <label class="settings-field-label" for="fx-integration-enabled">
            Enable Frankfurter FX integration${infoTip('When disabled, FX lookups are skipped and the app keeps entered values unchanged. You can re-enable at any time.')}
          </label>
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
            <input type="checkbox" id="fx-integration-enabled" ${enabled ? 'checked' : ''}>
            <button class="btn btn-primary btn-sm" id="btn-save-fx-integration">Save FX preference</button>
            <span id="fx-int-msg" class="form-msg"></span>
          </div>
        </div>
        <div class="card-section-head" style="margin-top:1rem">STATUS</div>
        <div class="settings-items settings-items-compact" id="fx-status-items">
          <div class="settings-item settings-item-compact"><div class="settings-item-header"><span class="settings-item-label">Status</span><span id="fx-status-enabled" class="settings-item-value">-</span></div></div>
          <div class="settings-item settings-item-compact"><div class="settings-item-header"><span class="settings-item-label">Cached rates</span><span id="fx-status-cache-entries" class="settings-item-value">-</span></div></div>
          <div class="settings-item settings-item-compact"><div class="settings-item-header"><span class="settings-item-label">Last successful fetch</span><span id="fx-status-last-fetch" class="settings-item-value">-</span></div></div>
          <div class="settings-item settings-item-compact"><div class="settings-item-header"><span class="settings-item-label">Last error</span><span id="fx-status-last-error" class="settings-item-value settings-item-value-error">-</span></div></div>
        </div>
        <details class="settings-details">
          <summary>FX diagnostics</summary>
          <div class="settings-items settings-items-compact">
          <div class="settings-item settings-item-compact"><div class="settings-item-header"><span class="settings-item-label">This month</span><span id="fx-status-month-summary" class="settings-item-value fx-stat-inline">-</span></div></div>
          <div class="settings-item settings-item-compact"><div class="settings-item-header"><span class="settings-item-label">Prefetch</span><span id="fx-status-prefetch-summary" class="settings-item-value fx-stat-inline">-</span></div></div>
          <div class="settings-item settings-item-compact"><div class="settings-item-header"><span class="settings-item-label">Normalize</span><span id="fx-status-normalize-summary" class="settings-item-value fx-stat-inline">-</span></div></div>
        </div>
        </details>
        <div class="form-actions">
          <button class="btn btn-danger btn-sm" id="btn-fx-clear-cache">Clear FX cache</button>
        </div>
      </div>
    </div>`;
}

function renderStatementMappingDetails(settings: Settings, type: string): string {
  let mapping;
  let issue = '';
  try {
    mapping = getSnapshotMapping(settings[SNAPSHOT_MAPPINGS_KEY], type, getAccounts());
  } catch (error) {
    issue = (error as Error).message;
  }
  return `
    <p class="note">${esc(getSnapshotParser(type).label)} · ${mapping ? 'Mapping remembered' : 'Set up on first import or here'}. Preferences follow backups and sync; PDF contents and draft values do not.</p>
    ${issue ? `<p class="dialog-error" role="alert">${esc(issue)}</p>` : ''}
    ${snapshotMappingFields(getAccounts(), 'settings-statement', mapping, type)}
    <div class="form-actions">
      <button class="btn btn-primary btn-sm" id="btn-save-statement-mapping">Save mapping</button>
      <button class="btn btn-outline btn-sm" id="btn-reset-statement-mapping">Reset mapping</button>
      <span id="statement-mapping-msg" class="form-msg" role="status"></span>
    </div>
  `;
}

function renderStatementMapping(settings: Settings): string {
  const type = snapshotParsers[0].id;
  return `<section id="statement-mapping" data-document-type="${esc(type)}">
    <div class="card-section-head">STATEMENT IMPORTS</div>
    ${
      snapshotParsers.length > 1
        ? `<div class="dialog-field">
      <label class="dialog-label" for="statement-report-type">Report type</label>
      <select id="statement-report-type" class="form-input dialog-input">
        ${snapshotParsers.map((parser) => `<option value="${esc(parser.id)}">${esc(parser.label)}</option>`).join('')}
      </select>
    </div>`
        : ''
    }
    <div data-statement-details>${renderStatementMappingDetails(settings, type)}</div>
  </section>`;
}

async function refreshFxIntegrationStatus(root: HTMLElement): Promise<void> {
  const telemetry = await loadFxTelemetrySafe();
  const currentMonth = (() => {
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    return `${now.getFullYear()}-${mm}`;
  })();
  const monthly = await loadFxTelemetryMonthlySafe(currentMonth);
  const rates = await loadAllFxRates();
  const enabled = (getSettings().fx_integration_enabled ?? '1') !== '0';
  const statusEnabled = root.querySelector('#fx-status-enabled') as HTMLElement | null;
  const cacheEntries = root.querySelector('#fx-status-cache-entries') as HTMLElement | null;
  const lastFetch = root.querySelector('#fx-status-last-fetch') as HTMLElement | null;
  const lastError = root.querySelector('#fx-status-last-error') as HTMLElement | null;
  const monthSummary = root.querySelector('#fx-status-month-summary') as HTMLElement | null;
  const prefetchSummary = root.querySelector('#fx-status-prefetch-summary') as HTMLElement | null;
  const normalizeSummary = root.querySelector('#fx-status-normalize-summary') as HTMLElement | null;

  const cachedTimes = rates
    .map((r) => r.fetchedAt)
    .filter(Boolean)
    .sort();
  const lastCacheAt = cachedTimes.length > 0 ? cachedTimes[cachedTimes.length - 1] : '';
  if (statusEnabled) statusEnabled.textContent = enabled ? 'Enabled' : 'Disabled';
  if (cacheEntries) {
    cacheEntries.textContent = `${rates.length} entr${rates.length === 1 ? 'y' : 'ies'}${lastCacheAt ? ` (last updated ${formatEnglishDateTime(new Date(lastCacheAt))})` : ''}`;
  }
  if (lastFetch) {
    lastFetch.textContent = telemetry.lastFetchAt
      ? formatEnglishDateTime(new Date(telemetry.lastFetchAt))
      : '—';
  }
  if (lastError) {
    const hasError = !!(telemetry.lastErrorAt && telemetry.lastError);
    lastError.textContent = hasError
      ? `${formatEnglishDateTime(new Date(telemetry.lastErrorAt))} — ${telemetry.lastError}`
      : '—';
    lastError.classList.toggle('settings-item-value-error--active', hasError);
  }
  if (monthSummary) {
    monthSummary.textContent = `${monthly.fetchCount} req / ${monthly.cacheHitCount} hits / ${monthly.errorCount} err`;
  }
  if (prefetchSummary) {
    prefetchSummary.textContent = `${telemetry.prefetchSuccessCount} ok / ${telemetry.prefetchFailureCount} failed`;
  }
  if (normalizeSummary) {
    normalizeSummary.textContent = `${telemetry.normalizeSuccessCount} ok / ${telemetry.normalizeFailureCount} failed`;
  }
}

async function loadFxTelemetrySafe(): Promise<FxTelemetry> {
  try {
    return await getFxTelemetry();
  } catch (err) {
    if (String(err).includes('no such table: fx_telemetry')) {
      return {
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
      };
    }
    throw err;
  }
}

async function loadFxTelemetryMonthlySafe(month: string): Promise<FxTelemetryMonthly> {
  try {
    return await getFxTelemetryMonthly(month);
  } catch {
    return { month, fetchCount: 0, cacheHitCount: 0, errorCount: 0 };
  }
}

function mappingRemembered(type: string): boolean {
  try {
    return !!getSnapshotMapping(getSettings()[SNAPSHOT_MAPPINGS_KEY], type, getAccounts());
  } catch {
    return false;
  }
}

function attachFxIntegrationListeners(root: HTMLElement): void {
  const mappingRoot = root.querySelector<HTMLElement>('#statement-mapping');
  if (mappingRoot) wireSnapshotMappingFields(mappingRoot);
  const mappingDirty = mappingRoot
    ? trackFormDirty(
        mappingRoot,
        'statement-mapping',
        '[data-statement-details]',
        undefined,
        // A suggested, never-saved mapping is worth saving as-is.
        () => !mappingRemembered(mappingRoot.dataset.documentType!),
      )
    : null;
  const fxDirty = trackFormDirty(
    root,
    'fx-integration',
    root.querySelector('#fx-integration-enabled')?.parentElement ?? null,
  );
  mappingRoot
    ?.querySelector<HTMLSelectElement>('#statement-report-type')
    ?.addEventListener('change', (event) => {
      const type = (event.currentTarget as HTMLSelectElement).value;
      mappingRoot.dataset.documentType = type;
      mappingRoot.querySelector<HTMLElement>('[data-statement-details]')!.innerHTML =
        renderStatementMappingDetails(getSettings(), type);
      wireSnapshotMappingFields(mappingRoot);
      mappingDirty?.commit();
    });
  mappingRoot?.addEventListener('click', async (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
      '#btn-save-statement-mapping',
    );
    if (!button) return;
    const type = mappingRoot.dataset.documentType!;
    try {
      const mapping = readSnapshotMappingFields(mappingRoot, getAccounts(), type);
      const saved = await withCardGuard('integrations', button, async () => {
        await saveSnapshotMapping(type, mapping);
        return true;
      });
      if (!saved) throw new Error('A sync or save is in progress. Try again in a moment.');
      if (mappingRoot.dataset.documentType !== type) return;
      mappingDirty?.commit();
      toastResult(
        'statement-mapping-msg',
        'Mapping saved. Future imports fill the draft automatically.',
        'success',
      );
    } catch (error) {
      if (mappingRoot.dataset.documentType === type)
        showMsg('statement-mapping-msg', (error as Error).message, false);
    }
  });
  mappingRoot?.addEventListener('click', async (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
      '#btn-reset-statement-mapping',
    );
    if (!button) return;
    const type = mappingRoot.dataset.documentType!;
    const label = getSnapshotParser(type).label;
    let resetAll = false;
    try {
      updateSnapshotMapping(getSettings()[SNAPSHOT_MAPPINGS_KEY], type, null, getAccounts());
    } catch {
      resetAll = true;
    }
    const ok = await confirmDialog({
      title: resetAll ? 'Reset unreadable import preferences?' : `Reset ${label} mapping?`,
      body: resetAll
        ? 'The preferences cannot be read. This explicitly removes ALL statement mappings, including other providers. Your snapshots and accounts are unchanged.'
        : `The next ${label} import will ask for a mapping again. Other providers and snapshots are unchanged.`,
      confirmLabel: 'Reset mapping',
      danger: true,
    });
    if (!ok) return;
    try {
      const reset = await withCardGuard('integrations', button, async () => {
        await setSettings({
          [SNAPSHOT_MAPPINGS_KEY]: resetAll
            ? ''
            : updateSnapshotMapping(
                getSettings()[SNAPSHOT_MAPPINGS_KEY],
                type,
                null,
                getAccounts(),
              ),
        });
        return true;
      });
      if (!reset) throw new Error('A sync or save is in progress. Try again in a moment.');
      if (mappingRoot.dataset.documentType !== type) return;
      mappingDirty?.commit();
      toastResult(
        'statement-mapping-msg',
        'Mapping reset. Set up your next import again.',
        'success',
      );
    } catch (error) {
      if (mappingRoot.dataset.documentType === type)
        showMsg('statement-mapping-msg', (error as Error).message, false);
    }
  });
  void refreshFxIntegrationStatus(root).catch((err) => {
    showMsg('fx-int-msg', 'Status load failed: ' + (err as Error).message, false);
  });

  root.querySelector('#btn-save-fx-integration')?.addEventListener('click', async () => {
    const btn = root.querySelector('#btn-save-fx-integration') as HTMLButtonElement;
    const enabled = !!(root.querySelector('#fx-integration-enabled') as HTMLInputElement | null)
      ?.checked;
    try {
      await withCardGuard(
        'integrations',
        btn,
        () => setSetting('fx_integration_enabled', enabled ? '1' : '0'),
        {
          busyText: 'Saving...',
        },
      );
      await refreshFxIntegrationStatus(root);
      fxDirty.commit();
      toastResult('fx-int-msg', 'FX preference saved', 'success');
    } catch (err) {
      toastResult('fx-int-msg', 'Could not save FX preference: ' + errorText(err), 'error');
    }
  });

  root.querySelector('#btn-fx-clear-cache')?.addEventListener('click', async () => {
    const btn = root.querySelector('#btn-fx-clear-cache') as HTMLButtonElement;
    const ok = await confirmDialog({
      title: 'Clear cached FX rates?',
      body: 'This removes cached rates. Future mixed-currency snapshots may need a new fetch.',
      confirmLabel: 'Clear cache',
      danger: true,
    });
    if (!ok) return;
    try {
      await withCardGuard('integrations', btn, () => restoreAllFxRates([]), {
        busyText: 'Clearing...',
      });
      await refreshFxIntegrationStatus(root);
      toastResult('fx-int-msg', 'FX cache cleared', 'success');
    } catch (err) {
      toastResult('fx-int-msg', 'Could not clear FX cache: ' + errorText(err), 'error');
    }
  });
}

// ── Cache / Force resync ──────────────────────────────────

function renderCacheCard(): string {
  const hasConflict = window.__hasSyncConflict?.() ?? false;
  return `
    <div class="card card-collapsible" id="settings-card-cache" data-card-key="cache">
      ${settingsCardHeader('cache', 'Cache &amp; sync', hasConflict ? 'Sync conflict needs attention' : 'Sync recovery and local cache')}
      <div class="card-body">
        <p class="note" style="margin-bottom:.75rem">Data is stored locally in SQLite and synced to Google Drive. If sync pauses because both copies changed, resolve the conflict here and export a backup first if you want the safest path.</p>
        <p class="note js-sync-conflict-note" ${hasConflict ? '' : 'hidden'} style="margin-bottom:.75rem;color:var(--warn-fg)">Sync is paused because Drive changed elsewhere and this device also has local changes. Closing the dialog leaves sync paused; resolve it before saving more changes.</p>
        <div style="display:flex;gap:10px;margin-top:.5rem;align-items:center;flex-wrap:wrap">
          <button class="btn btn-primary btn-sm" id="btn-resolve-sync-conflict" ${hasConflict ? '' : 'hidden'}>Resolve sync conflict</button>
          <button class="btn btn-outline btn-sm" id="btn-force-resync">Force full resync</button>
          <span id="resync-msg" class="form-msg"></span>
        </div>
        <p class="note" style="margin-top:.75rem">Force full resync clears cached views and re-checks Drive. It is not the primary tool for resolving a sync conflict.</p>
      </div>
    </div>`;
}

export function refreshSyncRecoveryControls(): void {
  const pending = window.__hasSyncConflict?.() ?? false;
  const button = document.getElementById('btn-resolve-sync-conflict');
  if (button) button.hidden = !pending;
  const note = document.querySelector<HTMLElement>('.js-sync-conflict-note');
  if (note) note.hidden = !pending;
}

function attachCacheListeners(root: HTMLElement): void {
  root.querySelector('#btn-resolve-sync-conflict')?.addEventListener('click', async () => {
    try {
      await window.__openSyncConflictResolver?.();
    } catch (err: any) {
      toastResult('resync-msg', 'Could not open the conflict resolver: ' + errorText(err), 'error');
    }
  });
  root.querySelector('#btn-force-resync')?.addEventListener('click', async () => {
    if (!navigator.onLine) {
      toastResult('resync-msg', 'Unavailable offline. Connect to the internet first.', 'error');
      return;
    }
    const btn = root.querySelector('#btn-force-resync') as HTMLButtonElement;
    try {
      await withCardGuard('cache', btn, () => window.__forceFullResync!(), {
        busyText: 'Resyncing...',
      });
      toastResult('resync-msg', 'Full resync complete', 'success');
    } catch (err: any) {
      toastResult('resync-msg', 'Resync failed: ' + errorText(err), 'error');
    }
  });
}

// ── Annual portfolio report ────────────────────────────────

/**
 * Return the set of calendar years that have at least one snapshot or
 * transaction entry, sorted descending. Used to populate the year selector.
 */
export function _getEligibleYears(txs: Transaction[], snaps: Snapshot[]): number[] {
  const years = new Set<number>();
  for (const s of snaps) years.add(parseInt(s.date.substring(0, 4), 10));
  for (const t of txs) years.add(parseInt(t.date.substring(0, 4), 10));
  return Array.from(years).sort((a, b) => b - a);
}

function renderReportCard(): string {
  return `
    <div class="card card-collapsible" id="settings-card-reports" data-card-key="reports">
      ${settingsCardHeader('reports', 'Annual portfolio report', 'Download a yearly summary')}
      <div class="card-body">
        <p class="note" style="margin-bottom:.85rem">Download a self-contained HTML summary of your portfolio for any calendar year — net worth, holdings, dividends, interest, and realised gains. Open it in any browser to print to PDF.</p>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <label for="report-year-select" style="font-size:13px;color:var(--ink-2)">Year</label>
          <select id="report-year-select" class="planning-input" style="width:auto;min-width:90px;max-width:100%;text-align:left" disabled><option value="">Loading…</option></select>
          <button class="btn btn-outline btn-sm" id="btn-download-report" disabled>Download HTML report</button>
        </div>
        <div id="report-msg" class="settings-inline-msg" role="status"></div>
        <button class="btn btn-outline btn-sm settings-inline-retry" id="btn-retry-report" hidden>Retry loading years</button>
      </div>
    </div>`;
}

function attachReportListeners(root: HTMLElement): void {
  let yearsLoaded = false;
  let loading: Promise<void> | undefined;
  const yearEl = root.querySelector<HTMLSelectElement>('#report-year-select');
  const btn = root.querySelector<HTMLButtonElement>('#btn-download-report');
  const retry = root.querySelector<HTMLButtonElement>('#btn-retry-report');
  const card = root.querySelector<HTMLElement>('#settings-card-reports');
  if (!yearEl || !btn || !retry || !card) return;

  const ensureYearsLoaded = (): Promise<void> => {
    if (loading) return loading;
    if (yearsLoaded) return Promise.resolve();
    retry.hidden = true;
    yearEl.disabled = true;
    btn.disabled = true;
    btn.dataset.reportReady = 'false';
    showMsg('report-msg', 'Loading report years...', true);
    loading = (async () => {
      try {
        const [txs, snaps] = await Promise.all([loadTransactions(), loadSnapshots()]);
        const years = _getEligibleYears(txs, snaps);
        yearsLoaded = true;
        if (!years.length) {
          yearEl.innerHTML = '<option value="">No years available</option>';
          showMsg(
            'report-msg',
            'No data found. Add snapshots or transactions to generate a report.',
            false,
          );
          return;
        }
        yearEl.innerHTML = years.map((year) => `<option value="${year}">${year}</option>`).join('');
        yearEl.disabled = false;
        btn.dataset.reportReady = 'true';
        btn.disabled = isBusy();
        if (isBusy()) btn.title = SYNC_BUSY_TITLE;
        clearInlineMsg('report-msg');
      } catch (error) {
        yearEl.innerHTML = '<option value="">Unable to load years</option>';
        retry.hidden = false;
        showMsg(
          'report-msg',
          'Report years could not be loaded: ' + (error as Error).message,
          false,
        );
      } finally {
        loading = undefined;
      }
    })();
    return loading;
  };

  card.querySelector('.js-card-toggle')?.addEventListener('click', () => {
    if (!card.classList.contains('collapsed')) void ensureYearsLoaded();
  });
  retry.addEventListener('click', () => void ensureYearsLoaded());
  if (!card.classList.contains('collapsed')) void ensureYearsLoaded();

  root.querySelector('#btn-download-report')?.addEventListener('click', async () => {
    const btn = root.querySelector('#btn-download-report') as HTMLButtonElement;
    const yearEl = root.querySelector('#report-year-select') as HTMLSelectElement | null;
    try {
      btn.disabled = true;
      btn.textContent = 'Generating…';

      // Ensure year options are loaded (covers keyboard-only or programmatic clicks).
      await ensureYearsLoaded();

      const year = yearEl && yearEl.value ? parseInt(yearEl.value, 10) : NaN;
      const [txs, snaps] = await Promise.all([loadTransactions(), loadSnapshots()]);

      // Revalidate: ensure the selected year still has real data.
      if (isNaN(year) || !_getEligibleYears(txs, snaps).includes(year)) {
        showMsg(
          'report-msg',
          `No data found for ${isNaN(year) ? 'the selected year' : year}. Please select a valid year.`,
          false,
        );
        return;
      }

      const accounts = getAccounts();
      const holdings = getHoldings();
      const method = getCostBasisMethod();
      const report = buildAnnualReport(year, txs, snaps, holdings, accounts, method);
      const html = renderAnnualReportHtml(report, 'EUR');
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `wealth-tracker-report-${year}.html`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toastResult('report-msg', `Report for ${year} downloaded.`, 'success');
    } catch (err: any) {
      toastResult('report-msg', 'Report generation failed: ' + errorText(err), 'error');
    } finally {
      btn.disabled = isBusy() || btn.dataset.reportReady !== 'true';
      btn.textContent = 'Download HTML report';
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
      ${settingsCardHeader('backup', 'Backup &amp; restore', 'Export a copy or restore your data')}
      <div class="card-body">
        <p class="note" style="margin-bottom:.85rem">Export everything as one file you can keep somewhere safe. If anything happens to your Sheet, restore from that file.</p>
        <div id="settings-backup-nudge">${backupNudgeHtml(getSettings())}</div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
          <button class="btn btn-outline btn-sm" id="btn-export-backup">Export backup</button>
          <button class="btn btn-ghost btn-sm" id="btn-restore-backup">Restore from file\u2026</button>
          <input type="file" id="backup-file-input" accept="application/json" style="display:none">
        </div>
      </div>
    </div>`;
}

function attachBackupListeners(root: HTMLElement): void {
  root.querySelector('#btn-export-backup')?.addEventListener('click', async () => {
    const btn = root.querySelector('#btn-export-backup') as HTMLButtonElement;
    try {
      await withCardGuard('backup', btn, () => window.__exportBackup!(), {
        busyText: 'Exporting...',
        allowDuringConflict: true,
      });
      refreshBackupData();
      toastResult('backup-msg', 'Backup downloaded.', 'success');
    } catch (err: any) {
      toastResult('backup-msg', 'Export failed: ' + errorText(err), 'error');
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
        toastResult('backup-msg', 'Restore cancelled.', 'info');
      } else if (result === 'done') {
        toastResult('backup-msg', 'Restore complete.', 'success');
      }
    } catch (err: any) {
      toastResult('backup-msg', 'Restore failed: ' + errorText(err), 'error');
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

function parseHistoryDate(iso: string): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return isNaN(date.getTime()) ? null : date;
}

function fmtHistoryGroupLabel(iso: string): string {
  const date = parseHistoryDate(iso);
  if (!date) return fmtHistoryTimestamp(iso) || 'Unknown date';
  return formatEnglishDate(date, { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtHistoryTime(iso: string): string {
  const date = parseHistoryDate(iso);
  if (!date) return fmtHistoryTimestamp(iso);
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

const HISTORY_ENTITY_LABELS: Record<string, string> = {
  accounts: 'Accounts',
  holdings: 'Holdings',
  settings: 'Settings',
  restore: 'Restore',
  migration: 'Migration',
};

function formatHistoryEntity(entity: string): string {
  const normalized = String(entity || '')
    .trim()
    .toLowerCase();
  return HISTORY_ENTITY_LABELS[normalized] || entity || 'Other';
}

interface ConfigHistoryGroup {
  key: string;
  label: string;
  entries: ConfigHistoryEntry[];
}

interface HistorySummaryDisplay {
  text: string;
  title: string;
  detail?: string;
}

function parseJsonHistorySummary(summary: string): HistorySummaryDisplay | null {
  const match = /^\s*([^=]+?)\s*=\s*(\{[\s\S]*\}|\[[\s\S]*\])\s*$/.exec(summary);
  if (!match) return null;
  const label = match[1].trim();
  const payload = match[2].trim();
  if (!label || !payload) return null;
  try {
    const parsed = JSON.parse(payload);
    const countLabel = Array.isArray(parsed)
      ? `${parsed.length} item${parsed.length === 1 ? '' : 's'}`
      : `${Object.keys(parsed).length} key${Object.keys(parsed).length === 1 ? '' : 's'}`;
    return {
      text: `${label} (${countLabel})`,
      title: summary,
      detail: JSON.stringify(parsed, null, 2),
    };
  } catch {
    return null;
  }
}

function groupConfigHistoryEntries(entries: ConfigHistoryEntry[]): ConfigHistoryGroup[] {
  const groups: ConfigHistoryGroup[] = [];
  entries.forEach((entry) => {
    const date = parseHistoryDate(entry.timestamp);
    const key = date
      ? `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
      : `raw:${entry.timestamp}`;
    const lastGroup = groups[groups.length - 1];
    if (lastGroup && lastGroup.key === key) {
      lastGroup.entries.push(entry);
      return;
    }
    groups.push({
      key,
      label: fmtHistoryGroupLabel(entry.timestamp),
      entries: [entry],
    });
  });
  return groups;
}

function describeHistorySummary(summary: string): HistorySummaryDisplay {
  const trimmed = String(summary || '').trim();
  const maxInlineChars = 56;
  if (!trimmed) {
    return { text: '', title: '' };
  }
  const key = trimmed.split('=')[0].trim();
  const friendly: Record<string, string> = {
    ui_collapse_state: 'Section visibility changed',
    last_backup_at: 'Backup export recorded',
    monthly_contrib_budget: 'Contribution amount changed',
    contribution_interval: 'Contribution cadence changed',
    calibration_interval: 'Calibration interval changed',
    costBasisMethod: 'Cost-basis method changed',
    riskFreeRate: 'Risk-free rate changed',
    fx_integration_enabled: 'FX preference changed',
  };
  if (trimmed.includes('=') && friendly[key]) {
    return { text: friendly[key], title: trimmed, detail: trimmed };
  }
  const parsedJsonSummary = parseJsonHistorySummary(trimmed);
  if (parsedJsonSummary) return parsedJsonSummary;
  if (trimmed.length <= maxInlineChars) return { text: trimmed, title: trimmed };
  return {
    text: `${trimmed.slice(0, maxInlineChars - 1)}…`,
    title: trimmed,
    detail: trimmed,
  };
}

function renderConfigHistoryRow(entry: ConfigHistoryEntry): string {
  const kindLabel = formatHistoryEntity(entry.entity);
  const summary = describeHistorySummary(entry.summary);
  const rowMain = `
    <span class="config-history-kind" title="${esc(kindLabel)}">${esc(kindLabel)}</span>
    <span class="config-history-summary-text">${esc(summary.text)}</span>
    <span class="config-history-when">${esc(fmtHistoryTime(entry.timestamp))}</span>`;
  if (summary.detail) {
    return `
          <details class="config-history-row config-history-row-expandable">
            <summary class="config-history-row-main" title="${esc(summary.title)}">
              ${rowMain}
            </summary>
            <pre class="config-history-row-detail">${esc(summary.detail)}</pre>
          </details>`;
  }
  return `
          <div class="config-history-row">
            <div class="config-history-row-main" title="${esc(summary.title)}">
              ${rowMain}
            </div>
          </div>`;
}

export function renderConfigHistoryCard(entries: ConfigHistoryEntry[]): string {
  let body: string;
  if (entries.length === 0) {
    body = '<p class="note" style="margin-top:.5rem">No changes recorded yet.</p>';
  } else {
    const rows = groupConfigHistoryEntries(entries)
      .map((e, idx) => {
        const groupRows = e.entries.map((entry) => renderConfigHistoryRow(entry)).join('');
        const count = e.entries.length;
        return `
        <details class="config-history-group"${idx === 0 ? ' open' : ''}>
          <summary class="config-history-group-row">
            <span class="config-history-group-date">${esc(e.label)}</span>
            <span class="config-history-group-count">${count} change${count === 1 ? '' : 's'}</span>
          </summary>
          <div class="config-history-group-body">
            ${groupRows}
          </div>
        </details>`;
      })
      .join('');
    body = `
      <div class="config-history-wrap">
        ${rows}
      </div>
      <p class="note config-history-note">Showing the last ${entries.length} change${entries.length === 1 ? '' : 's'}.</p>`;
  }

  return `
    <div class="card card-collapsible collapsed" id="settings-card-config-history" data-card-key="config-history">
      ${settingsCardHeader('config-history', 'Config history', 'Recent configuration changes')}
      <div class="card-body">
        <p class="note" style="margin-bottom:.5rem">Read-only log of recent configuration changes (accounts, holdings, settings).</p>
        ${body}
      </div>
    </div>`;
}

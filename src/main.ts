import './styles.css';
import { logEnvironment, injectEnvBanner } from './env';
import { checkStorageQuota } from './storage';
import { CONFIG } from './config';
import { getACCTSList } from './constants';
import { appTemplate } from './template';
import { signIn as gisSignIn, signOut, isSignedIn, hasEverGranted } from './auth/google';
import {
  loadSnapshots,
  saveSnapshots,
  upsertSnapshot,
  loadTransactions,
  mergeTransactions,
  countAmendedRows,
  insertTransaction,
  updateTransaction,
  deleteTransaction,
  deleteTransactions,
  saveImportMeta,
  loadImportMeta,
  restoreAllData,
  logConfigChange,
  clearSyncMetadata,
} from './db';
import {
  pullFromCloud,
  pushToCloud,
  scheduleUpload,
  cancelPendingUpload,
  SyncConflictError,
  getPendingSyncConflict,
  overwriteCloudWithLocal,
  replaceLocalWithCloud,
} from './sync/engine';
import {
  loadConfig,
  onConfigChange,
  getCostBasisMethod,
  getHoldings,
  getAccounts,
  getSettings,
  getAlertSettings,
  hydrateConfigFromCache,
  setSetting,
} from './store/config';
import type { ConfigChangeKind } from './store/config';
import {
  buildBackup,
  backupFilename,
  validateBackup,
  summarizeBackup,
  migrateBackup,
} from './backup/exportImport';
import { getSetupState } from './model/setup';
import type { SetupStep } from './model/setup';
import { computePD } from './portfolio';
import { parseWithProfile, detectProfile, previewSummary } from './import/parse';
import { builtInProfiles } from './import/profiles/index';
import { renderNW } from './views/networth';
import { renderAnalytics } from './views/analytics';
import { renderPortfolio, getMaxDrift } from './views/portfolio';
import { renderDCA } from './views/contributions';
import { renderDividends } from './views/dividends';
import { renderSettings, refreshSettingsAfterChange, applySyncBusyState } from './views/settings';
import { renderLog } from './views/log';
import {
  fmtMon,
  showMsg,
  reinjectPendingMsg,
  esc,
  currentMonth,
  withButtonGuard,
  fmtPctVal,
} from './utils';
import { navHash, parseNavHash } from './nav';
import {
  isCacheValid,
  clearCache,
  getCachedConfig,
  setCachedConfig,
  getCachedSnapshots,
  setCachedSnapshots,
  getCachedTransactions,
  setCachedTransactions,
  getCachedAggregates,
  setCachedAggregates,
  getCachedImportMeta,
  setCachedImportMeta,
  getInputsHash,
  setInputsHash,
  computeInputsHash,
  holdingsSignature,
  setCollapseState,
} from './cache/db';
import { onThemeChange, setUserTheme, getUserThemePref } from './theme';
import { shouldAutoResync } from './sync/policy';
import { loadCollapseState, replaceCollapseState } from './ui/collapseState';
import { restoreCollapseFromSheet, backupCollapseToSheet } from './ui/collapseSync';
import { confirmDialog } from './ui/confirmDialog';
import { conflictDialog } from './ui/conflictDialog';
import { transactionDialog } from './ui/transactionDialog';
import { snapshotDialog } from './ui/snapshotDialog';
import { showSigninOverlay, hideSigninOverlay } from './ui/signinOverlay';
import { attachInfoTips } from './ui/infoTip';
import { withTimeout } from './sync/timeout';
import { isBusy, setBusy } from './sync/lock';
import { registerSW } from 'virtual:pwa-register';
import type { Snapshot, Transaction, PortfolioData, ImportProfile, Account } from './types';
import { buildAppSecuritySuggestions } from './securitySuggestions';

// ── App state ────────────────────────────────────────────
const state: {
  snaps: Snapshot[];
  txs: Transaction[];
  pd: PortfolioData | null;
  importMeta: { last_import?: string };
  offline: boolean;
  cacheLoaded: boolean;
} = {
  snaps: [],
  txs: [],
  pd: null,
  importMeta: {},
  offline: !navigator.onLine,
  cacheLoaded: false,
};

// ── Render-on-show state ─────────────────────────────────
let _activeSection = 'networth';
const _dirty = new Set<string>();
const ALL_SECTIONS = ['networth', 'portfolio', 'analytics', 'settings', 'log'] as const;

// ── Portfolio sub-view state ─────────────────────────────
let _portfolioSubview: 'holdings' | 'contributions' | 'dividends' = 'holdings';

// ── Unified sync/write lock (shared with settings.ts - see sync/lock.ts) ──
let _lastSyncAt = 0;
const AUTO_RESYNC_MIN_INTERVAL_MS = 2 * 60_000; // 2 minutes
function setSyncing(v: boolean): void {
  setBusy(v);
  // Reconcile Settings button states immediately (not just at next renderAll).
  applySyncBusyState();
  // Also disable write controls outside Settings (snapshot Save, CSV import, etc.).
  applyReadOnlyMode();
  // Reflect syncing state on the Sync now button so users see auto-syncs too.
  const syncNowBtn = document.getElementById('btn-sync-now') as HTMLButtonElement | null;
  if (syncNowBtn) syncNowBtn.textContent = v ? 'Syncing\u2026' : 'Sync now';
}
function isSyncBusy(): boolean {
  return isBusy();
}

type WriteAccessMode = 'signed-in' | 'signed-in-or-granted';

function ensureWriteAccess(msgId: string, mode: WriteAccessMode = 'signed-in'): boolean {
  if (mode === 'signed-in') {
    if (!isSignedIn()) {
      showMsg(msgId, 'Please sign in first.', false);
      return false;
    }
  } else if (!isSignedIn() && !hasEverGranted()) {
    showMsg(msgId, 'Please sign in first.', false);
    return false;
  }
  if (isSyncBusy()) {
    showMsg(msgId, 'A sync or save is in progress. Try again in a moment.', false);
    return false;
  }
  return true;
}

async function runSynchronizedWrite(opts: {
  action: () => Promise<void>;
  button?: HTMLButtonElement;
  busyText?: string;
  keepDisabledOnSuccess?: boolean;
}): Promise<void> {
  const run = async () => {
    setSyncing(true);
    try {
      await opts.action();
    } finally {
      setSyncing(false);
    }
  };
  if (opts.button) {
    await withButtonGuard(opts.button, run, {
      busyText: opts.busyText,
      keepDisabledOnSuccess: opts.keepDisabledOnSuccess,
    });
    return;
  }
  await run();
}

function showSyncAwareSuccess(msgId: string, onlineMessage: string, offlineMessage: string): void {
  showMsg(msgId, state.offline || !navigator.onLine ? offlineMessage : onlineMessage, true);
}

async function performWriteAction(opts: {
  msgId: string;
  access?: WriteAccessMode;
  action: () => Promise<void>;
  button?: HTMLButtonElement;
  busyText?: string;
  keepDisabledOnSuccess?: boolean;
  onlineMessage?: string;
  offlineMessage?: string;
  errorPrefix?: string;
}): Promise<boolean> {
  if (!ensureWriteAccess(opts.msgId, opts.access)) return false;
  try {
    await runSynchronizedWrite({
      action: opts.action,
      button: opts.button,
      busyText: opts.busyText,
      keepDisabledOnSuccess: opts.keepDisabledOnSuccess,
    });
    if (opts.onlineMessage && opts.offlineMessage) {
      showSyncAwareSuccess(opts.msgId, opts.onlineMessage, opts.offlineMessage);
    }
    return true;
  } catch (err) {
    showMsg(opts.msgId, (opts.errorPrefix || 'Error: ') + (err as Error).message, false);
    return false;
  }
}

function refreshConflictAccess(): void {
  const el = document.getElementById('sync-status');
  const actionable = !!getPendingSyncConflict();
  if (!el) return;
  if (actionable) {
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('title', 'Sync paused — activate to resolve sync conflict');
    el.setAttribute('aria-label', 'Sync paused — activate to resolve sync conflict');
  } else {
    el.removeAttribute('role');
    el.removeAttribute('tabindex');
  }
  if (document.getElementById('settings-content')) renderSettings();
}

/**
 * Handle a SyncConflictError uniformly: update the status pill, refresh
 * ARIA attributes and open the resolver. Returns true when the error was a
 * conflict (caller should stop further processing), false otherwise.
 */
function handleSyncConflict(err: unknown): boolean {
  if (!(err instanceof SyncConflictError)) return false;
  setSyncStatus('conflict');
  refreshConflictAccess();
  void openSyncConflictResolver();
  return true;
}

/** True when data is shown from cache but no valid auth token exists. */
function isReadOnly(): boolean {
  return state.cacheLoaded && !isSignedIn();
}

/**
 * Disable every write-triggering control outside Settings for one of two
 * independent reasons: not signed in (isReadOnly - persistent, until the
 * user signs in) or a sync/write in flight elsewhere (isSyncBusy -
 * transient, clears itself). Read-only always wins the tooltip when both
 * are true - "sign in" is the more actionable message in that case.
 * Deliberately does NOT touch the monthly-update card's collapsed/expanded
 * layout for the busy case (only for readOnly) - collapsing and restoring
 * the form every time a two-second background sync starts would be a much
 * louder, flashier change than a brief disabled state calls for.
 */
function applyReadOnlyMode(): void {
  const readOnly = isReadOnly();
  const busy = isSyncBusy();
  const disabled = readOnly || busy;
  const hint = readOnly
    ? 'Sign in to enable editing'
    : busy
      ? 'Sync in progress - try again in a moment'
      : '';

  // Disable write-action buttons
  const writeIds = ['btn-add-snap', 'btn-confirm-import', 'btn-sync-now'];
  for (const id of writeIds) {
    const el = document.getElementById(id) as HTMLButtonElement | null;
    if (!el) continue;
    el.disabled = disabled;
    el.title = hint;
  }

  // Disable CSV drop zone and file input
  const zone = document.getElementById('drop-zone');
  const csvInput = document.getElementById('csv-file-input') as HTMLInputElement | null;
  if (zone) {
    zone.classList.toggle('drop-zone-disabled', disabled);
    zone.title = hint;
  }
  if (csvInput) {
    csvInput.disabled = disabled;
  }

  // Per-row snapshot Delete button, if a history row is currently expanded.
  // Edit is deliberately left alone - it only populates the form locally,
  // it never itself writes to Sheets (the write happens on a later, already
  // guarded Save click), so blocking it here would add friction for no
  // correctness benefit.
  document.querySelectorAll<HTMLButtonElement>('.js-del-snap').forEach((el) => {
    el.disabled = disabled;
    el.title = hint;
  });

  // Collapse monthly update card in read-only mode
  const balanceCard = document.getElementById('balance-card');
  if (balanceCard) {
    const actionRow = balanceCard.querySelector('#btn-add-snap')
      ?.parentElement as HTMLElement | null;
    let roMsg = balanceCard.querySelector('.ro-msg') as HTMLElement | null;

    if (readOnly) {
      if (actionRow) actionRow.style.display = 'none';
      if (!roMsg) {
        roMsg = document.createElement('p');
        roMsg.className = 'note ro-msg';
        roMsg.style.marginTop = '0.5rem';
        roMsg.textContent = '📦 Read-only mode. Sign in to log monthly updates.';
        balanceCard.querySelector('.card-title')?.insertAdjacentElement('afterend', roMsg);
      }
      roMsg.style.display = '';
    } else {
      if (actionRow) actionRow.style.display = '';
      if (roMsg) roMsg.style.display = 'none';
    }
  }
}

// ── Initial load overlay state ───────────────────────────
let _initialLoad = false;
function isInitialLoad(): boolean {
  return _initialLoad;
}

// ── Boot ─────────────────────────────────────────────────
logEnvironment();
document.getElementById('app')!.innerHTML = appTemplate();
injectEnvBanner();
// Apply persisted theme preference before first render to avoid flash
setUserTheme(getUserThemePref());
_updateThemeToggleLabel();
void checkStorageQuota(); // fire-and-forget storage check
loadCollapseState(); // fire-and-forget: loads persisted UI collapse state from IDB
initNav();
initSnapForm();
initCSVDrop();
initAuth();
initOnlineListeners();
initThemeListener();
initPwaUpdate();

// ── Navigation ───────────────────────────────────────────
function initNav() {
  document.querySelectorAll<HTMLElement>('.nav button[data-section]').forEach((btn) => {
    btn.addEventListener('click', () => showSection(btn.dataset.section!, btn));
  });
  document.querySelectorAll<HTMLElement>('[data-goto]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.goto!;
      const navBtn = document.querySelector(`.nav button[data-section="${target}"]`);
      showSection(target, navBtn as HTMLElement | null);
    });
  });
  // Wire portfolio sub-nav (once)
  const subnav = document.getElementById('portfolio-subnav');
  subnav?.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('[data-subview]') as HTMLElement | null;
    if (btn) showPortfolioSubview(btn.dataset.subview!);
  });

  // Roving tabindex for WAI-ARIA Tabs Pattern on both tablists
  initRovingTabindex(document.querySelector('.nav[role="tablist"]'));
  initRovingTabindex(subnav);

  // Hash-based initial routing
  resolveInitialSection();
}

/** WAI-ARIA Tabs Pattern: roving tabindex + arrow-key navigation. */
function initRovingTabindex(tablist: Element | null): void {
  if (!tablist) return;
  const tabs = () => [...tablist.querySelectorAll<HTMLElement>('[role="tab"]')];
  // Set initial tabindex: active tab = 0, rest = -1
  for (const t of tabs())
    t.setAttribute('tabindex', t.getAttribute('aria-selected') === 'true' ? '0' : '-1');
  tablist.addEventListener('keydown', (e) => {
    const ev = e as KeyboardEvent;
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(ev.key)) return;
    ev.preventDefault();
    const items = tabs();
    const cur = items.indexOf(document.activeElement as HTMLElement);
    if (cur < 0) return;
    let next: number;
    if (ev.key === 'ArrowRight') next = (cur + 1) % items.length;
    else if (ev.key === 'ArrowLeft') next = (cur - 1 + items.length) % items.length;
    else if (ev.key === 'Home') next = 0;
    else next = items.length - 1; // End
    for (const t of items) t.setAttribute('tabindex', '-1');
    items[next].setAttribute('tabindex', '0');
    items[next].focus();
  });
}

function resolveInitialSection(): void {
  const { section: targetSection, subview } = parseNavHash(window.location.hash);
  const targetBtn = document.querySelector(
    `.nav button[data-section="${targetSection}"]`,
  ) as HTMLElement | null;
  showSection(targetSection, targetBtn);
  if (targetSection === 'portfolio') {
    showPortfolioSubview(subview || 'holdings');
  }
}

function showSection(id: string, btn: Element | null) {
  const alreadyActive =
    _activeSection === id && document.getElementById(id)?.classList.contains('active');
  // Settings always repaints to reflect live config edits; others are no-ops when re-clicking.
  if (alreadyActive && id !== 'settings') {
    // Still worth a defensive re-sync of the hash in case it drifted (e.g. via
    // popstate or a stale deep link) - cheap, no DOM/render cost.
    history.replaceState(null, '', navHash(id, id === 'portfolio' ? _portfolioSubview : undefined));
    return;
  }
  document.querySelectorAll('.section').forEach((s) => s.classList.remove('active'));
  document.querySelectorAll('.nav button').forEach((b) => {
    b.classList.remove('active');
    b.setAttribute('aria-selected', 'false');
    b.setAttribute('tabindex', '-1');
  });
  document.getElementById(id)?.classList.add('active');
  btn?.classList.add('active');
  btn?.setAttribute('aria-selected', 'true');
  btn?.setAttribute('tabindex', '0');
  _activeSection = id;
  if (_dirty.has(id)) {
    _dirty.delete(id);
    renderSection(id);
  } else if (id === 'settings') {
    renderSection('settings');
  } // settings reflects live config; always repaint
  if (id === 'portfolio') showPortfolioSubview(_portfolioSubview);
  history.replaceState(null, '', navHash(id, id === 'portfolio' ? _portfolioSubview : undefined));
}

// ── PWA update detection ──────────────────────────────────
// Explicit prompt, not a silent auto-reload: this app already guards every
// write behind visible status and an in-flight lock (isSyncBusy), so a
// service worker silently swapping the running bundle mid-edit would be the
// same category of risk in a different layer. The user always sees the
// prompt and decides when to reload.
const PWA_UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000; // hourly

function initPwaUpdate(): void {
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      showUpdateBanner(() => {
        if (isSyncBusy()) {
          showMsg(
            'pwa-update-msg',
            'A save is in progress. Try reloading again in a moment.',
            false,
          );
          return;
        }
        updateSW(true);
      });
    },
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      setInterval(() => registration.update().catch(() => {}), PWA_UPDATE_CHECK_INTERVAL_MS);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') registration.update().catch(() => {});
      });
    },
  });
}

function showUpdateBanner(onReload: () => void): void {
  if (document.getElementById('pwa-update-banner')) return; // already showing
  const bar = document.createElement('div');
  bar.id = 'pwa-update-banner';
  bar.className = 'pwa-update-banner';
  bar.innerHTML = `
    <span>A new version of Wealth Tracker is available.</span>
    <button id="pwa-update-reload" class="btn btn-sm btn-primary" type="button">Reload</button>
    <span id="pwa-update-msg" class="pwa-update-msg"></span>
  `;
  document.body.appendChild(bar);
  document.getElementById('pwa-update-reload')?.addEventListener('click', onReload);
}

// ── Online/offline listeners ─────────────────────────────
function initOnlineListeners() {
  window.addEventListener('online', async () => {
    state.offline = false;
    setSyncStatus('ok', 'Back online');
    // Push local DB immediately before any pull/resync path, so reconnect
    // never downloads cloud state on top of local offline writes.
    let pushed = false;
    try {
      pushed = await pushToCloud();
    } catch (err) {
      if (handleSyncConflict(err)) return;
      throw err;
    }
    if (!pushed) {
      // Retry soon and avoid a pull until push succeeds, preventing overwrite.
      scheduleUpload();
      return;
    }
    // Trigger a guarded background resync if conditions are met.
    autoResyncIfNeeded();
  });
  window.addEventListener('offline', () => {
    state.offline = true;
    setSyncStatus('offline');
  });

  // Auto-resync when user returns to the tab (visibility or focus)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') autoResyncIfNeeded();
  });
  window.addEventListener('focus', () => autoResyncIfNeeded());
}

/** Chart.js bakes colors into the canvas at render time, unlike CSS, which
 *  re-themes instantly via its own media query. Without this, a chart-bearing
 *  view stays visually stuck in the old color scheme until some unrelated
 *  action triggers the next re-render. */
function initThemeListener() {
  onThemeChange(() => renderAll());
  document.getElementById('btn-theme-toggle')?.addEventListener('click', () => {
    const next =
      getUserThemePref() === 'light' ? 'dark' : getUserThemePref() === 'dark' ? 'system' : 'light';
    setUserTheme(next);
    _updateThemeToggleLabel();
  });
}

function _updateThemeToggleLabel(): void {
  const btn = document.getElementById('btn-theme-toggle');
  if (!btn) return;
  const pref = getUserThemePref();
  const icons: Record<string, string> = {
    light:
      '<svg class="theme-toggle-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="3.1" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 1.4v2M8 12.6v2M1.4 8h2M12.6 8h2M3.34 3.34l1.42 1.42M11.24 11.24l1.42 1.42M12.66 3.34l-1.42 1.42M4.76 11.24l-1.42 1.42" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
    dark: '<svg class="theme-toggle-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M10.6 1.7a5.9 5.9 0 1 0 3.7 8.5A6.3 6.3 0 0 1 10.6 1.7Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
    system:
      '<svg class="theme-toggle-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><rect x="2.2" y="2.4" width="11.6" height="8.2" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M6 13h4M8 10.8V13" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
  };
  const aria: Record<string, string> = {
    light: 'Switch theme: currently Light',
    dark: 'Switch theme: currently Dark',
    system: 'Switch theme: currently System',
  };
  const title: Record<string, string> = {
    light: 'Theme: Light (click to cycle Light → Dark → System)',
    dark: 'Theme: Dark (click to cycle Light → Dark → System)',
    system: 'Theme: System (click to cycle Light → Dark → System)',
  };
  btn.innerHTML = icons[pref] ?? icons.light;
  btn.setAttribute('aria-label', aria[pref] ?? 'Switch theme');
  btn.setAttribute('title', title[pref] ?? 'Switch theme');
}

/** Trigger syncInBackground only when shouldAutoResync passes. */
function autoResyncIfNeeded(): void {
  if (
    shouldAutoResync({
      signedIn: isSignedIn(),
      online: navigator.onLine,
      syncing: isSyncBusy(),
      lastSyncAt: _lastSyncAt,
      now: Date.now(),
      minIntervalMs: AUTO_RESYNC_MIN_INTERVAL_MS,
    })
  ) {
    syncInBackground();
  }
}

// ── Auth ─────────────────────────────────────────────────
function initAuth() {
  document.getElementById('btn-signin')?.addEventListener('click', onSignInClick);
  document.getElementById('btn-signin-global')?.addEventListener('click', onSignInClick);
  document.getElementById('btn-signout')?.addEventListener('click', () => {
    signOut();
  });
  document.getElementById('btn-sync-now')?.addEventListener('click', () => {
    if (!isSyncBusy()) syncInBackground();
  });
  document.getElementById('sync-status')?.addEventListener('click', () => {
    if (getPendingSyncConflict()) void openSyncConflictResolver();
  });
  document.getElementById('sync-status')?.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && getPendingSyncConflict()) {
      e.preventDefault();
      void openSyncConflictResolver();
    }
  });

  // Boot: render from cache instantly, then check for a stored token.
  // If a valid token is already in memory (restored from localStorage at module
  // load), proceed transparently. If not, wait for the user to click Sign in -
  // never fire a GIS network call at boot without a prior explicit auth.
  bootFromCache().then(() => {
    if (isSignedIn()) {
      updateAuthUI(true);
      syncInBackground();
    } else {
      updateAuthUI(false);
    }
  });
}

const SIGNIN_TIMEOUT_MS = 90_000;

async function onSignInClick() {
  let cancelled = false;
  showSigninOverlay(() => {
    cancelled = true;
  });
  try {
    setAuthStatus('Signing in…', false, true);
    await withTimeout(gisSignIn(), SIGNIN_TIMEOUT_MS);

    hideSigninOverlay();
    updateAuthUI(true);
    await loadAllData();
  } catch (err) {
    hideSigninOverlay();
    if (cancelled) return; // user already dismissed the overlay; don't also show an error
    if ((err as Error).message === 'popup_closed') {
      setAuthStatus('Sign-in cancelled', true);
    } else if ((err as Error).message === 'signin_timeout') {
      setAuthStatus('Sign-in timed out, please try again', true);
    } else {
      setAuthStatus('Sign-in failed: ' + (err as Error).message, true);
    }
  }
}

function updateAuthUI(signedIn: boolean) {
  const prompt = document.getElementById('auth-prompt');
  const content = document.getElementById('log-content');
  const signoutBtn = document.getElementById('btn-signout');
  const signinGlobal = document.getElementById('btn-signin-global');
  const syncNowBtn = document.getElementById('btn-sync-now');

  if (signedIn) {
    prompt?.style.setProperty('display', 'none');
    content?.style.setProperty('display', 'block');
    signoutBtn?.style.setProperty('display', 'inline-block');
    signinGlobal?.style.setProperty('display', 'none');
    syncNowBtn?.style.setProperty('display', 'inline-block');
    setAuthStatus('✓ Signed in');
  } else {
    if (state.cacheLoaded) {
      // Read-only mode: show data but block writes
      prompt?.style.setProperty('display', 'none');
      content?.style.setProperty('display', 'block');
      signinGlobal?.style.setProperty('display', 'inline-block');
      syncNowBtn?.style.setProperty('display', 'none');
      setAuthStatus('📦 Read-only, sign in to sync');
    } else {
      prompt?.style.setProperty('display', 'block');
      content?.style.setProperty('display', 'none');
      signinGlobal?.style.setProperty('display', 'inline-block');
      syncNowBtn?.style.setProperty('display', 'none');
      setAuthStatus('Not signed in');
    }
    signoutBtn?.style.setProperty('display', 'none');
  }
  applyReadOnlyMode();
  renderSetupBanner();
}

function setAuthStatus(msg: string, isErr = false, isBusy = false) {
  const el = document.getElementById('auth-status');
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle('auth-status-busy', isBusy);
  el.style.color = isErr ? 'var(--neg)' : 'var(--ink-2)';
}

// ── Cache-first boot ─────────────────────────────────────
/**
 * Attempt to render from IndexedDB cache immediately.
 * This allows offline-first UX and instant second-boot.
 */
async function bootFromCache() {
  try {
    const valid = await isCacheValid();
    if (!valid) return;

    const [cachedConfig, cachedSnaps, cachedTxs, cachedMeta, cachedPd] = await Promise.all([
      getCachedConfig(),
      getCachedSnapshots(),
      getCachedTransactions(),
      getCachedImportMeta(),
      getCachedAggregates(),
    ]);

    // Hydrate the config store first - getACCTSList()/getAccounts()/
    // primaryInvestmentValue() depend on this before renderAll() runs.
    if (cachedConfig) {
      hydrateConfigFromCache(cachedConfig);
    }

    if (cachedSnaps || cachedTxs) {
      state.snaps = cachedSnaps || [];
      state.txs = cachedTxs || [];
      state.importMeta = cachedMeta || {};
      state.pd = cachedPd || null;
      state.cacheLoaded = true;
      renderAll();
      setSyncStatus('cached');
    }
  } catch {
    // Cache read failed - no problem, will do full network load
  }
}

// ── Background sync ──────────────────────────────────────
/**
 * Sync data from local SQLite DB, with Drive AppData pull if cloud is newer.
 */
async function syncInBackground() {
  if (isSyncBusy()) return; // re-entrancy guard
  if (state.offline) {
    setSyncStatus('offline');
    return;
  }
  setSyncing(true);
  setSyncStatus('syncing');
  try {
    // Pull from Drive if cloud is newer (replaces local DB if so)
    await pullFromCloud();

    // Load from local SQLite
    await loadConfig();
    restoreCollapseFromSheet(); // restore UI prefs if IDB was empty (new device)
    const [snaps, txs, meta] = await Promise.all([
      loadSnapshots(),
      loadTransactions(),
      loadImportMeta(),
    ]);

    // Update state
    state.snaps = snaps;
    state.txs = txs;
    state.importMeta = meta;

    // Compute aggregates (with caching)
    state.pd = await computeAggregatesWithCache(txs);

    // Setup config change listener
    onConfigChange(async (changed) => {
      if (state.txs.length) {
        state.pd = await computeAggregatesWithCache(state.txs);
      }
      // Keep IndexedDB cache authoritative after every config write,
      // so bootFromCache() never re-hydrates stale data on next refresh.
      const cfgCached = await setCachedConfig({
        accounts: getAccounts(),
        holdings: getHoldings(),
        settings: getSettings(),
      });
      if (!cfgCached) showCacheWriteWarning();
      renderAll(changed);
    });

    // Persist to IDB cache for next boot
    const [configCached, snapsCached, txsCached] = await Promise.all([
      setCachedConfig({
        accounts: getAccounts(),
        holdings: getHoldings(),
        settings: getSettings(),
      }),
      setCachedSnapshots(snaps),
      setCachedTransactions(txs),
      setCachedImportMeta(meta),
    ]);
    if (!configCached || !snapsCached || !txsCached) showCacheWriteWarning();

    setSyncStatus('ok');
    await backupCollapseToSheet();
  } catch (err) {
    if (!handleSyncConflict(err)) {
      setSyncStatus('error', (err as Error).message);
    }
    // If we had cached data, keep showing it
    if (!state.cacheLoaded) {
      // No cache either - show error
    }
  } finally {
    setSyncing(false);
    _lastSyncAt = Date.now();
    renderAll();
  }
}

// ── Cached aggregates with invalidation ──────────────────
/**
 * Compute aggregates only when inputs change.
 * Uses an inputsHash to detect whether recomputation is needed.
 */
async function computeAggregatesWithCache(txs: Transaction[]): Promise<PortfolioData | null> {
  if (!txs.length) return null;

  const method = getCostBasisMethod();
  const holdings = getHoldings();
  const currentHash = computeInputsHash(
    txs.length,
    txs[txs.length - 1]?.date || '',
    method,
    holdingsSignature(holdings),
  );

  // Check if cached aggregates are still valid
  const storedHash = await getInputsHash();
  if (storedHash === currentHash) {
    const cached = await getCachedAggregates();
    if (cached) return cached;
  }

  // Recompute
  const pd = computePD(txs, { method });

  // Cache the result
  await Promise.all([setCachedAggregates(pd), setInputsHash(currentHash)]);

  return pd;
}

// ── Data loading (full, used for first sign-in or force resync) ──
async function loadAllData() {
  _initialLoad = !state.cacheLoaded;
  setSyncStatus('loading');
  setSyncing(true);
  try {
    // Pull from Drive if cloud is newer
    await pullFromCloud();

    await refreshStateFromLocalDb();

    onConfigChange(async (changed) => {
      if (state.txs.length) {
        state.pd = await computeAggregatesWithCache(state.txs);
      }
      const cached = await setCachedConfig({
        accounts: getAccounts(),
        holdings: getHoldings(),
        settings: getSettings(),
      });
      if (!cached) showCacheWriteWarning();
      renderAll(changed);
    });
    setSyncStatus('ok');
    await backupCollapseToSheet();
  } catch (err) {
    if (!handleSyncConflict(err)) {
      setSyncStatus('error', (err as Error).message);
    }
  } finally {
    _initialLoad = false;
    setSyncing(false);
    _lastSyncAt = Date.now();
    renderAll();
  }
}

// ── Force full resync ────────────────────────────────────
/**
 * Clear the cache and do a clean full reload from local DB + Drive.
 * Exposed for the Settings UI "Force full resync" button.
 */
export async function forceFullResync() {
  await clearCache();
  state.snaps = [];
  state.txs = [];
  state.pd = null;
  state.importMeta = {};
  state.cacheLoaded = false;
  await loadAllData();
}
// Make it available on window for the settings button
window.__forceFullResync = forceFullResync;

// ── Backup export ─────────────────────────────────────────
export async function exportBackup(): Promise<void> {
  await setSetting('last_backup_at', new Date().toISOString());
  const backup = buildBackup({
    accounts: getAccounts(),
    holdings: getHoldings(),
    settings: getSettings(),
    snapshots: state.snaps,
    transactions: state.txs,
    importMeta: state.importMeta,
  });
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = backupFilename();
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
window.__exportBackup = exportBackup;

async function refreshStateFromLocalDb(opts: { clearCaches?: boolean } = {}): Promise<void> {
  if (opts.clearCaches) await clearCache();

  await loadConfig();
  restoreCollapseFromSheet();
  const [snaps, txs, meta] = await Promise.all([
    loadSnapshots(),
    loadTransactions(),
    loadImportMeta(),
  ]);
  state.snaps = snaps;
  state.txs = txs;
  state.importMeta = meta;
  state.pd = txs.length ? computePD(txs, { method: getCostBasisMethod() }) : null;
  state.cacheLoaded = true;

  const [configCached, snapsCached, txsCached] = await Promise.all([
    setCachedConfig({
      accounts: getAccounts(),
      holdings: getHoldings(),
      settings: getSettings(),
    }),
    setCachedSnapshots(snaps),
    setCachedTransactions(txs),
    setCachedImportMeta(meta),
    state.pd ? setCachedAggregates(state.pd) : Promise.resolve(),
    state.pd
      ? setInputsHash(
          computeInputsHash(
            txs.length,
            txs[txs.length - 1]?.date || '',
            getCostBasisMethod(),
            holdingsSignature(getHoldings()),
          ),
        )
      : Promise.resolve(),
  ]);
  if (!configCached || !snapsCached || !txsCached) showCacheWriteWarning();
}

async function openSyncConflictResolver(): Promise<void> {
  async function resolveConflictWith(
    action: () => Promise<boolean>,
    dialog: { title: string; body: string; confirmLabel: string },
  ): Promise<boolean> {
    const ok = await confirmDialog({ ...dialog, danger: true });
    if (!ok) return false;
    setSyncing(true);
    try {
      await action();
      await refreshStateFromLocalDb({ clearCaches: true });
      setSyncStatus('ok');
      refreshConflictAccess();
      renderAll();
    } finally {
      setSyncing(false);
    }
    return true;
  }

  while (getPendingSyncConflict()) {
    const choice = await conflictDialog();
    if (choice === 'cancel') return;
    if (choice === 'backup') {
      await exportBackup();
      continue;
    }

    if (choice === 'keep-local') {
      const resolved = await resolveConflictWith(overwriteCloudWithLocal, {
        title: 'Overwrite Drive with local data?',
        body: 'This keeps this device as the source of truth and discards the newer Drive copy.',
        confirmLabel: 'Overwrite Drive',
      });
      if (resolved) return;
      continue;
    }

    const resolved = await resolveConflictWith(replaceLocalWithCloud, {
      title: 'Replace local data with Drive?',
      body: 'This discards this device\u2019s unsynced local changes and replaces the local database with the Drive copy.',
      confirmLabel: 'Replace local',
    });
    if (resolved) return;
  }
}
window.__openSyncConflictResolver = openSyncConflictResolver;
window.__hasSyncConflict = () => !!getPendingSyncConflict();

// ── Backup restore ────────────────────────────────────────
export async function restoreFromBackup(file: File): Promise<'cancelled' | 'done'> {
  if (!isSignedIn()) throw new Error('Sign in first.');
  // Note: no isSyncBusy() check here - the caller (withCardGuard) already
  // holds the busy lock, so checking it would always self-deadlock.

  let raw: unknown;
  try {
    raw = JSON.parse(await file.text());
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  const parsed = validateBackup(raw);
  if (!parsed) throw new Error('That file is not a recognized Wealth Tracker backup.');
  const backup = migrateBackup(parsed);

  const ok = await confirmDialog({
    title: 'Restore from backup?',
    body: summarizeBackup(backup),
    confirmLabel: 'Restore',
    danger: true,
  });
  if (!ok) return 'cancelled';

  setSyncing(true);
  // Cancel any in-flight pre-restore upload so stale data is never pushed.
  cancelPendingUpload();
  try {
    const { accounts, holdings, settings, snapshots, transactions, importMeta } = backup.data;

    // Write all five tables atomically in one SQLite transaction.
    // Either everything is replaced or nothing is (full rollback on error).
    await restoreAllData({ accounts, holdings, settings, snapshots, transactions });

    // Reload in-memory config store from the freshly written SQLite tables.
    await loadConfig();
    await logConfigChange('Restore', 'restored from backup');

    // Reapply collapse/expand UI state from the backup
    const rawCollapse = settings['ui_collapse_state'];
    if (rawCollapse) {
      try {
        const parsedCollapse = JSON.parse(rawCollapse);
        if (parsedCollapse && typeof parsedCollapse === 'object') {
          replaceCollapseState(parsedCollapse);
          await setCollapseState(parsedCollapse);
        }
      } catch {
        /* malformed; leave current collapse state as-is */
      }
    }

    if (importMeta.last_import) await saveImportMeta(importMeta.last_import);
    // Reset sync metadata before scheduling the upload so the engine treats
    // the post-restore push as a clean first sync rather than a conflicting
    // local change against stale pre-restore Drive version/timestamps.
    await clearSyncMetadata();
    scheduleUpload();

    state.snaps = snapshots;
    state.txs = transactions;
    state.importMeta = importMeta;
    state.pd = transactions.length
      ? computePD(transactions, { method: getCostBasisMethod() })
      : null;

    await Promise.all([
      setCachedConfig({
        accounts: getAccounts(),
        holdings: getHoldings(),
        settings: getSettings(),
      }),
      setCachedSnapshots(snapshots),
      setCachedTransactions(transactions),
      setCachedImportMeta(importMeta),
      state.pd ? setCachedAggregates(state.pd) : Promise.resolve(),
      state.pd
        ? setInputsHash(
            computeInputsHash(
              transactions.length,
              transactions[transactions.length - 1]?.date || '',
              getCostBasisMethod(),
              holdingsSignature(getHoldings()),
            ),
          )
        : Promise.resolve(),
    ]);
    await setSetting('last_backup_at', new Date().toISOString());
    renderAll();
    return 'done';
  } finally {
    setSyncing(false);
    _lastSyncAt = Date.now();
  }
}
window.__restoreFromBackup = restoreFromBackup;

function setSyncStatus(status: string, msg = '') {
  const el = document.getElementById('sync-status');
  if (!el) return;
  const map: Record<string, { cls: string; text: string; title: string }> = {
    loading: {
      cls: 'status-warn',
      text: '<span class="spinner"></span>Loading\u2026',
      title: 'Loading app data and checking sync status',
    },
    syncing: {
      cls: 'status-warn',
      text: '<span class="spinner"></span>Syncing\u2026',
      title: 'Syncing local data with Google Drive',
    },
    cached: {
      cls: 'status-info',
      text: '\uD83D\uDCE6 Showing cached data',
      title: 'Showing cached local data; sign in to sync with Google Drive',
    },
    ok: {
      cls: 'status-ok',
      text: '\u2713 Synced',
      title: 'Local data is synced with Google Drive',
    },
    offline: {
      cls: 'status-warn',
      text: '\uD83D\uDCF4 Offline, showing cached data',
      title: 'Offline mode; showing cached local data until connection returns',
    },
    conflict: {
      cls: 'status-warn',
      text: '\u26A0 Sync paused \u2014 action needed',
      title: 'Sync paused because local and Drive copies both changed',
    },
    error: {
      cls: 'status-err',
      text: '\u26A0 Sync error: ' + msg,
      title: 'Sync error: ' + msg,
    },
  };
  const state = map[status];
  const cls = state?.cls || 'status-empty';
  const text = state?.text || '';
  const title = state?.title || '';
  el.className = 'status-pill ' + cls;
  el.innerHTML = text;
  if (title) {
    el.setAttribute('title', title);
    el.setAttribute('aria-label', title);
  } else {
    el.removeAttribute('title');
    el.removeAttribute('aria-label');
  }
  el.style.display = status ? 'inline-flex' : 'none';
  refreshConflictAccess();
}

// ── Setup banner (onboarding checklist) ───────────────────
let _bannerDismissed = false;

function renderSetupBanner(): void {
  const el = document.getElementById('setup-banner');
  if (!el) return;
  if (isInitialLoad() || isSyncBusy()) {
    el.style.display = 'none';
    return;
  }
  if (_bannerDismissed) {
    el.style.display = 'none';
    return;
  }

  const step: SetupStep = getSetupState({
    signedIn: isSignedIn(),
    accountCount: getAccounts().length,
    snapshotCount: state.snaps.length,
    cacheLoaded: state.cacheLoaded,
  });

  if (step === 'done') {
    // Show optional next-step hints until the user has imported transactions
    // and configured at least one holding on an investment account. Both are
    // optional but unlock Portfolio / Dividends functionality.
    const hasTransactions = state.txs.length > 0;
    const hasHoldings = getHoldings().length > 0;
    if (hasTransactions && hasHoldings) {
      el.style.display = 'none';
      return;
    }

    const bonusSteps = [
      ...(!hasTransactions
        ? [
            {
              id: 'import-csv',
              label: 'Import transactions',
              note: 'enables cost-basis, P&L & dividends',
            },
          ]
        : []),
      ...(!hasHoldings
        ? [
            {
              id: 'configure-holdings',
              label: 'Configure holdings',
              note: 'enables Portfolio & drift view',
            },
          ]
        : []),
    ];

    const stepsHtml = bonusSteps
      .map(
        (s, i) => `
      <span class="setup-step ${i === 0 ? 'step-current' : ''}">
        <span class="step-check">${i === 0 ? '→' : '○'}</span>
        ${s.label} <span style="color:var(--ink-3);font-size:10px">(${s.note})</span>
      </span>
    `,
      )
      .join('');

    const firstStep = bonusSteps[0];
    const ctaLabel = firstStep.id === 'import-csv' ? 'Import CSV' : 'Configure in Settings';
    el.innerHTML = `
      <div class="card setup-card" style="margin-bottom:1rem;padding:.75rem 1rem;display:flex;align-items:center;gap:1rem;flex-wrap:wrap">
        <div style="font-weight:500;font-size:13px;color:var(--ink)">Recommended next steps</div>
        <div class="setup-steps" style="display:flex;gap:.75rem;font-size:12px">${stepsHtml}</div>
        <div style="margin-left:auto;display:flex;gap:.5rem;align-items:center">
          <button class="btn btn-primary btn-sm" id="setup-cta">${ctaLabel}</button>
          <button class="btn btn-ghost btn-sm" id="setup-dismiss" title="Dismiss">✕</button>
        </div>
      </div>
    `;
    el.style.display = 'block';

    document.getElementById('setup-cta')?.addEventListener('click', () => {
      if (firstStep.id === 'import-csv') {
        showSection('log', document.querySelector('.nav button[data-section="log"]'));
      } else {
        showSection('settings', document.querySelector('.nav button[data-section="settings"]'));
      }
    });
    document.getElementById('setup-dismiss')?.addEventListener('click', () => {
      _bannerDismissed = true;
      el.style.display = 'none';
    });
    return;
  }

  const steps = [
    { id: 'signin', label: 'Sign in', done: step !== 'signin' },
    { id: 'accounts', label: 'Add accounts', done: step === 'first-update' },
    { id: 'first-update', label: 'First monthly update', done: false },
  ];

  const stepsHtml = steps
    .map(
      (s) => `
    <span class="setup-step ${s.done ? 'step-done' : ''} ${s.id === step ? 'step-current' : ''}">
      <span class="step-check">${s.done ? '✓' : s.id === step ? '→' : '○'}</span>
      ${s.label}
    </span>
  `,
    )
    .join('');

  let ctaHtml = '';
  if (step === 'signin') {
    ctaHtml = '<button class="btn btn-primary btn-sm" id="setup-cta">Sign in to start</button>';
  } else if (step === 'accounts') {
    ctaHtml = '<button class="btn btn-primary btn-sm" id="setup-cta">Add your accounts</button>';
  } else if (step === 'first-update') {
    ctaHtml = '<button class="btn btn-primary btn-sm" id="setup-cta">Log your first month</button>';
  }

  el.innerHTML = `
    <div class="card setup-card" style="margin-bottom:1rem;padding:.75rem 1rem;display:flex;align-items:center;gap:1rem;flex-wrap:wrap">
      <div style="font-weight:500;font-size:13px;color:var(--ink)">Get started</div>
      <div class="setup-steps" style="display:flex;gap:.75rem;font-size:12px">${stepsHtml}</div>
      <div style="margin-left:auto;display:flex;gap:.5rem;align-items:center">
        ${ctaHtml}
        <button class="btn btn-ghost btn-sm" id="setup-dismiss" title="Dismiss">✕</button>
      </div>
    </div>
  `;
  el.style.display = 'block';

  document.getElementById('setup-cta')?.addEventListener('click', () => {
    if (step === 'signin') onSignInClick();
    else if (step === 'accounts') {
      showSection('settings', document.querySelector('.nav button[data-section="settings"]'));
    } else if (step === 'first-update') {
      showSection('log', document.querySelector('.nav button[data-section="log"]'));
    }
  });
  document.getElementById('setup-dismiss')?.addEventListener('click', () => {
    _bannerDismissed = true;
    el.style.display = 'none';
  });
}

// ── Snapshot form ─────────────────────────────────────────
function initSnapForm() {
  document.getElementById('btn-add-snap')?.addEventListener('click', () => saveMonthlyUpdate());
}

async function saveSnapshot(snap: Snapshot) {
  const date = snap.date;
  if (!date) {
    showMsg('snap-msg', 'Please select a month.', false);
    return;
  }
  if (date > currentMonth()) {
    showMsg('snap-msg', 'Cannot log a future month.', false);
    return;
  }

  const btn = document.getElementById('btn-add-snap') as HTMLButtonElement;
  await performWriteAction({
    msgId: 'snap-msg',
    button: btn,
    busyText: 'Saving...',
    action: async () => {
      await upsertSnapshot(snap);
      scheduleUpload();
      const idx = state.snaps.findIndex((s) => s.date === date);
      if (idx >= 0) state.snaps[idx] = snap;
      else {
        state.snaps.push(snap);
        state.snaps.sort((a, b) => a.date.localeCompare(b.date));
      }
      const snapCached = await setCachedSnapshots(state.snaps);
      if (!snapCached) showCacheWriteWarning();
      renderAll();
    },
    onlineMessage: 'Saved ✓',
    offlineMessage: 'Saved locally. Will sync to Drive when back online.',
  });
}

/**
 * saveMonthlyUpdate - single orchestrator for the "Monthly update" flow.
 * Saves balances (snapshot) via the existing upsert path.
 * CSV import remains a separate confirm action within the same card.
 * Both paths run under the unified sync lock.
 */
async function saveMonthlyUpdate(editDate?: string) {
  if (!ensureWriteAccess('snap-msg')) return;

  let existing = editDate ? state.snaps.find((s) => s.date === editDate) : undefined;

  const snap = await snapshotDialog({
    mode: existing ? 'edit' : 'add',
    existing,
    prefill: existing ? undefined : prefillSnapFormFromLatest(),
    accounts: getAccounts(),
    holdings: state.pd?.etfs || {},
    configHoldings: getHoldings(),
  });
  if (!snap) return;
  await saveSnapshot(snap);
}

function editSnap(date: string) {
  const s = state.snaps.find((snap) => snap.date === date);
  if (!s) return;

  showSection('log', document.querySelector('.nav button[data-section="log"]'));
  void saveMonthlyUpdate(date);
}

async function delSnap(date: string, btn?: HTMLButtonElement) {
  if (!ensureWriteAccess('snap-msg', 'signed-in-or-granted')) return;
  const ok = await confirmDialog({
    title: `Delete snapshot for ${fmtMon(date)}?`,
    body: 'This cannot be undone.',
    confirmLabel: 'Delete',
    danger: true,
  });
  if (!ok) return;
  await performWriteAction({
    msgId: 'snap-msg',
    access: 'signed-in-or-granted',
    button: btn,
    busyText: 'Removing...',
    keepDisabledOnSuccess: true,
    errorPrefix: 'Delete failed: ',
    action: async () => {
      const previous = state.snaps;
      state.snaps = state.snaps.filter((s) => s.date !== date);
      try {
        await saveSnapshots(state.snaps);
        if (isSignedIn()) scheduleUpload();
        const snapCachedDel = await setCachedSnapshots(state.snaps);
        if (!snapCachedDel) showCacheWriteWarning();
        renderAll();
      } catch (err) {
        state.snaps = previous;
        throw err;
      }
    },
    onlineMessage: 'Snapshot deleted.',
    offlineMessage: 'Deleted locally. Will sync to Drive when back online.',
  });
}

async function delSnapsBulk(dates: string[], btn?: HTMLButtonElement) {
  if (!ensureWriteAccess('snap-msg', 'signed-in-or-granted')) return;
  const uniqueDates = Array.from(new Set(dates))
    .filter((date) => state.snaps.some((s) => s.date === date))
    .sort((a, b) => a.localeCompare(b));
  if (uniqueDates.length === 0) return;
  const preview = uniqueDates
    .slice(0, 3)
    .map((date) => fmtMon(date))
    .join(', ');
  const extraCount = Math.max(0, uniqueDates.length - 3);
  const summary = extraCount > 0 ? `${preview}, and ${extraCount} more` : preview;
  const ok = await confirmDialog({
    title: `Delete ${uniqueDates.length} snapshots?`,
    body: `This cannot be undone. Selected months: ${summary}.`,
    confirmLabel: 'Delete',
    danger: true,
  });
  if (!ok) return;
  await performWriteAction({
    msgId: 'snap-msg',
    access: 'signed-in-or-granted',
    button: btn,
    busyText: 'Removing...',
    keepDisabledOnSuccess: true,
    errorPrefix: 'Bulk delete failed: ',
    action: async () => {
      const previous = state.snaps;
      const toDelete = new Set(uniqueDates);
      state.snaps = state.snaps.filter((s) => !toDelete.has(s.date));
      try {
        await saveSnapshots(state.snaps);
        if (isSignedIn()) scheduleUpload();
        const snapCachedDel = await setCachedSnapshots(state.snaps);
        if (!snapCachedDel) showCacheWriteWarning();
        renderAll();
      } catch (err) {
        state.snaps = previous;
        throw err;
      }
    },
    onlineMessage: `${uniqueDates.length} snapshots deleted.`,
    offlineMessage: 'Deleted locally. Will sync to Drive when back online.',
  });
}

function computePdOrThrow(txs: Transaction[]): PortfolioData | null {
  if (!txs.length) return null;
  return computePD(txs, { method: getCostBasisMethod() });
}

async function persistTransactionsState(nextPd: PortfolioData | null): Promise<void> {
  state.txs = await loadTransactions();
  state.pd = nextPd;
  const txCached = await setCachedTransactions(state.txs);
  const aggCached = nextPd ? await setCachedAggregates(nextPd) : true;
  const hashCached = nextPd
    ? await setInputsHash(
        computeInputsHash(
          state.txs.length,
          state.txs[state.txs.length - 1]?.date || '',
          getCostBasisMethod(),
          holdingsSignature(getHoldings()),
        ),
      )
    : true;
  if (!txCached || !aggCached || !hashCached) showCacheWriteWarning();
}

async function addManualTransaction(): Promise<void> {
  if (!ensureWriteAccess('tx-msg', 'signed-in-or-granted')) return;
  try {
    const suggestions = buildAppSecuritySuggestions(state.txs);
    const draft = await transactionDialog({ suggestions });
    if (!draft) return;
    const candidate = [...state.txs, draft].sort((a, b) => a.date.localeCompare(b.date));
    const nextPd = computePdOrThrow(candidate);
    await performWriteAction({
      msgId: 'tx-msg',
      access: 'signed-in-or-granted',
      action: async () => {
        await insertTransaction(draft);
        if (isSignedIn()) scheduleUpload();
        await persistTransactionsState(nextPd);
        renderAll();
      },
      onlineMessage: 'Transaction added.',
      offlineMessage: 'Transaction saved locally. Will sync to Drive when back online.',
    });
  } catch (err) {
    showMsg('tx-msg', 'Error: ' + (err as Error).message, false);
  }
}

async function editManualTransaction(rowId: bigint): Promise<void> {
  if (!ensureWriteAccess('tx-msg', 'signed-in-or-granted')) return;
  const existing = state.txs.find((t) => t.rowId === rowId);
  if (!existing) {
    showMsg('tx-msg', 'Transaction not found.', false);
    return;
  }

  try {
    const suggestions = buildAppSecuritySuggestions(state.txs);
    const draft = await transactionDialog({ existing, suggestions });
    if (!draft) return;
    const candidate = state.txs.map((t) => (t.rowId === rowId ? { ...draft, rowId } : t));
    const nextPd = computePdOrThrow(candidate);
    await performWriteAction({
      msgId: 'tx-msg',
      access: 'signed-in-or-granted',
      action: async () => {
        await updateTransaction(rowId, draft);
        if (isSignedIn()) scheduleUpload();
        await persistTransactionsState(nextPd);
        renderAll();
      },
      onlineMessage: 'Transaction updated.',
      offlineMessage: 'Transaction updated locally. Will sync to Drive when back online.',
    });
  } catch (err) {
    showMsg('tx-msg', 'Error: ' + (err as Error).message, false);
  }
}

async function delManualTransaction(rowId: bigint, btn?: HTMLButtonElement): Promise<void> {
  if (!ensureWriteAccess('tx-msg', 'signed-in-or-granted')) return;
  const tx = state.txs.find((t) => t.rowId === rowId);
  if (!tx) {
    showMsg('tx-msg', 'Transaction not found.', false);
    return;
  }

  const ok = await confirmDialog({
    title: `Delete transaction on ${tx.date}?`,
    body: `${tx.type} ${tx.isin || tx.name || ''}`.trim() || 'This cannot be undone.',
    confirmLabel: 'Delete',
    danger: true,
  });
  if (!ok) return;
  const candidate = state.txs.filter((t) => t.rowId !== rowId);
  const nextPd = computePdOrThrow(candidate);
  await performWriteAction({
    msgId: 'tx-msg',
    access: 'signed-in-or-granted',
    button: btn,
    busyText: 'Deleting...',
    keepDisabledOnSuccess: true,
    errorPrefix: 'Delete failed: ',
    action: async () => {
      await deleteTransaction(rowId);
      if (isSignedIn()) scheduleUpload();
      await persistTransactionsState(nextPd);
      renderAll();
    },
    onlineMessage: 'Transaction deleted.',
    offlineMessage: 'Transaction deleted locally. Will sync to Drive when back online.',
  });
}

async function delTransactionsBulk(rowIds: bigint[], btn?: HTMLButtonElement): Promise<void> {
  if (!ensureWriteAccess('tx-msg', 'signed-in-or-granted')) return;
  const uniqueIds = Array.from(new Set(rowIds.map((rowId) => rowId.toString())))
    .map((rowId) => BigInt(rowId))
    .filter((rowId) => state.txs.some((tx) => tx.rowId === rowId));
  if (uniqueIds.length === 0) return;
  const preview = state.txs
    .filter((tx) => tx.rowId != null && uniqueIds.some((id) => id === tx.rowId))
    .slice(0, 3)
    .map((tx) => `${tx.date} ${tx.type}`)
    .join(', ');
  const extraCount = Math.max(0, uniqueIds.length - 3);
  const summary = extraCount > 0 ? `${preview}, and ${extraCount} more` : preview;
  const ok = await confirmDialog({
    title: `Delete ${uniqueIds.length} transactions?`,
    body: `This cannot be undone. Selected rows: ${summary}.`,
    confirmLabel: 'Delete',
    danger: true,
  });
  if (!ok) return;
  const toDelete = new Set(uniqueIds.map((id) => id.toString()));
  const candidate = state.txs.filter(
    (tx) => tx.rowId == null || !toDelete.has(tx.rowId.toString()),
  );
  const nextPd = computePdOrThrow(candidate);
  await performWriteAction({
    msgId: 'tx-msg',
    access: 'signed-in-or-granted',
    button: btn,
    busyText: 'Deleting...',
    keepDisabledOnSuccess: true,
    errorPrefix: 'Bulk delete failed: ',
    action: async () => {
      await deleteTransactions(uniqueIds);
      if (isSignedIn()) scheduleUpload();
      await persistTransactionsState(nextPd);
      renderAll();
    },
    onlineMessage: `${uniqueIds.length} transactions deleted.`,
    offlineMessage: 'Transactions deleted locally. Will sync to Drive when back online.',
  });
}

function getLatestSnapshotValues(): Record<string, number | string | undefined> | null {
  if (state.snaps.length === 0) return null;
  return state.snaps[state.snaps.length - 1];
}

function prefillSnapFormFromLatest(): Snapshot | undefined {
  const latest = getLatestSnapshotValues();
  const prefill: Snapshot = { date: currentMonth() };
  if (!latest) return prefill;

  for (const a of getACCTSList()) {
    const value = latest[a.key];
    if (typeof value === 'number') prefill[a.key] = value;
  }

  for (const [key, val] of Object.entries(latest)) {
    if (key.startsWith('etf_') && typeof val === 'number' && val > 0) {
      prefill[key] = val;
    }
  }
  return prefill;
}

// ── CSV import ────────────────────────────────────────────
function initCSVDrop() {
  const zone = document.getElementById('drop-zone');
  const inp = document.getElementById('csv-file-input') as HTMLInputElement | null;

  if (!zone || !inp) return;

  inp.addEventListener('change', () => {
    if (inp.files?.[0]) handleCSVFile(inp.files[0]);
  });
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('over');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('over');
    const f = e.dataTransfer?.files[0];
    if (f?.name.toLowerCase().endsWith('.csv')) handleCSVFile(f);
    else showMsg('import-msg', 'Please drop a .csv file', false);
  });
}

async function handleCSVFile(file: File) {
  if (!isSignedIn()) {
    showMsg('import-msg', 'Please sign in before importing.', false);
    return;
  }
  if (isSyncBusy()) {
    showMsg('import-msg', 'A sync is already in progress.', false);
    return;
  }
  showMsg('import-msg', 'Parsing\u2026', true);
  const reader = new FileReader();
  reader.onload = (e) => {
    const text = e.target!.result as string;
    const headerLine = text.trim().split('\n')[0] || '';

    // Auto-detect profile
    let profile = detectProfile(headerLine);

    if (profile) {
      // Profile detected - parse immediately and show preview
      showImportPreview(text, profile);
    } else {
      // No match - show profile picker
      showProfilePicker(text);
    }
  };
  reader.readAsText(file, 'UTF-8');
}

/** Show a dropdown to pick a profile when auto-detect fails. */
function showProfilePicker(csvText: string) {
  const container = document.getElementById('import-preview');
  if (!container) return;

  const options = builtInProfiles
    .map((p) => `<option value="${esc(p.id)}">${esc(p.label)}</option>`)
    .join('');

  container.innerHTML = `
    <div class="card" style="margin-top:.75rem">
      <div class="card-title">Select import profile</div>
      <p class="note" style="margin-bottom:.75rem">Could not auto-detect the CSV format. Please select the matching bank/broker profile:</p>
      <div style="display:flex;gap:10px;align-items:center;margin-bottom:.75rem">
        <select id="profile-select" class="form-input" style="width:auto;max-width:260px">
          ${options}
        </select>
        <button class="btn btn-primary btn-sm" id="btn-apply-profile">Parse with profile</button>
      </div>
      <button class="btn btn-ghost btn-sm" id="btn-cancel-profile">Cancel</button>
    </div>
  `;
  container.style.display = 'block';

  document.getElementById('btn-apply-profile')?.addEventListener('click', () => {
    const id = (document.getElementById('profile-select') as HTMLSelectElement | null)?.value;
    const profile = builtInProfiles.find((p) => p.id === id);
    if (profile) showImportPreview(csvText, profile);
  });
  document.getElementById('btn-cancel-profile')?.addEventListener('click', () => {
    container.innerHTML = '';
    container.style.display = 'none';
    showMsg('import-msg', 'Import cancelled.', false);
  });
}

/** Parse CSV with profile and show a preview for confirmation. */
function showImportPreview(csvText: string, profile: ImportProfile) {
  const parsed = parseWithProfile(csvText, profile);
  const summary = previewSummary(parsed);
  const container = document.getElementById('import-preview');
  if (!container) return;
  const cont = container; // capture for closures
  const allRows = parsed.transactions;
  const excludedRows = new Set<number>();
  const PAGE_SIZE = 25;
  let currentPage = 0;
  let hideDateWarning = false;

  function getIncludedRows() {
    return allRows.filter((_, idx) => !excludedRows.has(idx));
  }

  // Confirm handler - save to database
  async function confirmImport() {
    if (isSyncBusy()) {
      showMsg('import-msg', 'A sync or save is in progress. Try again in a moment.', false);
      return;
    }
    const includedRows = getIncludedRows();
    if (includedRows.length === 0) {
      showMsg('import-msg', 'No rows selected for import. Include at least one row.', false);
      return;
    }
    cont.innerHTML = '';
    cont.style.display = 'none';
    setSyncing(true);
    try {
      const merged = await mergeTransactions(state.txs, includedRows);
      const today = new Date().toISOString().slice(0, 10);
      await saveImportMeta(today);
      state.txs = merged;
      state.importMeta = { last_import: today };
      state.pd = computePD(merged, { method: getCostBasisMethod() });

      // Update cache
      const [txCached] = await Promise.all([
        setCachedTransactions(merged),
        setCachedImportMeta({ last_import: today }),
        state.pd ? setCachedAggregates(state.pd) : Promise.resolve(),
        state.pd
          ? setInputsHash(
              computeInputsHash(
                merged.length,
                merged[merged.length - 1]?.date || '',
                getCostBasisMethod(),
                holdingsSignature(getHoldings()),
              ),
            )
          : Promise.resolve(),
      ]);
      if (!txCached) showCacheWriteWarning();

      renderAll();
      showMsg(
        'import-msg',
        state.offline || !navigator.onLine
          ? `\u2713 Imported ${includedRows.length} row${includedRows.length > 1 ? 's' : ''} locally (${excludedRows.size} excluded). Will sync to Drive when back online.`
          : `\u2713 Imported ${includedRows.length} row${includedRows.length > 1 ? 's' : ''} (${excludedRows.size} excluded).`,
        true,
      );

      // Push to cloud immediately so a page reload won't pull
      // the stale cloud DB and overwrite the freshly imported data.
      // When offline, pushToCloud() fails gracefully; the data is safe
      // in local SQLite and will be pushed on next Sync Now or write.
      try {
        await pushToCloud();
      } catch (err) {
        if (!handleSyncConflict(err)) throw err;
      }
    } catch (err) {
      showMsg('import-msg', 'Error: ' + (err as Error).message, false);
    } finally {
      setSyncing(false);
    }
  }

  // Build type counts string
  const typeCounts = Object.entries(summary.byCounts)
    .sort(([, a], [, b]) => b - a)
    .map(([type, count]) => `<span style="font-weight:500">${count}</span> ${esc(type)}`)
    .join(', ');

  // Unmapped warning
  const totalUnmapped = summary.unmapped.reduce((s, u) => s + u.count, 0);
  const unmappedList = summary.unmapped
    .map((u) => `<code>${esc(u.type)}</code> (${u.count})`)
    .join(', ');
  const unmappedHtml =
    totalUnmapped > 0
      ? `
    <div class="status-bar status-warn" style="margin:.6rem 0">
      ⚠ ${totalUnmapped} row${totalUnmapped > 1 ? 's' : ''} with unmapped type${totalUnmapped > 1 ? 's' : ''}: ${unmappedList}
    </div>
  `
      : '';

  const totalDateErrors = summary.dateErrors.reduce((s, d) => s + d.count, 0);
  const dateErrorsList = summary.dateErrors
    .map((d) => `<code>${esc(d.raw)}</code> (${d.count})`)
    .join(', ');
  const dateErrorsHtml =
    totalDateErrors > 0
      ? `
    <div class="status-bar status-warn" style="margin:.6rem 0" id="import-date-warn">
      ⚠ ${totalDateErrors} row${totalDateErrors > 1 ? 's' : ''} skipped due to invalid date${totalDateErrors > 1 ? 's' : ''}: ${dateErrorsList}
      <button class="btn btn-ghost btn-sm" id="btn-dismiss-date-warn" style="margin-left:8px">Dismiss</button>
    </div>
  `
      : '';

  const totalNumberErrors = summary.numberErrors.reduce((s, e) => s + e.count, 0);
  const numberErrorsList = summary.numberErrors
    .map((e) => `<code>${esc(e.field)}: ${esc(e.raw)}</code> (${e.count})`)
    .join(', ');
  const numberErrorsHtml =
    totalNumberErrors > 0
      ? `
    <div class="status-bar status-warn" style="margin:.6rem 0">
      ⚠ ${totalNumberErrors} cell${totalNumberErrors > 1 ? 's' : ''} with unparseable number (coerced to 0): ${numberErrorsList}
    </div>
  `
      : '';

  // Amended-rows warning: rows that already exist but differ in at least one data field.
  // Computed once against the current stored set; the merge will silently keep the stored values.
  const amendedCount = countAmendedRows(state.txs, allRows);
  const amendedHtml =
    amendedCount > 0
      ? `
    <div class="status-bar status-warn" style="margin:.6rem 0">
      ⚠ ${amendedCount} row${amendedCount > 1 ? 's' : ''} already exist and differ from the imported file — re-import does not overwrite existing data.
    </div>
  `
      : '';

  function renderPreview() {
    const includedCount = summary.total - excludedRows.size;
    const totalPages = Math.max(1, Math.ceil(allRows.length / PAGE_SIZE));
    currentPage = Math.min(currentPage, totalPages - 1);
    const start = currentPage * PAGE_SIZE;
    const end = Math.min(start + PAGE_SIZE, allRows.length);
    const pageRows = allRows.slice(start, end);

    const previewTableHtml =
      pageRows.length > 0
        ? `
      <div style="overflow-x:auto;margin-top:.6rem;-webkit-overflow-scrolling:touch">
        <table style="width:100%;font-size:11px;border-collapse:collapse">
          <thead>
            <tr style="color:var(--ink-3);text-transform:uppercase;letter-spacing:.04em">
              <th style="padding:4px 6px;text-align:left">Date</th>
              <th style="padding:4px 6px;text-align:left">Type</th>
              <th style="padding:4px 6px;text-align:left">Name</th>
              <th style="padding:4px 6px;text-align:right">Shares</th>
              <th style="padding:4px 6px;text-align:right">Amount</th>
              <th style="padding:4px 6px;text-align:left">Currency</th>
              <th style="padding:4px 6px;text-align:right">Action</th>
            </tr>
          </thead>
          <tbody>
            ${pageRows
              .map((tx, idxOnPage) => {
                const idx = start + idxOnPage;
                const excluded = excludedRows.has(idx);
                return `
                <tr style="border-top:1px solid var(--line);opacity:${excluded ? '0.5' : '1'}">
                  <td style="padding:4px 6px">${esc(tx.date)}</td>
                  <td style="padding:4px 6px">${esc(tx.type)}</td>
                  <td style="padding:4px 6px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(tx.name)}</td>
                  <td style="padding:4px 6px;text-align:right">${tx.shares || ''}</td>
                  <td style="padding:4px 6px;text-align:right">${tx.amount}</td>
                  <td style="padding:4px 6px">${esc(tx.currency)}</td>
                  <td style="padding:4px 6px;text-align:right">
                    <button class="btn btn-ghost btn-sm" data-toggle-exclude="1" data-idx="${idx}">
                      ${excluded ? 'Include' : 'Exclude'}
                    </button>
                  </td>
                </tr>
              `;
              })
              .join('')}
          </tbody>
        </table>
      </div>
    `
        : '';

    const pageInfoHtml =
      allRows.length > 0
        ? `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:.6rem">
        <div class="note">
          Showing rows ${start + 1}-${end} of ${allRows.length}
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <button class="btn btn-ghost btn-sm" id="btn-prev-import-page" ${currentPage === 0 ? 'disabled' : ''}>Previous</button>
          <span class="note">Page ${currentPage + 1} / ${totalPages}</span>
          <button class="btn btn-ghost btn-sm" id="btn-next-import-page" ${currentPage >= totalPages - 1 ? 'disabled' : ''}>Next</button>
        </div>
      </div>
    `
        : '<div class="note" style="margin-top:.6rem">No parsed rows to preview.</div>';

    cont.innerHTML = `
      <div class="card" style="margin-top:.75rem">
        <div class="card-title">Import preview</div>
        <div style="margin:.6rem 0;font-size:13px">
          <span style="font-weight:500">Profile:</span> ${esc(profile.label)}
        </div>
        <div style="font-size:13px">
          <span style="font-weight:500">${summary.total}</span> rows parsed (${includedCount} included, ${excludedRows.size} excluded): ${typeCounts}
        </div>
        ${unmappedHtml}
        ${hideDateWarning ? '' : dateErrorsHtml}
        ${numberErrorsHtml}
        ${amendedHtml}
        ${previewTableHtml}
        ${pageInfoHtml}
        <div style="display:flex;gap:10px;margin-top:.85rem">
          <button class="btn btn-primary" id="btn-confirm-import" ${includedCount === 0 ? 'disabled' : ''}>Confirm import (${includedCount})</button>
          <button class="btn btn-ghost" id="btn-cancel-import">Cancel</button>
        </div>
      </div>
    `;
    cont.style.display = 'block';

    document.getElementById('btn-confirm-import')?.addEventListener('click', () => confirmImport());
    document.getElementById('btn-cancel-import')?.addEventListener('click', () => {
      cont.innerHTML = '';
      cont.style.display = 'none';
      showMsg('import-msg', 'Import cancelled.', false);
    });
    document.getElementById('btn-dismiss-date-warn')?.addEventListener('click', () => {
      document.getElementById('import-date-warn')?.remove();
    });
    document.getElementById('btn-prev-import-page')?.addEventListener('click', () => {
      if (currentPage > 0) {
        currentPage -= 1;
        renderPreview();
      }
    });
    document.getElementById('btn-next-import-page')?.addEventListener('click', () => {
      if (currentPage < totalPages - 1) {
        currentPage += 1;
        renderPreview();
      }
    });
    document.querySelectorAll<HTMLButtonElement>('[data-toggle-exclude="1"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.idx);
        if (!Number.isInteger(idx)) return;
        if (excludedRows.has(idx)) excludedRows.delete(idx);
        else excludedRows.add(idx);
        renderPreview();
      });
    });
  }

  renderPreview();
}

// ── Update subtitle ───────────────────────────────────────
function updateSub() {
  const parts = [];
  if (state.importMeta?.last_import && state.txs.length) {
    parts.push(`CSV: ${state.importMeta.last_import}`);
  }
  if (state.snaps.length > 0) {
    parts.push(
      `${state.snaps.length} snapshot${state.snaps.length > 1 ? 's' : ''} · latest ${fmtMon(state.snaps[state.snaps.length - 1].date)}`,
    );
  }
  const el = document.getElementById('app-sub');
  if (el) el.textContent = parts.length > 0 ? parts.join(' · ') : CONFIG.app.subtitle;
}

// ── Portfolio sub-view helpers ─────────────────────────────
function showPortfolioSubview(sub: string, force = false): void {
  const alreadyActive =
    !force &&
    _portfolioSubview === sub &&
    document.getElementById(`subview-${sub}`)?.style.display === 'block';
  if (alreadyActive) {
    history.replaceState(null, '', navHash('portfolio', sub));
    return;
  }
  _portfolioSubview = sub as typeof _portfolioSubview;
  ['holdings', 'contributions', 'dividends'].forEach((s) => {
    const el = document.getElementById(`subview-${s}`);
    if (el) el.style.display = s === sub ? 'block' : 'none';
  });
  document.querySelectorAll('#portfolio-subnav [data-subview]').forEach((b) => {
    const isActive = (b as HTMLElement).dataset.subview === sub;
    b.classList.toggle('active', isActive);
    b.setAttribute('aria-selected', String(isActive));
    b.setAttribute('tabindex', isActive ? '0' : '-1');
  });
  renderPortfolioSubview(sub);
  history.replaceState(null, '', navHash('portfolio', sub));
}

function renderPortfolioSubview(sub: string): void {
  if (sub === 'holdings') renderPortfolio(state.pd, state.snaps);
  else if (sub === 'contributions') renderDCA(state.pd, state.snaps);
  else if (sub === 'dividends') renderDividends(state.pd, state.txs);
}

// ── Section dispatcher ────────────────────────────────────
function renderSection(id: string, changed?: ConfigChangeKind): void {
  if (isInitialLoad()) {
    const section = document.getElementById(id);
    if (section && !section.querySelector('.section-loading')) {
      const overlay = document.createElement('div');
      overlay.className = 'section-loading';
      overlay.innerHTML = '<span class="spinner"></span> Loading\u2026';
      overlay.style.cssText =
        'display:flex;align-items:center;gap:0.5rem;padding:2rem 1rem;font-size:13px;color:var(--ink-2)';
      section.prepend(overlay);
    }
    return;
  }
  // Remove any leftover overlay
  document.getElementById(id)?.querySelector('.section-loading')?.remove();
  try {
    switch (id) {
      case 'networth':
        renderNW(state.snaps);
        break;
      case 'portfolio':
        renderPortfolioSubview(_portfolioSubview);
        break;
      case 'settings':
        if (changed) {
          refreshSettingsAfterChange(changed);
        } else {
          renderSettings();
        }
        break;
      case 'analytics': {
        const anContent = document.getElementById('an-content');
        if (anContent && state.snaps.length > 0) {
          if (!anContent.querySelector('.an-computing')) {
            const placeholder = document.createElement('div');
            placeholder.className = 'an-computing';
            placeholder.innerHTML = '<span class="spinner"></span> Computing\u2026';
            placeholder.style.cssText =
              'display:flex;align-items:center;gap:0.5rem;padding:2rem 1rem;font-size:13px;color:var(--ink-2)';
            anContent.prepend(placeholder);
          }
          setTimeout(() => {
            anContent.querySelector('.an-computing')?.remove();
            renderAnalytics(state.pd, state.snaps, state.txs);
          }, 0);
        } else {
          renderAnalytics(state.pd, state.snaps, state.txs);
        }
        break;
      }
      case 'log':
        renderLog({
          txs: state.txs,
          snaps: state.snaps,
          importMeta: state.importMeta,
          onEditSnap: editSnap,
          onDelSnap: delSnap,
          onBulkDelSnaps: delSnapsBulk,
          onAddTx: addManualTransaction,
          onEditTx: editManualTransaction,
          onDelTx: delManualTransaction,
          onBulkDelTxs: delTransactionsBulk,
          readOnly: isReadOnly(),
        });
        break;
    }
  } catch (err: unknown) {
    console.error(`[renderSection] error in section "${id}":`, err);
    const section = document.getElementById(id);
    if (section && !section.querySelector('.section-error')) {
      const msg = document.createElement('div');
      msg.className = 'section-error';
      msg.style.cssText = 'padding:1.5rem 1rem;font-size:13px;color:var(--neg)';
      msg.textContent =
        'Something went wrong rendering this section. Try a Force full resync from Settings, or reload the page.';
      section.prepend(msg);
    }
  }
}

// ── Render all ────────────────────────────────────────────
function renderAll(changed?: ConfigChangeKind) {
  updateSub();
  renderSetupBanner(); // update onboarding checklist
  _dirty.clear();
  for (const s of ALL_SECTIONS) _dirty.add(s);
  _dirty.delete(_activeSection);
  renderSection(_activeSection, changed);
  applyReadOnlyMode();
  // Re-inject transient feedback message if still within its display window
  reinjectPendingMsg();
  updateDriftBadge();
}

/** Shows a dot badge on the Portfolio tab when max allocation drift exceeds the configured threshold. */
function updateDriftBadge(): void {
  const btn = document.getElementById('tab-portfolio');
  if (!btn) return;
  const max = getMaxDrift(state.pd, state.snaps);
  const threshold = getAlertSettings().driftThresholdPct || 5;
  const highThreshold = threshold * 2;

  if (max !== null && max > threshold) {
    const isHigh = max > highThreshold;
    btn.classList.add('drift-alert');
    btn.classList.toggle('drift-alert-high', isHigh);
    btn.setAttribute('aria-label', `Portfolio (drift alert: ${fmtPctVal(max)})`);

    const severityLabel = isHigh ? 'High drift' : 'Moderate drift';
    const thresholdLabel = isHigh
      ? `over ${fmtPctVal(highThreshold, 'auto')} (high threshold)`
      : `over ${fmtPctVal(threshold, 'auto')} (threshold)`;
    const tipText = `${severityLabel}: max allocation drift is ${fmtPctVal(max)}, ${thresholdLabel}. Open Portfolio to review it.`;

    // Embed an infoTip span so hover/tap reveals the drift detail using the
    // shared popover system instead of a parallel custom implementation.
    const variant = isHigh ? 'alert' : 'warn';
    let tipEl = btn.querySelector<HTMLElement>('.info-tip');
    if (!tipEl) {
      const wrapper = document.createElement('span');
      wrapper.innerHTML = `<span class="info-tip info-tip--${variant}" data-tip="" data-tip-variant="${variant}" aria-label="" tabindex="0">${variant === 'alert' ? '\u203c' : '!'}</span>`;
      tipEl = wrapper.firstElementChild as HTMLElement;
      btn.appendChild(tipEl);
    } else {
      // Update variant class/icon in case severity changed
      tipEl.className = `info-tip info-tip--${variant}`;
      tipEl.dataset.tipVariant = variant;
      tipEl.textContent = variant === 'alert' ? '\u203c' : '!';
      // Re-bind listeners after class change by clearing the bound flag
      delete (tipEl as HTMLElement & { dataset: DOMStringMap }).dataset.tipBound;
    }
    tipEl.dataset.tip = tipText;
    tipEl.setAttribute('aria-label', tipText);
    attachInfoTips(btn);
  } else {
    btn.classList.remove('drift-alert', 'drift-alert-high');
    btn.removeAttribute('aria-label');
    // Remove the embedded info-tip when drift clears
    btn.querySelector('.info-tip')?.remove();
  }
}

// Export updateDriftBadge so it can be called from settings when alert threshold changes
(window as any).updateDriftBadge = updateDriftBadge;

/**
 * Shows a one-time dismissible warning banner when an IDB cache write fails.
 * Multiple failures within a session only show the banner once.
 */
function showCacheWriteWarning(): void {
  if (document.getElementById('cache-warn-banner')) return;
  const banner = document.createElement('div');
  banner.id = 'cache-warn-banner';
  banner.className = 'status-bar status-warn';
  banner.style.cssText =
    'position:sticky;top:0;z-index:100;padding:8px 12px;display:flex;align-items:center;gap:8px';
  banner.innerHTML =
    'Local cache could not be saved. Reopen the app while online to reload from your backup.' +
    '<button aria-label="Dismiss" style="margin-left:auto;background:none;border:none;cursor:pointer;font-size:16px;line-height:1;color:inherit">&#x2715;</button>';
  banner.querySelector('button')?.addEventListener('click', () => banner.remove());
  const main = document.querySelector('main') || document.body;
  main.prepend(banner);
}

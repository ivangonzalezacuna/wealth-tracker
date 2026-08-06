import './styles.css';
import { logEnvironment, injectEnvBanner } from './env';
import { checkStorageQuota } from './storage';
import { CONFIG } from './config';
import { getACCTSList } from './constants';
import { appTemplate } from './template';
import { signIn as gisSignIn, signOut, isSignedIn } from './auth/google';
import {
  loadSnapshots,
  saveSnapshots,
  upsertSnapshot,
  loadTransactions,
  mergeTransactions,
  saveImportMeta,
  loadImportMeta,
  restoreAllData,
  logConfigChange,
} from './db';
import { pullFromCloud, pushToCloud, scheduleUpload } from './sync/engine';
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
  fmtEur2,
  safeColor,
  fmtPctVal,
} from './utils';
import { parseNum } from './csv';
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
import { onThemeChange } from './theme';
import { shouldAutoResync } from './sync/policy';
import { loadCollapseState, replaceCollapseState } from './ui/collapseState';
import { restoreCollapseFromSheet, backupCollapseToSheet } from './ui/collapseSync';
import { confirmDialog } from './ui/confirmDialog';
import { showSigninOverlay, hideSigninOverlay } from './ui/signinOverlay';
import { withTimeout } from './sync/timeout';
import { isBusy, setBusy } from './sync/lock';
import { registerSW } from 'virtual:pwa-register';
import type { Snapshot, Transaction, PortfolioData, ImportProfile, Account } from './types';

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
const ALL_SECTIONS = ['networth', 'portfolio', 'settings', 'log'] as const;

// ── Portfolio sub-view state ─────────────────────────────
let _portfolioSubview: 'holdings' | 'contributions' | 'dividends' = 'holdings';
let _driftTooltipEl: HTMLSpanElement | null = null;

// ── Unified sync/write lock (shared with settings.ts - see sync/lock.ts) ──
let _lastSyncAt = 0;
const AUTO_RESYNC_MIN_INTERVAL_MS = 2 * 60_000; // 2 minutes
function setSyncing(v: boolean): void {
  setBusy(v);
  // Reconcile Settings button states immediately (not just at next renderAll).
  applySyncBusyState();
  // Also disable write controls outside Settings (snapshot Save, CSV import, etc.).
  applyReadOnlyMode();
}
function isSyncBusy(): boolean {
  return isBusy();
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
  const writeIds = ['btn-save-snap', 'btn-confirm-import', 'btn-sync-now'];
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
    const formGrid = balanceCard.querySelector('.form-grid') as HTMLElement | null;
    const saveRow = balanceCard.querySelector('#btn-save-snap')
      ?.parentElement as HTMLElement | null;
    let roMsg = balanceCard.querySelector('.ro-msg') as HTMLElement | null;

    if (readOnly) {
      if (formGrid) formGrid.style.display = 'none';
      if (saveRow) saveRow.style.display = 'none';
      if (!roMsg) {
        roMsg = document.createElement('p');
        roMsg.className = 'note ro-msg';
        roMsg.style.marginTop = '0.5rem';
        roMsg.textContent = '📦 Read-only mode. Sign in to log monthly updates.';
        balanceCard.querySelector('.card-title')?.insertAdjacentElement('afterend', roMsg);
      }
      roMsg.style.display = '';
    } else {
      if (formGrid) formGrid.style.display = '';
      if (saveRow) saveRow.style.display = '';
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
void checkStorageQuota(); // fire-and-forget storage check
loadCollapseState(); // fire-and-forget: loads persisted UI collapse state from IDB
initNav();
initSnapForm();
initCSVDrop();
initAuth();
setDefaultMonth();
initOnlineListeners();
initThemeListener();
initPwaUpdate();

// ── Navigation ───────────────────────────────────────────
function initNav() {
  document.querySelectorAll<HTMLElement>('.nav button[data-section]').forEach((btn) => {
    btn.addEventListener('click', () => showSection(btn.dataset.section!, btn));
  });
  const portfolioBtn = document.getElementById('tab-portfolio') as HTMLElement | null;
  portfolioBtn?.addEventListener('mouseenter', (e) => {
    if (_isTouchLikeEvent(e)) return;
    showDriftTooltip(portfolioBtn);
  });
  portfolioBtn?.addEventListener('mouseleave', (e) => {
    if (_isTouchLikeEvent(e)) return;
    hideDriftTooltip();
  });
  portfolioBtn?.addEventListener('focus', () => showDriftTooltip(portfolioBtn));
  portfolioBtn?.addEventListener('blur', hideDriftTooltip);
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
    const pushed = await pushToCloud();
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
    setAuthStatus('<span class="spinner"></span>Signing in…');
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

function setAuthStatus(msg: string, isErr = false) {
  const el = document.getElementById('auth-status');
  if (!el) return;
  if (isErr) {
    el.textContent = msg;
  } else {
    el.innerHTML = msg;
  }
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
    setSyncStatus('error', (err as Error).message);
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

    await loadConfig();
    restoreCollapseFromSheet(); // restore UI prefs if IDB was empty
    const [snaps, txs, meta] = await Promise.all([
      loadSnapshots(),
      loadTransactions(),
      loadImportMeta(),
    ]);
    state.snaps = snaps;
    state.txs = txs;
    state.importMeta = meta;
    state.pd = txs.length ? computePD(txs, { method: getCostBasisMethod() }) : null;

    // Cache everything
    const [configCachedLA, snapsCachedLA, txsCachedLA] = await Promise.all([
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
    if (!configCachedLA || !snapsCachedLA || !txsCachedLA) showCacheWriteWarning();

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
    setSyncStatus('error', (err as Error).message);
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
    bodyHtml: summarizeBackup(backup),
    confirmLabel: 'Restore',
    danger: true,
  });
  if (!ok) return 'cancelled';

  setSyncing(true);
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
  const map: Record<string, [string, string]> = {
    loading: ['status-warn', '<span class="spinner"></span>Loading\u2026'],
    syncing: ['status-warn', '<span class="spinner"></span>Syncing\u2026'],
    cached: ['status-info', '\uD83D\uDCE6 Showing cached data'],
    ok: ['status-ok', '\u2713 Synced'],
    offline: ['status-warn', '\uD83D\uDCF4 Offline, showing cached data'],
    error: ['status-err', '\u26A0 Sync error: ' + msg],
  };
  const [cls, text] = map[status] || ['status-empty', ''];
  el.className = 'status-pill ' + cls;
  el.innerHTML = text;
  el.style.display = status ? 'inline-flex' : 'none';
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
    el.style.display = 'none';
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
  document.getElementById('btn-save-snap')?.addEventListener('click', saveMonthlyUpdate);

  // Event delegation for ETF breakdown toggle buttons and live reconciliation.
  // Both listeners are attached once here so they survive renderSnapForm re-renders.
  const fieldsEl = document.getElementById('snap-acct-fields');
  if (fieldsEl) {
    fieldsEl.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('.snap-etf-toggle') as HTMLElement | null;
      if (!btn) return;
      const acctKey = btn.dataset.acctKey;
      if (!acctKey) return;
      const section = document.getElementById(`snap-etf-section-${acctKey}`);
      if (!section) return;
      const isOpen = section.style.display !== 'none';
      section.style.display = isOpen ? 'none' : '';
      btn.setAttribute('aria-expanded', String(!isOpen));
      const chevron = btn.querySelector('.snap-etf-chevron') as HTMLElement | null;
      if (chevron) chevron.textContent = isOpen ? '\u25b8' : '\u25be';
    });
    fieldsEl.addEventListener('input', (e) => {
      const target = e.target as HTMLInputElement;
      let acctKey = '';
      if (target.dataset.acctKey) {
        // ETF value input
        acctKey = target.dataset.acctKey;
      } else if (
        target.id.startsWith('snap-') &&
        target.id !== 'snap-date' &&
        target.id !== 'snap-notes'
      ) {
        // Account total input (id = snap-<key>)
        acctKey = target.id.slice(5);
      }
      if (acctKey) _updateSnapEtfRecon(acctKey);
    });
  }
}

function setDefaultMonth() {
  const cur = currentMonth();
  const el = document.getElementById('snap-date') as HTMLInputElement | null;
  if (el) {
    el.value = cur;
    el.max = cur;
  }
}

async function saveSnapshot() {
  if (!isSignedIn()) {
    showMsg('snap-msg', 'Please sign in first.', false);
    return;
  }
  if (isSyncBusy()) {
    showMsg('snap-msg', 'A sync or save is in progress. Try again in a moment.', false);
    return;
  }
  const date = (document.getElementById('snap-date') as HTMLInputElement | null)?.value;
  if (!date) {
    showMsg('snap-msg', 'Please select a month.', false);
    return;
  }
  if (date > currentMonth()) {
    showMsg('snap-msg', 'Cannot log a future month.', false);
    return;
  }

  const snap: Snapshot = { date };
  for (const a of getACCTSList()) {
    const el = document.getElementById(`snap-${a.key}`) as HTMLInputElement | null;
    snap[a.key] = parseNum(String(el?.value ?? ''));
  }
  snap.notes =
    (document.getElementById('snap-notes') as HTMLInputElement | null)?.value.trim() || '';

  // Persist per-ETF market values from the breakdown section (primary investment accounts only).
  const etfInputs = document.querySelectorAll<HTMLInputElement>('[data-etf-isin]');
  for (const inp of Array.from(etfInputs)) {
    const isin = inp.dataset.etfIsin;
    const val = parseNum(String(inp.value ?? ''));
    if (isin && val > 0) {
      snap[`etf_${isin}`] = val;
    }
  }

  // Validate ETF reconciliation: if any ETF value is entered for an account,
  // the sum must equal the account total. If none are set, skip.
  for (const a of getACCTSList()) {
    const section = document.getElementById(`snap-etf-section-${a.key}`);
    if (!section) continue;
    const sectionInputs = section.querySelectorAll<HTMLInputElement>('[data-etf-isin]');
    let allocated = 0;
    let anySet = false;
    for (const inp of Array.from(sectionInputs)) {
      const v = parseNum(String(inp.value ?? ''));
      if (v > 0) {
        anySet = true;
        allocated += v;
      }
    }
    if (!anySet) continue;
    const total = (snap[a.key] as number | undefined) ?? 0;
    if (Math.abs(allocated - total) > 0.005) {
      section.style.display = '';
      const toggleBtn = document.querySelector<HTMLElement>(
        `.snap-etf-toggle[data-acct-key="${a.key}"]`,
      );
      if (toggleBtn) {
        toggleBtn.setAttribute('aria-expanded', 'true');
        const chevron = toggleBtn.querySelector('.snap-etf-chevron') as HTMLElement | null;
        if (chevron) chevron.textContent = '\u25be';
      }
      _updateSnapEtfRecon(a.key);
      showMsg(
        'snap-msg',
        `${a.label}: ETF values (${fmtEur2(allocated)}) must equal the account total (${fmtEur2(total)}). Fix or clear the ETF breakdown.`,
        false,
      );
      return;
    }
  }

  const btn = document.getElementById('btn-save-snap') as HTMLButtonElement;
  try {
    await withButtonGuard(
      btn,
      async () => {
        setSyncing(true);
        try {
          // Write to local DB first; only mutate local state on success.
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
          clearSnapForm();
          renderAll();
        } finally {
          setSyncing(false);
        }
      },
      { busyText: 'Saving...' },
    );
    showMsg(
      'snap-msg',
      state.offline || !navigator.onLine
        ? 'Saved locally. Will sync to Drive when back online.'
        : 'Saved \u2713',
      true,
    );
  } catch (err) {
    showMsg('snap-msg', 'Error: ' + (err as Error).message, false);
  }
}

/**
 * saveMonthlyUpdate - single orchestrator for the "Monthly update" flow.
 * Saves balances (snapshot) via the existing upsert path.
 * CSV import remains a separate confirm action within the same card.
 * Both paths run under the unified sync lock.
 */
async function saveMonthlyUpdate() {
  await saveSnapshot();
}

function editSnap(date: string) {
  const s = state.snaps.find((s) => s.date === date);
  if (!s) return;

  renderSnapForm(state.pd); // idempotent - guarantees the input fields exist

  const dateEl = document.getElementById('snap-date') as HTMLInputElement | null;
  if (dateEl) dateEl.value = s.date;

  for (const a of getACCTSList()) {
    const el = document.getElementById(`snap-${a.key}`) as HTMLInputElement | null;
    if (el) el.value = s[a.key] != null ? String(s[a.key]) : '';
  }

  const notesEl = document.getElementById('snap-notes') as HTMLInputElement | null;
  if (notesEl) notesEl.value = s.notes || '';

  // Reset ETF breakdown fields/UI before applying selected snapshot values.
  document.querySelectorAll<HTMLInputElement>('[data-etf-isin]').forEach((el) => {
    el.value = '';
  });
  document.querySelectorAll<HTMLElement>('.snap-etf-recon').forEach((el) => {
    el.style.display = 'none';
  });
  document.querySelectorAll<HTMLElement>('.snap-etf-section').forEach((section) => {
    section.style.display = 'none';
  });
  document.querySelectorAll<HTMLElement>('.snap-etf-toggle').forEach((btn) => {
    btn.setAttribute('aria-expanded', 'false');
    const chevron = btn.querySelector('.snap-etf-chevron') as HTMLElement | null;
    if (chevron) chevron.textContent = '\u25b8';
  });

  // Prefill per-ETF market values and auto-expand the breakdown section.
  let hasEtfValues = false;
  for (const [key, val] of Object.entries(s)) {
    if (key.startsWith('etf_') && typeof val === 'number' && val > 0) {
      const isin = key.slice(4);
      const etfEl = document.getElementById(`snap-etf-${isin}`) as HTMLInputElement | null;
      if (etfEl) {
        etfEl.value = String(val);
        hasEtfValues = true;
      }
    }
  }
  if (hasEtfValues) {
    document.querySelectorAll<HTMLElement>('.snap-etf-section').forEach((section) => {
      section.style.display = '';
    });
    document.querySelectorAll<HTMLElement>('.snap-etf-toggle').forEach((btn) => {
      btn.setAttribute('aria-expanded', 'true');
      const chevron = btn.querySelector('.snap-etf-chevron') as HTMLElement | null;
      if (chevron) chevron.textContent = '\u25be';
    });
    // Refresh reconciliation for all primary investment accounts.
    for (const a of getAccounts()) {
      if (a.isPrimaryInvestment && (a.moneyType || '').toLowerCase() === 'investment') {
        _updateSnapEtfRecon(a.id || a.key || '');
      }
    }
  }

  showSection('log', document.querySelector('.nav button[data-section="log"]'));
  dateEl?.scrollIntoView({ behavior: 'smooth' });
}

async function delSnap(date: string, btn?: HTMLButtonElement) {
  if (!isSignedIn()) return;
  if (isSyncBusy()) {
    showMsg('snap-msg', 'A sync or save is in progress. Try again in a moment.', false);
    return;
  }
  const ok = await confirmDialog({
    title: `Delete snapshot for ${fmtMon(date)}?`,
    body: 'This cannot be undone.',
    confirmLabel: 'Delete',
    danger: true,
  });
  if (!ok) return;
  const run = async () => {
    const previous = state.snaps;
    state.snaps = state.snaps.filter((s) => s.date !== date);
    setSyncing(true);
    try {
      await saveSnapshots(state.snaps);
      scheduleUpload();
      const snapCachedDel = await setCachedSnapshots(state.snaps);
      if (!snapCachedDel) showCacheWriteWarning();
      renderAll();
    } catch (err) {
      // Roll back optimistic delete on write failure.
      state.snaps = previous;
      throw err;
    } finally {
      setSyncing(false);
    }
  };
  try {
    if (btn) {
      await withButtonGuard(btn, run, { busyText: 'Removing...', keepDisabledOnSuccess: true });
    } else {
      await run();
    }
    if (state.offline || !navigator.onLine) {
      showMsg('snap-msg', 'Deleted locally. Will sync to Drive when back online.', true);
    }
  } catch (err) {
    showMsg('snap-msg', 'Delete failed: ' + (err as Error).message, false);
  }
}

function clearSnapForm() {
  for (const a of getACCTSList()) {
    const el = document.getElementById(`snap-${a.key}`) as HTMLInputElement | null;
    if (el) el.value = '';
  }
  const notes = document.getElementById('snap-notes') as HTMLInputElement | null;
  if (notes) notes.value = '';

  // Clear ETF breakdown inputs and hide reconciliation bars
  document.querySelectorAll<HTMLInputElement>('[data-etf-isin]').forEach((el) => {
    el.value = '';
  });
  document.querySelectorAll<HTMLElement>('.snap-etf-recon').forEach((el) => {
    el.style.display = 'none';
  });
}

function getLatestSnapshotValues(): Record<string, number | string | undefined> | null {
  if (state.snaps.length === 0) return null;
  return state.snaps[state.snaps.length - 1];
}

function prefillSnapFormFromLatest(): void {
  const latest = getLatestSnapshotValues();
  if (!latest) return;

  for (const a of getACCTSList()) {
    const el = document.getElementById(`snap-${a.key}`) as HTMLInputElement | null;
    if (el && !el.value) {
      const value = latest[a.key];
      if (typeof value === 'number') el.value = String(value);
    }
  }

  let hasEtfValues = false;
  for (const [key, val] of Object.entries(latest)) {
    if (!key.startsWith('etf_') || typeof val !== 'number' || val <= 0) continue;
    const isin = key.slice(4);
    const etfEl = document.getElementById(`snap-etf-${isin}`) as HTMLInputElement | null;
    if (etfEl && !etfEl.value) {
      etfEl.value = String(val);
      hasEtfValues = true;
    }
  }

  if (hasEtfValues) {
    document.querySelectorAll<HTMLElement>('.snap-etf-section').forEach((section) => {
      section.style.display = '';
    });
    document.querySelectorAll<HTMLElement>('.snap-etf-toggle').forEach((btn) => {
      btn.setAttribute('aria-expanded', 'true');
      const chevron = btn.querySelector('.snap-etf-chevron') as HTMLElement | null;
      if (chevron) chevron.textContent = '\u25be';
    });
    for (const a of getAccounts()) {
      if (a.isPrimaryInvestment && (a.moneyType || '').toLowerCase() === 'investment') {
        _updateSnapEtfRecon(a.id || a.key || '');
      }
    }
  }
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

  // Confirm handler - save to database
  async function confirmImport() {
    if (isSyncBusy()) {
      showMsg('import-msg', 'A sync or save is in progress. Try again in a moment.', false);
      return;
    }
    cont.innerHTML = '';
    cont.style.display = 'none';
    setSyncing(true);
    try {
      const merged = await mergeTransactions(state.txs, parsed.transactions);
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
          ? `\u2713 ${merged.length} transactions saved locally. Will sync to Drive when back online.`
          : `\u2713 ${merged.length} transactions saved`,
        true,
      );

      // Push to cloud immediately so a page reload won't pull
      // the stale cloud DB and overwrite the freshly imported data.
      // When offline, pushToCloud() fails gracefully; the data is safe
      // in local SQLite and will be pushed on next Sync Now or write.
      await pushToCloud();
    } catch (err) {
      showMsg('import-msg', 'Error: ' + (err as Error).message, false);
    } finally {
      setSyncing(false);
    }
  }

  // Auto-confirm when no unmapped types and no invalid dates (clean import)
  if (summary.unmapped.length === 0 && summary.dateErrors.length === 0) {
    confirmImport();
    return;
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

  // Sample table (first ~10 rows)
  const sampleRows = summary.sample;
  const sampleHtml =
    sampleRows.length > 0
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
          </tr>
        </thead>
        <tbody>
          ${sampleRows
            .map(
              (tx) => `
            <tr style="border-top:1px solid var(--line)">
              <td style="padding:4px 6px">${esc(tx.date)}</td>
              <td style="padding:4px 6px">${esc(tx.type)}</td>
              <td style="padding:4px 6px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(tx.name)}</td>
              <td style="padding:4px 6px;text-align:right">${tx.shares || ''}</td>
              <td style="padding:4px 6px;text-align:right">${tx.amount}</td>
              <td style="padding:4px 6px">${esc(tx.currency)}</td>
            </tr>
          `,
            )
            .join('')}
        </tbody>
      </table>
    </div>
  `
      : '';

  container.innerHTML = `
    <div class="card" style="margin-top:.75rem">
      <div class="card-title">Import preview</div>
      <div style="margin:.6rem 0;font-size:13px">
        <span style="font-weight:500">Profile:</span> ${esc(profile.label)}
      </div>
      <div style="font-size:13px">
        <span style="font-weight:500">${summary.total}</span> rows parsed: ${typeCounts}
      </div>
      ${unmappedHtml}
      ${dateErrorsHtml}
      ${sampleHtml}
      <div style="display:flex;gap:10px;margin-top:.85rem">
        <button class="btn btn-primary" id="btn-confirm-import">Confirm import</button>
        <button class="btn btn-ghost" id="btn-cancel-import">Cancel</button>
      </div>
    </div>
  `;
  container.style.display = 'block';

  document.getElementById('btn-confirm-import')?.addEventListener('click', () => confirmImport());

  // Cancel handler
  document.getElementById('btn-cancel-import')?.addEventListener('click', () => {
    container.innerHTML = '';
    container.style.display = 'none';
    showMsg('import-msg', 'Import cancelled.', false);
  });

  document.getElementById('btn-dismiss-date-warn')?.addEventListener('click', () => {
    document.getElementById('import-date-warn')?.remove();
  });
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

// ── Snapshot form (dynamic account fields) ────────────────
function renderSnapForm(pd?: PortfolioData | null) {
  const el = document.getElementById('snap-acct-fields');
  if (!el) return;
  const accts = getACCTSList();
  const accounts = getAccounts();

  if (accts.length === 0) {
    el.innerHTML =
      '<p class="note">No accounts configured yet. Add accounts in the <a href="#" data-goto="settings" class="goto-settings">Settings</a> tab.</p>';
    el.querySelector('.goto-settings')?.addEventListener('click', (e) => {
      e.preventDefault();
      showSection('settings', document.querySelector('.nav button[data-section="settings"]'));
    });
    return;
  }

  // Compute a render signature so we can skip re-rendering when shape has not changed,
  // which prevents clearing values the user has typed during a background sync.
  const heldIsins = _getHeldIsins(pd);
  const sig = accts.map((a) => a.key).join(',') + '|' + heldIsins.join(',');
  if ((el as HTMLElement & { _renderSig?: string })._renderSig === sig) {
    const dateEl = document.getElementById('snap-date') as HTMLInputElement | null;
    if (dateEl) {
      dateEl.max = currentMonth();
      if (!dateEl.value) dateEl.value = currentMonth();
    }
    return;
  }
  (el as HTMLElement & { _renderSig?: string })._renderSig = sig;

  el.innerHTML = accts
    .map((a) => {
      const fullAcct = accounts.find((acc) => (acc.id || acc.key) === a.key);
      const isPrimaryInv = !!(
        fullAcct?.isPrimaryInvestment && (fullAcct.moneyType || '').toLowerCase() === 'investment'
      );
      const etfSection =
        isPrimaryInv && heldIsins.length > 0 ? _renderEtfBreakdown(a.key, pd, accounts) : '';
      return `
      <div class="form-group">
        <label class="form-label">${esc(a.label)} (€)</label>
        <input type="text" inputmode="decimal" id="snap-${esc(a.key)}" class="form-input" placeholder="total value">
        ${etfSection}
      </div>`;
    })
    .join('');

  const dateEl = document.getElementById('snap-date') as HTMLInputElement | null;
  if (dateEl) {
    dateEl.max = currentMonth();
    if (!dateEl.value) dateEl.value = currentMonth();
  }
  prefillSnapFormFromLatest();
}

/** Returns ISINs of all non-exited positions, sorted for stable comparison. */
function _getHeldIsins(pd?: PortfolioData | null): string[] {
  if (!pd) return [];
  return Object.values(pd.etfs)
    .filter((pos) => !pos.exited && pos.shares >= 1e-6)
    .map((pos) => pos.isin)
    .sort();
}

/** Builds the HTML for the ETF breakdown toggle and expandable section. */
function _renderEtfBreakdown(
  acctKey: string,
  pd: PortfolioData | null | undefined,
  accounts: Account[],
): string {
  if (!pd) return '';
  const holdings = getHoldings();

  // Positions currently held (shares > 0, not exited)
  const held = Object.values(pd.etfs).filter((pos) => !pos.exited && pos.shares >= 1e-6);
  if (held.length === 0) return '';

  // Split into contributing (active, has contribAmount) and legacy (everything else)
  const activeIsins = new Set(
    holdings.filter((h) => h.active && h.contribAmount > 0).map((h) => h.isin),
  );
  const contributing = held.filter((pos) => activeIsins.has(pos.isin));
  const legacy = held.filter((pos) => !activeIsins.has(pos.isin));

  const getName = (isin: string, fallbackName: string, shortName: string): string => {
    const h = holdings.find((h) => h.isin === isin);
    return h?.name || fallbackName || shortName;
  };

  const renderRow = (pos: {
    isin: string;
    name: string;
    shortName: string;
    color: string;
  }): string => `
      <div class="snap-etf-row">
        <div class="snap-etf-meta">
          <span class="hold-dot" style="background:${safeColor(pos.color)}"></span>
          <div class="snap-etf-name-col">
            <span class="snap-etf-name">${esc(getName(pos.isin, pos.name, pos.shortName))}</span>
            <span class="snap-etf-isin">${esc(pos.isin)}</span>
          </div>
        </div>
        <input type="text" inputmode="decimal"
               id="snap-etf-${esc(pos.isin)}"
               data-etf-isin="${esc(pos.isin)}"
               data-acct-key="${esc(acctKey)}"
               class="form-input form-input-sm snap-etf-input"
               placeholder="Value">
      </div>`;

  const contribHtml =
    contributing.length > 0
      ? `<div class="snap-etf-group"><div class="snap-etf-group-label">Contributing</div>${contributing.map(renderRow).join('')}</div>`
      : '';
  const legacyHtml =
    legacy.length > 0
      ? `<div class="snap-etf-group"><div class="snap-etf-group-label">Held, not contributing</div>${legacy.map(renderRow).join('')}</div>`
      : '';

  return `
    <div class="snap-etf-wrap">
      <button type="button" class="snap-etf-toggle btn btn-sm btn-ghost"
              data-acct-key="${esc(acctKey)}" aria-expanded="false">
        <span class="snap-etf-chevron">\u25b8</span> ETF breakdown
      </button>
      <div class="snap-etf-section" id="snap-etf-section-${esc(acctKey)}" style="display:none">
        ${contribHtml}
        ${legacyHtml}
        <div class="snap-etf-recon" id="snap-etf-recon-${esc(acctKey)}" style="display:none">
          <span class="snap-etf-recon-alloc">Allocated: <b>-</b></span>
          <span class="snap-etf-recon-sep">&middot;</span>
          <span class="snap-etf-recon-remain">Remaining: <b>-</b></span>
        </div>
      </div>
    </div>`;
}

/** Recomputes and displays the allocated/remaining reconciliation row for one account. */
function _updateSnapEtfRecon(acctKey: string): void {
  const section = document.getElementById(`snap-etf-section-${acctKey}`);
  const reconEl = document.getElementById(`snap-etf-recon-${acctKey}`);
  if (!section || !reconEl) return;

  const totalInput = document.getElementById(`snap-${acctKey}`) as HTMLInputElement | null;
  const totalVal = parseNum(String(totalInput?.value ?? ''));

  let allocated = 0;
  const sectionInputs = section.querySelectorAll<HTMLInputElement>('[data-etf-isin]');
  for (const inp of Array.from(sectionInputs)) {
    const v = parseNum(String(inp.value ?? ''));
    if (v > 0) allocated += v;
  }

  const remaining = totalVal - allocated;
  const hasAnyValue = totalVal > 0 || allocated > 0;

  reconEl.style.display = hasAnyValue ? '' : 'none';
  if (!hasAnyValue) return;

  const allocEl = reconEl.querySelector('.snap-etf-recon-alloc b') as HTMLElement | null;
  const remainEl = reconEl.querySelector('.snap-etf-recon-remain') as HTMLElement | null;
  const remainB = remainEl?.querySelector('b') as HTMLElement | null;

  if (allocEl) allocEl.textContent = fmtEur2(allocated);
  if (remainB) remainB.textContent = fmtEur2(remaining);
  if (remainEl) {
    remainEl.classList.toggle('snap-etf-recon-warn', remaining < -0.005);
    remainEl.classList.toggle('snap-etf-recon-ok', totalVal > 0 && Math.abs(remaining) < 0.005);
  }
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
  else if (sub === 'dividends') renderDividends(state.pd, state.txs, state.snaps);
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
        renderNW(state.pd, state.snaps, state.txs);
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
      case 'log':
        renderLog({
          txs: state.txs,
          snaps: state.snaps,
          importMeta: state.importMeta,
          onEditSnap: editSnap,
          onDelSnap: delSnap,
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
  renderSnapForm(state.pd); // cheap, keep eager (Log form fields)
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
      ? `over ${fmtPctVal(highThreshold)} (high threshold)`
      : `over ${fmtPctVal(threshold)} (threshold)`;
    btn.setAttribute(
      'data-drift-alert',
      `${severityLabel}: max allocation drift is ${fmtPctVal(max)}, ${thresholdLabel}. Open Portfolio to review it.`,
    );
  } else {
    btn.classList.remove('drift-alert', 'drift-alert-high');
    btn.removeAttribute('aria-label');
    btn.removeAttribute('data-drift-alert');
    hideDriftTooltip();
  }
}

function showDriftTooltip(trigger: HTMLElement): void {
  const text = trigger.dataset.driftAlert || '';
  if (!trigger.classList.contains('drift-alert') || !text) {
    hideDriftTooltip();
    return;
  }
  if (!_driftTooltipEl) {
    _driftTooltipEl = document.createElement('span');
    _driftTooltipEl.className = 'drift-alert-pop';
  }
  _driftTooltipEl.textContent = text;
  if (!_driftTooltipEl.isConnected) document.body.appendChild(_driftTooltipEl);
  positionDriftTooltip(trigger, _driftTooltipEl);
}

function hideDriftTooltip(): void {
  _driftTooltipEl?.remove();
}

function positionDriftTooltip(trigger: HTMLElement, pop: HTMLElement): void {
  const rect = trigger.getBoundingClientRect();
  const top = rect.bottom + 8;
  const left = rect.right;
  pop.style.top = `${top}px`;
  pop.style.left = `${left}px`;
  pop.style.transform = 'translateX(-100%)';
  requestAnimationFrame(() => {
    const popRect = pop.getBoundingClientRect();
    let nextLeft = left;
    let nextTop = top;
    let transform = 'translateX(-100%)';
    if (popRect.right > window.innerWidth - 4) nextLeft = window.innerWidth - 4;
    if (popRect.left < 4) {
      nextLeft = 4;
      transform = 'none';
    }
    if (popRect.bottom > window.innerHeight - 4) {
      nextTop = rect.top - 8;
      transform = transform === 'none' ? 'translateY(-100%)' : transform + ' translateY(-100%)';
    }
    pop.style.left = `${nextLeft}px`;
    pop.style.top = `${nextTop}px`;
    pop.style.transform = transform;
  });
}

// Export updateDriftBadge so it can be called from settings when alert threshold changes
(window as any).updateDriftBadge = updateDriftBadge;

function _isTouchLikeEvent(e: MouseEvent): boolean {
  return e.sourceCapabilities?.firesTouchEvents ?? false;
}

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

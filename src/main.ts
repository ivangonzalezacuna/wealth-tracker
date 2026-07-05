import './styles.css';
import { CONFIG } from './config';
import { getACCTSList } from './constants';
import { appTemplate } from './template';
import { signIn as gisSignIn, signOut, isSignedIn } from './auth/google';
import {
  ensureDriveFileAuthorized,
  isDriveFileAuthorized,
  clearDriveFileAuthorization,
} from './auth/picker';
import { loadSnapshots, saveSnapshots, upsertSnapshot } from './sheets/snapshots';
import {
  loadTransactions,
  mergeTransactions,
  restoreTransactions,
  saveImportMeta,
  loadImportMeta,
} from './sheets/transactions';
import {
  loadConfig,
  onConfigChange,
  getCostBasisMethod,
  getHoldings,
  getAccounts,
  getSettings,
  setAccounts,
  setHoldings,
  replaceSettings,
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
import { renderPortfolio } from './views/portfolio';
import { renderDCA } from './views/contributions';
import { renderDividends } from './views/dividends';
import { renderSettings, refreshSettingsAfterChange } from './views/settings';
import { renderLog } from './views/log';
import { fmtMon, showMsg, reinjectPendingMsg, esc, currentMonth, withButtonGuard } from './utils';
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
  getSyncCursor,
  setSyncCursor,
  getInputsHash,
  setInputsHash,
  computeInputsHash,
  holdingsSignature,
  setCollapseState,
} from './cache/db';
import { fetchDeltaTransactions, mergeDelta } from './cache/sync';
import { shouldAutoResync } from './sync/policy';
import { loadCollapseState, replaceCollapseState } from './ui/collapseState';
import { restoreCollapseFromSheet, backupCollapseToSheet } from './ui/collapseSync';
import { confirmDialog } from './ui/confirmDialog';
import { showSigninOverlay, hideSigninOverlay } from './ui/signinOverlay';
import { withTimeout } from './sync/timeout';
import { isBusy, setBusy } from './sync/lock';
import { registerSW } from 'virtual:pwa-register';
import type { Snapshot, Transaction, PortfolioData, ImportProfile } from './types';

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

// ── Unified sync/write lock (shared with settings.ts - see sync/lock.ts) ──
let _lastSyncAt = 0;
const AUTO_RESYNC_MIN_INTERVAL_MS = 2 * 60_000; // 2 minutes
function setSyncing(v: boolean): void {
  setBusy(v);
}
function isSyncBusy(): boolean {
  return isBusy();
}

/** True when data is shown from cache but no valid auth token exists. */
function isReadOnly(): boolean {
  return state.cacheLoaded && !isSignedIn();
}

function applyReadOnlyMode(): void {
  const readOnly = isReadOnly();
  const hint = 'Sign in to enable editing';

  // Disable write-action buttons
  const writeIds = ['btn-save-snap', 'btn-confirm-import', 'btn-sync-now'];
  for (const id of writeIds) {
    const el = document.getElementById(id) as HTMLButtonElement | null;
    if (!el) continue;
    el.disabled = readOnly;
    el.title = readOnly ? hint : '';
  }

  // Disable CSV drop zone and file input
  const zone = document.getElementById('drop-zone');
  const csvInput = document.getElementById('csv-file-input') as HTMLInputElement | null;
  if (zone) {
    zone.classList.toggle('drop-zone-disabled', readOnly);
    zone.title = readOnly ? hint : '';
  }
  if (csvInput) {
    csvInput.disabled = readOnly;
  }

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
document.getElementById('app')!.innerHTML = appTemplate();
loadCollapseState(); // fire-and-forget: loads persisted UI collapse state from IDB
initNav();
initSnapForm();
initCSVDrop();
initAuth();
setDefaultMonth();
initOnlineListeners();
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

  // Hash-based initial routing
  resolveInitialSection();
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
  });
  document.getElementById(id)?.classList.add('active');
  btn?.classList.add('active');
  btn?.setAttribute('aria-selected', 'true');
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
  window.addEventListener('online', () => {
    state.offline = false;
    setSyncStatus('ok', 'Back online');
    // Trigger a guarded background resync if conditions are met
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
    // oauth2.revoke() inside signOut() revokes the drive.file grant
    // server-side too, so the local "already picked this file" flag must
    // be cleared here as well, or the next sign-in would wrongly skip the
    // Picker step while the server-side permission is actually gone.
    clearDriveFileAuthorization();
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

    // One-time per browser: drive.file only grants access to a file once
    // the user has explicitly opened it with this app via the Picker.
    // isDriveFileAuthorized() is true immediately on every later sign-in,
    // so this only prompts once (or again if localStorage was cleared).
    if (!isDriveFileAuthorized()) {
      setAuthStatus('<span class="spinner"></span>Select your spreadsheet…');
      await ensureDriveFileAuthorized();
    }

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
    } else if ((err as Error).message === 'picker_cancelled') {
      setAuthStatus('Sign-in needs you to select your spreadsheet - please try again', true);
    } else if ((err as Error).message === 'picker_wrong_file') {
      setAuthStatus('Please select the same spreadsheet configured for this app', true);
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
 * Sync data from Google Sheets in the background.
 * Uses incremental sync for transactions (delta only).
 */
async function syncInBackground() {
  if (_syncing) return; // re-entrancy guard
  if (state.offline) {
    setSyncStatus('offline');
    return;
  }
  setSyncing(true);
  setSyncStatus('syncing');
  try {
    // Load config first (snapshots & other reads depend on it)
    await loadConfig();
    restoreCollapseFromSheet(); // restore UI prefs if IDB was empty (new device)
    const [snaps, meta] = await Promise.all([loadSnapshots(), loadImportMeta()]);

    // Incremental transaction sync
    let txs: Transaction[];
    const cursor = await getSyncCursor();
    if (cursor && state.txs.length > 0) {
      // Delta sync: fetch only new rows
      const delta = await fetchDeltaTransactions(cursor);
      if (delta !== null && delta.length === 0) {
        // No new transactions - keep cached
        txs = state.txs;
      } else if (delta !== null) {
        // Merge delta into cached transactions
        const { merged, cursor: newCursor } = mergeDelta(state.txs, delta);
        txs = merged;
        await setSyncCursor(newCursor);
      } else {
        // Delta fetch failed - fall back to full load
        txs = await loadTransactions();
        await setSyncCursor({
          lastDate: txs.length > 0 ? txs[txs.length - 1].date : '',
          rowCount: txs.length,
        });
      }
    } else {
      // No cursor or no cached txs - full load
      txs = await loadTransactions();
      await setSyncCursor({
        lastDate: txs.length > 0 ? txs[txs.length - 1].date : '',
        rowCount: txs.length,
      });
    }

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
      // Keep the IndexedDB cache authoritative the instant any config write
      // settles (Save or Delete on Accounts/Holdings/Settings), not just after
      // a full background sync. Without this, bootFromCache() on the next
      // refresh briefly re-hydrates from stale cached config until
      // syncInBackground() completes and overwrites it (Phase 58, Commit 5).
      try {
        await setCachedConfig({
          accounts: getAccounts(),
          holdings: getHoldings(),
          settings: getSettings(),
        });
      } catch {
        // Best-effort -- a cache write failure here must never block the
        // already-successful Sheet write or the UI re-render.
      }
      renderAll(changed);
    });

    // Persist all data to cache for next boot
    await Promise.all([
      setCachedConfig({
        accounts: getAccounts(),
        holdings: getHoldings(),
        settings: getSettings(),
      }),
      setCachedSnapshots(snaps),
      setCachedTransactions(txs),
      setCachedImportMeta(meta),
    ]);

    setSyncStatus('ok');
    backupCollapseToSheet(); // opportunistic backup (fire-and-forget)
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

    // Save sync cursor
    await setSyncCursor({
      lastDate: txs.length > 0 ? txs[txs.length - 1].date : '',
      rowCount: txs.length,
    });

    // Cache everything
    await Promise.all([
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

    onConfigChange(async () => {
      if (state.txs.length) {
        state.pd = await computeAggregatesWithCache(state.txs);
      }
      renderAll();
    });
    setSyncStatus('ok');
    backupCollapseToSheet(); // opportunistic backup (fire-and-forget)
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
 * Clear the cache and do a clean full reload from Google Sheets.
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
  if (state.offline || !navigator.onLine)
    throw new Error('Cannot restore while offline. Please reconnect and try again.');
  if (!isSignedIn()) throw new Error('Sign in first.');
  if (isSyncBusy()) throw new Error('A sync or save is in progress. Try again in a moment.');

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
  try {
    const { accounts, holdings, settings, snapshots, transactions, importMeta } = backup.data;
    await setAccounts(accounts);
    await setHoldings(holdings);
    await replaceSettings(settings);

    // Reapply collapse/expand UI state from the backup
    const rawCollapse = settings['ui_collapse_state'];
    if (rawCollapse) {
      try {
        const parsed = JSON.parse(rawCollapse);
        if (parsed && typeof parsed === 'object') {
          replaceCollapseState(parsed);
          await setCollapseState(parsed);
        }
      } catch {
        /* malformed; leave current collapse state as-is */
      }
    }

    await saveSnapshots(snapshots);
    await restoreTransactions(transactions);
    if (importMeta.last_import) await saveImportMeta(importMeta.last_import);

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
      setSyncCursor({
        lastDate: transactions.length ? transactions[transactions.length - 1].date : '',
        rowCount: transactions.length,
      }),
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
    loading: ['status-warn', '<span class="spinner"></span>Loading from Google Sheets\u2026'],
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
  // Block writes when offline
  if (state.offline || !navigator.onLine) {
    showMsg('snap-msg', 'Cannot save while offline. Please reconnect and try again.', false);
    return;
  }
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

  const btn = document.getElementById('btn-save-snap') as HTMLButtonElement;
  try {
    await withButtonGuard(
      btn,
      async () => {
        setSyncing(true);
        try {
          // Write to Sheets first - only mutate local state once the write
          // has actually succeeded (Phase 69), so a failed save can never
          // leave state.snaps showing an entry that was never persisted.
          await upsertSnapshot(snap);
          const idx = state.snaps.findIndex((s) => s.date === date);
          if (idx >= 0) state.snaps[idx] = snap;
          else {
            state.snaps.push(snap);
            state.snaps.sort((a, b) => a.date.localeCompare(b.date));
          }
          await setCachedSnapshots(state.snaps);
          clearSnapForm();
          renderAll();
        } finally {
          setSyncing(false);
        }
      },
      { busyText: 'Saving...' },
    );
    showMsg('snap-msg', 'Saved \u2713', true);
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

  renderSnapForm(); // idempotent - guarantees the input fields exist

  const dateEl = document.getElementById('snap-date') as HTMLInputElement | null;
  if (dateEl) dateEl.value = s.date;

  for (const a of getACCTSList()) {
    const el = document.getElementById(`snap-${a.key}`) as HTMLInputElement | null;
    if (el) el.value = s[a.key] != null ? String(s[a.key]) : '';
  }

  const notesEl = document.getElementById('snap-notes') as HTMLInputElement | null;
  if (notesEl) notesEl.value = s.notes || '';

  showSection('log', document.querySelector('.nav button[data-section="log"]'));
  dateEl?.scrollIntoView({ behavior: 'smooth' });
}

async function delSnap(date: string, btn?: HTMLButtonElement) {
  // Block writes when offline
  if (state.offline || !navigator.onLine) {
    showMsg('snap-msg', 'Cannot delete while offline. Please reconnect and try again.', false);
    return;
  }
  if (!isSignedIn()) return;
  if (isSyncBusy()) return;
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
      await setCachedSnapshots(state.snaps);
      renderAll();
    } catch (err) {
      // Roll back the optimistic filter - the Sheets write never landed,
      // so the deleted entry must reappear in local state (Phase 69),
      // matching the existing setAccounts/setHoldings rollback pattern.
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
  // Block writes when offline
  if (state.offline || !navigator.onLine) {
    showMsg('import-msg', 'Cannot import while offline. Please reconnect and try again.', false);
    return;
  }
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

  // Confirm handler - write to sheets
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
      await Promise.all([
        setCachedTransactions(merged),
        setCachedImportMeta({ last_import: today }),
        setSyncCursor({
          lastDate: merged.length > 0 ? merged[merged.length - 1].date : '',
          rowCount: merged.length,
        }),
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

      renderAll();
      showMsg('import-msg', `✓ ${merged.length} transactions synced to Google Sheets`, true);
    } catch (err) {
      showMsg('import-msg', 'Error: ' + (err as Error).message, false);
    } finally {
      setSyncing(false);
    }
  }

  // Auto-confirm when no unmapped types (clean import)
  if (summary.unmapped.length === 0) {
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
  const unmappedHtml = `
    <div class="status-bar status-warn" style="margin:.6rem 0">
      ⚠ ${totalUnmapped} row${totalUnmapped > 1 ? 's' : ''} with unmapped type${totalUnmapped > 1 ? 's' : ''}: ${unmappedList}
    </div>
  `;

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
function renderSnapForm() {
  const el = document.getElementById('snap-acct-fields');
  if (!el) return;
  const accts = getACCTSList();
  if (accts.length === 0) {
    el.innerHTML =
      '<p class="note">No accounts configured yet. Add accounts in the <a href="#" data-goto="settings" class="goto-settings">Settings</a> tab.</p>';
    el.querySelector('.goto-settings')?.addEventListener('click', (e) => {
      e.preventDefault();
      showSection('settings', document.querySelector('.nav button[data-section="settings"]'));
    });
    return;
  }
  el.innerHTML = accts
    .map(
      (a) => `
    <div class="form-group">
      <label class="form-label">${esc(a.label)} (€)</label>
      <input type="text" inputmode="decimal" id="snap-${esc(a.key)}" class="form-input" placeholder="total value">
    </div>
  `,
    )
    .join('');

  const dateEl = document.getElementById('snap-date') as HTMLInputElement | null;
  if (dateEl) {
    dateEl.max = currentMonth();
    if (!dateEl.value) dateEl.value = currentMonth();
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
  });
  renderPortfolioSubview(sub);
  history.replaceState(null, '', navHash('portfolio', sub));
}

function renderPortfolioSubview(sub: string): void {
  if (sub === 'holdings') renderPortfolio(state.pd, state.snaps);
  else if (sub === 'contributions') renderDCA(state.pd, state.snaps);
  else if (sub === 'dividends') renderDividends(state.pd);
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
        renderNW(state.pd, state.snaps);
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
  renderSnapForm(); // cheap, keep eager (Log form fields)
  renderSetupBanner(); // update onboarding checklist
  _dirty.clear();
  for (const s of ALL_SECTIONS) _dirty.add(s);
  _dirty.delete(_activeSection);
  renderSection(_activeSection, changed);
  applyReadOnlyMode();
  // Re-inject transient feedback message if still within its display window
  reinjectPendingMsg();
}

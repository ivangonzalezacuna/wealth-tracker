// @ts-nocheck — DOM-heavy entry point; full strict typing deferred to framework migration
import './styles.css';
import { CONFIG } from './config';
import { getACCTSList } from './constants';
import { appTemplate } from './template';
import { signIn as gisSignIn, signOut, isSignedIn, trySilentSignIn } from './auth/google';
import { loadSnapshots, saveSnapshots } from './sheets/snapshots';
import { loadTransactions, mergeTransactions, saveImportMeta, loadImportMeta } from './sheets/transactions';
import { loadConfig, onConfigChange, getCostBasisMethod, getHoldings, getAccounts, getSettings } from './store/config';
import { computePD } from './portfolio';
import { parseWithProfile, detectProfile, previewSummary } from './import/parse';
import { builtInProfiles } from './import/profiles/index';
import { renderNW } from './views/networth';
import { renderPortfolio } from './views/portfolio';
import { renderDCA } from './views/contributions';
import { renderDividends } from './views/dividends';
import { renderRef } from './views/reference';
import { renderSettings } from './views/settings';
import { renderLog } from './views/log';
import { fmtMon, showMsg, esc, currentMonth } from './utils';
import { parseNum } from './csv';
import {
  isCacheValid, clearCache,
  getCachedConfig, setCachedConfig,
  getCachedSnapshots, setCachedSnapshots,
  getCachedTransactions, setCachedTransactions,
  getCachedAggregates, setCachedAggregates,
  getCachedImportMeta, setCachedImportMeta,
  getSyncCursor, setSyncCursor,
  getInputsHash, setInputsHash,
  computeInputsHash, holdingsSignature,
} from './cache/db';
import { fetchDeltaTransactions, mergeDelta } from './cache/sync';

// ── App state ────────────────────────────────────────────
const state = {
  snaps:      [],
  txs:        [],
  pd:         null,
  importMeta: {},
  syncing:    false,
  offline:    !navigator.onLine,
  cacheLoaded: false,
};

// ── Boot ─────────────────────────────────────────────────
document.getElementById('app').innerHTML = appTemplate();
initNav();
initSnapForm();
initCSVDrop();
initAuth();
setDefaultMonth();
initOnlineListeners();

// ── Navigation ───────────────────────────────────────────
function initNav() {
  document.querySelectorAll('.nav button[data-section]').forEach(btn => {
    btn.addEventListener('click', () => showSection(btn.dataset.section, btn));
  });
  document.querySelectorAll('[data-goto]').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.goto;
      const navBtn = document.querySelector(`.nav button[data-section="${target}"]`);
      showSection(target, navBtn);
    });
  });
}

function showSection(id, btn) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav button').forEach(b => b.classList.remove('active'));
  document.getElementById(id)?.classList.add('active');
  btn?.classList.add('active');
  // Render reference chart on demand (canvas must be visible)
  if (id === 'reference') renderRef();
  if (id === 'settings') renderSettings();
}

// ── Online/offline listeners ─────────────────────────────
function initOnlineListeners() {
  window.addEventListener('online', () => {
    state.offline = false;
    setSyncStatus('ok', 'Back online');
    // Trigger a background resync if signed in
    if (isSignedIn()) syncInBackground();
  });
  window.addEventListener('offline', () => {
    state.offline = true;
    setSyncStatus('offline');
  });
}

// ── Auth ─────────────────────────────────────────────────
function initAuth() {
  document.getElementById('btn-signin')?.addEventListener('click', onSignInClick);
  document.getElementById('btn-signout')?.addEventListener('click', () => signOut());

  // Boot: first try to render from cache (instant), then authenticate and sync
  bootFromCache().then(() => {
    trySilentSignIn().then((ok) => {
      if (ok) { updateAuthUI(true); syncInBackground(); }
      else    { updateAuthUI(false); }
    });
  });
}

async function onSignInClick() {
  try {
    setAuthStatus('<span class="spinner"></span>Signing in…');
    await gisSignIn();
    updateAuthUI(true);
    await loadAllData();
  } catch (err) {
    setAuthStatus('Sign-in failed — ' + err.message, true);
  }
}

function updateAuthUI(signedIn) {
  const prompt   = document.getElementById('auth-prompt');
  const content  = document.getElementById('log-content');
  const signoutBtn = document.getElementById('btn-signout');

  if (signedIn) {
    prompt?.style.setProperty('display', 'none');
    content?.style.setProperty('display', 'block');
    signoutBtn?.style.setProperty('display', 'inline-block');
    setAuthStatus('✓ Signed in · data synced to Google Sheets');
  } else {
    prompt?.style.setProperty('display', 'block');
    content?.style.setProperty('display', 'none');
    signoutBtn?.style.setProperty('display', 'none');
    setAuthStatus('Not signed in');
  }
}

function setAuthStatus(msg, isErr = false) {
  const el = document.getElementById('auth-status');
  if (el) { el.innerHTML = msg; el.style.color = isErr ? '#A32D2D' : '#52514e'; }
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
    // Cache read failed — no problem, will do full network load
  }
}

// ── Background sync ──────────────────────────────────────
/**
 * Sync data from Google Sheets in the background.
 * Uses incremental sync for transactions (delta only).
 */
async function syncInBackground() {
  if (state.offline) {
    setSyncStatus('offline');
    return;
  }
  setSyncStatus('syncing');
  try {
    // Load config first (snapshots & other reads depend on it)
    await loadConfig();
    const [snaps, meta] = await Promise.all([
      loadSnapshots(),
      loadImportMeta(),
    ]);

    // Incremental transaction sync
    let txs: any[];
    const cursor = await getSyncCursor();
    if (cursor && state.txs.length > 0) {
      // Delta sync: fetch only new rows
      const delta = await fetchDeltaTransactions(cursor);
      if (delta !== null && delta.length === 0) {
        // No new transactions — keep cached
        txs = state.txs;
      } else if (delta !== null) {
        // Merge delta into cached transactions
        const { merged, cursor: newCursor } = mergeDelta(state.txs, delta);
        txs = merged;
        await setSyncCursor(newCursor);
      } else {
        // Delta fetch failed — fall back to full load
        txs = await loadTransactions();
        await setSyncCursor({ lastDate: txs.length > 0 ? txs[txs.length - 1].date : '', rowCount: txs.length });
      }
    } else {
      // No cursor or no cached txs — full load
      txs = await loadTransactions();
      await setSyncCursor({ lastDate: txs.length > 0 ? txs[txs.length - 1].date : '', rowCount: txs.length });
    }

    // Update state
    state.snaps = snaps;
    state.txs = txs;
    state.importMeta = meta;

    // Compute aggregates (with caching)
    state.pd = await computeAggregatesWithCache(txs);

    // Setup config change listener
    onConfigChange(async () => {
      if (state.txs.length) {
        state.pd = await computeAggregatesWithCache(state.txs);
      }
      renderAll();
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

    renderAll();
    setSyncStatus('ok');
  } catch (err) {
    setSyncStatus('error', err.message);
    // If we had cached data, keep showing it
    if (!state.cacheLoaded) {
      // No cache either — show error
    }
  }
}

// ── Cached aggregates with invalidation ──────────────────
/**
 * Compute aggregates only when inputs change.
 * Uses an inputsHash to detect whether recomputation is needed.
 */
async function computeAggregatesWithCache(txs: any[]): Promise<any> {
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
  await Promise.all([
    setCachedAggregates(pd),
    setInputsHash(currentHash),
  ]);

  return pd;
}

// ── Data loading (full, used for first sign-in or force resync) ──
async function loadAllData() {
  setSyncStatus('loading');
  try {
    await loadConfig();
    const [snaps, txs, meta] = await Promise.all([
      loadSnapshots(),
      loadTransactions(),
      loadImportMeta(),
    ]);
    state.snaps      = snaps;
    state.txs        = txs;
    state.importMeta = meta;
    state.pd         = txs.length ? computePD(txs, { method: getCostBasisMethod() }) : null;

    // Save sync cursor
    await setSyncCursor({ lastDate: txs.length > 0 ? txs[txs.length - 1].date : '', rowCount: txs.length });

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
      state.pd ? setInputsHash(computeInputsHash(
        txs.length,
        txs[txs.length - 1]?.date || '',
        getCostBasisMethod(),
        holdingsSignature(getHoldings()),
      )) : Promise.resolve(),
    ]);

    onConfigChange(async () => {
      if (state.txs.length) {
        state.pd = await computeAggregatesWithCache(state.txs);
      }
      renderAll();
    });
    renderAll();
    setSyncStatus('ok');
  } catch (err) {
    setSyncStatus('error', err.message);
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
(window as any).__forceFullResync = forceFullResync;

function setSyncStatus(status, msg = '') {
  const el = document.getElementById('sync-status');
  if (!el) return;
  const map = {
    loading: ['status-warn',  '<span class="spinner"></span>Loading from Google Sheets…'],
    syncing: ['status-warn',  '<span class="spinner"></span>Syncing…'],
    cached:  ['status-info',  '📦 Showing cached data'],
    ok:      ['status-ok',    '✓ Synced with Google Sheets'],
    offline: ['status-warn',  '📴 Offline — showing cached data'],
    error:   ['status-err',   '⚠ Sync error — ' + msg],
  };
  const [cls, text] = map[status] || ['status-empty', ''];
  el.className  = 'status-bar ' + cls;
  el.innerHTML  = text;
  el.style.display = status ? 'block' : 'none';
}

// ── Snapshot form ─────────────────────────────────────────
function initSnapForm() {
  document.getElementById('btn-save-snap')?.addEventListener('click', saveSnapshot);
}

function setDefaultMonth() {
  const cur = currentMonth();
  const el  = document.getElementById('snap-date') as HTMLInputElement | null;
  if (el) { el.value = cur; el.max = cur; }
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
  if (state.syncing) {
    showMsg('snap-msg', 'A save is already in progress.', false);
    return;
  }
  const date = document.getElementById('snap-date').value;
  if (!date) { showMsg('snap-msg', 'Please select a month.', false); return; }
  if (date > currentMonth()) {
    showMsg('snap-msg', 'Cannot log a future month.', false);
    return;
  }

  const snap = { date };
  for (const a of getACCTSList()) {
    const el = document.getElementById(`snap-${a.key}`) as HTMLInputElement | null;
    snap[a.key] = parseNum(String(el?.value ?? ''));
  }
  snap.notes = document.getElementById('snap-notes').value.trim();

  showMsg('snap-msg', 'Saving…', true);
  state.syncing = true;
  try {
    const idx = state.snaps.findIndex(s => s.date === date);
    if (idx >= 0) state.snaps[idx] = snap;
    else { state.snaps.push(snap); state.snaps.sort((a, b) => a.date.localeCompare(b.date)); }
    await saveSnapshots(state.snaps);
    await setCachedSnapshots(state.snaps);
    clearSnapForm();
    showMsg('snap-msg', 'Saved ✓', true);
    renderAll();
  } catch (err) {
    showMsg('snap-msg', 'Error: ' + err.message, false);
  } finally {
    state.syncing = false;
  }
}

function editSnap(date) {
  const s = state.snaps.find(s => s.date === date);
  if (!s) return;

  renderSnapForm(); // idempotent — guarantees the input fields exist

  const dateEl = document.getElementById('snap-date');
  if (dateEl) dateEl.value = s.date;

  for (const a of getACCTSList()) {
    const el = document.getElementById(`snap-${a.key}`);
    if (el) el.value = s[a.key] != null ? s[a.key] : '';
  }

  const notesEl = document.getElementById('snap-notes');
  if (notesEl) notesEl.value = s.notes || '';

  showSection('log', document.querySelector('.nav button[data-section="log"]'));
  dateEl?.scrollIntoView({ behavior: 'smooth' });
}

async function delSnap(date) {
  // Block writes when offline
  if (state.offline || !navigator.onLine) {
    showMsg('snap-msg', 'Cannot delete while offline. Please reconnect and try again.', false);
    return;
  }
  if (!isSignedIn()) return;
  if (state.syncing) return;
  if (!confirm(`Delete snapshot for ${fmtMon(date)}?`)) return;
  state.snaps = state.snaps.filter(s => s.date !== date);
  state.syncing = true;
  try {
    await saveSnapshots(state.snaps);
    await setCachedSnapshots(state.snaps);
    renderAll();
  } catch (err) {
    showMsg('snap-msg', 'Delete failed: ' + err.message, false);
  } finally {
    state.syncing = false;
  }
}

function clearSnapForm() {
  for (const a of getACCTSList()) {
    const el = document.getElementById(`snap-${a.key}`);
    if (el) el.value = '';
  }
  const notes = document.getElementById('snap-notes');
  if (notes) notes.value = '';
}

// ── CSV import ────────────────────────────────────────────
function initCSVDrop() {
  const zone = document.getElementById('drop-zone');
  const inp  = document.getElementById('csv-file-input');

  if (!zone || !inp) return;

  inp.addEventListener('change', () => {
    if (inp.files[0]) handleCSVFile(inp.files[0]);
  });
  zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', ()  => zone.classList.remove('over'));
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.classList.remove('over');
    const f = e.dataTransfer.files[0];
    if (f?.name.toLowerCase().endsWith('.csv')) handleCSVFile(f);
    else showMsg('import-msg', 'Please drop a .csv file', false);
  });
}

async function handleCSVFile(file) {
  // Block writes when offline
  if (state.offline || !navigator.onLine) {
    showMsg('import-msg', 'Cannot import while offline. Please reconnect and try again.', false);
    return;
  }
  if (!isSignedIn()) {
    showMsg('import-msg', 'Please sign in before importing.', false);
    return;
  }
  if (state.syncing) {
    showMsg('import-msg', 'A sync is already in progress.', false);
    return;
  }
  showMsg('import-msg', 'Parsing…', true);
  const reader = new FileReader();
  reader.onload = e => {
    const text = e.target.result;
    const headerLine = text.trim().split('\n')[0] || '';

    // Auto-detect profile
    let profile = detectProfile(headerLine);

    if (profile) {
      // Profile detected — parse immediately and show preview
      showImportPreview(text, profile);
    } else {
      // No match — show profile picker
      showProfilePicker(text);
    }
  };
  reader.readAsText(file, 'UTF-8');
}

/** Show a dropdown to pick a profile when auto-detect fails. */
function showProfilePicker(csvText) {
  const container = document.getElementById('import-preview');
  if (!container) return;

  const options = builtInProfiles.map(p =>
    `<option value="${esc(p.id)}">${esc(p.label)}</option>`
  ).join('');

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
    const id = document.getElementById('profile-select')?.value;
    const profile = builtInProfiles.find(p => p.id === id);
    if (profile) showImportPreview(csvText, profile);
  });
  document.getElementById('btn-cancel-profile')?.addEventListener('click', () => {
    container.innerHTML = '';
    container.style.display = 'none';
    showMsg('import-msg', 'Import cancelled.', false);
  });
}

/** Parse CSV with profile and show a preview for confirmation. */
function showImportPreview(csvText, profile) {
  const parsed  = parseWithProfile(csvText, profile);
  const summary = previewSummary(parsed);
  const container = document.getElementById('import-preview');
  if (!container) return;

  // Build type counts string
  const typeCounts = Object.entries(summary.byCounts)
    .sort(([,a], [,b]) => b - a)
    .map(([type, count]) => `<span style="font-weight:500">${count}</span> ${esc(type)}`)
    .join(', ');

  // Unmapped warning
  let unmappedHtml = '';
  if (summary.unmapped.length > 0) {
    const totalUnmapped = summary.unmapped.reduce((s, u) => s + u.count, 0);
    const unmappedList  = summary.unmapped.map(u => `<code>${esc(u.type)}</code> (${u.count})`).join(', ');
    unmappedHtml = `
      <div class="status-bar status-warn" style="margin:.6rem 0">
        ⚠ ${totalUnmapped} row${totalUnmapped > 1 ? 's' : ''} with unmapped type${totalUnmapped > 1 ? 's' : ''}: ${unmappedList}
      </div>
    `;
  }

  // Sample table (first ~10 rows)
  const sampleRows = summary.sample;
  const sampleHtml = sampleRows.length > 0 ? `
    <div style="overflow-x:auto;margin-top:.6rem;-webkit-overflow-scrolling:touch">
      <table style="width:100%;font-size:11px;border-collapse:collapse">
        <thead>
          <tr style="color:#6b6a65;text-transform:uppercase;letter-spacing:.04em">
            <th style="padding:4px 6px;text-align:left">Date</th>
            <th style="padding:4px 6px;text-align:left">Type</th>
            <th style="padding:4px 6px;text-align:left">Name</th>
            <th style="padding:4px 6px;text-align:right">Shares</th>
            <th style="padding:4px 6px;text-align:right">Amount</th>
            <th style="padding:4px 6px;text-align:left">Currency</th>
          </tr>
        </thead>
        <tbody>
          ${sampleRows.map(tx => `
            <tr style="border-top:1px solid #f1efe8">
              <td style="padding:4px 6px">${esc(tx.date)}</td>
              <td style="padding:4px 6px">${esc(tx.type)}</td>
              <td style="padding:4px 6px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(tx.name)}</td>
              <td style="padding:4px 6px;text-align:right">${tx.shares || ''}</td>
              <td style="padding:4px 6px;text-align:right">${tx.amount}</td>
              <td style="padding:4px 6px">${esc(tx.currency)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  ` : '';

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

  // Confirm handler — write to sheets
  document.getElementById('btn-confirm-import')?.addEventListener('click', async () => {
    container.innerHTML = '';
    container.style.display = 'none';
    state.syncing = true;
    try {
      const merged = await mergeTransactions(state.txs, parsed.transactions);
      const today  = new Date().toISOString().slice(0, 10);
      await saveImportMeta(today);
      state.txs        = merged;
      state.importMeta = { last_import: today };
      state.pd         = computePD(merged, { method: getCostBasisMethod() });

      // Update cache
      await Promise.all([
        setCachedTransactions(merged),
        setCachedImportMeta({ last_import: today }),
        setSyncCursor({ lastDate: merged.length > 0 ? merged[merged.length - 1].date : '', rowCount: merged.length }),
        state.pd ? setCachedAggregates(state.pd) : Promise.resolve(),
        state.pd ? setInputsHash(computeInputsHash(
          merged.length,
          merged[merged.length - 1]?.date || '',
          getCostBasisMethod(),
          holdingsSignature(getHoldings()),
        )) : Promise.resolve(),
      ]);

      showMsg('import-msg', `✓ ${merged.length} transactions synced to Google Sheets`, true);
      renderAll();
    } catch (err) {
      showMsg('import-msg', 'Error: ' + err.message, false);
    } finally {
      state.syncing = false;
    }
  });

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
    parts.push(`${state.snaps.length} snapshot${state.snaps.length > 1 ? 's' : ''} · latest ${fmtMon(state.snaps[state.snaps.length - 1].date)}`);
  }
  const el = document.getElementById('app-sub');
  if (el) el.textContent = parts.length > 0
    ? parts.join(' · ')
    : CONFIG.app.subtitle;
}

// ── Snapshot form (dynamic account fields) ────────────────
function renderSnapForm() {
  const el = document.getElementById('snap-acct-fields');
  if (!el) return;
  const accts = getACCTSList();
  if (accts.length === 0) {
    el.innerHTML = '<p class="note">No accounts configured yet. Add accounts in the <a href="#" data-goto="settings" class="goto-settings">Settings</a> tab.</p>';
    el.querySelector('.goto-settings')?.addEventListener('click', (e) => {
      e.preventDefault();
      showSection('settings', document.querySelector('.nav button[data-section="settings"]'));
    });
    return;
  }
  el.innerHTML = accts.map(a => `
    <div class="form-group">
      <label class="form-label">${esc(a.label)} (€)</label>
      <input type="text" inputmode="decimal" id="snap-${esc(a.key)}" class="form-input" placeholder="total value">
    </div>
  `).join('');

  const dateEl = document.getElementById('snap-date') as HTMLInputElement | null;
  if (dateEl) {
    dateEl.max = currentMonth();
    if (!dateEl.value) dateEl.value = currentMonth();
  }
}

// ── Render all ────────────────────────────────────────────
function renderAll() {
  renderSnapForm();
  renderNW(state.pd, state.snaps);
  renderPortfolio(state.pd, state.snaps);
  renderDCA(state.pd, state.snaps);
  renderDividends(state.pd);
  renderLog({
    txs:        state.txs,
    snaps:      state.snaps,
    importMeta: state.importMeta,
    onEditSnap: editSnap,
    onDelSnap:  delSnap,
  });
  updateSub();
}

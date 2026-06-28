import './styles.css';
import { CONFIG } from './config.js';
import { getACCTSList } from './constants.js';
import { appTemplate } from './template.js';
import { getToken, signIn as gisSignIn, signOut, isSignedIn, trySilentSignIn } from './auth/google.js';
import { loadSnapshots, saveSnapshots } from './sheets/snapshots.js';
import { loadTransactions, mergeTransactions, saveImportMeta, loadImportMeta } from './sheets/transactions.js';
import { loadConfig, onConfigChange, getCostBasisMethod } from './store/config.js';
import { computePD } from './portfolio.js';
import { parseCSV } from './csv.js';
import { renderNW } from './views/networth.js';
import { renderPortfolio } from './views/portfolio.js';
import { renderDCA } from './views/contributions.js';
import { renderDividends } from './views/dividends.js';
import { renderRef } from './views/reference.js';
import { renderSettings } from './views/settings.js';
import { renderLog } from './views/log.js';
import { snapTotal, fmtMon, showMsg, esc } from './utils.js';

// ── App state ────────────────────────────────────────────
const state = {
  snaps:      [],
  txs:        [],
  pd:         null,
  importMeta: {},
  syncing:    false,
};

// ── Boot ─────────────────────────────────────────────────
document.getElementById('app').innerHTML = appTemplate();
initNav();
initSnapForm();
initCSVDrop();
initAuth();
setDefaultMonth();

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

// ── Auth ─────────────────────────────────────────────────
function initAuth() {
  document.getElementById('btn-signin')?.addEventListener('click', onSignInClick);
  document.getElementById('btn-signout')?.addEventListener('click', () => signOut());

  // Silent boot: resume the session with no UI if the Google session is alive
  trySilentSignIn().then((ok) => {
    if (ok) { updateAuthUI(true); loadAllData(); }
    else    { updateAuthUI(false); }
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

// ── Data loading ─────────────────────────────────────────
async function loadAllData() {
  setSyncStatus('loading');
  try {
    const [, snaps, txs, meta] = await Promise.all([
      loadConfig(),
      loadSnapshots(),
      loadTransactions(),
      loadImportMeta(),
    ]);
    state.snaps      = snaps;
    state.txs        = txs;
    state.importMeta = meta;
    state.pd         = txs.length ? computePD(txs, { method: getCostBasisMethod() }) : null;
    onConfigChange(() => {
      // Re-compute with potentially changed cost basis method
      if (state.txs.length) state.pd = computePD(state.txs, { method: getCostBasisMethod() });
      renderAll();
    });
    renderAll();
    setSyncStatus('ok');
  } catch (err) {
    setSyncStatus('error', err.message);
  }
}

function setSyncStatus(status, msg = '') {
  const el = document.getElementById('sync-status');
  if (!el) return;
  const map = {
    loading: ['status-warn',  '<span class="spinner"></span>Loading from Google Sheets…'],
    ok:      ['status-ok',    '✓ Synced with Google Sheets'],
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
  const now = new Date();
  const el  = document.getElementById('snap-date');
  if (el) el.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

async function saveSnapshot() {
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

  const snap = { date };
  for (const a of getACCTSList()) {
    snap[a.key] = parseFloat(document.getElementById(`snap-${a.key}`).value) || 0;
  }
  snap.notes = document.getElementById('snap-notes').value.trim();

  showMsg('snap-msg', 'Saving…', true);
  state.syncing = true;
  try {
    const idx = state.snaps.findIndex(s => s.date === date);
    if (idx >= 0) state.snaps[idx] = snap;
    else { state.snaps.push(snap); state.snaps.sort((a, b) => a.date.localeCompare(b.date)); }
    await saveSnapshots(state.snaps);
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
  document.getElementById('snap-date').value  = s.date;
  for (const a of getACCTSList()) {
    document.getElementById(`snap-${a.key}`).value = s[a.key] || '';
  }
  document.getElementById('snap-notes').value = s.notes || '';
  showSection('log', document.querySelector('.nav button[data-section="log"]'));
  document.getElementById('snap-date')?.scrollIntoView({ behavior: 'smooth' });
}

async function delSnap(date) {
  if (!isSignedIn()) return;
  if (state.syncing) return;
  if (!confirm(`Delete snapshot for ${fmtMon(date)}?`)) return;
  state.snaps = state.snaps.filter(s => s.date !== date);
  state.syncing = true;
  try {
    await saveSnapshots(state.snaps);
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
  reader.onload = async e => {
    state.syncing = true;
    try {
      const parsed  = parseCSV(e.target.result);
      const merged  = await mergeTransactions(state.txs, parsed);
      const today   = new Date().toISOString().slice(0, 10);
      await saveImportMeta(today);
      state.txs        = merged;
      state.importMeta = { last_import: today };
      state.pd         = computePD(merged, { method: getCostBasisMethod() });
      showMsg('import-msg', `✓ ${merged.length} transactions synced to Google Sheets`, true);
      renderAll();
    } catch (err) {
      showMsg('import-msg', 'Error: ' + err.message, false);
    } finally {
      state.syncing = false;
    }
  };
  reader.readAsText(file, 'UTF-8');
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
      <input type="number" id="snap-${esc(a.key)}" class="form-input" placeholder="total value">
    </div>
  `).join('');
}

// ── Render all ────────────────────────────────────────────
function renderAll() {
  renderSnapForm();
  renderNW(state.snaps);
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

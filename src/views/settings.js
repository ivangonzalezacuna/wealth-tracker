import { getAccounts, getHoldings, getSettings, setAccounts, setHoldings, setSettings, isConfigLoaded } from '../store/config.js';
import { showMsg } from '../utils.js';

/**
 * Render the Settings section — editable tables for Accounts, Holdings, Settings.
 * Only shown after config is loaded (sign-in required).
 */
export function renderSettings() {
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
    ${renderSettingsCard(settings)}
  `;

  attachAccountListeners(el);
  attachHoldingListeners(el);
  attachSettingsListeners(el);
}

// ── Accounts ──────────────────────────────────────────────

function renderAccountsCard(accounts) {
  const rows = accounts.map((a, i) => `
    <div class="tbl-row settings-acct-row" style="grid-template-columns:1.2fr 1fr 1fr 1.5fr .8fr .6fr .5fr" data-idx="${i}">
      <div><input class="form-input form-input-sm" data-field="id" value="${esc(a.id)}" placeholder="key"></div>
      <div><input class="form-input form-input-sm" data-field="moneyType" value="${esc(a.moneyType)}" placeholder="investment|savings|pension|cash"></div>
      <div><input class="form-input form-input-sm" data-field="institution" value="${esc(a.institution)}" placeholder="Institution"></div>
      <div><input class="form-input form-input-sm" data-field="label" value="${esc(a.label)}" placeholder="Display label"></div>
      <div><input class="form-input form-input-sm" data-field="color" value="${esc(a.color)}" type="color" style="padding:2px;height:30px"></div>
      <div><label style="font-size:11px;cursor:pointer"><input type="checkbox" data-field="isPrimaryInvestment" ${a.isPrimaryInvestment ? 'checked' : ''}> Primary</label></div>
      <div><button class="btn btn-sm btn-danger js-del-acct" data-idx="${i}">✕</button></div>
    </div>
  `).join('');

  return `
    <div class="card">
      <div class="card-title">Accounts</div>
      <p class="note" style="margin-bottom:.75rem">Accounts tracked in monthly snapshots. The "id" is the stable column key — avoid renaming once data exists.</p>
      <div class="tbl" id="settings-accounts-tbl">
        <div class="tbl-row th" style="grid-template-columns:1.2fr 1fr 1fr 1.5fr .8fr .6fr .5fr">
          <div>ID</div><div>Type</div><div>Institution</div><div>Label</div><div>Color</div><div>Primary</div><div></div>
        </div>
        ${rows}
      </div>
      <div style="display:flex;gap:10px;margin-top:.75rem">
        <button class="btn btn-outline btn-sm" id="btn-add-acct">+ Add account</button>
        <button class="btn btn-primary btn-sm" id="btn-save-accts">Save accounts</button>
        <span id="accts-msg" style="font-size:12px;line-height:28px"></span>
      </div>
    </div>`;
}

function attachAccountListeners(root) {
  root.querySelector('#btn-add-acct')?.addEventListener('click', () => {
    const accounts = collectAccounts(root);
    accounts.push({ id: '', moneyType: 'cash', institution: '', label: '', color: '#888888', isPrimaryInvestment: false, order: accounts.length + 1 });
    rerenderAccountsTable(root, accounts);
  });

  root.querySelector('#btn-save-accts')?.addEventListener('click', async () => {
    const accounts = collectAccounts(root);
    if (accounts.some(a => !a.id)) {
      showMsg('accts-msg', 'Each account needs an id.', false);
      return;
    }
    try {
      await setAccounts(accounts);
      showMsg('accts-msg', 'Saved', true);
    } catch (err) {
      showMsg('accts-msg', 'Error: ' + err.message, false);
    }
  });

  root.querySelectorAll('.js-del-acct').forEach(btn => {
    btn.addEventListener('click', () => {
      const accounts = collectAccounts(root);
      accounts.splice(parseInt(btn.dataset.idx), 1);
      rerenderAccountsTable(root, accounts);
    });
  });
}

function collectAccounts(root) {
  const rows = root.querySelectorAll('.settings-acct-row');
  return [...rows].map((row, i) => ({
    id:                  row.querySelector('[data-field="id"]').value.trim(),
    moneyType:           row.querySelector('[data-field="moneyType"]').value.trim(),
    institution:         row.querySelector('[data-field="institution"]').value.trim(),
    label:               row.querySelector('[data-field="label"]').value.trim(),
    color:               row.querySelector('[data-field="color"]').value.trim(),
    isPrimaryInvestment: row.querySelector('[data-field="isPrimaryInvestment"]').checked,
    order:               i + 1,
  }));
}

function rerenderAccountsTable(root, accounts) {
  const tbl = root.querySelector('#settings-accounts-tbl');
  if (!tbl) return;
  const rows = accounts.map((a, i) => `
    <div class="tbl-row settings-acct-row" style="grid-template-columns:1.2fr 1fr 1fr 1.5fr .8fr .6fr .5fr" data-idx="${i}">
      <div><input class="form-input form-input-sm" data-field="id" value="${esc(a.id)}" placeholder="key"></div>
      <div><input class="form-input form-input-sm" data-field="moneyType" value="${esc(a.moneyType)}" placeholder="investment|savings|pension|cash"></div>
      <div><input class="form-input form-input-sm" data-field="institution" value="${esc(a.institution)}" placeholder="Institution"></div>
      <div><input class="form-input form-input-sm" data-field="label" value="${esc(a.label)}" placeholder="Display label"></div>
      <div><input class="form-input form-input-sm" data-field="color" value="${esc(a.color)}" type="color" style="padding:2px;height:30px"></div>
      <div><label style="font-size:11px;cursor:pointer"><input type="checkbox" data-field="isPrimaryInvestment" ${a.isPrimaryInvestment ? 'checked' : ''}> Primary</label></div>
      <div><button class="btn btn-sm btn-danger js-del-acct" data-idx="${i}">✕</button></div>
    </div>
  `).join('');
  // Keep header, replace rows
  tbl.innerHTML = `
    <div class="tbl-row th" style="grid-template-columns:1.2fr 1fr 1fr 1.5fr .8fr .6fr .5fr">
      <div>ID</div><div>Type</div><div>Institution</div><div>Label</div><div>Color</div><div>Primary</div><div></div>
    </div>
    ${rows}`;
  // Re-attach delete listeners
  tbl.querySelectorAll('.js-del-acct').forEach(btn => {
    btn.addEventListener('click', () => {
      const accs = collectAccounts(root);
      accs.splice(parseInt(btn.dataset.idx), 1);
      rerenderAccountsTable(root, accs);
    });
  });
}

// ── Holdings ──────────────────────────────────────────────

function renderHoldingsCard(holdings) {
  const rows = holdings.map((h, i) => `
    <div class="tbl-row settings-hold-row" style="grid-template-columns:1.5fr 1fr .7fr .5fr .5fr .8fr .8fr .7fr 1fr .4fr" data-idx="${i}">
      <div><input class="form-input form-input-sm" data-field="isin" value="${esc(h.isin)}" placeholder="ISIN"></div>
      <div><input class="form-input form-input-sm" data-field="ticker" value="${esc(h.ticker)}" placeholder="Ticker"></div>
      <div><input class="form-input form-input-sm" data-field="color" value="${esc(h.color)}" type="color" style="padding:2px;height:30px"></div>
      <div><label style="font-size:11px;cursor:pointer"><input type="checkbox" data-field="acc" ${h.acc ? 'checked' : ''}> Acc</label></div>
      <div><label style="font-size:11px;cursor:pointer"><input type="checkbox" data-field="active" ${h.active ? 'checked' : ''}> Active</label></div>
      <div><input class="form-input form-input-sm" data-field="weeklyTarget" value="${h.weeklyTarget || ''}" type="number" placeholder="0" style="width:60px"></div>
      <div><input class="form-input form-input-sm" data-field="assetClass" value="${esc(h.assetClass)}" placeholder="equity|bond"></div>
      <div><input class="form-input form-input-sm" data-field="region" value="${esc(h.region)}" placeholder="region"></div>
      <div><input class="form-input form-input-sm" data-field="foldInto" value="${esc(h.foldInto)}" placeholder="ISIN"></div>
      <div><button class="btn btn-sm btn-danger js-del-hold" data-idx="${i}">✕</button></div>
    </div>
  `).join('');

  return `
    <div class="card">
      <div class="card-title">Holdings</div>
      <p class="note" style="margin-bottom:.75rem">ETF holdings with target allocation, asset class, and succession mapping.</p>
      <div class="tbl" id="settings-holdings-tbl" style="overflow-x:auto">
        <div class="tbl-row th" style="grid-template-columns:1.5fr 1fr .7fr .5fr .5fr .8fr .8fr .7fr 1fr .4fr">
          <div>ISIN</div><div>Ticker</div><div>Color</div><div>Acc</div><div>Active</div><div>Weekly€</div><div>Class</div><div>Region</div><div>Fold into</div><div></div>
        </div>
        ${rows}
      </div>
      <div style="display:flex;gap:10px;margin-top:.75rem">
        <button class="btn btn-outline btn-sm" id="btn-add-hold">+ Add holding</button>
        <button class="btn btn-primary btn-sm" id="btn-save-holds">Save holdings</button>
        <span id="holds-msg" style="font-size:12px;line-height:28px"></span>
      </div>
    </div>`;
}

function attachHoldingListeners(root) {
  root.querySelector('#btn-add-hold')?.addEventListener('click', () => {
    const holds = collectHoldings(root);
    holds.push({ isin: '', ticker: '', name: '', color: '#888888', acc: true, active: true, weeklyTarget: 0, assetClass: 'equity', region: 'developed', foldInto: '', order: holds.length + 1 });
    rerenderHoldingsTable(root, holds);
  });

  root.querySelector('#btn-save-holds')?.addEventListener('click', async () => {
    const holds = collectHoldings(root);
    if (holds.some(h => !h.isin || !h.ticker)) {
      showMsg('holds-msg', 'Each holding needs ISIN and ticker.', false);
      return;
    }
    try {
      await setHoldings(holds);
      showMsg('holds-msg', 'Saved', true);
    } catch (err) {
      showMsg('holds-msg', 'Error: ' + err.message, false);
    }
  });

  root.querySelectorAll('.js-del-hold').forEach(btn => {
    btn.addEventListener('click', () => {
      const holds = collectHoldings(root);
      holds.splice(parseInt(btn.dataset.idx), 1);
      rerenderHoldingsTable(root, holds);
    });
  });
}

function collectHoldings(root) {
  const rows = root.querySelectorAll('.settings-hold-row');
  return [...rows].map((row, i) => ({
    isin:         row.querySelector('[data-field="isin"]').value.trim(),
    ticker:       row.querySelector('[data-field="ticker"]').value.trim(),
    name:         '',
    color:        row.querySelector('[data-field="color"]').value.trim(),
    acc:          row.querySelector('[data-field="acc"]').checked,
    active:       row.querySelector('[data-field="active"]').checked,
    weeklyTarget: parseFloat(row.querySelector('[data-field="weeklyTarget"]').value) || 0,
    assetClass:   row.querySelector('[data-field="assetClass"]').value.trim(),
    region:       row.querySelector('[data-field="region"]').value.trim(),
    foldInto:     row.querySelector('[data-field="foldInto"]').value.trim(),
    order:        i + 1,
  }));
}

function rerenderHoldingsTable(root, holdings) {
  const tbl = root.querySelector('#settings-holdings-tbl');
  if (!tbl) return;
  const rows = holdings.map((h, i) => `
    <div class="tbl-row settings-hold-row" style="grid-template-columns:1.5fr 1fr .7fr .5fr .5fr .8fr .8fr .7fr 1fr .4fr" data-idx="${i}">
      <div><input class="form-input form-input-sm" data-field="isin" value="${esc(h.isin)}" placeholder="ISIN"></div>
      <div><input class="form-input form-input-sm" data-field="ticker" value="${esc(h.ticker)}" placeholder="Ticker"></div>
      <div><input class="form-input form-input-sm" data-field="color" value="${esc(h.color)}" type="color" style="padding:2px;height:30px"></div>
      <div><label style="font-size:11px;cursor:pointer"><input type="checkbox" data-field="acc" ${h.acc ? 'checked' : ''}> Acc</label></div>
      <div><label style="font-size:11px;cursor:pointer"><input type="checkbox" data-field="active" ${h.active ? 'checked' : ''}> Active</label></div>
      <div><input class="form-input form-input-sm" data-field="weeklyTarget" value="${h.weeklyTarget || ''}" type="number" placeholder="0" style="width:60px"></div>
      <div><input class="form-input form-input-sm" data-field="assetClass" value="${esc(h.assetClass)}" placeholder="equity|bond"></div>
      <div><input class="form-input form-input-sm" data-field="region" value="${esc(h.region)}" placeholder="region"></div>
      <div><input class="form-input form-input-sm" data-field="foldInto" value="${esc(h.foldInto)}" placeholder="ISIN"></div>
      <div><button class="btn btn-sm btn-danger js-del-hold" data-idx="${i}">✕</button></div>
    </div>
  `).join('');
  tbl.innerHTML = `
    <div class="tbl-row th" style="grid-template-columns:1.5fr 1fr .7fr .5fr .5fr .8fr .8fr .7fr 1fr .4fr">
      <div>ISIN</div><div>Ticker</div><div>Color</div><div>Acc</div><div>Active</div><div>Weekly€</div><div>Class</div><div>Region</div><div>Fold into</div><div></div>
    </div>
    ${rows}`;
  tbl.querySelectorAll('.js-del-hold').forEach(btn => {
    btn.addEventListener('click', () => {
      const h = collectHoldings(root);
      h.splice(parseInt(btn.dataset.idx), 1);
      rerenderHoldingsTable(root, h);
    });
  });
}

// ── Settings (key/value) ──────────────────────────────────

function renderSettingsCard(settings) {
  const entries = Object.entries(settings);
  const rows = entries.map(([k, v], i) => `
    <div class="tbl-row settings-kv-row" style="grid-template-columns:1.5fr 2fr .4fr" data-idx="${i}">
      <div><input class="form-input form-input-sm" data-field="key" value="${esc(k)}"></div>
      <div><input class="form-input form-input-sm" data-field="value" value="${esc(v)}"></div>
      <div><button class="btn btn-sm btn-danger js-del-kv" data-idx="${i}">✕</button></div>
    </div>
  `).join('');

  return `
    <div class="card">
      <div class="card-title">Settings &amp; rules</div>
      <p class="note" style="margin-bottom:.75rem">Key-value pairs: projection parameters (annualReturnPct), reinvestment rules (rule_N_label / rule_N_value), and any custom notes.</p>
      <div class="tbl" id="settings-kv-tbl">
        <div class="tbl-row th" style="grid-template-columns:1.5fr 2fr .4fr">
          <div>Key</div><div>Value</div><div></div>
        </div>
        ${rows}
      </div>
      <div style="display:flex;gap:10px;margin-top:.75rem">
        <button class="btn btn-outline btn-sm" id="btn-add-kv">+ Add setting</button>
        <button class="btn btn-primary btn-sm" id="btn-save-kv">Save settings</button>
        <span id="kv-msg" style="font-size:12px;line-height:28px"></span>
      </div>
    </div>`;
}

function attachSettingsListeners(root) {
  root.querySelector('#btn-add-kv')?.addEventListener('click', () => {
    const kvs = collectKVs(root);
    kvs.push({ key: '', value: '' });
    rerenderKVTable(root, kvs);
  });

  root.querySelector('#btn-save-kv')?.addEventListener('click', async () => {
    const kvs = collectKVs(root);
    const obj = {};
    for (const { key, value } of kvs) {
      if (key) obj[key] = value;
    }
    try {
      await setSettings(obj);
      showMsg('kv-msg', 'Saved', true);
    } catch (err) {
      showMsg('kv-msg', 'Error: ' + err.message, false);
    }
  });

  root.querySelectorAll('.js-del-kv').forEach(btn => {
    btn.addEventListener('click', () => {
      const kvs = collectKVs(root);
      kvs.splice(parseInt(btn.dataset.idx), 1);
      rerenderKVTable(root, kvs);
    });
  });
}

function collectKVs(root) {
  const rows = root.querySelectorAll('.settings-kv-row');
  return [...rows].map(row => ({
    key:   row.querySelector('[data-field="key"]').value.trim(),
    value: row.querySelector('[data-field="value"]').value.trim(),
  }));
}

function rerenderKVTable(root, kvs) {
  const tbl = root.querySelector('#settings-kv-tbl');
  if (!tbl) return;
  const rows = kvs.map(({ key, value }, i) => `
    <div class="tbl-row settings-kv-row" style="grid-template-columns:1.5fr 2fr .4fr" data-idx="${i}">
      <div><input class="form-input form-input-sm" data-field="key" value="${esc(key)}"></div>
      <div><input class="form-input form-input-sm" data-field="value" value="${esc(value)}"></div>
      <div><button class="btn btn-sm btn-danger js-del-kv" data-idx="${i}">✕</button></div>
    </div>
  `).join('');
  tbl.innerHTML = `
    <div class="tbl-row th" style="grid-template-columns:1.5fr 2fr .4fr">
      <div>Key</div><div>Value</div><div></div>
    </div>
    ${rows}`;
  tbl.querySelectorAll('.js-del-kv').forEach(btn => {
    btn.addEventListener('click', () => {
      const k = collectKVs(root);
      k.splice(parseInt(btn.dataset.idx), 1);
      rerenderKVTable(root, k);
    });
  });
}

// ── Helpers ───────────────────────────────────────────────

function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

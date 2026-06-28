import { getAccounts, getHoldings, getSettings, setAccounts, setHoldings, setSettings, isConfigLoaded } from '../store/config.js';
import { loadTransactions } from '../sheets/transactions.js';
import { showMsg } from '../utils.js';

/**
 * Render the Settings section — user-friendly forms for Accounts, Holdings, Settings.
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
    ${renderProjectionCard(settings)}
    ${renderRulesCard(settings)}
  `;

  attachAccountListeners(el);
  attachHoldingListeners(el);
  attachProjectionListeners(el);
  attachRulesListeners(el);
}

// ── Accounts ──────────────────────────────────────────────

const ACCOUNT_TYPES = [
  { value: 'investment', label: 'Investment' },
  { value: 'savings',    label: 'Savings' },
  { value: 'pension',    label: 'Pension' },
  { value: 'cash',       label: 'Cash' },
];

function renderAccountsCard(accounts) {
  const rows = accounts.map((a, i) => renderAccountRow(a, i)).join('');

  return `
    <div class="card">
      <div class="card-title">Accounts</div>
      <p class="note" style="margin-bottom:.75rem">Accounts tracked in each monthly net-worth snapshot. Add one row per bank account or portfolio.</p>
      <div class="tbl" id="settings-accounts-tbl">
        <div class="tbl-row th" style="grid-template-columns:1.8fr 1fr 1.2fr .8fr .6fr .4fr">
          <div>Name</div><div>Type</div><div>Institution</div><div>Color</div><div>Primary</div><div></div>
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

function renderAccountRow(a, i) {
  const typeOptions = ACCOUNT_TYPES.map(t =>
    `<option value="${t.value}" ${a.moneyType === t.value ? 'selected' : ''}>${t.label}</option>`
  ).join('');

  return `
    <div class="tbl-row settings-acct-row" style="grid-template-columns:1.8fr 1fr 1.2fr .8fr .6fr .4fr" data-idx="${i}">
      <div><input class="form-input form-input-sm" data-field="label" value="${esc(a.label)}" placeholder="e.g. Main ETF portfolio"></div>
      <div><select class="form-input form-input-sm" data-field="moneyType">${typeOptions}</select></div>
      <div><input class="form-input form-input-sm" data-field="institution" value="${esc(a.institution)}" placeholder="e.g. Trade Republic"></div>
      <div><input class="form-input form-input-sm" data-field="color" value="${esc(a.color)}" type="color" style="padding:2px;height:30px"></div>
      <div><label style="font-size:11px;cursor:pointer"><input type="checkbox" data-field="isPrimaryInvestment" ${a.isPrimaryInvestment ? 'checked' : ''}> Primary</label></div>
      <div><button class="btn btn-sm btn-danger js-del-acct" data-idx="${i}">✕</button></div>
      <input type="hidden" data-field="id" value="${esc(a.id)}">
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
    if (accounts.some(a => !a.label)) {
      showMsg('accts-msg', 'Each account needs a name.', false);
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
  const rows = accounts.map((a, i) => renderAccountRow(a, i)).join('');
  tbl.innerHTML = `
    <div class="tbl-row th" style="grid-template-columns:1.8fr 1fr 1.2fr .8fr .6fr .4fr">
      <div>Name</div><div>Type</div><div>Institution</div><div>Color</div><div>Primary</div><div></div>
    </div>
    ${rows}`;
  tbl.querySelectorAll('.js-del-acct').forEach(btn => {
    btn.addEventListener('click', () => {
      const accs = collectAccounts(root);
      accs.splice(parseInt(btn.dataset.idx), 1);
      rerenderAccountsTable(root, accs);
    });
  });
}

// ── Holdings ──────────────────────────────────────────────

const ASSET_CLASSES = [
  { value: 'equity', label: 'Equity' },
  { value: 'bond',   label: 'Bond' },
  { value: 'reit',   label: 'REIT' },
  { value: 'commodity', label: 'Commodity' },
  { value: 'other',  label: 'Other' },
];

const REGIONS = [
  { value: 'developed', label: 'Developed' },
  { value: 'emerging',  label: 'Emerging' },
  { value: 'global',    label: 'Global' },
  { value: 'europe',    label: 'Europe' },
  { value: 'us',        label: 'US' },
  { value: 'other',     label: 'Other' },
];

function renderHoldingsCard(holdings) {
  const rows = holdings.map((h, i) => renderHoldingRow(h, i)).join('');

  return `
    <div class="card">
      <div class="card-title">Holdings (ETFs)</div>
      <p class="note" style="margin-bottom:.75rem">ETF positions in your portfolio. Active holdings receive weekly contributions. Closed positions can be folded into a successor fund.</p>
      <div class="tbl" id="settings-holdings-tbl" style="overflow-x:auto">
        <div class="tbl-row th" style="grid-template-columns:1.3fr .9fr .7fr .6fr .6fr .8fr .8fr .7fr 1.1fr .4fr">
          <div>ISIN</div><div>Ticker</div><div>Color</div><div>Accum.</div><div>Active</div><div>Weekly (€)</div><div>Asset class</div><div>Region</div><div>Successor ISIN</div><div></div>
        </div>
        ${rows}
      </div>
      <div style="display:flex;gap:10px;margin-top:.75rem;flex-wrap:wrap">
        <button class="btn btn-outline btn-sm" id="btn-add-hold">+ Add holding</button>
        <button class="btn btn-outline btn-sm" id="btn-autofill-holds">Auto-fill from transactions</button>
        <button class="btn btn-primary btn-sm" id="btn-save-holds">Save holdings</button>
        <span id="holds-msg" style="font-size:12px;line-height:28px"></span>
      </div>
    </div>`;
}

function renderHoldingRow(h, i) {
  const classOptions = ASSET_CLASSES.map(c =>
    `<option value="${c.value}" ${h.assetClass === c.value ? 'selected' : ''}>${c.label}</option>`
  ).join('');
  const regionOptions = REGIONS.map(r =>
    `<option value="${r.value}" ${h.region === r.value ? 'selected' : ''}>${r.label}</option>`
  ).join('');

  return `
    <div class="tbl-row settings-hold-row" style="grid-template-columns:1.3fr .9fr .7fr .6fr .6fr .8fr .8fr .7fr 1.1fr .4fr" data-idx="${i}">
      <div><input class="form-input form-input-sm" data-field="isin" value="${esc(h.isin)}" placeholder="e.g. IE00B4L5Y983"></div>
      <div><input class="form-input form-input-sm" data-field="ticker" value="${esc(h.ticker)}" placeholder="e.g. IWDA"></div>
      <div><input class="form-input form-input-sm" data-field="color" value="${esc(h.color)}" type="color" style="padding:2px;height:30px"></div>
      <div><label style="font-size:11px;cursor:pointer"><input type="checkbox" data-field="acc" ${h.acc ? 'checked' : ''}> Yes</label></div>
      <div><label style="font-size:11px;cursor:pointer"><input type="checkbox" data-field="active" ${h.active ? 'checked' : ''}> Yes</label></div>
      <div><input class="form-input form-input-sm" data-field="weeklyTarget" value="${h.weeklyTarget || ''}" type="number" min="0" placeholder="0" style="width:70px"></div>
      <div><select class="form-input form-input-sm" data-field="assetClass">${classOptions}</select></div>
      <div><select class="form-input form-input-sm" data-field="region">${regionOptions}</select></div>
      <div><input class="form-input form-input-sm" data-field="foldInto" value="${esc(h.foldInto)}" placeholder="ISIN of successor"></div>
      <div><button class="btn btn-sm btn-danger js-del-hold" data-idx="${i}">✕</button></div>
    </div>`;
}

function attachHoldingListeners(root) {
  root.querySelector('#btn-add-hold')?.addEventListener('click', () => {
    const holds = collectHoldings(root);
    holds.push({ isin: '', ticker: '', name: '', color: '#888888', acc: true, active: true, weeklyTarget: 0, assetClass: 'equity', region: 'developed', foldInto: '', order: holds.length + 1 });
    rerenderHoldingsTable(root, holds);
  });

  root.querySelector('#btn-autofill-holds')?.addEventListener('click', async () => {
    showMsg('holds-msg', 'Loading transactions…', true);
    try {
      const txs = await loadTransactions();
      const buys = txs.filter(t => t.type === 'BUY' && t.category === 'TRADING' && t.symbol);
      if (buys.length === 0) {
        showMsg('holds-msg', 'No BUY transactions found. Import a CSV first.', false);
        return;
      }
      // Extract unique ISIN→name mapping from transactions
      const isinMap = {};
      for (const tx of buys) {
        if (!isinMap[tx.symbol]) {
          isinMap[tx.symbol] = tx.name || '';
        }
      }
      // Merge with existing holdings (skip already-configured ISINs)
      const holds = collectHoldings(root);
      const existing = new Set(holds.map(h => h.isin));
      let added = 0;
      for (const [isin, name] of Object.entries(isinMap)) {
        if (existing.has(isin)) continue;
        const parsed = parseHoldingName(name, isin);
        holds.push({
          isin,
          ticker:      parsed.ticker,
          name:        '',
          color:       randomColor(),
          acc:         parsed.acc,
          active:      true,
          weeklyTarget: 0,
          assetClass:  parsed.assetClass,
          region:      parsed.region,
          foldInto:    '',
          order:       holds.length + 1,
        });
        added++;
      }
      rerenderHoldingsTable(root, holds);
      showMsg('holds-msg', added > 0 ? `Added ${added} holding(s) from transactions. Review and save.` : 'All transaction ISINs already configured.', true);
    } catch (err) {
      showMsg('holds-msg', 'Error: ' + err.message, false);
    }
  });

  root.querySelector('#btn-save-holds')?.addEventListener('click', async () => {
    const holds = collectHoldings(root);
    if (holds.some(h => !h.isin || !h.ticker)) {
      showMsg('holds-msg', 'Each holding needs an ISIN and ticker.', false);
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
  const rows = holdings.map((h, i) => renderHoldingRow(h, i)).join('');
  tbl.innerHTML = `
    <div class="tbl-row th" style="grid-template-columns:1.3fr .9fr .7fr .6fr .6fr .8fr .8fr .7fr 1.1fr .4fr">
      <div>ISIN</div><div>Ticker</div><div>Color</div><div>Accum.</div><div>Active</div><div>Weekly (€)</div><div>Asset class</div><div>Region</div><div>Successor ISIN</div><div></div>
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

// ── Projection settings ──────────────────────────────────

function renderProjectionCard(settings) {
  const annualReturn = settings.annualReturnPct || '7';

  return `
    <div class="card">
      <div class="card-title">Projection assumptions</div>
      <p class="note" style="margin-bottom:.75rem">Parameters used to calculate your 5-year portfolio projection on the Overview tab.</p>
      <div class="form-grid" style="max-width:500px">
        <div class="form-group">
          <label class="form-label">Expected annual return (%)</label>
          <input class="form-input" id="set-annual-return" type="number" min="0" max="30" step="0.1" value="${esc(annualReturn)}" placeholder="7">
          <span class="note">Historical average for diversified ETF portfolios is ~7%</span>
        </div>
      </div>
      <div style="display:flex;gap:10px;margin-top:.75rem">
        <button class="btn btn-primary btn-sm" id="btn-save-projection">Save projection settings</button>
        <span id="proj-msg" style="font-size:12px;line-height:28px"></span>
      </div>
    </div>`;
}

function attachProjectionListeners(root) {
  root.querySelector('#btn-save-projection')?.addEventListener('click', async () => {
    const annualReturn = root.querySelector('#set-annual-return')?.value || '7';
    try {
      await setSettings({ annualReturnPct: annualReturn });
      showMsg('proj-msg', 'Saved', true);
    } catch (err) {
      showMsg('proj-msg', 'Error: ' + err.message, false);
    }
  });
}

// ── Reinvestment rules ───────────────────────────────────

function renderRulesCard(settings) {
  // Extract rules from settings: rule_1_label, rule_1_value, rule_2_label, ...
  const rules = [];
  for (let i = 1; i <= 20; i++) {
    const label = settings[`rule_${i}_label`];
    const value = settings[`rule_${i}_value`];
    if (label !== undefined || value !== undefined) {
      rules.push({ label: label || '', value: value || '' });
    }
  }

  const rows = rules.map((r, i) => `
    <div class="tbl-row settings-rule-row" style="grid-template-columns:1.5fr 2fr .4fr" data-idx="${i}">
      <div><input class="form-input form-input-sm" data-field="label" value="${esc(r.label)}" placeholder="e.g. Dividends reinvested"></div>
      <div><input class="form-input form-input-sm" data-field="value" value="${esc(r.value)}" placeholder="e.g. into IWDA weekly"></div>
      <div><button class="btn btn-sm btn-danger js-del-rule" data-idx="${i}">✕</button></div>
    </div>
  `).join('');

  return `
    <div class="card">
      <div class="card-title">Reinvestment rules</div>
      <p class="note" style="margin-bottom:.75rem">Notes about how dividends and proceeds from sold positions are reinvested. These are displayed on the Overview tab as reminders.</p>
      <div class="tbl" id="settings-rules-tbl">
        <div class="tbl-row th" style="grid-template-columns:1.5fr 2fr .4fr">
          <div>Description</div><div>Action</div><div></div>
        </div>
        ${rows}
      </div>
      <div style="display:flex;gap:10px;margin-top:.75rem">
        <button class="btn btn-outline btn-sm" id="btn-add-rule">+ Add rule</button>
        <button class="btn btn-primary btn-sm" id="btn-save-rules">Save rules</button>
        <span id="rules-msg" style="font-size:12px;line-height:28px"></span>
      </div>
    </div>`;
}

function attachRulesListeners(root) {
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

  root.querySelectorAll('.js-del-rule').forEach(btn => {
    btn.addEventListener('click', () => {
      const rules = collectRules(root);
      rules.splice(parseInt(btn.dataset.idx), 1);
      rerenderRulesTable(root, rules);
    });
  });
}

function collectRules(root) {
  const rows = root.querySelectorAll('.settings-rule-row');
  return [...rows].map(row => ({
    label: row.querySelector('[data-field="label"]').value.trim(),
    value: row.querySelector('[data-field="value"]').value.trim(),
  }));
}

function rerenderRulesTable(root, rules) {
  const tbl = root.querySelector('#settings-rules-tbl');
  if (!tbl) return;
  const rows = rules.map((r, i) => `
    <div class="tbl-row settings-rule-row" style="grid-template-columns:1.5fr 2fr .4fr" data-idx="${i}">
      <div><input class="form-input form-input-sm" data-field="label" value="${esc(r.label)}" placeholder="e.g. Dividends reinvested"></div>
      <div><input class="form-input form-input-sm" data-field="value" value="${esc(r.value)}" placeholder="e.g. into IWDA weekly"></div>
      <div><button class="btn btn-sm btn-danger js-del-rule" data-idx="${i}">✕</button></div>
    </div>
  `).join('');
  tbl.innerHTML = `
    <div class="tbl-row th" style="grid-template-columns:1.5fr 2fr .4fr">
      <div>Description</div><div>Action</div><div></div>
    </div>
    ${rows}`;
  tbl.querySelectorAll('.js-del-rule').forEach(btn => {
    btn.addEventListener('click', () => {
      const r = collectRules(root);
      r.splice(parseInt(btn.dataset.idx), 1);
      rerenderRulesTable(root, r);
    });
  });
}

// ── Helpers ───────────────────────────────────────────────

function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Generate a stable snake_case ID from a label. */
function generateId(label) {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 30);
}

/** Generate a random muted hex color for a new holding. */
function randomColor() {
  const h = Math.random() * 360;
  const s = 0.45, l = 0.55;
  // HSL to hex conversion
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;
  let r, g, b;
  if (h < 60) { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }
  const toHex = v => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Parse an ETF name from a Trade Republic CSV to infer holding metadata.
 * Typical names:
 *   "iShares Core MSCI World UCITS ETF USD (Acc)"
 *   "iShares Core MSCI EM IMI UCITS ETF USD (Acc)"
 *   "iShares € Aggregate Bond UCITS ETF EUR (Dist)"
 *   "Vanguard FTSE All-World UCITS ETF (USD) Accumulating"
 *   "Xtrackers MSCI Emerging Markets UCITS ETF 1C"
 */
function parseHoldingName(name, isin) {
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
    .replace(/^(iShares|Vanguard|Xtrackers|Amundi|SPDR|Invesco|Lyxor|WisdomTree|UBS|HSBC|BNP)\s*(Core\s*)?/i, '')
    .trim();
  if (cleaned) {
    // Build a compact ticker-like abbreviation from remaining words
    const words = cleaned.split(/\s+/).filter(w => w.length > 0);
    if (words.length <= 3) {
      ticker = words.join(' ');
    } else {
      // Take initials of long names
      ticker = words.map(w => w[0]).join('').toUpperCase();
    }
  }

  return { ticker, acc, assetClass, region };
}

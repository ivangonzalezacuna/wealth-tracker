import { CONFIG } from './config';

export function appTemplate(): string {
  return `
<header>
  <h1>${CONFIG.app.title}</h1>
  <div class="sub" id="app-sub">${CONFIG.app.subtitle}</div>
  <div id="auth-bar">
    <span id="auth-status" class="auth-status"></span>
    <button id="btn-signout" class="btn btn-ghost btn-sm" style="display:none">Sign out</button>
  </div>
</header>

<nav class="nav">
  <button class="active" data-section="networth">Net worth</button>
  <button data-section="portfolio">Portfolio</button>
  <button data-section="contributions">Contributions</button>
  <button data-section="dividends">Dividends</button>
  <button data-section="reference">Reference</button>
  <button data-section="settings">Settings</button>
  <button data-section="log" class="log-btn">＋ Log</button>
</nav>

<!-- ════ NET WORTH ════ -->
<div id="networth" class="section active">
  <div id="nw-empty" style="display:none"><div class="card"><div class="empty-state">
    <div style="font-size:2.4rem;margin-bottom:.75rem">📊</div>
    <div style="font-weight:500;font-size:14px;color:#0b0b0b;margin-bottom:.4rem">No snapshots yet</div>
    <p style="font-size:13px;margin-bottom:1.25rem;max-width:340px;margin-left:auto;margin-right:auto">Log your first monthly entry to start tracking net worth across all accounts. Takes ~2 minutes per month.</p>
    <button class="btn btn-primary" data-goto="log">Add first snapshot →</button>
  </div></div></div>
  <div id="nw-content" style="display:none">
    <div class="kpi-row" id="nw-kpis"></div>
    <div class="card">
      <div class="card-title" id="nw-chart-title">Net worth — stacked by account</div>
      <div id="nw-chart-legend" class="legend"></div>
      <div class="chart-wrap" style="height:260px"><canvas id="c-nw-hist"></canvas></div>
    </div>
    <div class="two-col">
      <div class="card">
        <div class="card-title">Account breakdown</div>
        <div id="nw-donut-legend" class="legend"></div>
        <div class="chart-wrap" style="height:165px"><canvas id="c-nw-donut"></canvas></div>
      </div>
      <div class="card">
        <div class="card-title">Latest snapshot</div>
        <div id="nw-detail"></div>
      </div>
    </div>
  </div>
</div>

<!-- ════ PORTFOLIO ════ -->
<div id="portfolio" class="section">
  <div id="port-empty" style="display:none"><div class="card"><div class="empty-state">
    <div style="font-size:2rem;margin-bottom:.75rem">📂</div>
    <div style="font-weight:500;font-size:14px;color:#0b0b0b;margin-bottom:.4rem">No transaction data imported</div>
    <p style="font-size:13px;margin-bottom:1rem">Import your Transaktionsexport CSV to see exact cost basis, shares, and dividends.</p>
    <button class="btn btn-primary" data-goto="log">Import CSV →</button>
  </div></div></div>
  <div id="port-content" style="display:none">
    <div class="kpi-row" id="port-kpis"></div>
    <div class="card">
      <div class="card-title">Holdings — exact positions from CSV</div>
      <div class="tbl" role="table" aria-label="Holdings"><div id="port-table"></div></div>
    </div>
    <div class="two-col">
      <div class="card">
        <div class="card-title">Cost basis allocation</div>
        <div id="port-donut-legend" class="legend"></div>
        <div class="chart-wrap" style="height:165px"><canvas id="c-port-donut"></canvas></div>
      </div>
      <div class="card">
        <div class="card-title">Summary</div>
        <div id="port-summary"></div>
      </div>
    </div>
  </div>
</div>

<!-- ════ CONTRIBUTIONS ════ -->
<div id="contributions" class="section">
  <div id="dca-empty" style="display:none"><div class="card"><div class="empty-state">
    <div style="font-size:2rem;margin-bottom:.5rem">📅</div>
    <div style="font-weight:500;font-size:14px;color:#0b0b0b;margin-bottom:.75rem">No transaction data imported</div>
    <button class="btn btn-primary" data-goto="log">Import CSV →</button>
  </div></div></div>
  <div id="dca-content" style="display:none">
    <div class="kpi-row" id="dca-kpis"></div>
    <div class="card">
      <div class="card-title">Monthly invested — stacked by ETF (savings plan executions)</div>
      <div class="chart-controls">
        <div id="dca-legend" class="legend"></div>
        <div class="range-toggle" id="dca-range-toggle">
          <button class="btn btn-sm btn-ghost" data-range="12">12M</button>
          <button class="btn btn-sm btn-ghost" data-range="24">24M</button>
          <button class="btn btn-sm btn-ghost active" data-range="all">All</button>
        </div>
      </div>
      <div class="chart-wrap" style="height:260px"><canvas id="c-dca-bar"></canvas></div>
    </div>
    <div class="two-col">
      <div class="card">
        <div class="card-title">Month-by-month</div>
        <div class="filter-bar">
          <select id="dca-year-filter" class="form-input form-input-sm" style="width:auto;display:inline-block">
            <option value="">All years</option>
          </select>
        </div>
        <div class="tbl" role="table" aria-label="Monthly contributions"><div id="dca-table"></div></div>
        <div id="dca-pagination" class="pagination"></div>
      </div>
      <div class="card">
        <div class="card-title" id="dca-proj-title">5-year projection</div>
        <div class="chart-wrap" style="height:180px"><canvas id="c-dca-proj"></canvas></div>
        <p class="note" id="dca-proj-note">Starting from latest portfolio value. Excludes taxes, fees, FX.</p>
      </div>
    </div>
  </div>
</div>

<!-- ════ DIVIDENDS ════ -->
<div id="dividends" class="section">
  <div id="div-empty" style="display:none"><div class="card"><div class="empty-state">
    <div style="font-size:2rem;margin-bottom:.5rem">💰</div>
    <div style="font-weight:500;font-size:14px;color:#0b0b0b;margin-bottom:.75rem">No transaction data imported</div>
    <button class="btn btn-primary" data-goto="log">Import CSV →</button>
  </div></div></div>
  <div id="div-content" style="display:none">
    <div class="kpi-row" id="div-kpis"></div>
    <div class="card">
      <div class="card-title">Dividend payments received (most recent first)</div>
      <div class="tbl" role="table" aria-label="Dividend history"><div id="div-history"></div></div>
    </div>
    <div class="card">
      <div class="card-title">Cash / savings interest received</div>
      <div id="div-interest"></div>
    </div>
  </div>
</div>

<!-- ════ REFERENCE ════ -->
<div id="reference" class="section">
  <div class="card">
    <div class="card-title">Target allocation</div>
    <div class="two-col" style="align-items:start">
      <div>
        <div id="ref-legend" class="legend" style="margin-bottom:.75rem"></div>
        <div class="chart-wrap" style="height:155px"><canvas id="c-ref-target"></canvas></div>
      </div>
      <div>
        <div id="ref-breakdown"></div>
        <p class="note" id="ref-note"></p>
      </div>
    </div>
  </div>
  <div class="card">
    <div class="card-title">Closed positions</div>
    <div id="ref-closed"></div>
  </div>
  <div class="card">
    <div class="card-title">Settings &amp; rules</div>
    <div id="ref-rules"></div>
  </div>
</div>

<!-- ════ SETTINGS ════ -->
<div id="settings" class="section">
  <div id="settings-content"></div>
</div>

<!-- ════ LOG ════ -->
<div id="log" class="section">
  <div id="auth-prompt" class="card" style="display:none">
    <div class="empty-state">
      <div style="font-size:2rem;margin-bottom:.75rem">🔐</div>
      <div style="font-weight:500;font-size:14px;color:#0b0b0b;margin-bottom:.5rem">Sign in to sync data</div>
      <p style="font-size:13px;margin-bottom:1.25rem;color:#52514e">Your data is stored in your own Google Sheet. Sign in once and it syncs across all devices.</p>
      <button id="btn-signin" class="btn btn-primary">Sign in with Google</button>
    </div>
  </div>

  <div id="log-content">
    <div id="import-status" class="status-bar status-empty">No CSV imported yet</div>
    <div id="sync-status" class="status-bar" style="display:none"></div>

    <div class="card">
      <div class="card-title">Import CSV</div>
      <p class="note" style="margin-bottom:.85rem">Import your transaction export CSV. Drag your file here or click to browse. Parsed locally — data synced to your Google Sheet. Re-import anytime; duplicates handled automatically.</p>
      <div class="drop-zone" id="drop-zone">
        <input type="file" id="csv-file-input" accept=".csv">
        <div style="font-size:2rem;margin-bottom:.4rem">📥</div>
        <div style="font-weight:500;font-size:13px;color:#52514e;margin-bottom:.2rem">Drop CSV file here</div>
        <div style="font-size:11px;color:#6b6a65">or click to browse</div>
      </div>
      <div id="import-msg" style="font-size:12px;margin-top:.6rem;min-height:18px"></div>
      <div id="import-preview" style="display:none"></div>
    </div>

    <hr class="divider">

    <div class="card">
      <div class="card-title">Add / update monthly snapshot</div>
      <p class="note" style="margin-bottom:.85rem">Enter total account balances once a month (~2 min). Same month overwrites the previous entry.</p>
      <div class="form-grid">
        <div class="form-group">
          <label class="form-label">Month</label>
          <input type="month" id="snap-date" class="form-input">
        </div>
        <div class="form-group">
          <label class="form-label">Notes (optional)</label>
          <input type="text" id="snap-notes" class="form-input" placeholder="e.g. catch-up done, got raise…">
        </div>
        <div id="snap-acct-fields"></div>
      </div>
      <div style="display:flex;align-items:center;gap:14px;margin-top:.25rem">
        <button class="btn btn-primary" id="btn-save-snap">Save snapshot</button>
        <span id="snap-msg" style="font-size:12px;min-height:18px"></span>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Snapshot history</div>
      <div class="filter-bar" id="snap-filter-bar">
        <select id="snap-year-filter" class="form-input form-input-sm" style="width:auto;display:inline-block">
          <option value="">All years</option>
        </select>
        <input type="text" id="snap-search" class="form-input form-input-sm" placeholder="Search notes…" style="width:140px;display:inline-block;margin-left:6px">
      </div>
      <div id="snaps-list" role="table" aria-label="Snapshot history"></div>
      <div id="snap-pagination" class="pagination"></div>
    </div>
  </div>
</div>
`;
}

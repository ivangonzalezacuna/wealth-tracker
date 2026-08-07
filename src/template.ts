import { CONFIG } from './config';

export function appTemplate(): string {
  return `
<header>
  <h1>${CONFIG.app.title}</h1>
  <div class="sub" id="app-sub">${CONFIG.app.subtitle}</div>
  <div id="auth-bar">
    <span id="auth-status" class="auth-status"></span>
    <span id="sync-status" class="status-pill" style="display:none"></span>
    <button id="btn-sync-now" class="btn btn-ghost btn-sm" style="display:none" title="Incremental sync (does not clear cache)">Sync now</button>
    <button id="btn-signin-global" class="btn btn-primary btn-sm" style="display:none">Sign in</button>
    <button id="btn-signout" class="btn btn-ghost btn-sm" style="display:none">Sign out</button>
  </div>
</header>

<nav class="nav" role="tablist" aria-label="Main sections">
  <button id="tab-networth" class="active" data-section="networth" role="tab" aria-selected="true" aria-controls="networth">Net worth</button>
  <button id="tab-portfolio" data-section="portfolio" role="tab" aria-selected="false" aria-controls="portfolio">Portfolio</button>
  <button id="tab-analytics" data-section="analytics" role="tab" aria-selected="false" aria-controls="analytics">Analytics</button>
  <button id="tab-settings" data-section="settings" role="tab" aria-selected="false" aria-controls="settings">Settings</button>
  <button id="tab-log" class="log-btn" data-section="log" role="tab" aria-selected="false" aria-controls="log" aria-label="Update (add snapshot or import CSV)">＋ Update</button>
</nav>

<div id="setup-banner" style="display:none"></div>

<!-- ════ NET WORTH ════ -->
<div id="networth" class="section active" role="tabpanel" aria-labelledby="tab-networth">
  <div id="nw-empty" style="display:none"><div class="card"><div class="empty-state">
    <div style="font-size:2.4rem;margin-bottom:.75rem">📊</div>
    <div style="font-weight:500;font-size:14px;color:var(--ink);margin-bottom:.4rem">No snapshots yet</div>
    <p style="font-size:13px;margin-bottom:1.25rem;max-width:340px;margin-left:auto;margin-right:auto">Log your first monthly entry to start tracking net worth across all accounts. Takes ~2 minutes per month.</p>
    <button class="btn btn-primary" data-goto="log">Add first snapshot →</button>
  </div></div></div>
  <div id="nw-content" style="display:none">
    <div class="kpi-row" id="nw-kpis"></div>
    <div class="card card-primary">
      <div class="card-title" id="nw-chart-title">Net worth: stacked by account</div>
      <div class="chart-controls">
        <div id="nw-chart-legend" class="legend"></div>
        <div class="range-toggle" id="nw-range-toggle" role="group" aria-label="History range">
          <button class="btn btn-sm btn-ghost" data-range="12">1Y</button>
          <button class="btn btn-sm btn-ghost" data-range="36">3Y</button>
          <button class="btn btn-sm btn-ghost active" data-range="all">All</button>
        </div>
      </div>
      <div class="chart-wrap chart-h-lg"><canvas id="c-nw-hist"></canvas></div>
    </div>
    <div class="two-col">
      <div class="card">
        <div class="card-title">Latest snapshot</div>
        <div id="nw-detail"></div>
      </div>
      <div id="nw-analytics-callout" class="card" style="align-self:start"></div>
    </div>
    <div id="nw-goal"></div>
    <div id="nw-forecast"></div>
  </div>
</div>

<!-- ════ PORTFOLIO ════ -->
<div id="portfolio" class="section" role="tabpanel" aria-labelledby="tab-portfolio">
  <div class="subnav range-toggle" id="portfolio-subnav" role="tablist" aria-label="Portfolio views">
    <button id="tab-holdings" class="btn btn-sm btn-ghost active" data-subview="holdings" role="tab" aria-selected="true" aria-controls="subview-holdings">Holdings</button>
    <button id="tab-contributions" class="btn btn-sm btn-ghost" data-subview="contributions" role="tab" aria-selected="false" aria-controls="subview-contributions">Contributions</button>
    <button id="tab-dividends" class="btn btn-sm btn-ghost" data-subview="dividends" role="tab" aria-selected="false" aria-controls="subview-dividends">Dividends</button>
  </div>
  <div class="subview" id="subview-holdings" role="tabpanel" aria-labelledby="tab-holdings" style="display:block">
    <div id="port-empty" style="display:none"><div class="card"><div class="empty-state">
      <div style="font-size:2rem;margin-bottom:.75rem">📂</div>
      <div style="font-weight:500;font-size:14px;color:var(--ink);margin-bottom:.4rem">No transaction data imported</div>
      <p style="font-size:13px;margin-bottom:1rem">Import your transaction export CSV to see exact cost basis, shares, and dividends.</p>
      <button class="btn btn-primary" data-goto="log">Import CSV →</button>
    </div></div></div>
    <div id="port-content" style="display:none">
      <div class="kpi-row" id="port-kpis"></div>
      <div class="card">
        <div class="card-title">Holdings: cost basis &amp; performance</div>
        <div class="tbl" role="table" aria-label="Holdings"><div id="port-table"></div></div>
        <div id="port-pagination" class="pagination"></div>
      </div>
      <div class="two-col">
        <div class="card">
          <div class="card-title">Cost basis allocation</div>
          <div id="port-donut-legend" class="legend"></div>
          <div class="chart-wrap chart-h-sm"><canvas id="c-port-donut"></canvas></div>
        </div>
        <div class="card">
          <div class="card-title">Summary</div>
          <div id="port-summary"></div>
        </div>
      </div>
      <div class="two-col">
        <div class="card">
          <div class="card-title">Allocation by asset class</div>
          <div id="port-alloc-class-legend" class="legend"></div>
          <div class="chart-wrap chart-h-sm"><canvas id="c-port-alloc-class"></canvas></div>
        </div>
        <div class="card">
          <div class="card-title">Allocation by region</div>
          <div id="port-alloc-region-legend" class="legend"></div>
          <div class="chart-wrap chart-h-sm"><canvas id="c-port-alloc-region"></canvas></div>
        </div>
      </div>
      <div id="port-drift"></div>
    </div>
  </div>
  <div class="subview" id="subview-contributions" role="tabpanel" aria-labelledby="tab-contributions" style="display:none">
    <div id="dca-empty" style="display:none"><div class="card"><div class="empty-state">
      <div style="font-size:2rem;margin-bottom:.5rem">📅</div>
      <div style="font-weight:500;font-size:14px;color:var(--ink);margin-bottom:.75rem">No transaction data imported</div>
      <button class="btn btn-primary" data-goto="log">Import CSV →</button>
    </div></div></div>
    <div id="dca-content" style="display:none">
      <div class="kpi-row" id="dca-kpis"></div>
      <div class="card card-primary">
        <div class="card-title">Monthly invested: stacked by ETF (savings plan executions)</div>
        <div class="chart-controls">
          <div id="dca-legend" class="legend"></div>
          <div class="range-toggle" id="dca-range-toggle" role="group" aria-label="Contributions range">
            <button class="btn btn-sm btn-ghost" data-range="12">1Y</button>
            <button class="btn btn-sm btn-ghost" data-range="36">3Y</button>
            <button class="btn btn-sm btn-ghost active" data-range="all">All</button>
          </div>
        </div>
        <div class="chart-wrap chart-h-lg"><canvas id="c-dca-bar"></canvas></div>
      </div>
      <div class="two-col">
        <div class="card">
          <div class="card-title">Month-by-month</div>
          <div class="filter-bar">
            <select id="dca-year-filter" class="form-input form-input-sm" aria-label="Filter by year" style="width:auto;display:inline-block">
              <option value="">All years</option>
            </select>
          </div>
          <div class="tbl" role="table" aria-label="Monthly contributions"><div id="dca-table"></div></div>
          <div id="dca-pagination" class="pagination"></div>
        </div>
        <div id="dca-proj-card"></div>
      </div>
    </div>
  </div>
  <div class="subview" id="subview-dividends" role="tabpanel" aria-labelledby="tab-dividends" style="display:none">
    <div id="div-empty" style="display:none"><div class="card"><div class="empty-state">
      <div style="font-size:2rem;margin-bottom:.5rem">💰</div>
      <div style="font-weight:500;font-size:14px;color:var(--ink);margin-bottom:.75rem">No transaction data imported</div>
      <button class="btn btn-primary" data-goto="log">Import CSV →</button>
    </div></div></div>
    <div id="div-content" style="display:none">
      <div class="kpi-row" id="div-kpis"></div>
      <div class="card">
        <div class="card-title">Dividend payments received (most recent first)</div>
        <div class="filter-bar">
          <select id="div-year-filter" class="form-input form-input-sm" aria-label="Filter by year" style="width:auto;display:inline-block">
            <option value="">All years</option>
          </select>
        </div>
        <div class="tbl" role="table" aria-label="Dividend history"><div id="div-history"></div></div>
        <div id="div-pagination" class="pagination"></div>
      </div>
      <div class="card">
        <div class="card-title">Cash / savings interest received</div>
        <div class="filter-bar">
          <select id="int-year-filter" class="form-input form-input-sm" aria-label="Filter by year" style="width:auto;display:inline-block">
            <option value="">All years</option>
          </select>
        </div>
        <div id="div-interest"></div>
        <div id="int-pagination" class="pagination"></div>
      </div>
      <div class="card">
        <div class="card-title">By year</div>
        <div id="div-annual"></div>
        <div id="div-annual-pagination" class="pagination"></div>
      </div>
    </div>
  </div>
</div>

<!-- ════ ANALYTICS ════ -->
<div id="analytics" class="section" role="tabpanel" aria-labelledby="tab-analytics">
  <div id="an-empty" style="display:none"><div class="card"><div class="empty-state">
    <div style="font-size:2.4rem;margin-bottom:.75rem">📈</div>
    <div style="font-weight:500;font-size:14px;color:var(--ink);margin-bottom:.4rem">No snapshots yet</div>
    <p style="font-size:13px;margin-bottom:1.25rem;max-width:340px;margin-left:auto;margin-right:auto">Add at least one monthly snapshot to see analytics. Performance and risk metrics appear as your history grows.</p>
    <button class="btn btn-primary" data-goto="log">Add first snapshot →</button>
  </div></div></div>
  <div id="an-content" style="display:none">

    <!-- Level 1: Performance Summary (always visible) -->
    <div class="kpi-row" id="an-kpis-l1"></div>
    <div class="section-label" id="an-perf-detail-heading" style="display:none;padding:.4rem 0 .1rem;font-size:11px;color:var(--ink-3);font-weight:500;text-transform:uppercase;letter-spacing:.04em">Performance Detail</div>
    <div class="kpi-row" id="an-kpis-l2" style="margin-top:0"></div>

    <div class="card card-primary">
      <div class="card-title">Portfolio growth over time</div>
      <div class="chart-controls">
        <div id="an-growth-legend" class="legend"></div>
        <div class="range-toggle" id="an-growth-range-toggle" role="group" aria-label="Growth range">
          <button class="btn btn-sm btn-ghost" data-range="12">1Y</button>
          <button class="btn btn-sm btn-ghost" data-range="36">3Y</button>
          <button class="btn btn-sm btn-ghost active" data-range="all">All</button>
        </div>
      </div>
      <div class="chart-wrap chart-h-lg"><canvas id="c-an-growth"></canvas></div>
    </div>

    <!-- Level 2: Heatmap + Allocation (2+ snapshots) -->
    <div id="an-level2">
      <div class="card">
        <div class="card-title">Growth breakdown: contributed vs market</div>
        <div class="chart-controls">
          <div id="an-contrib-legend" class="legend"></div>
          <div class="range-toggle" id="an-contrib-range-toggle" role="group" aria-label="Contributions vs market range">
            <button class="btn btn-sm btn-ghost" data-range="12">1Y</button>
            <button class="btn btn-sm btn-ghost" data-range="36">3Y</button>
            <button class="btn btn-sm btn-ghost active" data-range="all">All</button>
          </div>
        </div>
        <div class="chart-wrap chart-h-md"><canvas id="c-an-contrib"></canvas></div>
        <p class="note">Market movement is the residual after subtracting contributions from the total change. Use IRR for a money-weighted investment return metric.</p>
      </div>

      <div class="card">
        <div class="card-title">Monthly return heatmap</div>
        <div id="an-heatmap-note" class="note" style="display:none"></div>
        <div id="an-heatmap-pager" style="display:none;align-items:center;gap:8px;margin-bottom:6px;font-size:12px;color:var(--ink-2)">
          <button class="btn btn-sm btn-ghost" id="an-heatmap-prev">&#8249;</button>
          <span id="an-heatmap-page-label" style="min-width:80px;text-align:center"></span>
          <button class="btn btn-sm btn-ghost" id="an-heatmap-next">&#8250;</button>
        </div>
        <div id="an-heatmap-wrap" style="overflow-x:auto">
          <div id="an-heatmap"></div>
        </div>
        <p class="note" id="an-heatmap-footer">Color intensity is weighted by portfolio value: months with more capital show more saturated colors.</p>
      </div>

      <div class="two-col">
        <div class="card">
          <div class="card-title">
            Allocation by asset class
            <span id="an-alloc-class-toggle-wrap" style="margin-left:8px"></span>
          </div>
          <div id="an-alloc-class-legend" class="legend"></div>
          <div class="chart-wrap chart-h-sm"><canvas id="c-an-alloc-class"></canvas></div>
        </div>
        <div class="card">
          <div class="card-title">
            Allocation by account
            <span id="an-alloc-acct-toggle-wrap" style="margin-left:8px"></span>
          </div>
          <div id="an-alloc-acct-legend" class="legend"></div>
          <div class="chart-wrap chart-h-sm"><canvas id="c-an-alloc-acct"></canvas></div>
        </div>
      </div>

      <div class="two-col">
        <div class="card">
          <div class="card-title">
            Allocation by region
            <span id="an-alloc-region-toggle-wrap" style="margin-left:8px"></span>
          </div>
          <div id="an-alloc-region-legend" class="legend"></div>
          <div class="chart-wrap chart-h-sm"><canvas id="c-an-alloc-region"></canvas></div>
        </div>
        <div class="card" id="an-alloc-sector-card">
          <div class="card-title">
            Allocation by sector
            <span id="an-alloc-sector-toggle-wrap" style="margin-left:8px"></span>
          </div>
          <div id="an-alloc-sector-legend" class="legend"></div>
          <div class="chart-wrap chart-h-sm"><canvas id="c-an-alloc-sector"></canvas></div>
        </div>
      </div>

      <div class="two-col">
        <div class="card" id="an-alloc-currency-card">
          <div class="card-title">
            Allocation by currency
            <span id="an-alloc-currency-toggle-wrap" style="margin-left:8px"></span>
          </div>
          <div id="an-alloc-currency-legend" class="legend"></div>
          <div class="chart-wrap chart-h-sm"><canvas id="c-an-alloc-currency"></canvas></div>
        </div>
      </div>
    </div>

    <!-- Level 3: Advanced Analytics (collapsible) -->
    <details id="an-advanced" class="card" style="margin-top:1rem">
      <summary style="cursor:pointer;font-weight:500;font-size:14px;padding:.25rem 0;list-style:none;display:flex;align-items:center;gap:6px">
        <span id="an-advanced-arrow" style="font-size:10px;transition:transform .15s">▶</span>
        Advanced Analytics
        <span id="an-advanced-gate" style="font-size:11px;color:var(--ink-3);font-weight:400;margin-left:4px"></span>
      </summary>
      <div id="an-advanced-content" style="padding-top:.75rem">
        <div class="kpi-row" id="an-kpis-risk"></div>

        <div class="card" id="an-drawdown-card" style="margin:0 0 1rem">
          <div class="card-title">Drawdown history</div>
          <div class="chart-wrap chart-h-md"><canvas id="c-an-drawdown"></canvas></div>
        </div>

        <div class="card" id="an-rolling-cagr-card" style="margin:0 0 1rem">
          <div class="card-title">Rolling 3-year CAGR</div>
          <div id="an-rolling-cagr-note" class="note" style="display:none"></div>
          <div class="chart-wrap chart-h-md"><canvas id="c-an-rolling-cagr"></canvas></div>
        </div>

        <div id="an-income" style="display:none">
          <div class="section-label" style="padding:.4rem 0 .1rem;font-size:11px;color:var(--ink-3);font-weight:500;text-transform:uppercase;letter-spacing:.04em">Income (dividends and interest)</div>
          <div class="kpi-row" id="an-kpis-income"></div>
          <div class="card" style="margin:0 0 1rem">
            <div class="card-title">
              Income by month (dividends and interest)
            </div>
            <div class="chart-controls" style="margin-bottom:4px">
              <div class="range-toggle" id="an-income-range-toggle" role="group" aria-label="Income range">
                <button class="btn btn-sm btn-ghost active" data-range="12">1Y</button>
                <button class="btn btn-sm btn-ghost" data-range="36">3Y</button>
                <button class="btn btn-sm btn-ghost" data-range="all">All</button>
              </div>
            </div>
            <div class="chart-wrap chart-h-md"><canvas id="c-an-income"></canvas></div>
          </div>
        </div>
      </div>
    </details>

  </div>
</div>

<!-- ════ SETTINGS ════ -->
<div id="settings" class="section" role="tabpanel" aria-labelledby="tab-settings">
  <div id="settings-content"></div>
</div>

<!-- ════ LOG ════ -->
<div id="log" class="section" role="tabpanel" aria-labelledby="tab-log">
  <div id="auth-prompt" class="card" style="display:none">
    <div class="empty-state">
      <div style="font-size:2rem;margin-bottom:.75rem">🔐</div>
      <div style="font-weight:500;font-size:14px;color:var(--ink);margin-bottom:.5rem">Sign in to sync data</div>
      <p style="font-size:13px;margin-bottom:1.25rem;color:var(--ink-2)">Your data is stored securely in your Google Drive. Sign in once and it syncs across all devices.</p>
      <button id="btn-signin" class="btn btn-primary">Sign in with Google</button>
    </div>
  </div>

  <div id="log-content">
    <div class="card" id="csv-import-card">
      <div class="card-title">Import transactions</div>
      <p class="note" style="margin-bottom:.85rem">Import your transaction export CSV. Drag your file here or click to browse. Parsed locally; data synced to your Google Drive. Re-import anytime; duplicates handled automatically.</p>
      <div class="drop-zone" id="drop-zone">
        <input type="file" id="csv-file-input" accept=".csv" aria-label="Choose CSV file to import">
        <div style="font-size:2rem;margin-bottom:.4rem" aria-hidden="true">📥</div>
        <div style="font-weight:500;font-size:13px;color:var(--ink-2);margin-bottom:.2rem">Drop CSV file here</div>
        <div style="font-size:11px;color:var(--ink-3)">or click to browse</div>
      </div>
      <div id="import-msg" style="font-size:12px;margin-top:.6rem;min-height:18px"></div>
      <div id="import-preview" style="display:none"></div>
      <div id="import-status" class="status-bar status-empty" style="margin-top:1rem">No CSV imported yet</div>
    </div>

    <div class="card" id="balance-card">
      <div class="card-title">Monthly update</div>
      <p class="note" style="margin-bottom:.85rem">Enter total account balances once a month (~2 min). Same month overwrites the previous entry.</p>
      <div class="form-grid">
        <div class="form-group">
          <label class="form-label">Month</label>
          <input type="month" id="snap-date" class="form-input">
        </div>
        <div class="form-group">
          <label class="form-label">Notes (optional)</label>
          <input type="text" id="snap-notes" class="form-input form-input-compact" placeholder="e.g. catch-up done, got raise...">
        </div>
        <div id="snap-acct-fields"></div>
      </div>

      <div style="display:flex;align-items:center;gap:14px;margin-top:.85rem">
        <button class="btn btn-primary" id="btn-save-snap">Save monthly update</button>
        <span id="snap-msg" style="font-size:12px;min-height:18px"></span>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Snapshot history</div>
      <div class="filter-bar" id="snap-filter-bar">
        <select id="snap-year-filter" class="form-input form-input-sm" aria-label="Filter by year" style="width:auto;display:inline-block">
          <option value="">All years</option>
        </select>
        <input type="text" id="snap-search" class="form-input form-input-sm" aria-label="Search snapshots by notes" placeholder="Search notes…" style="width:140px;display:inline-block;margin-left:6px">
      </div>
      <div id="snaps-list" role="table" aria-label="Snapshot history"></div>
      <div id="snap-pagination" class="pagination"></div>
    </div>
  </div>
</div>
`;
}

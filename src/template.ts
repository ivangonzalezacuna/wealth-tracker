import { CONFIG } from './config';

function metricExplainerCard(
  icon: string,
  title: string,
  description: string,
  interpretation: string,
  adviceLabel: string,
  advice: string,
): string {
  const p = (style: string, html: string) =>
    `<p style="font-size:12px;color:var(--ink-2);${style}">${html}</p>`;
  return `<div class="card" style="padding:.75rem 1rem;margin:0">
              <div style="font-size:12px;font-weight:600;margin-bottom:.25rem">${icon} ${title}</div>
              ${p('margin:0 0 .25rem', description)}
              ${p('margin:0 0 .25rem', `<strong>How to read it:</strong> ${interpretation}`)}
              ${p('margin:0', `<strong>${adviceLabel}:</strong> ${advice}`)}
            </div>`;
}

export function appTemplate(): string {
  return `
<header>
  <h1>${CONFIG.app.title}</h1>
  <div class="sub" id="app-sub">${CONFIG.app.subtitle}</div>
  <button id="btn-theme-toggle" class="btn-theme-toggle" aria-label="Switch theme: currently Light" title="Theme: Light (click to cycle Light → Dark → System)"><svg class="theme-toggle-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="3.1" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 1.4v2M8 12.6v2M1.4 8h2M12.6 8h2M3.34 3.34l1.42 1.42M11.24 11.24l1.42 1.42M12.66 3.34l-1.42 1.42M4.76 11.24l-1.42 1.42" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg></button>
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
  <button id="tab-log" class="log-btn" data-section="log" role="tab" aria-selected="false" aria-controls="log" aria-label="Log data (add snapshot or import CSV)">Log data</button>
</nav>

<div id="setup-banner" style="display:none"></div>

<!-- ════ NET WORTH ════ -->
<div id="networth" class="section active" role="tabpanel" aria-labelledby="tab-networth">
  <div id="nw-empty" style="display:none"><div class="card"><div class="empty-state">
    <div class="empty-icon">📊</div>
    <div class="empty-title">No snapshots yet</div>
    <p style="font-size:13px;margin-bottom:1.25rem;max-width:340px;margin-left:auto;margin-right:auto">Log your first monthly entry to start tracking net worth across all accounts. Takes ~2 minutes per month.</p>
    <button class="btn btn-primary" data-goto="log">Add first snapshot →</button>
  </div></div></div>
  <div id="nw-content" style="display:none">
    <div class="kpi-row" id="nw-kpis"></div>
    <div class="card card-primary">
      <div class="card-title" id="nw-chart-title">Net worth: stacked by account</div>
      <div class="chart-wrap chart-h-lg chart-zoomable"><div id="c-nw-hist" class="chart-host" role="img" aria-label="Net worth over time chart"></div></div>
    </div>
    <div class="card">
      <div class="card-title" id="nw-detail-title">Accounts</div>
      <div id="nw-detail"></div>
    </div>
    <div id="nw-goal"></div>
    <div id="nw-planning"></div>
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
      <div class="empty-icon">📂</div>
      <div class="empty-title">No transaction data imported</div>
      <p style="font-size:13px;margin-bottom:1rem">Import your transaction export CSV to see exact cost basis, shares, and dividends.</p>
      <button class="btn btn-primary" data-goto="log">Import CSV →</button>
    </div></div></div>
    <div id="port-content" style="display:none">
      <div class="kpi-row kpi-row-groups" id="port-kpis"></div>
      <div class="card">
        <div class="card-title">Holdings</div>
        <div class="tbl" role="table" aria-label="Holdings"><div id="port-table"></div></div>
        <div id="port-pagination" class="pagination"></div>
      </div>
      <div class="two-col">
        <div class="card">
          <div class="card-title">Cost basis allocation</div>
          <div class="chart-wrap chart-h-sm chart-h-fit"><div id="c-port-donut" class="chart-host" role="img" aria-label="Cost basis allocation chart"></div></div>
        </div>
        <div class="card">
          <div class="card-title">Value and returns</div>
          <div id="port-summary"></div>
        </div>
      </div>
      <div id="port-drift"></div>
    </div>
  </div>
  <div class="subview" id="subview-contributions" role="tabpanel" aria-labelledby="tab-contributions" style="display:none">
    <div id="dca-empty" style="display:none"><div class="card"><div class="empty-state">
      <div class="empty-icon">📅</div>
      <div class="empty-title">No transaction data imported</div>
      <button class="btn btn-primary" data-goto="log">Import CSV →</button>
    </div></div></div>
    <div id="dca-content" style="display:none">
      <div class="kpi-row" id="dca-kpis"></div>
      <div class="card card-primary">
        <div class="card-title">Monthly purchases by ETF (savings plan executions)</div>
        <div class="chart-wrap chart-h-lg"><div id="c-dca-bar" class="chart-host" role="img" aria-label="Monthly contributions bar chart"></div></div>
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
      <div class="empty-icon">💰</div>
      <div class="empty-title" id="div-empty-title">No transaction data imported</div>
      <p id="div-empty-body" style="font-size:13px;margin-bottom:1rem;max-width:360px;margin-left:auto;margin-right:auto">Import your broker CSV to unlock dividend and interest tracking.</p>
      <button class="btn btn-primary" data-goto="log">Import CSV →</button>
    </div></div></div>
    <div id="div-content" style="display:none">
      <div class="kpi-row kpi-row-groups" id="div-kpis"></div>
      <div class="card">
        <div class="card-title">Dividend payments received (most recent first)</div>
        <div class="filter-bar" id="div-year-filter-bar">
          <select id="div-year-filter" class="form-input form-input-sm" aria-label="Filter by year" style="width:auto;display:inline-block">
            <option value="">All years</option>
          </select>
        </div>
        <div class="tbl" role="table" aria-label="Dividend history"><div id="div-history"></div></div>
        <div id="div-pagination" class="pagination"></div>
      </div>
      <div class="card">
        <div class="card-title">Cash / savings interest received</div>
        <div class="filter-bar" id="int-year-filter-bar">
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
    <div class="empty-icon">📈</div>
    <div class="empty-title">No snapshots yet</div>
    <p style="font-size:13px;margin-bottom:1.25rem;max-width:340px;margin-left:auto;margin-right:auto">Add at least one monthly snapshot to see analytics. Balance-growth cards unlock first; investment risk metrics need 24 consecutive monthly investment periods plus deposit/withdrawal history.</p>
    <button class="btn btn-primary" data-goto="log">Add first snapshot →</button>
  </div></div></div>
  <div id="an-content" style="display:none">

    <div class="kpi-row kpi-row-groups" id="an-kpis-l1"></div>
    <p class="note analytics-scope-note">TWR is cumulative; IRR is annualized and money-weighted. Not directly comparable. Complete investment balances and external cash flows matter.</p>
    <details id="an-balance-details" class="inline-details analytics-balance-details">
      <summary>Net worth growth details</summary>
      <p class="note">Balance changes include money added or withdrawn. They are not cash-flow-adjusted investment returns.</p>
      <div id="an-kpis-l2"></div>
    </details>

    <div class="card card-primary">
      <div class="card-title">Net worth over time</div>
      <div class="chart-wrap chart-h-lg chart-zoomable"><div id="c-an-growth" class="chart-host" role="img" aria-label="Portfolio growth chart"></div></div>
    </div>

    <!-- Level 2: Heatmap + Allocation (2+ snapshots) -->
    <div id="an-level2">
      <div class="card">
        <div class="card-title">Investment balance breakdown: external flows vs market</div>
        <div class="chart-wrap chart-h-md chart-zoomable"><div id="c-an-contrib" class="chart-host" role="img" aria-label="Investment balance breakdown chart"></div></div>
        <p class="note">Investment value change = recorded external flows + market movement (the residual). This is not net worth growth.</p>
      </div>

      <div class="card">
        <div class="card-title">Monthly investment return heatmap</div>
        <div id="an-heatmap-note" class="note" style="display:none"></div>
        <div id="an-heatmap-pager" style="display:none;align-items:center;gap:8px;margin-bottom:6px;font-size:12px;color:var(--ink-2)">
          <button class="btn btn-sm btn-ghost" id="an-heatmap-prev" aria-label="Older heatmap years">&#8249;</button>
          <span id="an-heatmap-page-label" style="min-width:80px;text-align:center"></span>
          <button class="btn btn-sm btn-ghost" id="an-heatmap-next" aria-label="Newer heatmap years">&#8250;</button>
        </div>
        <div id="an-heatmap"></div>
        <div class="chart-wrap" id="c-an-heatmap-wrap" style="display:none"><div id="c-an-heatmap" class="chart-host" role="img" aria-label="Monthly investment return heatmap"></div></div>
        <p class="note" id="an-heatmap-footer">Heatmap colors are descriptive only and should not be used for short-term timing decisions.</p>
        <div class="analytics-subsection" id="an-annual-table-card">
          <div class="card-title">Annual investment returns</div>
          <div id="an-annual-table"></div>
          <p class="note">Years with fewer than 12 months of data are not directly comparable with full years.</p>
        </div>
      </div>

      <div class="card" id="an-allocation-card">
        <div class="card-title">Allocation<span class="info-tip" data-tip="Accounts use the latest snapshot balances, including savings and pensions. Holdings use purchase costs, not market values, so the two totals differ." data-tip-variant="" aria-label="Accounts use the latest snapshot balances, including savings and pensions. Holdings use purchase costs, not market values, so the two totals differ." tabindex="0">?</span></div>
        <div class="analytics-allocation-grid">
          <section class="alloc-panel" aria-labelledby="an-alloc-acct-title">
            <div class="alloc-panel-head">
              <span class="alloc-panel-title" id="an-alloc-acct-title">Accounts</span>
              <span class="alloc-panel-sub">Latest snapshot balances</span>
            </div>
            <div id="an-alloc-acct-toggle-wrap" class="chart-controls alloc-controls"></div>
            <p class="note alloc-empty" id="an-alloc-acct-empty" hidden>No account balances in the latest snapshot.</p>
            <div class="chart-wrap chart-h-fit chart-tools"><div id="c-an-alloc-acct" class="chart-host" role="img" aria-label="Allocation by account chart"></div></div>
          </section>
          <section class="alloc-panel" aria-labelledby="an-alloc-hold-title">
            <div class="alloc-panel-head">
              <span class="alloc-panel-title" id="an-alloc-hold-title">Holdings</span>
              <span class="alloc-panel-sub">Purchase costs</span>
            </div>
            <div id="an-alloc-hold-toggle-wrap" class="chart-controls alloc-controls"></div>
            <p class="note alloc-empty" id="an-alloc-hold-empty" hidden>No holding purchases to break down yet.</p>
            <div class="chart-wrap chart-h-fit chart-tools"><div id="c-an-alloc-hold" class="chart-host" role="img" aria-label="Allocation by holding chart"></div></div>
          </section>
        </div>
      </div>
    </div>

    <!-- Level 3: Advanced Analytics (collapsible) -->
    <details id="an-advanced" class="card-collapsible inline-details" style="margin-top:1rem">
      <summary class="section-label">
        Advanced analytics
      </summary>
      <div id="an-advanced-content" style="padding-top:.75rem">
        <div class="card" id="an-risk-metrics-note-card" style="margin:0 0 1rem;display:none">
          <div class="card-title">Investment risk analytics</div>
          <div id="an-risk-metrics-note" class="note"></div>
        </div>
        <div class="kpi-row kpi-row-groups" id="an-kpis-risk"></div>

        <!-- Collapsible plain-language explainer for each advanced metric -->
        <details id="an-metrics-explainer" style="margin:.5rem 0 1rem">
          <summary style="cursor:pointer;list-style:none;display:flex;align-items:center;gap:6px;font-size:12px;color:var(--ink-2);padding:.25rem 0;user-select:none">
            <span class="card-chevron" style="width:14px;height:14px"></span>
            What do these metrics mean?
          </summary>
          <div style="margin-top:.5rem;display:flex;flex-direction:column;gap:.5rem">

            ${metricExplainerCard(
              '📈',
              'Volatility',
              'How bumpy was the ride? Annualized variability of monthly cash-flow-adjusted investment returns.',
              'Higher values mean larger observed swings, up or down.',
              'Limits',
              'There is no universal target. Interpretation depends on the assets and period observed.',
            )}
            ${metricExplainerCard(
              '📉',
              'Max Drawdown',
              'Largest decline from a previous peak in the recorded investment-return series, whether or not it has recovered.',
              'A value of −20% means a 20% decline from that peak.',
              'Limits',
              'Monthly observations can miss larger declines within a month. This is not a forecast of future losses.',
            )}
            ${metricExplainerCard(
              '⚖️',
              'Calmar Ratio',
              'Annualized investment return divided by the size of the largest recorded drawdown.',
              'A value of 1 means the two percentages have equal magnitude.',
              'Limits',
              'Unavailable when no drawdown was recorded. Comparisons depend strongly on the period observed.',
            )}
            ${metricExplainerCard(
              '📊',
              'Sharpe Ratio',
              'Annualized investment return minus the configured risk-free rate, divided by annualized volatility.',
              'A negative value means return was below that configured rate.',
              'Limits',
              'This does not establish how a particular savings account performed. The risk-free rate is configurable in Settings.',
            )}
            ${metricExplainerCard(
              '🎯',
              'Sortino Ratio',
              'Annualized investment return minus the configured risk-free rate, divided by downside deviation from negative monthly returns.',
              'Unlike Sharpe, it uses downside variability rather than all variability.',
              'Limits',
              'A higher Sortino than Sharpe does not prove gains exceeded losses. Unavailable when downside deviation is zero.',
            )}
            ${metricExplainerCard(
              '〰️',
              'Avg Drawdown',
              'Average decline below the previous peak across months that were below that peak.',
              'Months at the peak are excluded; this is not the single largest decline.',
              'Limits',
              'A dash can mean no underwater months were recorded. Contributions do not directly repair this cash-flow-adjusted measure.',
            )}
            ${metricExplainerCard(
              '⏱️',
              'DD Duration',
              'Longest recorded run of consecutive months below the previous investment-performance peak.',
              'The run may still be ongoing.',
              'Limits',
              'Past recovery times do not predict future recovery. Contributions do not directly shorten this cash-flow-adjusted measure.',
            )}

          </div>
        </details>

        <div class="card" id="an-drawdown-card" style="margin:0 0 1rem">
          <div class="card-title">Investment drawdown history</div>
          <div class="chart-wrap chart-h-md chart-zoomable"><div id="c-an-drawdown" class="chart-host" role="img" aria-label="Portfolio drawdown chart"></div></div>
        </div>

        <div class="card" id="an-rolling-cagr-card" style="margin:0 0 1rem">
          <div class="card-title">Rolling 3-year investment CAGR</div>
          <div id="an-rolling-cagr-note" class="note" style="display:none"></div>
          <div class="chart-wrap chart-h-md chart-zoomable"><div id="c-an-rolling-cagr" class="chart-host" role="img" aria-label="Rolling CAGR chart"></div></div>
        </div>

        <div id="an-income" style="display:none">
          <div class="section-label">Income (dividends and interest)</div>
          <div id="an-kpis-income" style="margin-top:8px"></div>
          <p class="note analytics-scope-note">Income totals sum the magnitudes of recorded dividend and interest amounts. Separate tax rows and withholding fields are not deducted here. Gross/net treatment depends on imported amounts; this is not guaranteed after-tax income. The 12-month window ends in the latest imported transaction month.</p>
          <div class="card" style="margin:0 0 1rem">
            <div class="card-title">
              Income by month (dividends and interest)
            </div>
            <div class="chart-wrap chart-h-md chart-zoomable"><div id="c-an-income" class="chart-host" role="img" aria-label="Income history chart"></div></div>
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
      <div class="empty-icon">🔐</div>
      <div class="empty-title">Sign in to sync data</div>
      <p style="font-size:13px;margin-bottom:1.25rem;color:var(--ink-2)">Your data is stored securely in your Google Drive. Sign in once and it syncs across all devices.</p>
      <button id="btn-signin" class="btn btn-primary">Sign in with Google</button>
    </div>
  </div>

  <div id="log-content">
    <div class="log-toolbar" id="log-toolbar">
      <div class="subnav range-toggle" id="log-subnav" role="tablist" aria-label="Log data views">
        <button id="log-tab-transactions" class="btn btn-sm btn-ghost active" data-logview="transactions" role="tab" aria-selected="true" aria-controls="csv-import-card">Transactions <span class="log-tab-count" id="log-count-transactions"></span></button>
        <button id="log-tab-snapshots" class="btn btn-sm btn-ghost" data-logview="snapshots" role="tab" aria-selected="false" aria-controls="balance-card">Snapshots <span class="log-tab-count" id="log-count-snapshots"></span></button>
      </div>
      <div class="log-toolbar-actions" id="snap-add-row">
        <span id="snap-msg" class="log-inline-msg" role="status" aria-live="polite"></span>
        <button class="btn btn-primary btn-sm" id="btn-add-snap" title="Log month-end balances. Saving the same month overwrites the previous entry.">Add monthly snapshot</button>
      </div>
    </div>

    <div class="card log-panel" id="csv-import-card" role="tabpanel" aria-labelledby="log-tab-transactions">
      <div class="log-panel-head">
        <div class="card-title">Transaction ledger</div>
        <button type="button" class="btn btn-ghost btn-sm log-import-toggle" id="btn-toggle-import" aria-expanded="false" aria-controls="csv-import-panel"><span class="row-expand-chevron" aria-hidden="true">&#x25B8;</span> Import CSV</button>
      </div>
      <div id="import-status" class="status-bar status-empty">No CSV imported yet</div>
      <div id="csv-import-panel" class="log-import-panel" hidden>
        <p class="note" style="margin-bottom:.6rem">Import your transaction export CSV. Parsed locally; data synced to your Google Drive. Re-import anytime; duplicates handled automatically.</p>
        <div class="drop-zone" id="drop-zone">
          <input type="file" id="csv-file-input" accept=".csv" aria-label="Choose CSV file to import">
          <div class="drop-zone-icon" aria-hidden="true">📥</div>
          <div id="csv-import-label" style="font-weight:500;font-size:13px;color:var(--ink-2);margin-bottom:.2rem">Drop CSV file here</div>
          <div id="csv-import-hint" style="font-size:11px;color:var(--ink-3)">or click to browse</div>
        </div>
      </div>
      <div id="import-msg" class="log-inline-msg" role="status" aria-live="polite"></div>
      <div id="import-preview" style="display:none"></div>

      <div id="tx-ledger-card" class="log-panel-body">
        <div class="filter-bar log-filter-bar" id="tx-filter-bar">
          <span class="filter-search"><input type="search" id="tx-search" class="form-input form-input-sm" aria-label="Search transactions" placeholder="Name, ISIN, source…" autocomplete="off"><button type="button" class="filter-clear" data-clear-search aria-label="Clear search">&times;</button></span>
          <div class="filter-bar-actions">
            <button class="btn btn-outline btn-sm" id="btn-start-del-txs" aria-pressed="false">Select</button>
            <button class="btn btn-outline btn-sm" id="btn-add-tx">Add transaction</button>
          </div>
          <div id="tx-type-filter" class="range-toggle filter-chips filter-chips-scroll" role="group" aria-label="Filter transactions by type"></div>
          <div class="bulk-actions" id="tx-bulk-actions" hidden>
            <button class="btn btn-ghost btn-sm" id="btn-tx-select-all">Select all</button>
            <button class="btn btn-ghost btn-sm" id="btn-tx-clear-all">Deselect all</button>
            <button class="btn btn-danger btn-sm" id="btn-del-txs" disabled>Delete</button>
          </div>
        </div>
        <div class="filter-status" id="tx-filter-status" role="status" hidden></div>
        <div class="tbl">
          <div id="tx-ledger-wrap"><div id="tx-ledger-list" class="tx-ledger-grid" role="table" aria-label="Transaction ledger"></div></div>
        </div>
        <div id="tx-pagination" class="pagination"></div>
        <div id="tx-msg" class="log-inline-msg" role="status" aria-live="polite"></div>
      </div>
    </div>

    <div class="card log-panel" id="balance-card" role="tabpanel" aria-labelledby="log-tab-snapshots" hidden>
      <div class="log-panel-head">
        <div class="card-title">Snapshot history</div>
        <span class="log-panel-meta" id="snap-latest-meta"></span>
      </div>
      <div class="log-panel-body">
        <div class="filter-bar log-filter-bar" id="snap-filter-bar">
          <select id="snap-year-filter" class="form-input form-input-sm filter-select" aria-label="Filter by year">
            <option value="">All years</option>
          </select>
          <span class="filter-search"><input type="search" id="snap-search" class="form-input form-input-sm" aria-label="Search snapshots by notes" placeholder="Notes or month…" autocomplete="off"><button type="button" class="filter-clear" data-clear-search aria-label="Clear search">&times;</button></span>
          <div class="filter-bar-actions">
            <button class="btn btn-outline btn-sm" id="btn-start-del-snaps" aria-pressed="false">Select</button>
          </div>
          <div class="bulk-actions" id="snap-bulk-actions" hidden>
            <button class="btn btn-ghost btn-sm" id="btn-snap-select-all">Select all</button>
            <button class="btn btn-ghost btn-sm" id="btn-snap-clear-all">Deselect all</button>
            <button class="btn btn-danger btn-sm" id="btn-del-snaps" disabled>Delete</button>
          </div>
        </div>
        <div class="filter-status" id="snap-filter-status" role="status" hidden></div>
        <div class="legend snap-legend" id="snap-legend" aria-label="Account colours"></div>
        <div id="snaps-list" role="table" aria-label="Snapshot history"></div>
        <div id="snap-pagination" class="pagination"></div>
      </div>
    </div>
  </div>
</div>
`;
}

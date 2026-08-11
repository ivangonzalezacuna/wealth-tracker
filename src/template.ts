import { CONFIG } from './config';

function rangeToggleHtml(
  id: string,
  ariaLabel: string,
  activeRange: '12' | '36' | 'all' = 'all',
): string {
  const btn = (range: '12' | '36' | 'all', label: string) =>
    `<button class="btn btn-sm btn-ghost${range === activeRange ? ' active' : ''}" data-range="${range}">${label}</button>`;
  return `<div class="range-toggle" id="${id}" role="group" aria-label="${ariaLabel}">${btn('12', '1Y')}${btn('36', '3Y')}${btn('all', 'All')}</div>`;
}

function metricExplainerCard(
  icon: string,
  title: string,
  description: string,
  benchmark: string,
  adviceLabel: string,
  advice: string,
): string {
  const p = (style: string, html: string) =>
    `<p style="font-size:12px;color:var(--ink-2);${style}">${html}</p>`;
  return `<div class="card" style="padding:.75rem 1rem;margin:0">
              <div style="font-size:12px;font-weight:600;margin-bottom:.25rem">${icon} ${title}</div>
              ${p('margin:0 0 .25rem', description)}
              ${p('margin:0 0 .25rem', `<strong>Good to aim for:</strong> ${benchmark}`)}
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
  <button id="tab-log" class="log-btn" data-section="log" role="tab" aria-selected="false" aria-controls="log" aria-label="Update (add snapshot or import CSV)">＋ Update</button>
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
      <div class="chart-controls">
        <div id="nw-chart-legend" class="legend"></div>
        ${rangeToggleHtml('nw-range-toggle', 'History range')}
      </div>
      <div class="chart-wrap chart-h-lg"><canvas id="c-nw-hist"></canvas></div>
      <div class="chart-data-table-wrap" id="c-nw-hist-table-wrap" hidden></div>
    </div>
    <div class="card">
      <div class="card-title">Latest snapshot</div>
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
        <div class="card-title">Monthly invested: stacked by ETF (savings plan executions)</div>
        <div class="chart-controls">
          <div id="dca-legend" class="legend"></div>
          ${rangeToggleHtml('dca-range-toggle', 'Contributions range')}
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
      <div class="empty-icon">💰</div>
      <div class="empty-title">No transaction data imported</div>
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
    <div class="empty-icon">📈</div>
    <div class="empty-title">No snapshots yet</div>
    <p style="font-size:13px;margin-bottom:1.25rem;max-width:340px;margin-left:auto;margin-right:auto">Add at least one monthly snapshot to see analytics. Income metrics update from imported data, and risk metrics unlock after 24 months of snapshot history.</p>
    <button class="btn btn-primary" data-goto="log">Add first snapshot →</button>
  </div></div></div>
  <div id="an-content" style="display:none">

    <!-- Level 1: Performance Summary (always visible) -->
    <div class="kpi-row" id="an-kpis-l1"></div>
    <div class="section-label" id="an-perf-detail-heading" style="display:none">Performance Detail</div>
    <div class="kpi-row" id="an-kpis-l2" style="margin-top:8px"></div>

    <div class="card card-primary">
      <div class="card-title">Portfolio growth over time</div>
      <div class="chart-controls">
        <div id="an-growth-legend" class="legend"></div>
        ${rangeToggleHtml('an-growth-range-toggle', 'Growth range')}
      </div>
      <div class="chart-wrap chart-h-lg"><canvas id="c-an-growth"></canvas></div>
      <div class="chart-data-table-wrap" id="c-an-growth-table-wrap" hidden></div>
    </div>

    <!-- Level 2: Heatmap + Allocation (2+ snapshots) -->
    <div id="an-level2">
      <div class="card">
        <div class="card-title">Growth breakdown: contributed vs market</div>
        <div class="chart-controls">
          <div id="an-contrib-legend" class="legend"></div>
          ${rangeToggleHtml('an-contrib-range-toggle', 'Contributions vs market range')}
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

      <div class="card" id="an-annual-table-card">
        <div class="card-title">Annual returns</div>
        <div id="an-annual-table"></div>
      </div>

      <div class="two-col">
        <div class="card">
          <div class="card-title">Allocation by account</div>
          <div id="an-alloc-acct-legend" class="legend"></div>
          <div class="chart-wrap chart-h-sm"><canvas id="c-an-alloc-acct"></canvas></div>
        </div>
        <div class="card">
          <div class="card-title">Allocation by asset class</div>
          <div id="an-alloc-class-toggle-wrap" class="chart-controls"></div>
          <div id="an-alloc-class-legend" class="legend"></div>
          <div class="chart-wrap chart-h-sm"><canvas id="c-an-alloc-class"></canvas></div>
        </div>
      </div>

      <div class="two-col">
        <div class="card">
          <div class="card-title">Allocation by region</div>
          <div id="an-alloc-region-toggle-wrap" class="chart-controls"></div>
          <div id="an-alloc-region-legend" class="legend"></div>
          <div class="chart-wrap chart-h-sm"><canvas id="c-an-alloc-region"></canvas></div>
        </div>
      </div>
    </div>

    <!-- Level 3: Advanced Analytics (collapsible) -->
    <details id="an-advanced" class="card-collapsible" style="margin-top:1rem">
      <summary class="section-label">
        <span class="card-chevron" id="an-advanced-arrow"></span>
        Advanced analytics
      </summary>
      <div id="an-advanced-content" style="padding-top:.75rem">
        <div class="card" id="an-risk-metrics-note-card" style="margin:0 0 1rem;display:none">
          <div class="card-title">Risk analytics</div>
          <div id="an-risk-metrics-note" class="note"></div>
        </div>
        <div class="kpi-row" id="an-kpis-risk"></div>

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
              'How bumpy is the ride? Volatility measures how much your portfolio value fluctuates month to month. A higher number means larger swings - both up and down.',
              'Below 10% is relatively calm for a long-term portfolio; 15-20% is typical for a global equity fund.',
              'How to reduce it',
              'Diversify across uncorrelated asset classes (e.g., bonds alongside equities) or add more stable assets like cash.',
            )}
            ${metricExplainerCard(
              '📉',
              'Max Drawdown',
              'The biggest drop your portfolio has ever taken from a peak before recovering. A max drawdown of −20% means your portfolio fell 20% at its worst moment.',
              'A well-diversified portfolio typically sees max drawdowns of −10% to −30%; less than −10% is very resilient.',
              'How to reduce it',
              'Add defensive assets (bonds, cash, gold) or diversify across regions so that different parts of your portfolio fall at different times.',
            )}
            ${metricExplainerCard(
              '⚖️',
              'Calmar Ratio',
              'How much annual growth (CAGR) do you get for every unit of maximum loss you have endured? A Calmar of 1.0 means your annual return equals your worst drawdown; higher is better.',
              'Above 0.5 is decent; above 1.0 is good; above 2.0 is excellent.',
              'How to improve it',
              'Growing your CAGR (longer investment horizon, higher-return assets) or reducing your worst drawdown both raise this ratio.',
            )}
            ${metricExplainerCard(
              '📊',
              'Sharpe Ratio',
              'Are you being rewarded enough for the risk you are taking? Sharpe compares your return above the risk-free rate (e.g., a savings account) to the total ups and downs in your portfolio.',
              'Above 1.0 is considered good; above 2.0 is excellent. Below 0 means you&#39;d have been better off in a savings account.',
              'How to improve it',
              'Either raise your returns (diversified growth assets, lower fees) or reduce volatility. The risk-free rate is configurable in Settings.',
            )}
            ${metricExplainerCard(
              '🎯',
              'Sortino Ratio',
              'Like the Sharpe ratio, but it only penalises downward swings; good months don&#39;t count against you. A Sortino higher than your Sharpe means your losses are smaller than your gains, which is ideal.',
              'Above 1.0 is solid; above 2.0 is excellent. A Sortino well above your Sharpe indicates your portfolio has more upside than downside volatility.',
              'How to improve it',
              'Focus on reducing losing months, for example by adding assets that are less correlated to your main equity holdings.',
            )}
            ${metricExplainerCard(
              '〰️',
              'Avg Drawdown',
              'The average depth below a previous peak, taken across all months where the portfolio was underwater. It gives a better sense of the typical pain level than the one worst moment (max drawdown).',
              'As close to 0% as possible. For a long-term equity portfolio, −3% to −8% average is common.',
              'How to reduce it',
              'Consistent contributions during downturns (cost-averaging) and a diversified portfolio that recovers faster both help shrink the average drawdown.',
            )}
            ${metricExplainerCard(
              '⏱️',
              'DD Duration',
              'The longest consecutive streak of months where your portfolio was below its previous high-water mark. Shorter is better: it means your portfolio recovered quickly after downturns.',
              'Under 12 months is resilient; 12-24 months is normal for a global equity portfolio; above 36 months warrants a review of your asset mix.',
              'How to reduce it',
              'Diversify across asset classes that don&#39;t fall simultaneously, and keep contributing regularly so that new purchases at lower prices speed up the recovery.',
            )}

          </div>
        </details>

        <div class="card" id="an-drawdown-card" style="margin:0 0 1rem">
          <div class="card-title">Drawdown history</div>
          <div class="chart-wrap chart-h-md"><canvas id="c-an-drawdown"></canvas></div>
          <div class="chart-data-table-wrap" id="c-an-drawdown-table-wrap" hidden></div>
        </div>

        <div class="card" id="an-rolling-cagr-card" style="margin:0 0 1rem">
          <div class="card-title">Rolling 3-year CAGR</div>
          <div id="an-rolling-cagr-note" class="note" style="display:none"></div>
          <div class="chart-wrap chart-h-md"><canvas id="c-an-rolling-cagr"></canvas></div>
        </div>

        <div id="an-income" style="display:none">
          <div class="section-label">Income (dividends and interest)</div>
          <div class="kpi-row" id="an-kpis-income" style="margin-top:8px"></div>
          <div class="card" style="margin:0 0 1rem">
            <div class="card-title">
              Income by month (dividends and interest)
            </div>
            <div class="chart-controls" style="margin-bottom:4px">
              ${rangeToggleHtml('an-income-range-toggle', 'Income range', '12')}
            </div>
            <div class="chart-wrap chart-h-md"><canvas id="c-an-income"></canvas></div>
            <div class="chart-data-table-wrap" id="c-an-income-table-wrap" hidden></div>
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
    <div class="card" id="csv-import-card">
      <div class="card-title">Transactions</div>

      <div class="card-section-title" style="margin-top:.75rem">Import</div>
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

      <div class="card-section" id="tx-ledger-card">
        <div class="card-section-title">Ledger</div>
        <p class="note" style="margin-bottom:.85rem">Review, audit, and correct imported transactions.</p>
        <div class="filter-bar" id="tx-filter-bar">
          <select id="tx-type-filter" class="form-input form-input-sm" aria-label="Filter transactions by type" style="flex-shrink:0">
            <option value="">All types</option>
          </select>
          <input type="text" id="tx-search" class="form-input form-input-sm" aria-label="Search transactions" placeholder="Search name, ISIN, source…" style="flex:1;min-width:80px">
          <button class="btn btn-outline btn-sm" id="btn-add-tx" style="margin-left:auto">Add transaction</button>
        </div>
        <div class="tbl">
          <div id="tx-ledger-list" class="tx-ledger-grid" role="table" aria-label="Transaction ledger"></div>
        </div>
        <div id="tx-pagination" class="pagination"></div>
        <div id="tx-msg" style="font-size:12px;min-height:18px;margin-top:.5rem"></div>
      </div>
    </div>

    <div class="card" id="balance-card">
      <div class="card-title">Snapshots</div>

      <div class="card-section-title" style="margin-top:.75rem">Monthly update</div>
      <p class="note" style="margin-bottom:.85rem">Log your latest month-end balances in a modal dialog. Same month overwrites the previous entry.</p>
      <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
        <button class="btn btn-primary" id="btn-add-snap">Add monthly snapshot</button>
        <span id="snap-msg" style="font-size:12px;min-height:18px"></span>
      </div>

      <div class="card-section">
        <div class="card-section-title">History</div>
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
</div>
`;
}

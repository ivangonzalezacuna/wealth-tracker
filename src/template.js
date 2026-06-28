export function appTemplate() {
  return `
<header>
  <h1>Finance Dashboard</h1>
  <div class="sub" id="app-sub">ETF portfolio · N26 savings · Ginkgo bAV · Net worth tracker</div>
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
    <div style="font-weight:500;font-size:14px;color:#0b0b0b;margin-bottom:.4rem">No TR data imported</div>
    <p style="font-size:13px;margin-bottom:1rem">Import your Transaktionsexport CSV to see exact cost basis, shares, and dividends.</p>
    <button class="btn btn-primary" data-goto="log">Import CSV →</button>
  </div></div></div>
  <div id="port-content" style="display:none">
    <div class="kpi-row" id="port-kpis"></div>
    <div class="card">
      <div class="card-title">Holdings — exact positions from CSV</div>
      <div class="tbl"><div id="port-table"></div></div>
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
    <div style="font-weight:500;font-size:14px;color:#0b0b0b;margin-bottom:.75rem">No TR data imported</div>
    <button class="btn btn-primary" data-goto="log">Import CSV →</button>
  </div></div></div>
  <div id="dca-content" style="display:none">
    <div class="kpi-row" id="dca-kpis"></div>
    <div class="card">
      <div class="card-title">Monthly invested — stacked by ETF (savings plan executions)</div>
      <div id="dca-legend" class="legend"></div>
      <div class="chart-wrap" style="height:260px"><canvas id="c-dca-bar"></canvas></div>
    </div>
    <div class="two-col">
      <div class="card">
        <div class="card-title">Month-by-month</div>
        <div class="tbl"><div id="dca-table"></div></div>
      </div>
      <div class="card">
        <div class="card-title">5-year projection (7% return, €200/wk target)</div>
        <div class="chart-wrap" style="height:180px"><canvas id="c-dca-proj"></canvas></div>
        <p class="note">Starting from latest TR portfolio value. Target €200/wk from there. Excludes taxes, fees, FX.</p>
      </div>
    </div>
  </div>
</div>

<!-- ════ DIVIDENDS ════ -->
<div id="dividends" class="section">
  <div id="div-empty" style="display:none"><div class="card"><div class="empty-state">
    <div style="font-size:2rem;margin-bottom:.5rem">💰</div>
    <div style="font-weight:500;font-size:14px;color:#0b0b0b;margin-bottom:.75rem">No TR data imported</div>
    <button class="btn btn-primary" data-goto="log">Import CSV →</button>
  </div></div></div>
  <div id="div-content" style="display:none">
    <div class="kpi-row" id="div-kpis"></div>
    <div class="card">
      <div class="card-title">Dividend payments received (most recent first)</div>
      <div class="tbl"><div id="div-history"></div></div>
    </div>
    <div class="card">
      <div class="card-title">TR savings interest (2.25% on cash balance)</div>
      <div id="div-interest"></div>
    </div>
  </div>
</div>

<!-- ════ REFERENCE ════ -->
<div id="reference" class="section">
  <div class="card">
    <div class="card-title">Target allocation — steady state</div>
    <div class="two-col" style="align-items:start">
      <div>
        <div class="legend" style="margin-bottom:.75rem">
          <span class="leg-item"><span class="leg-sq" style="background:#2a78d6"></span>IWDA 45%</span>
          <span class="leg-item"><span class="leg-sq" style="background:#1baf7a"></span>SUSW 15%</span>
          <span class="leg-item"><span class="leg-sq" style="background:#eda100"></span>EIMI 20%</span>
          <span class="leg-item"><span class="leg-sq" style="background:#4a3aa7"></span>AGGH 20%</span>
        </div>
        <div class="chart-wrap" style="height:155px"><canvas id="c-ref-target"></canvas></div>
      </div>
      <div>
        <div class="row"><div class="row-label">Equity (IWDA + SUSW + EIMI)</div><div class="row-val">80%</div></div>
        <div class="row"><div class="row-label">Bonds (AGGH)</div><div class="row-val">20%</div></div>
        <div class="row"><div class="row-label">Developed equity</div><div class="row-val">60%</div></div>
        <div class="row"><div class="row-label">Emerging equity</div><div class="row-val">20%</div></div>
        <div class="row"><div class="row-label">EM as % of equity</div><div class="row-val">25%</div></div>
        <p class="note">Weekly target: IWDA €90 · SUSW €30 · EIMI €40 · AGGH €40</p>
      </div>
    </div>
  </div>
  <div class="card">
    <div class="card-title">Closed positions — diluting naturally</div>
    <div class="row"><div class="row-label">IEEM → EIMI (both EM)</div><div class="row-val"><span class="badge b-closed">no new money</span></div></div>
    <div class="row"><div class="row-label">IEAC → AGGH (both bonds)</div><div class="row-val"><span class="badge b-closed">no new money</span></div></div>
    <div class="row"><div class="row-label">EIBX → AGGH (both bonds)</div><div class="row-val"><span class="badge b-closed">no new money</span></div></div>
    <p class="note">No action needed — they fade toward &lt;1% as new contributions grow the active positions. Selling may trigger Abgeltungsteuer. Fold in only for a clean 4-fund portfolio.</p>
  </div>
  <div class="card">
    <div class="card-title">Reinvestment rules</div>
    <div class="row"><div class="row-label">Net pay raise → ETFs</div><div class="row-val">50%</div></div>
    <div class="row"><div class="row-label">Net pay raise → bAV top-up (toward SV-frei ceiling)</div><div class="row-val">25%</div></div>
    <div class="row"><div class="row-label">Net pay raise → lifestyle / buffer</div><div class="row-val">25%</div></div>
    <div class="row"><div class="row-label">Rent decrease → ETFs</div><div class="row-val">60–70%</div></div>
    <div class="row"><div class="row-label">bAV SV-frei ceiling (2026)</div><div class="row-val">€338 / month</div></div>
    <div class="row"><div class="row-label">AVD start date</div><div class="row-val">January 2027</div></div>
  </div>
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
      <div class="card-title">Import Trade Republic CSV</div>
      <p class="note" style="margin-bottom:.85rem">In TR app: Settings → Documents → Transaction export. Drag your file here or click to browse. Parsed locally — data synced to your Google Sheet. Re-import anytime; duplicates handled automatically.</p>
      <div class="drop-zone" id="drop-zone">
        <input type="file" id="csv-file-input" accept=".csv">
        <div style="font-size:2rem;margin-bottom:.4rem">📥</div>
        <div style="font-weight:500;font-size:13px;color:#52514e;margin-bottom:.2rem">Drop Transaktionsexport.csv here</div>
        <div style="font-size:11px;color:#898781">or click to browse</div>
      </div>
      <div id="import-msg" style="font-size:12px;margin-top:.6rem;min-height:18px"></div>
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
        <div class="form-group">
          <label class="form-label">TR ETF portfolio — total value (€)</label>
          <input type="number" id="snap-tr" class="form-input" placeholder="TR home screen total">
        </div>
        <div class="form-group">
          <label class="form-label">TR Cash / savings (€)</label>
          <input type="number" id="snap-tr-cash" class="form-input" placeholder="0 if fully invested">
        </div>
        <div class="form-group">
          <label class="form-label">N26 — total balance (€) <span style="font-weight:400;color:#898781">current + savings</span></label>
          <input type="number" id="snap-n26" class="form-input" placeholder="N26 current + savings">
        </div>
        <div class="form-group">
          <label class="form-label">Ginkgo bAV (€)</label>
          <input type="number" id="snap-bav" class="form-input" placeholder="from Ginkgo statement">
        </div>
        <div class="form-group">
          <label class="form-label">AVD (€) — optional</label>
          <input type="number" id="snap-avd" class="form-input" placeholder="when set up Jan 2027">
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:14px;margin-top:.25rem">
        <button class="btn btn-primary" id="btn-save-snap">Save snapshot</button>
        <span id="snap-msg" style="font-size:12px;min-height:18px"></span>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Snapshot history</div>
      <div id="snaps-list"></div>
    </div>
  </div>
</div>
`;
}

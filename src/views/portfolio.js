import { fmt, fmtMon } from '../utils.js';
import { ISIN_ORDER, META } from '../constants.js';
import Chart from 'chart.js/auto';

const CH = {};

export function renderPortfolio(pd, snaps) {
  const has = pd && Object.keys(pd.etfs).length > 0;
  document.getElementById('port-empty').style.display   = has ? 'none'  : 'block';
  document.getElementById('port-content').style.display = has ? 'block' : 'none';
  if (!has) return;

  const latSnap = snaps.length > 0 ? snaps[snaps.length - 1] : null;
  const curVal  = latSnap ? (latSnap.tr_portfolio || 0) : null;
  const gain    = curVal !== null ? curVal - pd.totalInv : null;
  const gainPct = gain !== null && pd.totalInv > 0 ? gain / pd.totalInv * 100 : null;

  document.getElementById('port-kpis').innerHTML = `
    <div class="kpi"><div class="kpi-label">Total invested</div><div class="kpi-val">${fmt(pd.totalInv)}</div><div class="kpi-sub">exact from CSV</div></div>
    <div class="kpi"><div class="kpi-label">Current TR value</div>
      <div class="kpi-val">${curVal !== null ? fmt(curVal) : '—'}</div>
      <div class="kpi-sub">${curVal !== null ? 'from ' + fmtMon(latSnap.date) + ' snapshot' : 'add a snapshot'}</div></div>
    <div class="kpi"><div class="kpi-label">Total gain</div>
      <div class="kpi-val ${gain !== null && gain >= 0 ? 'pos' : 'neg'}">${gain !== null ? (gain >= 0 ? '+' : '') + fmt(gain) : '—'}</div>
      <div class="kpi-sub">${gainPct !== null ? (gainPct >= 0 ? '+' : '') + gainPct.toFixed(1) + '%' : ''}</div></div>
    <div class="kpi"><div class="kpi-label">Dividends (net)</div><div class="kpi-val pos">${fmt(pd.totalDivNet, 2)}</div><div class="kpi-sub">after tax</div></div>
  `;

  const etfList = ISIN_ORDER.map(s => pd.etfs[s]).filter(Boolean)
    .concat(Object.values(pd.etfs).filter(e => !ISIN_ORDER.includes(e.symbol)));

  const rows = etfList.map(e => {
    const pct = pd.totalInv > 0 ? e.cost / pd.totalInv * 100 : 0;
    const avg = e.shares > 0 ? e.cost / e.shares : 0;
    const m   = META[e.ticker] || {};
    return `<div class="tbl-row" style="grid-template-columns:2.2fr 1fr 1fr 1fr 1fr 1fr">
      <div>
        <span style="font-weight:500;font-size:12px">${e.ticker}</span>
        <span class="badge ${m.active ? 'b-active' : 'b-closed'}" style="margin-left:4px">${m.active ? 'active' : 'closed'}</span>
        <span class="badge ${e.acc ? 'b-acc' : 'b-dist'}" style="margin-left:4px">${e.acc ? 'Acc' : 'Dist'}</span>
        <div style="font-size:11px;color:#898781">${e.symbol}</div>
      </div>
      <div><div style="font-weight:500">${fmt(e.cost)}</div>
        <div class="bar-wrap" style="max-width:80px"><div class="bar-fill" style="width:${pct.toFixed(0)}%;background:${e.color}"></div></div>
      </div>
      <div style="color:#52514e">${e.shares.toFixed(4)}</div>
      <div style="color:#52514e">${avg > 0 ? '€' + avg.toFixed(2) : '—'}</div>
      <div style="color:#52514e">${pct.toFixed(1)}%</div>
      <div style="color:${e.divNet > 0 ? '#0F6E56' : '#898781'}">${e.divNet > 0 ? fmt(e.divNet, 2) : '—'}</div>
    </div>`;
  }).join('');

  document.getElementById('port-table').innerHTML = `
    <div class="tbl-row th" style="grid-template-columns:2.2fr 1fr 1fr 1fr 1fr 1fr">
      <div>ETF</div><div>Cost basis</div><div>Shares</div><div>Avg price</div><div>% of cost</div><div>Div (net)</div>
    </div>${rows}
    <div class="tbl-row" style="grid-template-columns:2.2fr 1fr 1fr 1fr 1fr 1fr;border-top:1px solid #d3d1c7;margin-top:4px">
      <div style="font-weight:500">Total</div>
      <div style="font-weight:500">${fmt(pd.totalInv)}</div>
      <div></div><div></div>
      <div style="font-weight:500">100%</div>
      <div style="color:#0F6E56;font-weight:500">${fmt(pd.totalDivNet, 2)}</div>
    </div>`;

  const donutE = etfList.filter(e => e.cost > 0);
  if (CH['c-port-donut']) { CH['c-port-donut'].destroy(); }
  CH['c-port-donut'] = new Chart(document.getElementById('c-port-donut'), {
    type: 'doughnut',
    data: { labels: donutE.map(e => e.ticker), datasets: [{
      data: donutE.map(e => e.cost), backgroundColor: donutE.map(e => e.color),
      borderWidth: 3, borderColor: '#fff',
    }]},
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } },
  });
  document.getElementById('port-donut-legend').innerHTML =
    donutE.map(e => `<span class="leg-item"><span class="leg-sq" style="background:${e.color}"></span>${e.ticker} ${pd.totalInv > 0 ? (e.cost / pd.totalInv * 100).toFixed(0) : 0}%</span>`).join('');

  document.getElementById('port-summary').innerHTML = `
    <div class="row"><div class="row-label">Total invested</div><div class="row-val">${fmt(pd.totalInv)}</div></div>
    <div class="row"><div class="row-label">Dividends (net)</div><div class="row-val ok">${fmt(pd.totalDivNet, 2)}</div></div>
    <div class="row"><div class="row-label">Tax withheld on dividends</div><div class="row-val">${fmt(pd.totalTax, 2)}</div></div>
    <div class="row"><div class="row-label">TR interest earned</div><div class="row-val ok">${fmt(pd.totalInterest, 2)}</div></div>
    ${gain !== null ? `<div class="row" style="border-top:1px solid #d3d1c7;margin-top:4px">
      <div class="row-label" style="font-weight:500">Portfolio gain</div>
      <div class="row-val ${gain >= 0 ? 'pos' : 'neg'}" style="font-weight:500">
        ${gain >= 0 ? '+' : ''}${fmt(gain)} (${gainPct >= 0 ? '+' : ''}${gainPct.toFixed(1)}%)</div></div>` : ''}
    <p class="note">Cost basis exact from CSV. Current value from latest snapshot (${latSnap ? fmtMon(latSnap.date) : 'none yet'}).</p>
  `;
}

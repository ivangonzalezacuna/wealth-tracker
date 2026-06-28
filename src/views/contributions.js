import { fmt, fmtMon } from '../utils.js';
import { getISIN_ORDERList, getISIN, getMETAMap } from '../constants.js';
import { getTotalWeeklyTarget, getAnnualReturnPct, getPrimaryInvestmentAccounts } from '../store/config.js';
import Chart from 'chart.js/auto';

const CH = {};

/** Get the primary investment value from a snapshot. */
function getPrimaryInvestmentValue(snap) {
  if (!snap) return null;
  const primAccts = getPrimaryInvestmentAccounts();
  if (primAccts.length > 0) {
    return primAccts.reduce((sum, a) => sum + (snap[a.id] || 0), 0) || null;
  }
  return null;
}

export function renderDCA(pd, snaps) {
  const ISIN_ORDER = getISIN_ORDERList();
  const ISIN = getISIN();
  const META = getMETAMap();
  const has = pd && pd.months.length > 0;
  document.getElementById('dca-empty').style.display   = has ? 'none'  : 'block';
  document.getElementById('dca-content').style.display = has ? 'block' : 'none';
  if (!has) return;

  const total  = pd.totalInv;
  const n      = pd.months.length;
  const avg    = n > 0 ? total / n : 0;
  const lastM  = pd.months[n - 1];
  const lastAmt = pd.monthly[lastM] || 0;

  document.getElementById('dca-kpis').innerHTML = `
    <div class="kpi"><div class="kpi-label">Total invested</div><div class="kpi-val">${fmt(total)}</div><div class="kpi-sub">all savings plans</div></div>
    <div class="kpi"><div class="kpi-label">Active months</div><div class="kpi-val">${n}</div><div class="kpi-sub">${fmtMon(pd.months[0])} → ${fmtMon(lastM)}</div></div>
    <div class="kpi"><div class="kpi-label">Avg / month</div><div class="kpi-val">${fmt(avg)}</div></div>
    <div class="kpi"><div class="kpi-label">Latest month</div><div class="kpi-val">${fmt(lastAmt)}</div><div class="kpi-sub">${fmtMon(lastM)}</div></div>
  `;

  const allSyms = [...new Set(pd.months.flatMap(m => Object.keys(pd.monthlyBy[m] || {})))];
  const ordSyms = ISIN_ORDER.filter(s => allSyms.includes(s)).concat(allSyms.filter(s => !ISIN_ORDER.includes(s)));

  const datasets = ordSyms.map(sym => {
    const t = ISIN[sym] || sym;
    const m = META[t]   || {};
    return {
      label: t,
      data: pd.months.map(mo => (pd.monthlyBy[mo] || {})[sym] || 0),
      backgroundColor: m.color || '#898781',
      borderRadius: 3, borderSkipped: false,
    };
  });

  if (CH['c-dca-bar']) CH['c-dca-bar'].destroy();
  CH['c-dca-bar'] = new Chart(document.getElementById('c-dca-bar'), {
    type: 'bar',
    data: { labels: pd.months.map(fmtMon), datasets },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { stacked: true, grid: { display: false }, ticks: { color: '#52514e', font: { size: 10 } } },
        y: { stacked: true, grid: { color: '#e1e0d9' }, ticks: { color: '#898781', callback: v => '€' + v } },
      },
    },
  });

  document.getElementById('dca-legend').innerHTML = ordSyms.map(sym => {
    const t = ISIN[sym] || sym;
    const m = META[t]   || {};
    return `<span class="leg-item"><span class="leg-sq" style="background:${m.color || '#898781'}"></span>${t}</span>`;
  }).join('');

  const tRows = pd.months.slice().reverse().map(m =>
    `<div class="tbl-row" style="grid-template-columns:1fr 1fr">
      <div style="color:#52514e">${fmtMon(m)}</div>
      <div style="font-weight:500;text-align:right">${fmt(pd.monthly[m])}</div>
    </div>`).join('');

  document.getElementById('dca-table').innerHTML = `
    <div class="tbl-row th" style="grid-template-columns:1fr 1fr"><div>Month</div><div style="text-align:right">Invested</div></div>
    ${tRows}
    <div class="tbl-row" style="grid-template-columns:1fr 1fr;border-top:1px solid #d3d1c7;margin-top:4px">
      <div style="font-weight:500">Total</div>
      <div style="font-weight:500;text-align:right">${fmt(total)}</div>
    </div>`;

  // 5-year projection — uses real weekly target from config store
  const latSnap = snaps.length > 0 ? snaps[snaps.length - 1] : null;
  const startV  = getPrimaryInvestmentValue(latSnap) || pd.totalInv;
  const annualReturnPct = getAnnualReturnPct();
  const weeklyTarget = getTotalWeeklyTarget() || 200;
  const rate = annualReturnPct / 100 / 52, contrib = weeklyTarget;
  let v = startV;
  const pts = [v];
  for (let i = 1; i <= 260; i++) {
    v = Math.round((v + contrib) * (1 + rate));
    if (i % 52 === 0) pts.push(v);
  }

  if (CH['c-dca-proj']) CH['c-dca-proj'].destroy();
  const projTitle = document.getElementById('dca-proj-title');
  if (projTitle) projTitle.textContent = `5-year projection (${annualReturnPct}% return, €${weeklyTarget}/wk target)`;
  CH['c-dca-proj'] = new Chart(document.getElementById('c-dca-proj'), {
    type: 'line',
    data: { labels: ['Now','Yr 1','Yr 2','Yr 3','Yr 4','Yr 5'],
      datasets: [{ label: 'Projected', data: pts,
        borderColor: '#2a78d6', backgroundColor: 'rgba(42,120,214,0.07)',
        borderWidth: 2, pointRadius: 4, pointBackgroundColor: '#2a78d6',
        fill: true, tension: 0.35 }]},
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { grid: { color: '#e1e0d9' }, ticks: { color: '#898781', callback: v => '€' + Math.round(v / 1000) + 'k' } },
        x: { grid: { display: false }, ticks: { color: '#52514e' } },
      },
    },
  });
}

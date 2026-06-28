import Chart from 'chart.js/auto';
import { getHoldings, getTotalWeeklyTarget, getSettings } from '../store/config.js';
import { esc } from '../utils.js';

let refChart = null;

export function renderRef() {
  if (refChart) { refChart.destroy(); refChart = null; }
  const el = document.getElementById('c-ref-target');
  if (!el) return;

  // Derive target allocation slices from active holdings with weeklyTarget > 0
  const holdings = getHoldings();
  const totalWeekly = getTotalWeeklyTarget();
  const activeWithTarget = holdings.filter(h => h.active && h.weeklyTarget > 0);

  if (activeWithTarget.length === 0) return;

  const slices = activeWithTarget.map(h => ({
    ticker: h.ticker,
    pct: totalWeekly > 0 ? Math.round(h.weeklyTarget / totalWeekly * 100) : 0,
    color: h.color,
    weeklyTarget: h.weeklyTarget,
    assetClass: h.assetClass,
    region: h.region,
  }));

  // Render legend
  const legendEl = document.getElementById('ref-legend');
  if (legendEl) {
    legendEl.innerHTML = slices.map(s =>
      `<span class="leg-item"><span class="leg-sq" style="background:${s.color}"></span>${esc(s.ticker)} ${s.pct}%</span>`
    ).join('');
  }

  // Render breakdown (derived from holdings assetClass/region)
  const breakdownEl = document.getElementById('ref-breakdown');
  if (breakdownEl) {
    const equityWt = slices.filter(s => s.assetClass === 'equity').reduce((sum, s) => sum + s.weeklyTarget, 0);
    const bondWt = slices.filter(s => s.assetClass === 'bond').reduce((sum, s) => sum + s.weeklyTarget, 0);
    const devWt = slices.filter(s => s.assetClass === 'equity' && s.region === 'developed').reduce((sum, s) => sum + s.weeklyTarget, 0);
    const emWt = slices.filter(s => s.assetClass === 'equity' && s.region === 'emerging').reduce((sum, s) => sum + s.weeklyTarget, 0);

    const pctOf = (part, whole) => whole > 0 ? Math.round(part / whole * 100) : 0;
    const lines = [];
    if (equityWt > 0) lines.push({ label: 'Equity', value: `${pctOf(equityWt, totalWeekly)}%` });
    if (bondWt > 0) lines.push({ label: 'Bonds', value: `${pctOf(bondWt, totalWeekly)}%` });
    if (devWt > 0) lines.push({ label: 'Developed equity', value: `${pctOf(devWt, totalWeekly)}%` });
    if (emWt > 0) lines.push({ label: 'Emerging equity', value: `${pctOf(emWt, totalWeekly)}%` });
    if (emWt > 0 && equityWt > 0) lines.push({ label: 'EM as % of equity', value: `${pctOf(emWt, equityWt)}%` });

    breakdownEl.innerHTML = lines.map(b =>
      `<div class="row"><div class="row-label">${b.label}</div><div class="row-val">${b.value}</div></div>`
    ).join('');
  }

  // Render weekly target note
  const noteEl = document.getElementById('ref-note');
  if (noteEl) {
    const parts = slices.map(s => `${s.ticker} €${s.weeklyTarget}`);
    noteEl.textContent = `Weekly target: ${parts.join(' · ')} = €${totalWeekly}/wk`;
  }

  // Render closed positions (derived from inactive holdings with foldInto)
  const closedEl = document.getElementById('ref-closed');
  if (closedEl) {
    const closed = holdings.filter(h => !h.active);
    if (closed.length > 0) {
      closedEl.innerHTML = closed.map(h => {
        const successor = h.foldInto ? holdings.find(x => x.isin === h.foldInto) : null;
        const label = successor
          ? `${esc(h.ticker)} → ${esc(successor.ticker)}`
          : `${esc(h.ticker)} (closed)`;
        return `<div class="row"><div class="row-label">${label}</div><div class="row-val"><span class="badge b-closed">no new money</span></div></div>`;
      }).join('') +
      '<p class="note">These positions fade naturally as new contributions grow the active positions.</p>';
    } else {
      closedEl.innerHTML = '<p class="note">No closed positions.</p>';
    }
  }

  // Render settings/rules from Settings store
  const rulesEl = document.getElementById('ref-rules');
  if (rulesEl) {
    const settings = getSettings();
    const ruleKeys = Object.keys(settings).filter(k => k.startsWith('rule_') && k.endsWith('_label'));
    if (ruleKeys.length > 0) {
      rulesEl.innerHTML = ruleKeys.sort().map(k => {
        const idx = k.replace('rule_', '').replace('_label', '');
        const label = settings[k];
        const value = settings[`rule_${idx}_value`] || '';
        return `<div class="row"><div class="row-label">${esc(label)}</div><div class="row-val">${esc(value)}</div></div>`;
      }).join('');
    } else {
      rulesEl.innerHTML = '<p class="note">No rules configured. Add rules in Settings.</p>';
    }
  }

  // Render chart
  refChart = new Chart(el, {
    type: 'doughnut',
    data: {
      labels: slices.map(s => s.ticker),
      datasets: [{
        data: slices.map(s => s.pct),
        backgroundColor: slices.map(s => s.color),
        borderWidth: 3, borderColor: '#fff',
      }],
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } },
  });
}

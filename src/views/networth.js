import { snapTotal, fmt, fmtMon } from '../utils.js';
import { ACCTS } from '../constants.js';
import Chart from 'chart.js/auto';

const CH = {};

export function renderNW(snaps) {
  const has = snaps.length > 0;
  document.getElementById('nw-empty').style.display   = has ? 'none'  : 'block';
  document.getElementById('nw-content').style.display = has ? 'block' : 'none';
  if (!has) return;

  const s     = snaps[snaps.length - 1];
  const total = snapTotal(s);
  const prev  = snaps.length > 1 ? snaps[snaps.length - 2] : null;
  const prevT = prev ? snapTotal(prev) : null;
  const chg   = prevT !== null ? total - prevT : null;
  const activeA = ACCTS.filter(a => (s[a.key] || 0) > 0);

  document.getElementById('nw-kpis').innerHTML = `
    <div class="kpi">
      <div class="kpi-label">Net worth</div>
      <div class="kpi-val">${fmt(total)}</div>
      <div class="kpi-sub">${chg !== null
        ? (chg >= 0 ? '+' : '') + fmt(chg) + ' vs ' + fmtMon(prev.date)
        : fmtMon(s.date)}</div>
    </div>
    ${activeA.map(a => `
      <div class="kpi">
        <div class="kpi-label">${a.label}</div>
        <div class="kpi-val">${fmt(s[a.key] || 0)}</div>
        <div class="kpi-sub">${total > 0 ? Math.round((s[a.key] || 0) / total * 100) : 0}% of total</div>
      </div>`).join('')}
  `;

  const chartA = ACCTS.filter(a => snaps.some(sn => (sn[a.key] || 0) > 0));
  const labels = snaps.map(sn => fmtMon(sn.date));

  document.getElementById('nw-chart-legend').innerHTML =
    chartA.map(a => `<span class="leg-item"><span class="leg-sq" style="background:${a.color}"></span>${a.label}</span>`).join('');

  document.getElementById('nw-chart-title').textContent = snaps.length === 1
    ? 'Account breakdown — ' + fmtMon(snaps[0].date) + ' (add more snapshots to see growth over time)'
    : 'Net worth — stacked by account · hover any month to see individual values';

  _destroyChart('c-nw-hist');
  if (snaps.length === 1) {
    CH['c-nw-hist'] = new Chart(document.getElementById('c-nw-hist'), {
      type: 'bar',
      data: {
        labels: chartA.map(a => a.label),
        datasets: [{ data: chartA.map(a => s[a.key] || 0),
          backgroundColor: chartA.map(a => a.color + 'cc'),
          borderColor: chartA.map(a => a.color),
          borderWidth: 1, borderRadius: 5, borderSkipped: false }],
      },
      options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false },
          tooltip: { callbacks: { label: ctx => ` ${fmt(ctx.raw)}` } } },
        scales: {
          x: { grid: { color: '#e1e0d9' }, ticks: { color: '#898781', callback: v => '€' + (v / 1000).toFixed(0) + 'k' } },
          y: { grid: { display: false }, ticks: { color: '#52514e', font: { size: 12 } } },
        },
      },
    });
  } else {
    CH['c-nw-hist'] = new Chart(document.getElementById('c-nw-hist'), {
      type: 'line',
      data: {
        labels,
        datasets: chartA.map(a => ({
          label: a.label, data: snaps.map(sn => sn[a.key] || 0),
          backgroundColor: a.color + 'cc', borderColor: a.color,
          borderWidth: 1, fill: true, tension: 0.3,
          pointRadius: 0, pointHoverRadius: 5, pointHoverBackgroundColor: a.color,
        })),
      },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false },
          tooltip: { mode: 'index', intersect: false,
            callbacks: {
              label: ctx => ` ${ctx.dataset.label}: ${fmt(ctx.raw)}`,
              footer: items => ` Total: ${fmt(items.reduce((s, i) => s + i.raw, 0))}`,
            },
            footerFont: { weight: 'bold' },
          },
        },
        scales: {
          y: { stacked: true, grid: { color: '#e1e0d9' },
               ticks: { color: '#898781', callback: v => '€' + (v / 1000).toFixed(0) + 'k' } },
          x: { grid: { display: false }, ticks: { color: '#52514e', font: { size: 10 } } },
        },
      },
    });
  }

  const bkA = ACCTS.filter(a => (s[a.key] || 0) > 0);
  _destroyChart('c-nw-donut');
  CH['c-nw-donut'] = new Chart(document.getElementById('c-nw-donut'), {
    type: 'doughnut',
    data: { labels: bkA.map(a => a.label), datasets: [{
      data: bkA.map(a => s[a.key] || 0), backgroundColor: bkA.map(a => a.color),
      borderWidth: 3, borderColor: '#fff',
    }]},
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } },
  });

  document.getElementById('nw-donut-legend').innerHTML =
    bkA.map(a => `<span class="leg-item"><span class="leg-sq" style="background:${a.color}"></span>${a.label} ${total > 0 ? Math.round((s[a.key] || 0) / total * 100) : 0}%</span>`).join('');

  let det = bkA.map(a =>
    `<div class="row"><div class="row-label">${a.label}</div><div class="row-val">${fmt(s[a.key] || 0)}</div></div>`
  ).join('');
  det += `<div class="row" style="border-top:1px solid #d3d1c7;margin-top:4px">
    <div class="row-label" style="font-weight:500">Total</div>
    <div class="row-val" style="font-weight:500">${fmt(total)}</div></div>`;
  if (prev) {
    const c = total - prevT;
    det += `<div class="row"><div class="row-label" style="color:#898781;font-size:12px">vs ${fmtMon(prev.date)}</div>
      <div class="row-val ${c >= 0 ? 'pos' : 'neg'}">${c >= 0 ? '+' : ''}${fmt(c)}</div></div>`;
  }
  if (s.notes) det += `<p class="note" style="margin-top:.5rem">📝 ${s.notes}</p>`;
  document.getElementById('nw-detail').innerHTML = det;
}

function _destroyChart(id) {
  if (CH[id]) { CH[id].destroy(); delete CH[id]; }
}

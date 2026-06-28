import Chart from 'chart.js/auto';
import { CONFIG } from '../config.js';

let refChart = null;

export function renderRef() {
  if (refChart) { refChart.destroy(); refChart = null; }
  const el = document.getElementById('c-ref-target');
  if (!el) return;

  const slices = CONFIG.targetAllocation.slices;
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

import Chart from 'chart.js/auto';

let refChart = null;

export function renderRef() {
  if (refChart) { refChart.destroy(); refChart = null; }
  const el = document.getElementById('c-ref-target');
  if (!el) return;
  refChart = new Chart(el, {
    type: 'doughnut',
    data: {
      labels: ['IWDA', 'SUSW', 'EIMI', 'AGGH'],
      datasets: [{
        data: [45, 15, 20, 20],
        backgroundColor: ['#2a78d6', '#1baf7a', '#eda100', '#4a3aa7'],
        borderWidth: 3, borderColor: '#fff',
      }],
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } },
  });
}

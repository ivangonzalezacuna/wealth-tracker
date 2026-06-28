export function snapTotal(s) {
  return (s.tr_portfolio || 0) + (s.tr_cash || 0) + (s.n26 || 0) + (s.bav || 0) + (s.avd || 0);
}

export function fmt(n, d = 0) {
  return '€' + Number(n).toLocaleString('de-DE', {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}

export function fmtMon(d) {
  if (!d) return '—';
  const [y, m] = d.split('-');
  return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+m - 1] + ' ' + y;
}

export function fmtDay(d) {
  if (!d) return '—';
  return new Date(d + 'T12:00:00').toLocaleDateString('de-DE', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

export function setChart(CH, id, cfg) {
  if (CH[id]) { CH[id].destroy(); delete CH[id]; }
  const el = document.getElementById(id);
  if (el) {
    const { Chart } = window._Chart;
    CH[id] = new Chart(el, cfg);
  }
}

export function showMsg(elId, text, ok) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = text;
  el.style.color = ok ? '#0F6E56' : '#A32D2D';
  if (ok) setTimeout(() => { el.textContent = ''; }, 3500);
}

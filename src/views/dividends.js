import { fmt, fmtDay, esc, safeColor } from '../utils.js';

export function renderDividends(pd) {
  const hasPD  = !!pd;
  const hasDiv = hasPD && pd.divHist.length > 0;

  document.getElementById('div-empty').style.display   = hasPD ? 'none'  : 'block';
  document.getElementById('div-content').style.display = hasPD ? 'block' : 'none';
  if (!hasPD) return;

  const totalGross = pd.divHist.reduce((s, d) => s + d.gross, 0);

  document.getElementById('div-kpis').innerHTML = `
    <div class="kpi"><div class="kpi-label">Gross dividends</div><div class="kpi-val">${fmt(totalGross, 2)}</div></div>
    <div class="kpi"><div class="kpi-label">Tax withheld</div><div class="kpi-val neg">−${fmt(pd.totalTax, 2)}</div><div class="kpi-sub">Abgeltungsteuer</div></div>
    <div class="kpi"><div class="kpi-label">Net received</div><div class="kpi-val pos">${fmt(pd.totalDivNet, 2)}</div></div>
    <div class="kpi"><div class="kpi-label">TR interest</div><div class="kpi-val pos">${fmt(pd.totalInterest, 2)}</div><div class="kpi-sub">on cash savings</div></div>
  `;

  const dRows = pd.divHist.map(d => `
    <div class="tbl-row" style="grid-template-columns:auto 1.5fr 1fr 1fr 1fr">
      <span class="leg-sq" style="background:${safeColor(d.color)};display:inline-block;margin-top:2px"></span>
      <div><div style="font-weight:500;font-size:12px">${esc(d.ticker)}</div>
           <div style="font-size:11px;color:#6b6a65">${fmtDay(d.date)}</div></div>
      <div style="color:#52514e">${fmt(d.gross, 2)}</div>
      <div style="color:#A32D2D">−${fmt(d.tax, 2)}</div>
      <div style="color:#0F6E56;font-weight:500">${fmt(d.net, 2)}</div>
    </div>`).join('');

  document.getElementById('div-history').innerHTML = hasDiv ? `
    <div class="tbl-row th" style="grid-template-columns:auto 1.5fr 1fr 1fr 1fr">
      <div></div><div>ETF / Date</div><div>Gross</div><div>Tax</div><div>Net</div>
    </div>${dRows}
    <div class="tbl-row" style="grid-template-columns:auto 1.5fr 1fr 1fr 1fr;border-top:1px solid #d3d1c7;margin-top:4px">
      <div></div><div style="font-weight:500">Total</div>
      <div style="font-weight:500">${fmt(totalGross, 2)}</div>
      <div style="color:#A32D2D">−${fmt(pd.totalTax, 2)}</div>
      <div style="color:#0F6E56;font-weight:500">${fmt(pd.totalDivNet, 2)}</div>
    </div>` : '<p class="note">No dividends found in imported transactions yet.</p>';

  document.getElementById('div-interest').innerHTML = pd.intHist.length > 0
    ? pd.intHist.map(i =>
        `<div class="row"><div class="row-label">${fmtDay(i.date)}</div><div class="row-val ok">${fmt(i.amount, 2)}</div></div>`
      ).join('') +
      `<div class="row" style="border-top:1px solid #d3d1c7;margin-top:4px">
        <div class="row-label" style="font-weight:500">Total interest</div>
        <div class="row-val ok" style="font-weight:500">${fmt(pd.totalInterest, 2)}</div></div>`
    : '<p class="note">No interest payments found in imported transactions.</p>';
}

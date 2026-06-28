import { ISIN, META } from './constants.js';

export function computePD(rows) {
  const etfs      = {};
  const divHist   = [];
  const intHist   = [];
  const monthly   = {};
  const monthlyBy = {};
  let totalInterest = 0;

  for (const tx of rows) {
    const ticker = ISIN[tx.symbol] || '';
    const meta   = META[ticker]    || {};

    if (tx.type === 'BUY' && tx.category === 'TRADING') {
      const cost = Math.abs(tx.amount);
      if (!etfs[tx.symbol]) {
        etfs[tx.symbol] = {
          symbol: tx.symbol,
          ticker: ticker || tx.symbol.slice(-4),
          name:   tx.name,
          color:  meta.color || '#898781',
          acc:    meta.acc !== false,
          active: meta.active !== false,
          cost: 0, shares: 0, divNet: 0, taxPaid: 0, buys: 0,
        };
      }
      etfs[tx.symbol].cost   += cost;
      etfs[tx.symbol].shares += tx.shares;
      etfs[tx.symbol].buys   += 1;
      const m = tx.date.slice(0, 7);
      monthly[m]   = (monthly[m] || 0) + cost;
      if (!monthlyBy[m]) monthlyBy[m] = {};
      monthlyBy[m][tx.symbol] = (monthlyBy[m][tx.symbol] || 0) + cost;
    } else if (tx.type === 'DIVIDEND') {
      if (!etfs[tx.symbol]) {
        etfs[tx.symbol] = {
          symbol: tx.symbol, ticker, name: tx.name,
          color: meta.color || '#898781',
          acc: false, active: false,
          cost: 0, shares: 0, divNet: 0, taxPaid: 0, buys: 0,
        };
      }
      const taxAbs = Math.abs(tx.tax);
      etfs[tx.symbol].divNet  += tx.amount;
      etfs[tx.symbol].taxPaid += taxAbs;
      divHist.push({
        date: tx.date, ticker: ticker || tx.symbol, name: tx.name,
        gross: tx.amount + taxAbs, net: tx.amount, tax: taxAbs,
        color: meta.color || '#898781',
      });
    } else if (tx.type === 'INTEREST_PAYMENT') {
      totalInterest += tx.amount;
      intHist.push({ date: tx.date, amount: tx.amount });
    }
  }

  divHist.sort((a, b) => b.date.localeCompare(a.date));
  intHist.sort((a, b) => b.date.localeCompare(a.date));

  const totalInv    = Object.values(etfs).reduce((s, e) => s + e.cost, 0);
  const totalDivNet = Object.values(etfs).reduce((s, e) => s + e.divNet, 0);
  const totalTax    = Object.values(etfs).reduce((s, e) => s + e.taxPaid, 0);
  const months      = Object.keys(monthly).sort();

  return { etfs, divHist, intHist, monthly, monthlyBy, months,
           totalInv, totalDivNet, totalTax, totalInterest };
}
